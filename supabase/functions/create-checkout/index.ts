import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const priceByPlan = new Map([
  ["basic", "price_1UJHObQfYqQ6BGmE9CqD61td"],
  ["plus", "price_1UJHPAQfYqQ6BGmENDRIFPCF"],
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

function logCheckoutError(error: unknown) {
  console.error(JSON.stringify({
    feature: "checkout",
    code: error instanceof Error ? error.name : "unknown_error",
    timestamp: new Date().toISOString(),
  }));
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get("Origin") || undefined;
  const configuredBaseUrl = Deno.env.get("APP_BASE_URL");
  let appOrigin: string | undefined;
  try {
    const parsed = new URL(configuredBaseUrl || "");
    if (
      (parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
    ) {
      appOrigin = parsed.origin;
    }
  } catch {
    appOrigin = undefined;
  }

  const allowedOrigins = new Set(developmentOrigins);
  if (appOrigin) allowedOrigins.add(appOrigin);
  if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
    return json({ error: "Η προέλευση του αιτήματος δεν επιτρέπεται." }, 403);
  }

  const corsOrigin = requestOrigin && allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : undefined;
  const corsHeaders = new Headers();
  if (corsOrigin) {
    corsHeaders.set("Access-Control-Allow-Origin", corsOrigin);
    corsHeaders.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    corsHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    corsHeaders.set("Vary", "Origin");
  }

  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Μη υποστηριζόμενο αίτημα." }, 405, corsOrigin);
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
      return json({ error: "Απαιτείται έγκυρη σύνδεση." }, 401, corsOrigin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      logCheckoutError(new Error("Supabase configuration unavailable"));
      return json({ error: "Η υπηρεσία checkout δεν είναι διαθέσιμη." }, 503, corsOrigin);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(bearerMatch[1]);
    if (authError || !user) {
      return json({ error: "Η σύνδεση δεν είναι έγκυρη." }, 401, corsOrigin);
    }

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

    if (Object.hasOwn(body, "userId") && body.userId !== user.id) {
      return json({ error: "Το αίτημα δεν αντιστοιχεί στον συνδεδεμένο λογαριασμό." }, 403, corsOrigin);
    }

    if (Object.hasOwn(body, "priceId")) {
      return json({ error: "Επιλέξτε πακέτο και δοκιμάστε ξανά." }, 400, corsOrigin);
    }
    const plan = body.plan;
    const businessId = body.business_id;
    const requestId = body.checkout_request_id;
    if (
      typeof plan !== "string" ||
      !priceByPlan.has(plan) ||
      typeof businessId !== "string" ||
      !uuidPattern.test(businessId) ||
      typeof requestId !== "string" ||
      !uuidPattern.test(requestId)
    ) {
      return json({ error: "Μη έγκυρο πακέτο." }, 400, corsOrigin);
    }

    const { data: ownedBusiness, error: ownershipError } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (ownershipError) {
      logCheckoutError(ownershipError);
      return json({ error: "Δεν ήταν δυνατή η επαλήθευση του επαγγελματικού λογαριασμού." }, 503, corsOrigin);
    }
    if (!ownedBusiness) {
      return json({ error: "Δεν βρέθηκε επιχείρηση που να ανήκει στον λογαριασμό σας." }, 403, corsOrigin);
    }

    if (!appOrigin) {
      logCheckoutError(new Error("APP_BASE_URL is missing or invalid"));
      return json({ error: "Η υπηρεσία checkout δεν είναι διαθέσιμη." }, 503, corsOrigin);
    }

    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecret) {
      logCheckoutError(new Error("Stripe configuration unavailable"));
      return json({ error: "Η υπηρεσία checkout δεν είναι διαθέσιμη." }, 503, corsOrigin);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      logCheckoutError(new Error("Subscription service configuration unavailable"));
      return json({ error: "Η υπηρεσία checkout δεν είναι διαθέσιμη." }, 503, corsOrigin);
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: currentSubscription, error: subscriptionError } = await admin
      .from("business_subscriptions")
      .select("stripe_customer_id")
      .eq("business_id", ownedBusiness.id)
      .maybeSingle();
    if (subscriptionError) {
      logCheckoutError(subscriptionError);
      return json({ error: "Δεν ήταν δυνατή η επαλήθευση της συνδρομής." }, 503, corsOrigin);
    }

    const priceId = priceByPlan.get(plan)!;
    const { data: reserved, error: reservationError } = await admin.rpc(
      "reserve_stripe_checkout",
      {
        target_business: ownedBusiness.id,
        target_owner: user.id,
        target_request: requestId,
        target_plan: plan,
        target_price: priceId,
      },
    );
    if (reservationError) {
      logCheckoutError(reservationError);
      return json({ error: "Δεν ήταν δυνατή η προετοιμασία του checkout." }, 503, corsOrigin);
    }
    if (reserved !== true) {
      return json({ error: "Υπάρχει ήδη ενεργή συνδρομή ή checkout σε εξέλιξη για την επιχείρηση." }, 409, corsOrigin);
    }

    const stripe = new Stripe(stripeSecret, {
      apiVersion: "2024-12-18.acacia",
    });
    const metadata = {
      business_id: ownedBusiness.id,
      owner_id: user.id,
      plan,
      checkout_request_id: requestId,
    };
    let session: Stripe.Checkout.Session;
    try {
      const configuredPrice = await stripe.prices.retrieve(priceId);
      if (
        !configuredPrice.active ||
        configuredPrice.recurring?.interval !== "month" ||
        configuredPrice.recurring.interval_count !== 1
      ) {
        throw new Error("Configured subscription price is not active monthly billing");
      }
      session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          ...(currentSubscription?.stripe_customer_id
            ? { customer: currentSubscription.stripe_customer_id }
            : { customer_email: user.email || undefined }),
          client_reference_id: user.id,
          line_items: [{ price: priceId, quantity: 1 }],
          subscription_data: { metadata },
          success_url: new URL("/dashboard/plan?payment=success", appOrigin).toString(),
          cancel_url: new URL("/dashboard/plan?payment=cancelled", appOrigin).toString(),
          metadata,
        },
        { idempotencyKey: `bookeasy-checkout-${ownedBusiness.id}-${requestId}` },
      );
    } catch (stripeError) {
      await admin.rpc("release_stripe_checkout_reservation", {
        target_business: ownedBusiness.id,
        target_owner: user.id,
        target_request: requestId,
      });
      throw stripeError;
    }

    const { error: attachError } = await admin.rpc("attach_stripe_checkout_session", {
      target_business: ownedBusiness.id,
      target_owner: user.id,
      target_request: requestId,
      target_session: session.id,
    });
    if (attachError) logCheckoutError(attachError);

    if (!session.url) {
      logCheckoutError(new Error("Stripe checkout URL unavailable"));
      return json({ error: "Δεν ήταν δυνατή η δημιουργία checkout." }, 502, corsOrigin);
    }

    return json({ url: session.url }, 200, corsOrigin);
  } catch (error) {
    logCheckoutError(error);
    return json({ error: "Δεν ήταν δυνατή η δημιουργία checkout. Δοκιμάστε ξανά." }, 500, corsOrigin);
  }
});