import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processBatch } from "./worker.ts";

// Worker: claims outbox rows (claim_notification_outbox) and delivers email via Resend.
// Secrets: RESEND_API_KEY, NOTIFICATION_FROM_EMAIL, NOTIFICATION_WORKER_SECRET.
// Invoke with header `x-worker-secret: $NOTIFICATION_WORKER_SECRET`. Push is not implemented yet.

const settings = {
  maxAttempts: Number(Deno.env.get("NOTIFICATION_MAX_ATTEMPTS") || 5),
  batchSize: Number(Deno.env.get("NOTIFICATION_BATCH_SIZE") || 10),
  retryDelaySeconds: Number(Deno.env.get("NOTIFICATION_RETRY_DELAY_SECONDS") || 60),
};

const deps = {
  env: (k: string) => Deno.env.get(k),
  fetch: fetch,
  log: (message: string, data?: Record<string, unknown>) => console.log(message, data),
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("NOTIFICATION_WORKER_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) {
    return new Response("Worker not configured", { status: 500 });
  }
  if (req.headers.get("x-worker-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await processBatch(createClient(supabaseUrl, serviceKey), deps, settings);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("process-notification-outbox failed", error instanceof Error ? error.message : "error");
    return new Response("Server error", { status: 500 });
  }
});
