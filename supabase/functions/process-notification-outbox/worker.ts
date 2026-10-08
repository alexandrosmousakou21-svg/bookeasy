// Pure worker logic (no Deno globals, no remote imports) so it can be unit-tested with fakes.
// index.ts wires it to Deno.env / fetch / Supabase.

export type OutboxRow = {
  id: string;
  type: string;
  channel: string;
  attempts: number;
  payload: Record<string, unknown>;
};

export type Deps = {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  log: (message: string, data?: Record<string, unknown>) => void;
  now?: () => number;
};

export type Settings = { maxAttempts: number; batchSize: number; retryDelaySeconds: number };

// Throw RecoverableError to retry later; any other error is permanent (-> failed).
export class RecoverableError extends Error {}

const SUPPORTED_TYPES = ["booking_confirmation", "booking_cancellation"];
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function when(p: Record<string, unknown>) {
  const tz = String(p.timezone || "Europe/Athens");
  const iso = p.starts_at ? String(p.starts_at) : "";
  const d = iso ? new Date(iso) : null;
  if (d && !Number.isNaN(d.getTime())) {
    try {
      return {
        date: new Intl.DateTimeFormat("el-GR", { dateStyle: "full", timeZone: tz }).format(d),
        time: new Intl.DateTimeFormat("el-GR", { timeStyle: "short", timeZone: tz }).format(d),
        tz,
      };
    } catch (_) { /* invalid timezone: fall back below */ }
  }
  return { date: String(p.appointment_date ?? ""), time: String(p.start_time ?? "").slice(0, 5), tz };
}

export function renderEmail(row: OutboxRow, businessName?: string | null) {
  const p = row.payload || {};
  const cancelled = row.type === "booking_cancellation";
  const w = when(p);
  const subject = cancelled ? "Ακύρωση ραντεβού — BookEasy" : "Επιβεβαίωση κράτησης — BookEasy";
  const greeting = p.customer_name ? `Γεια σου ${p.customer_name},` : "Γεια σου,";
  const lead = cancelled ? "Σε ενημερώνουμε ότι το ραντεβού σου ακυρώθηκε." : "Η κράτησή σου επιβεβαιώθηκε.";
  const rows: [string, string][] = [];
  if (businessName) rows.push(["Επιχείρηση", businessName]);
  rows.push(["Υπηρεσία", String(p.service_name || "-")]);
  if (p.staff_name) rows.push(["Επαγγελματίας", String(p.staff_name)]);
  rows.push(["Ημερομηνία", w.date], ["Ώρα", w.time], ["Ζώνη ώρας", w.tz]);

  const text = [greeting, "", lead, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", "BookEasy"].join("\n");
  const html = `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">` +
    `<tr><td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;font-size:20px;font-weight:bold">BookEasy</td></tr>` +
    `<tr><td style="padding:24px"><p style="margin:0 0 12px">${esc(greeting)}</p><p style="margin:0 0 16px;font-size:16px;font-weight:bold">${esc(lead)}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">` +
    rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b7280;width:38%">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`).join("") +
    `</table></td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}

export async function deliver(row: OutboxRow, deps: Deps, businessName?: string | null): Promise<void> {
  if (row.channel !== "email") throw new Error(`channel_not_supported:${row.channel}`);
  if (!SUPPORTED_TYPES.includes(row.type)) throw new Error(`type_not_supported:${row.type}`);
  if (!row.payload || typeof row.payload !== "object") throw new Error("malformed_payload");

  const to = String(row.payload.customer_email ?? "").trim();
  if (!to) throw new Error("missing_recipient_email");
  if (!EMAIL_RE.test(to)) throw new Error("invalid_recipient_email");

  const apiKey = deps.env("RESEND_API_KEY");
  const from = deps.env("NOTIFICATION_FROM_EMAIL");
  if (!apiKey || !from) throw new RecoverableError("email_provider_not_configured");

  const { subject, html, text } = renderEmail(row, businessName);
  let res: Response;
  try {
    res = await deps.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `notification-outbox/${row.id}`,
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
  } catch (_) {
    throw new RecoverableError("resend_network_error");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    const msg = `resend_${res.status}: ${detail}`;
    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) throw new RecoverableError(msg);
    throw new Error(msg);
  }
  deps.log("email sent", { id: row.id, type: row.type });
}

// deno-lint-ignore no-explicit-any
export async function processBatch(admin: any, deps: Deps, s: Settings) {
  const now = deps.now ?? Date.now;
  const { data, error } = await admin.rpc("claim_notification_outbox", {
    p_batch_size: s.batchSize,
    p_max_attempts: s.maxAttempts,
  });
  if (error) throw error;
  const rows = (data || []) as OutboxRow[];

  // Business names are not in the payload snapshot; look them up (read-only, best effort).
  const names = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => String(r.payload?.business_id || "")).filter(Boolean))];
  if (ids.length) {
    const { data: biz } = await admin.from("businesses").select("id,name").in("id", ids);
    for (const b of biz || []) names.set(b.id, b.name);
  }

  const result = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  // Only transition rows this worker still holds (status = processing).
  const finish = (id: string, patch: Record<string, unknown>) =>
    admin.from("notification_outbox").update(patch).eq("id", id).eq("status", "processing");

  for (const row of rows) {
    result.claimed++;
    try {
      await deliver(row, deps, names.get(String(row.payload?.business_id || "")));
      await finish(row.id, { status: "sent", processed_at: new Date(now()).toISOString(), last_error: null });
      result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      if (err instanceof RecoverableError && row.attempts < s.maxAttempts) {
        await finish(row.id, {
          status: "pending",
          last_error: message,
          available_at: new Date(now() + s.retryDelaySeconds * 1000 * row.attempts).toISOString(),
        });
        result.retried++;
      } else {
        await finish(row.id, { status: "failed", processed_at: new Date(now()).toISOString(), last_error: message });
        result.failed++;
      }
    }
  }
  return result;
}
