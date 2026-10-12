import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7?target=deno";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedPushHosts = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function logPushError(code: string) {
  console.error(JSON.stringify({
    feature: "professional-push",
    code,
    timestamp: new Date().toISOString(),
  }));
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    return null;
  }
}

function validSubscription(subscription: Record<string, any>) {
  try {
    const endpoint = new URL(subscription.endpoint);
    const p256dh = typeof subscription.p256dh === "string"
      ? decodeBase64Url(subscription.p256dh)
      : null;
    const auth = typeof subscription.auth_secret === "string"
      ? decodeBase64Url(subscription.auth_secret)
      : null;
    return endpoint.protocol === "https:" &&
      allowedPushHosts.has(endpoint.hostname) &&
      !endpoint.username && !endpoint.password &&
      p256dh?.length === 65 && auth?.length === 16;
  } catch {
    return false;
  }
}

function safeRoute(notification: Record<string, any>) {
  if (notification.category === "appointment") return "/dashboard/appointments";
  if (["subscription", "payment"].includes(notification.category)) return "/dashboard/plan";
  if (notification.category === "support") return "/dashboard/ai";
  return "/dashboard";
}

async function disableSubscription(admin: ReturnType<typeof createClient>, id: string) {
  const { error } = await admin
    .from("professional_push_subscriptions")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) logPushError("subscription_disable_failed");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    logPushError("missing_supabase_configuration");
    return json({ error: "Push delivery is not configured" }, 503);
  }
  if (req.headers.get("Authorization") !== `Bearer ${serviceRoleKey}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "Invalid request" }, 400);
    }
    body = parsed;
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const notificationId = body.notification_id;
  if (typeof notificationId !== "string" || !uuidPattern.test(notificationId)) {
    return json({ error: "Invalid notification id" }, 400);
  }

  const vapidPublicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("WEB_PUSH_VAPID_SUBJECT");
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject ||
    !(vapidSubject.startsWith("mailto:") || vapidSubject.startsWith("https://"))) {
    logPushError("missing_vapid_configuration");
    return json({ error: "Push delivery is not configured" }, 503);
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch {
    logPushError("invalid_vapid_configuration");
    return json({ error: "Push delivery is not configured" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: notification, error: notificationError } = await admin
      .from("professional_notifications")
      .select("id,business_id,recipient_user_id,category,event_type,title,body,data")
      .eq("id", notificationId)
      .maybeSingle();
    if (notificationError) throw notificationError;
    if (!notification) return json({ error: "Notification not found" }, 404);

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("owner_id")
      .eq("id", notification.business_id)
      .maybeSingle();
    if (businessError) throw businessError;
    if (!business || business.owner_id !== notification.recipient_user_id) {
      logPushError("notification_owner_mismatch");
      return json({ error: "Notification owner mismatch" }, 403);
    }

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from("professional_push_subscriptions")
      .select("id,endpoint,p256dh,auth_secret,expiration_time")
      .eq("business_id", notification.business_id)
      .eq("owner_id", notification.recipient_user_id)
      .eq("enabled", true);
    if (subscriptionsError) throw subscriptionsError;

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const subscription of subscriptions || []) {
      const expiration = subscription.expiration_time
        ? Date.parse(subscription.expiration_time)
        : null;
      if ((expiration !== null && expiration <= Date.now()) || !validSubscription(subscription)) {
        await disableSubscription(admin, subscription.id);
        skipped += 1;
        continue;
      }

      const { error: claimError } = await admin
        .from("professional_push_deliveries")
        .insert({ notification_id: notification.id, subscription_id: subscription.id });
      if (claimError?.code === "23505") {
        skipped += 1;
        continue;
      }
      if (claimError) {
        logPushError("delivery_claim_failed");
        failed += 1;
        continue;
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
          },
          JSON.stringify({
            title: notification.title,
            body: notification.body,
            data: { url: safeRoute(notification) },
          }),
          { TTL: 3600 },
        );
        const { error: deliveryError } = await admin
          .from("professional_push_deliveries")
          .update({ delivered_at: new Date().toISOString(), last_error_code: null })
          .eq("notification_id", notification.id)
          .eq("subscription_id", subscription.id);
        if (deliveryError) logPushError("delivery_receipt_update_failed");
        sent += 1;
      } catch (pushError) {
        const statusCode = typeof pushError === "object" && pushError !== null &&
          "statusCode" in pushError && typeof pushError.statusCode === "number"
          ? pushError.statusCode
          : null;
        const invalidSubscription = [400, 404, 410].includes(statusCode || 0);
        const safeCode = statusCode ? `push_${statusCode}` : "push_delivery_failed";
        const { error: deliveryError } = await admin
          .from("professional_push_deliveries")
          .update({ last_error_code: safeCode })
          .eq("notification_id", notification.id)
          .eq("subscription_id", subscription.id);
        if (deliveryError) logPushError("delivery_error_update_failed");
        if (invalidSubscription) await disableSubscription(admin, subscription.id);
        logPushError(safeCode);
        failed += 1;
      }
    }

    return json({ sent, failed, skipped });
  } catch (error) {
    logPushError(error instanceof Error ? error.name : "push_dispatch_failed");
    return json({ error: "Push dispatch failed" }, 500);
  }
});