import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const planByPrice = new Map([
  ["price_1UJHObQfYqQ6BGmE9CqD61td", "basic"],
  ["price_1UJHPAQfYqQ6BGmENDRIFPCF", "plus"],
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const developmentOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "https://localhost",
  "capacitor://localhost",
]);

function json(body: unknown, status: number, origin?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function logSubscriptionError(error: unknown) {
  console.error(JSON.stringify({
    feature: "manage-subscription",
    code: error instanceof Error ? error.name : "unknown_error",
    timestamp: new Date().toISOString(),
  }));
}

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id || null;
}

function isoFromUnix(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

function publicState(subscription: any) {
  return {
    plan: subscription.plan,
    status: subscription.status,
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get("Origin") || undefined;
  const allowedOrigins = new Set(developmentOrigins);
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  try {
    const parsed = new URL(appBaseUrl || "");
    if (parsed.protocol === "https:" && parsed.pathname === "/" && !parsed.search && !parsed.hash) {
      allowedOrigins.add(parsed.origin);
    }
  } catch {
    // Missing APP_BASE_URL is reported as configuration failure below.
  }
  if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
    return json({ error: "Η προέλευση του αιτήματος δεν επιτρέπεται." }, 403);
  }
  const corsOrigin = requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : undefined;
  const corsHeaders = new Headers();
  if (corsOrigin) {
    corsHeaders.set("Access-Control-Allow-Origin", corsOrigin);
    corsHeaders.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    corsHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    corsHeaders.set("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Μη υποστηριζόμενο αίτημα." }, 405, corsOrigin);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    if (!bearer) return json({ error: "Απαιτείται έγκυρη σύνδεση." }, 401, corsOrigin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !stripeSecret || !appBaseUrl) {
      logSubscriptionError(new Error("subscription configuration unavailable"));
      return json({ error: "Η διαχείριση συνδρομών δεν είναι διαθέσιμη." }, 503, corsOrigin);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(bearer[1]);
    if (authError || !user) return json({ error: "Η σύνδεση δεν είναι έγκυρη." }, 401, corsOrigin);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Το αίτημα δεν είναι έγκυρο." }, 400, corsOrigin);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Το αίτημα δεν είναι έγκυρο." }, 400, corsOrigin);
    }

    const businessId = body.business_id;
    const action = body.action;
    if (typeof businessId !== "string" || !uuidPattern.test(businessId) || !["cancel", "resume"].includes(String(action))) {
      return json({ error: "Το αίτημα δεν είναι έγκυρο." }, 400, corsOrigin);
    }
    const { data: business, error: businessError } = await userClient
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (businessError) {
      logSubscriptionError(businessError);
      return json({ error: "Δεν ήταν δυνατή η επαλήθευση της επιχείρησης." }, 503, corsOrigin);
    }
    if (!business) return json({ error: "Δεν βρέθηκε επιχείρηση που να ανήκει στον λογαριασμό σας." }, 403, corsOrigin);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: current, error: subscriptionError } = await admin
      .from("business_subscriptions")
      .select("business_id,owner_id,stripe_subscription_id,plan,status,current_period_start,current_period_end,cancel_at_period_end")
      .eq("business_id", business.id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (subscriptionError) {
      logSubscriptionError(subscriptionError);
      return json({ error: "Δεν ήταν δυνατή η φόρτωση της συνδρομής." }, 503, corsOrigin);
    }
    if (!current?.stripe_subscription_id) {
      return json({ error: "Δεν υπάρχει συνδρομή για την επιχείρηση." }, 404, corsOrigin);
    }

    const now = Date.now();
    const periodEnd = current.current_period_end ? Date.parse(current.current_period_end) : 0;
    const periodStillOpen = periodEnd > now;
    const cancellationAllowed = periodStillOpen && ["active", "past_due"].includes(current.status);
    const resumeAllowed = periodStillOpen && current.status === "active";
    if (action === "cancel" && current.cancel_at_period_end && cancellationAllowed) {
      return json(publicState(current), 200, corsOrigin);
    }
    if (action === "resume" && !current.cancel_at_period_end && resumeAllowed) {
      return json(publicState(current), 200, corsOrigin);
    }
    if (action === "cancel" ? !cancellationAllowed : !resumeAllowed) {
      return json({ error: "Δεν υπάρχει ενεργή συνδρομή που να μπορεί να τροποποιηθεί." }, 409, corsOrigin);
    }
    if (action === "resume" && !current.cancel_at_period_end) {
      return json(publicState(current), 200, corsOrigin);
    }

    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-12-18.acacia" });
    const updated = await stripe.subscriptions.update(current.stripe_subscription_id, {
      cancel_at_period_end: action === "cancel",
    });
    const price = updated.items.data[0]?.price;
    const priceId = price?.id;
    const plan = priceId ? planByPrice.get(priceId) : undefined;
    const stripeCustomerId = stripeId(updated.customer);
    if (
      !plan || !priceId || !stripeCustomerId ||
      price?.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1
    ) {
      throw new Error("Updated Stripe subscription has invalid state");
    }

    const { error: syncError } = await admin.rpc("sync_stripe_subscription_state", {
      p_event_id: null,
      p_event_type: action === "cancel" ? "owner_cancel" : "owner_resume",
      p_event_created_at: new Date().toISOString(),
      p_business_id: business.id,
      p_owner_id: user.id,
      p_stripe_customer_id: stripeCustomerId,
      p_stripe_subscription_id: updated.id,
      p_stripe_price_id: priceId,
      p_plan: plan,
      p_status: updated.status,
      p_current_period_start: isoFromUnix(updated.current_period_start),
      p_current_period_end: isoFromUnix(updated.current_period_end),
      p_cancel_at_period_end: updated.cancel_at_period_end,
    });
    if (syncError) throw syncError;
    return json(publicState({
      plan,
      status: updated.status,
      current_period_start: isoFromUnix(updated.current_period_start),
      current_period_end: isoFromUnix(updated.current_period_end),
      cancel_at_period_end: updated.cancel_at_period_end,
    }), 200, corsOrigin);
  } catch (error) {
    logSubscriptionError(error);
    return json({ error: "Δεν ήταν δυνατή η ενημέρωση της συνδρομής. Δοκιμάστε ξανά." }, 500, corsOrigin);
  }
});
