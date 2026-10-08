import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PLAN_BY_PRICE } from "../_shared/plans.ts";
import { computeEntitlement } from "../_shared/entitlement.ts";
import { decideSync } from "../_shared/subscription-sync.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-12-18.acacia",
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const iso = (seconds?: number | null) =>
  seconds ? new Date(seconds * 1000).toISOString() : null;

// deno-lint-ignore no-explicit-any
type Admin = any;

async function resolveBusinessId(admin: Admin, sub: Stripe.Subscription) {
  if (sub.metadata?.business_id) return sub.metadata.business_id as string;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const { data } = await admin
    .from("subscriptions")
    .select("business_id")
    .or(`stripe_subscription_id.eq.${sub.id},stripe_customer_id.eq.${customerId}`)
    .maybeSingle();
  return data?.business_id as string | undefined;
}

// Returns true when the subscription row was actually updated.
async function syncSubscription(admin: Admin, sub: Stripe.Subscription, event: Stripe.Event): Promise<boolean> {
  const businessId = await resolveBusinessId(admin, sub);
  if (!businessId) {
    console.warn("webhook: subscription without business", { event: event.id, subscription: sub.id });
    return false;
  }
  const { data: business } = await admin
    .from("businesses")
    .select("id,owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) return false;

  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan = priceId ? PLAN_BY_PRICE[priceId] : undefined;
  if (plan !== "basic" && plan !== "plus") {
    // Unknown price: change nothing and fail so the event is NOT marked processed (safe state kept).
    console.error("webhook: unknown stripe price, entitlement unchanged", {
      event: event.id,
      type: event.type,
      subscription: sub.id,
      price: priceId || null,
    });
    throw new Error("unknown_price");
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  const { data: existing } = await admin
    .from("subscriptions")
    .select("id,stripe_subscription_id,status,last_stripe_event_at")
    .eq("business_id", businessId)
    .maybeSingle();

  const decision = decideSync(existing, sub.id, event.created);
  if (decision !== "apply") {
    console.warn("webhook: ignored event", { event: event.id, type: event.type, decision, subscription: sub.id });
    return false;
  }

  const eventAt = new Date(event.created * 1000).toISOString();
  const row: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    plan,
    status: sub.status,
    current_period_start: iso(sub.current_period_start),
    current_period_end: iso(sub.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end,
    last_stripe_event_at: eventAt,
  };
  if (sub.trial_start) row.trial_start = iso(sub.trial_start);
  if (sub.trial_end) row.trial_end = iso(sub.trial_end);

  if (existing) {
    // Conditional update: only if no newer event was applied in the meantime.
    const { data: updated, error } = await admin
      .from("subscriptions")
      .update(row)
      .eq("id", existing.id)
      .or(`last_stripe_event_at.is.null,last_stripe_event_at.lte.${eventAt}`)
      .select("id");
    if (error) throw error;
    if (!updated?.length) return false;
  } else {
    const { error } = await admin
      .from("subscriptions")
      .insert({ ...row, business_id: businessId, user_id: business.owner_id });
    if (error) throw error;
  }

  // businesses.subscription_plan is only ever written here (service role).
  const entitlement = computeEntitlement({
    plan,
    status: sub.status,
    trial_end: iso(sub.trial_end),
    current_period_end: iso(sub.current_period_end),
  });
  const { error: bizError } = await admin
    .from("businesses")
    .update({ subscription_plan: entitlement.hasAccess ? plan : "basic" })
    .eq("id", businessId);
  if (bizError) throw bizError;
  return true;
}

async function handleEvent(admin: Admin, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) return;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      if (!sub.metadata?.business_id && session.metadata?.business_id) {
        sub.metadata = { ...sub.metadata, ...session.metadata };
      }
      await syncSubscription(admin, sub, event);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(admin, event.data.object as Stripe.Subscription, event);
      return;
    }
    case "invoice.payment_failed": {
      // deno-lint-ignore no-explicit-any
      const invoice = event.data.object as any;
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
      if (!subId) return;
      const sub = await stripe.subscriptions.retrieve(subId);
      const applied = await syncSubscription(admin, sub, event);
      // A failed payment is never treated as active (only if this event was applied).
      if (applied && sub.status === "active") {
        await admin.from("subscriptions").update({ status: "past_due" }).eq("stripe_subscription_id", subId);
        const { data } = await admin.from("subscriptions").select("business_id").eq("stripe_subscription_id", subId).maybeSingle();
        if (data) await admin.from("businesses").update({ subscription_plan: "basic" }).eq("id", data.business_id);
      }
      return;
    }
    default:
      return;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) {
    return new Response("Webhook not configured", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret, undefined, cryptoProvider);
  } catch (_error) {
    return new Response("Invalid signature", { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Idempotency: claim the event id first; duplicates are acknowledged without reprocessing.
  const { error: claimError } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (claimError) {
    if (claimError.code === "23505") return new Response("duplicate", { status: 200 });
    console.error("stripe_events insert failed", claimError);
    return new Response("Server error", { status: 500 });
  }

  try {
    await handleEvent(admin, event);
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("webhook processing failed", event.type, error);
    // Release the claim so Stripe's retry is processed.
    await admin.from("stripe_events").delete().eq("id", event.id);
    return new Response("Processing failed", { status: 500 });
  }
});
