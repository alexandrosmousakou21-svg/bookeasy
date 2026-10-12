// Pure decision logic shared by stripe-webhook and create-checkout (unit-testable, no I/O).
export const TERMINAL_STATUSES = ["canceled", "incomplete_expired"];

export type ExistingSub = {
  stripe_subscription_id: string | null;
  status: string | null;
  last_stripe_event_at: string | null;
} | null;

export type SyncDecision = "apply" | "stale" | "other_subscription";

export function decideSync(
  existing: ExistingSub,
  incomingSubscriptionId: string,
  eventCreatedSeconds: number,
): SyncDecision {
  if (!existing) return "apply";
  // Older event than the last one applied -> never roll state back.
  if (
    existing.last_stripe_event_at &&
    eventCreatedSeconds * 1000 < new Date(existing.last_stripe_event_at).getTime()
  ) {
    return "stale";
  }
  if (
    existing.stripe_subscription_id &&
    existing.stripe_subscription_id !== incomingSubscriptionId &&
    !TERMINAL_STATUSES.includes(existing.status || "")
  ) {
    // Event for an old/different Stripe subscription while another one is live.
    return "other_subscription";
  }
  return "apply";
}

// A checkout is blocked when a non-terminal Stripe subscription already exists.
// The internal (non-Stripe) trial has no stripe_subscription_id and must be able to check out.
export function checkoutBlocked(
  existing: { stripe_subscription_id: string | null; status: string | null } | null,
  liveStripeStatuses: string[] = [],
): boolean {
  const liveStripe = liveStripeStatuses.some((s) => !TERMINAL_STATUSES.includes(s));
  if (liveStripe) return true;
  if (!existing?.stripe_subscription_id) return false;
  return !TERMINAL_STATUSES.includes(existing.status || "");
}
