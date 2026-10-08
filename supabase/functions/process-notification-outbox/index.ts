import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Skeleton worker: claims outbox rows and logs them. It does NOT send email or push in this phase.
// Invoke from a scheduler (next phase) with header `x-worker-secret: $NOTIFICATION_WORKER_SECRET`.

const MAX_ATTEMPTS = Number(Deno.env.get("NOTIFICATION_MAX_ATTEMPTS") || 5);
const BATCH_SIZE = Number(Deno.env.get("NOTIFICATION_BATCH_SIZE") || 10);
const RETRY_DELAY_SECONDS = Number(Deno.env.get("NOTIFICATION_RETRY_DELAY_SECONDS") || 60);

type OutboxRow = {
  id: string;
  type: string;
  channel: string;
  attempts: number;
  payload: Record<string, unknown>;
};

// Placeholder for provider adapters (email/push) in later phases.
// Throw RecoverableError to retry later; any other error is treated as permanent.
export class RecoverableError extends Error {}

export async function deliver(row: OutboxRow): Promise<void> {
  console.log("notification (dry-run, not sent)", {
    id: row.id,
    type: row.type,
    channel: row.channel,
    attempt: row.attempts,
    payload: row.payload,
  });
}

// deno-lint-ignore no-explicit-any
export async function processBatch(admin: any, maxAttempts = MAX_ATTEMPTS, batchSize = BATCH_SIZE) {
  const { data, error } = await admin.rpc("claim_notification_outbox", {
    p_batch_size: batchSize,
    p_max_attempts: maxAttempts,
  });
  if (error) throw error;

  const result = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  for (const row of (data || []) as OutboxRow[]) {
    result.claimed++;
    try {
      await deliver(row);
      await admin
        .from("notification_outbox")
        .update({ status: "sent", processed_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      const recoverable = err instanceof RecoverableError;
      if (recoverable && row.attempts < maxAttempts) {
        await admin
          .from("notification_outbox")
          .update({
            status: "pending",
            last_error: message,
            available_at: new Date(Date.now() + RETRY_DELAY_SECONDS * 1000 * row.attempts).toISOString(),
          })
          .eq("id", row.id);
        result.retried++;
      } else {
        await admin
          .from("notification_outbox")
          .update({ status: "failed", processed_at: new Date().toISOString(), last_error: message })
          .eq("id", row.id);
        result.failed++;
      }
    }
  }
  return result;
}

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
    const result = await processBatch(createClient(supabaseUrl, serviceKey));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("process-notification-outbox failed", error);
    return new Response("Server error", { status: 500 });
  }
});
