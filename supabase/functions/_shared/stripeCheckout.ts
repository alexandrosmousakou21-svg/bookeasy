export interface CardSubscriptionCheckoutInput {
  appOrigin: string;
  customerId?: string | null;
  customerEmail?: string;
  metadata: Record<string, string>;
  priceId: string;
  userId: string;
}

export function createCardSubscriptionCheckout(input: CardSubscriptionCheckoutInput) {
  return {
    mode: "subscription" as const,
    payment_method_types: ["card"] as const,
    payment_method_options: {
      card: { request_three_d_secure: "automatic" as const },
    },
    ...(input.customerId
      ? { customer: input.customerId }
      : { customer_email: input.customerEmail || undefined }),
    client_reference_id: input.userId,
    line_items: [{ price: input.priceId, quantity: 1 }],
    subscription_data: { metadata: input.metadata },
    success_url: new URL("/dashboard/plan?payment=success", input.appOrigin).toString(),
    cancel_url: new URL("/dashboard/plan?payment=cancelled", input.appOrigin).toString(),
    metadata: input.metadata,
  };
}