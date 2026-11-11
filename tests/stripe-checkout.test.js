import assert from "node:assert/strict";
import test from "node:test";
import { createCardSubscriptionCheckout } from "../supabase/functions/_shared/stripeCheckout.ts";

test("subscription Checkout accepts cards and requests automatic SCA", () => {
  const metadata = { business_id: "business-1", owner_id: "owner-1", plan: "plus" };
  const options = createCardSubscriptionCheckout({
    appOrigin: "https://bookeasy.example",
    customerEmail: "owner@example.com",
    metadata,
    priceId: "price_test_monthly",
    userId: "owner-1",
  });

  assert.equal(options.mode, "subscription");
  assert.deepEqual(options.payment_method_types, ["card"]);
  assert.equal(options.payment_method_options.card.request_three_d_secure, "automatic");
  assert.deepEqual(options.line_items, [{ price: "price_test_monthly", quantity: 1 }]);
  assert.equal(options.success_url, "https://bookeasy.example/dashboard/plan?payment=success");
  assert.equal(options.cancel_url, "https://bookeasy.example/dashboard/plan?payment=cancelled");
  assert.equal(options.customer_email, "owner@example.com");
  assert.deepEqual(options.metadata, metadata);
});

test("existing Stripe customer is preferred when available", () => {
  const options = createCardSubscriptionCheckout({
    appOrigin: "https://bookeasy.example",
    customerId: "cus_existing",
    customerEmail: "ignored@example.com",
    metadata: {},
    priceId: "price_live_monthly",
    userId: "owner-1",
  });

  assert.equal(options.customer, "cus_existing");
  assert.equal("customer_email" in options, false);
});