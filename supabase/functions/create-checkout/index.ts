import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PLAN_BY_PRICE, PRICE_BY_PLAN } from "../_shared/plans.ts";
import { appBaseUrl, corsHeadersFor } from "../_shared/cors.ts";
import { checkoutBlocked } from "../_shared/subscription-sync.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-12-18.acacia",
});

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Απαιτείται σύνδεση." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Λείπει ρύθμιση του server." }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json({ error: "Η σύνδεση δεν είναι έγκυρη." }, 401);

    // userId / email from the body are intentionally ignored.
    const { plan: requestedPlan, priceId, businessId } = await req.json();

    let plan = requestedPlan as string | undefined;
    if (priceId !== undefined && priceId !== null) {
      if (!PLAN_BY_PRICE[priceId]) return json({ error: "Μη έγκυρο πακέτο" }, 400);
      plan = PLAN_BY_PRICE[priceId];
    }
    if (!plan || !PRICE_BY_PLAN[plan]) return json({ error: "Μη έγκυρο πακέτο" }, 400);
    if (!businessId) return json({ error: "Δεν βρέθηκε η επιχείρηση." }, 400);

    // Ownership check (RLS-scoped user client + explicit owner filter).
    const { data: business, error: businessError } = await userClient
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (businessError) throw businessError;
    if (!business) return json({ error: "Δεν έχετε πρόσβαση σε αυτή την επιχείρηση." }, 403);

    const admin = createClient(supabaseUrl, serviceKey);
    const base = appBaseUrl(Deno.env.get("APP_BASE_URL"));
    if (!base) return json({ error: "Λείπει ρύθμιση του server." }, 500);

    const { data: existing } = await admin
      .from("subscriptions")
      .select("stripe_customer_id,stripe_subscription_id,status")
      .eq("business_id", business.id)
      .maybeSingle();

    // Also ask Stripe: never create a second subscription for a customer that still has a live one.
    let liveStripeStatuses: string[] = [];
    if (existing?.stripe_customer_id) {
      const list = await stripe.subscriptions.list({
        customer: existing.stripe_customer_id,
        status: "all",
        limit: 20,
      });
      liveStripeStatuses = list.data.map((item) => item.status);
    }
    if (checkoutBlocked(existing, liveStripeStatuses)) {
      return json({ error: "Υπάρχει ήδη συνδρομή για αυτή την επιχείρηση." }, 409);
    }

    const metadata = { user_id: user.id, business_id: business.id, subscription_plan: plan };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email || undefined }),
      line_items: [{ price: PRICE_BY_PLAN[plan], quantity: 1 }],
      success_url: base + "/dashboard/plan?payment=success",
      cancel_url: base + "/dashboard/plan?payment=cancelled",
      client_reference_id: business.id,
      metadata,
      subscription_data: { metadata },
    });

    return json({ url: session.url });
  } catch (error) {
    console.error("create-checkout error", error);
    return json({ error: "Σφάλμα δημιουργίας πληρωμής." }, 500);
  }
});
