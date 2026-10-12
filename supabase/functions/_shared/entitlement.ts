// Central server-side entitlement logic. Based on the subscriptions row, NOT on
// businesses.subscription_plan.
export type SubscriptionRow = {
  plan: string | null;
  status: string | null;
  trial_end: string | null;
  current_period_end: string | null;
};

export type Entitlement = {
  hasAccess: boolean;
  plan: "basic" | "plus" | null;
  state: "trial" | "active" | "restricted";
  reason: string;
};

export function computeEntitlement(
  sub: SubscriptionRow | null | undefined,
  now: Date = new Date(),
): Entitlement {
  if (!sub) {
    return { hasAccess: false, plan: null, state: "restricted", reason: "no_subscription" };
  }
  const plan = sub.plan === "plus" ? "plus" : "basic";
  if (sub.status === "active") {
    // No grace period: an active subscription whose period has ended is not entitled.
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
    if (periodEnd && periodEnd.getTime() <= now.getTime()) {
      return { hasAccess: false, plan: null, state: "restricted", reason: "period_ended" };
    }
    return { hasAccess: true, plan, state: "active", reason: "active" };
  }
  if (sub.status === "trialing") {
    const end = sub.trial_end ? new Date(sub.trial_end) : null;
    if (end && end.getTime() > now.getTime()) {
      return { hasAccess: true, plan, state: "trial", reason: "trial" };
    }
    return { hasAccess: false, plan: null, state: "restricted", reason: "trial_expired" };
  }
  return { hasAccess: false, plan: null, state: "restricted", reason: sub.status || "unknown" };
}

// deno-lint-ignore no-explicit-any
export async function getEntitlement(admin: any, businessId: string): Promise<Entitlement> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("plan,status,trial_end,current_period_end")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  return computeEntitlement(data);
}
