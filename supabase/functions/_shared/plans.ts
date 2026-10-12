// Server-side Stripe price allowlist. Clients may only request a plan name.
export const PRICE_BY_PLAN: Record<string, string> = {
  basic: "price_1UJHObQfYqQ6BGmE9CqD61td",
  plus: "price_1UJHPAQfYqQ6BGmENDRIFPCF",
};

export const PLAN_BY_PRICE: Record<string, string> = Object.fromEntries(
  Object.entries(PRICE_BY_PLAN).map(([plan, price]) => [price, plan]),
);
