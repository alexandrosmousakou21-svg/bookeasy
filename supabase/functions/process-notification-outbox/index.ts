import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Worker: claims outbox rows and delivers email via Resend (secrets RESEND_API_KEY, NOTIFICATION_FROM_EMAIL). Push is not implemented yet.
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

// Throw RecoverableError to retry later; any other error is treated as permanent.
export class RecoverableError extends Error {}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function formatWhen(p: Record<string, unknown>): string {
  const tz = String(p.timezone || "Europe/Athens");
  const iso = p.starts_at ? String(p.starts_at) : null;
  if (iso) {
    try {
      return new Intl.DateTimeFormat("el-GR", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(iso));
    } catch (_) { /* fall through */ }
  }
  return `${p.appointment_date ?? ""} ${String(p.start_time ?? "").slice(0, 5)}`.trim();
}

export function renderEmail(row: OutboxRow): { subject: string; html: string; text: string } {
  const p = row.payload || {};
  const lines = [
    `Υπηρεσία: ${p.service_name || "-"}`,
    p.staff_name ? `Επαγγελματίας: ${p.staff_name}` : "",
    `Ημερομηνία & ώρα: ${formatWhen(p)}`,
  ].filter(Boolean);
  const cancelled = row.type === "booking_cancellation";
  const subject = cancelled ? "Το ραντεβού σου ακυρώθηκε" : "Επιβεβαίωση ραντεβού";
  const intro = `Γεια σου ${p.customer_name || ""},`.replace(" ,", ",");
  const lead = cancelled ? "Το ραντεβού σου ακυρώθηκε." : "Το ραντεβού σου καταχωρήθηκε.";
  const text = [intro, "", lead, ...lines, "", "BookEasy"].join("\n");
  const html = `<p>${esc(intro)}</p><p>${esc(lead)}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>BookEasy</p>`;
  return { subject, html, text };
}

export async function deliver(row: OutboxRow): Promise<void> {
  if (row.channel !== "email") {
    throw new Error(`channel_not_supported:${row.channel}`);
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFICATION_FROM_EMAIL");
  if (!apiKey || !from) throw new RecoverableError("email_provider_not_configured");

  const to = String(row.payload?.customer_email || "").trim();
  if (!to) throw new Error("missing_recipient_email");

  const { subject, html, text } = renderEmail(row);
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // outbox row id makes provider-side retries idempotent
        "Idempotency-Key": `notification-outbox/${row.id}`,
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
  } catch (_) {
    throw new RecoverableError("resend_network_error");
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    const msg = `resend_${res.status}: ${detail}`;
    if (res.status === 429 || res.status >= 500) throw new RecoverableError(msg);
    throw new Error(msg);
  }
  console.log("email sent", { id: row.id, type: row.type });
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
