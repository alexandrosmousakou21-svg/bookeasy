import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeLog(code: string) {
  console.error(JSON.stringify({ feature: "customer-support", code, timestamp: new Date().toISOString() }));
}

async function withinRateLimit(
  admin: any,
  serviceRoleKey: string,
  bucket: string,
  maxRequests: number,
  windowSeconds: number,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${serviceRoleKey}:${bucket}`),
  );
  const targetBucketHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const { data, error } = await admin.rpc("consume_api_rate_limit", {
    target_bucket_hash: targetBucketHash,
    window_seconds: windowSeconds,
    max_requests: maxRequests,
  });
  if (error) throw error;
  return data === true;
}

async function sendNotification(admin: any, businessId: string, businessName: string, customerName: string, customerEmail: string | null, customerPhone: string | null, message: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!apiKey || !from) return;

  const { data: settings, error } = await admin
    .from("business_contact_settings")
    .select("professional_email")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error || !settings?.professional_email) return;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [settings.professional_email],
        subject: `Νέο αίτημα εξυπηρέτησης · ${businessName}`,
        text: `Νέο αίτημα από ${customerName}\nEmail: ${customerEmail || "Δεν δόθηκε"}\nΤηλέφωνο: ${customerPhone || "Δεν δόθηκε"}\n\n${message}\n\nΑπαντήστε από το BookEasy dashboard.`,
      }),
    });
    if (!response.ok) safeLog("email_provider_rejected");
  } catch {
    safeLog("email_provider_unavailable");
  }
}

async function createRequest(
  admin: any,
  body: Record<string, any>,
  req: Request,
  serviceRoleKey: string,
) {
  const {
    request_key,
    access_token,
    business_id,
    customer_name,
    customer_email,
    customer_phone,
    messages,
  } = body;
  const email = typeof customer_email === "string" ? customer_email.trim().toLowerCase() : "";
  const phone = typeof customer_phone === "string" ? customer_phone.trim() : "";
  const name = typeof customer_name === "string" ? customer_name.trim() : "";

  if (
    !validUuid(request_key) ||
    !validUuid(access_token) ||
    !validUuid(business_id) ||
    !name || name.length > 120 ||
    (!email && !phone) ||
    (email && (email.length > 254 || !emailPattern.test(email))) ||
    phone.length > 40 ||
    !Array.isArray(messages) ||
    messages.length < 1 || messages.length > 30
  ) return json({ error: "Ελέγξτε τα στοιχεία επικοινωνίας και δοκιμάστε ξανά." }, 400);

  const tokenHash = await hashToken(access_token);
  const { data: existing, error: existingError } = await admin
    .from("customer_support_conversations")
    .select("id,access_token_hash")
    .eq("request_key", request_key)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (existing.access_token_hash !== tokenHash) return json({ error: "Το αίτημα δεν είναι έγκυρο." }, 403);
    return json({ conversation_id: existing.id, received: true });
  }

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("id,name")
    .eq("id", business_id)
    .maybeSingle();
  if (businessError || !business) return json({ error: "Η επιχείρηση δεν βρέθηκε." }, 404);

  const clientIp = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown";
  if (!await withinRateLimit(
    admin,
    serviceRoleKey,
    `support-create:${business_id}:${clientIp}`,
    3,
    600,
  )) {
    return json({ error: "Υποβάλλονται πολλά αιτήματα. Θα σας απαντήσουμε σύντομα." }, 429);
  }

  const recentQuery = admin
    .from("customer_support_conversations")
    .select("id")
    .eq("business_id", business_id)
    .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(3);
  const { data: recent, error: recentError } = email
    ? await recentQuery.eq("customer_email", email)
    : await recentQuery.eq("customer_phone", phone);
  if (recentError) throw recentError;
  if ((recent || []).length >= 3) return json({ error: "Υπάρχουν ήδη πρόσφατα αιτήματα. Θα σας απαντήσουμε σύντομα." }, 429);

  const { data: conversation, error: insertError } = await admin
    .from("customer_support_conversations")
    .insert({
      request_key,
      business_id,
      customer_id: null,
      customer_name: name,
      customer_email: email || null,
      customer_phone: phone || null,
      access_token_hash: tokenHash,
      status: "new",
      channel: "human",
      unread_for_business: true,
      unread_for_customer: false,
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: duplicate } = await admin
        .from("customer_support_conversations")
        .select("id,access_token_hash")
        .eq("request_key", request_key)
        .maybeSingle();
      if (duplicate?.access_token_hash === tokenHash) {
        return json({ conversation_id: duplicate.id, received: true });
      }
    }
    throw insertError;
  }

  const normalizedMessages = messages
    .slice(-30)
    .filter((item: any) => ["customer", "assistant"].includes(item?.sender_type))
    .map((item: any) => ({
      conversation_id: conversation.id,
      sender_type: item.sender_type,
      body: String(item.body || "").trim().slice(0, 2000),
    }))
    .filter((item: any) => item.body);

  if (!normalizedMessages.some((item: any) => item.sender_type === "customer")) {
    await admin.from("customer_support_conversations").delete().eq("id", conversation.id);
    return json({ error: "Προσθέστε ένα μήνυμα πριν στείλετε το αίτημα." }, 400);
  }

  const { error: messageError } = await admin
    .from("customer_support_messages")
    .insert(normalizedMessages);
  if (messageError) {
    await admin.from("customer_support_conversations").delete().eq("id", conversation.id);
    throw messageError;
  }

  const latestMessage = [...normalizedMessages].reverse().find((item: any) => item.sender_type === "customer");
  await sendNotification(
    admin,
    business_id,
    business.name,
    name,
    email || null,
    phone || null,
    latestMessage?.body || "Νέο αίτημα εξυπηρέτησης.",
  );
  return json({ conversation_id: conversation.id, received: true });
}

async function customerMessages(
  admin: any,
  body: Record<string, any>,
  serviceRoleKey: string,
) {
  const { conversation_id, access_token, action, message, client_message_id } = body;
  if (!validUuid(conversation_id) || !validUuid(access_token)) {
    return json({ error: "Η συνομιλία δεν είναι διαθέσιμη." }, 404);
  }
  const tokenHash = await hashToken(access_token);
  const { data: conversation, error: conversationError } = await admin
    .from("customer_support_conversations")
    .select("id,status,access_token_hash")
    .eq("id", conversation_id)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation || conversation.access_token_hash !== tokenHash) {
    return json({ error: "Η συνομιλία δεν είναι διαθέσιμη." }, 404);
  }
  let currentStatus = conversation.status;

  if (action === "send-message") {
    const text = typeof message === "string" ? message.trim() : "";
    if (!text || text.length > 4000 || !validUuid(client_message_id)) {
      return json({ error: "Το μήνυμα δεν είναι έγκυρο." }, 400);
    }
    const { data: duplicate, error: duplicateError } = await admin
      .from("customer_support_messages")
      .select("id")
      .eq("conversation_id", conversation_id)
      .eq("client_message_id", client_message_id)
      .maybeSingle();
    if (duplicateError) throw duplicateError;

    if (!duplicate) {
      if (!await withinRateLimit(
        admin,
        serviceRoleKey,
        `support-message:${conversation_id}`,
        15,
        60,
      )) {
        return json({ error: "Υποβάλλονται πολλά μηνύματα. Δοκιμάστε ξανά σε λίγο." }, 429);
      }
      const { error: insertError } = await admin
        .from("customer_support_messages")
        .insert({
          conversation_id,
          client_message_id,
          sender_type: "customer",
          body: text,
        });
      if (insertError && insertError.code !== "23505") throw insertError;

      if (!insertError) {
        currentStatus = conversation.status === "completed" ? "new" : conversation.status;
        const { error: updateError } = await admin
          .from("customer_support_conversations")
          .update({
            status: currentStatus,
            unread_for_business: true,
            unread_for_customer: false,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversation_id);
        if (updateError) throw updateError;
      }
    }
  }

  const { data: messages, error: messagesError } = await admin
    .from("customer_support_messages")
    .select("id,sender_type,body,created_at")
    .eq("conversation_id", conversation_id)
    .order("created_at", { ascending: true })
    .limit(100);
  if (messagesError) throw messagesError;
  const { error: readError } = await admin
    .from("customer_support_conversations")
    .update({ unread_for_customer: false })
    .eq("id", conversation_id);
  if (readError) throw readError;
  return json({ status: currentStatus, messages: messages || [] });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Μη υποστηριζόμενο αίτημα." }, 405);

  try {
    const body = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      safeLog("missing_server_configuration");
      return json({ error: "Η υποστήριξη δεν είναι προσωρινά διαθέσιμη." }, 503);
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (body?.action === "create-request") {
      return await createRequest(admin, body, req, serviceRoleKey);
    }
    if (["get-messages", "send-message"].includes(body?.action)) {
      return await customerMessages(admin, body, serviceRoleKey);
    }
    return json({ error: "Το αίτημα δεν είναι έγκυρο." }, 400);
  } catch (error) {
    safeLog(error instanceof Error ? error.name : "unknown_error");
    return json({ error: "Δεν ήταν δυνατή η ολοκλήρωση του αιτήματος. Δοκιμάστε ξανά." }, 500);
  }
});
