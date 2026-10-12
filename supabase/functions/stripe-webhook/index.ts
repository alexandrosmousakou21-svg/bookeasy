import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const planByPrice = new Map([
  ["price_1UJHObQfYqQ6BGmE9CqD61td", "basic"],
  ["price_1UJHPAQfYqQ6BGmENDRIFPCF", "plus"],
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function logWebhookError(code: string) {
  console.error(JSON.stringify({
    feature: "stripe-webhook",
    code,
    timestamp: new Date().toISOString(),
  }));
}

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id || null;
}

function isoFromUnix(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

async function recordEvent(
  admin: ReturnType<typeof createClient>,
  event: Stripe.Event,
  subscription?: Stripe.Subscription,
) {
  if (!subscription) {
    const { error } = await admin.rpc("sync_stripe_subscription_state", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_event_created_at: isoFromUnix(event.created),
      p_business_id: null,
      p_owner_id: null,
      p_stripe_customer_id: null,
      p_stripe_subscription_id: null,
      p_stripe_price_id: null,
      p_plan: null,
      p_status: null,
      p_current_period_start: null,
      p_current_period_end: null,
      p_cancel_at_period_end: null,
    });
    if (error) throw error;
    return;
  }

  const businessId = subscription.metadata?.business_id;
  const ownerId = subscription.metadata?.owner_id;
  const price = subscription.items.data[0]?.price;
  const priceId = price?.id;
  const plan = priceId ? planByPrice.get(priceId) : undefined;
  if (
    !businessId || !uuidPattern.test(businessId) ||
    !ownerId || !uuidPattern.test(ownerId) ||
    !priceId || !plan ||
    price?.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    subscription.metadata?.plan !== plan
  ) {
    throw new Error("Subscription metadata or price is invalid");
  }

  const { error } = await admin.rpc("sync_stripe_subscription_state", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_event_created_at: isoFromUnix(event.created),
    p_business_id: businessId,
    p_owner_id: ownerId,
    p_stripe_customer_id: stripeId(subscription.customer),
    p_stripe_subscription_id: subscription.id,
    p_stripe_price_id: priceId,
    p_plan: plan,
    p_status: subscription.status,
    p_current_period_start: isoFromUnix(subscription.current_period_start),
    p_current_period_end: isoFromUnix(subscription.current_period_end),
    p_cancel_at_period_end: subscription.cancel_at_period_end,
  });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!signature || !webhookSecret || !stripeSecret || !supabaseUrl || !serviceRoleKey) {
    logWebhookError("missing_webhook_configuration");
    return json({ error: "Webhook configuration unavailable" }, 503);
  }

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-12-18.acacia" });
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch {
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = new Stripe(stripeSecret, { apiVersion: "2024-12-18.acacia" });

  try {
    let subscription: Stripe.Subscription | undefined;
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        const subscriptionId = stripeId(session.subscription);
        if (subscriptionId) {
          subscription = await stripe.subscriptions.retrieve(subscriptionId);
        }
      }
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const businessId = session.metadata?.business_id;
      const ownerId = session.metadata?.owner_id;
      const requestId = session.metadata?.checkout_request_id;
      if (
        businessId && uuidPattern.test(businessId) &&
        ownerId && uuidPattern.test(ownerId) &&
        requestId && uuidPattern.test(requestId)
      ) {
        const { error } = await admin.rpc("expire_stripe_checkout", {
          p_event_id: event.id,
          p_event_type: event.type,
          p_event_created_at: isoFromUnix(event.created),
          p_business_id: businessId,
          p_owner_id: ownerId,
          p_request_id: requestId,
          p_session_id: session.id,
        });
        if (error) throw error;
      } else {
        await recordEvent(admin, event);
      }
      return json({ received: true }, 200);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const eventSubscription = event.data.object as Stripe.Subscription;
      subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = stripeId(invoice.subscription);
      if (subscriptionId) {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
      }
    } else {
      return json({ received: true, ignored: true }, 200);
    }

    await recordEvent(admin, event, subscription);
    return json({ received: true }, 200);
  } catch (error) {
    logWebhookError(error instanceof Error ? error.name : "subscription_sync_failed");
    return json({ error: "Subscription state could not be synchronized" }, 500);
  }
});
