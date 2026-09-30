import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-12-18.acacia",
});

Deno.serve(async (req) => {
  try {
    const { priceId, userId, email } = await req.json();

    if (!priceId || !userId) {
      return new Response(
        JSON.stringify({ error: "priceId και userId απαιτούνται" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const allowedPrices = [
      "price_1UJHObQfYqQ6BGmE9CqD61td",
      "price_1UJHPAQfYqQ6BGmENDRIFPCF",
    ];

    if (!allowedPrices.includes(priceId)) {
      return new Response(
        JSON.stringify({ error: "Μη έγκυρο πακέτο" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url:
        (req.headers.get("origin") || "http://localhost:5173") +
        "/dashboard?payment=success",
      cancel_url:
        (req.headers.get("origin") || "http://localhost:5173") +
        "/dashboard?payment=cancelled",
      metadata: {
        user_id: userId,
        subscription_plan:
          priceId === "price_1UJHPAQfYqQ6BGmENDRIFPCF"
            ? "plus"
            : "basic",
      },
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Stripe error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
