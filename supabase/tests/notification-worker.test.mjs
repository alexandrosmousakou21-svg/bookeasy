// Run: node --test supabase/tests/notification-worker.test.mjs
// No network and no real Resend call: fetch and the database are fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { deliver, processBatch, renderEmail, RecoverableError } from "../functions/process-notification-outbox/worker.ts";

const SECRET = "re_test_SECRET_KEY_123";
const SETTINGS = { maxAttempts: 3, batchSize: 10, retryDelaySeconds: 60 };

const payload = (o = {}) => ({
  business_id: "b1", service_name: "Κούρεμα <b>", staff_name: "Μαρία & Co", customer_name: "Γιάννης",
  customer_email: "c@example.com", starts_at: "2026-10-20T07:30:00Z", timezone: "Europe/Athens", ...o,
});
const row = (o = {}) => ({ id: "n-1", type: "booking_confirmation", channel: "email", attempts: 1, payload: payload(), ...o });

function mkDeps(fetchImpl) {
  const logs = [];
  const calls = [];
  return {
    logs, calls,
    env: (k) => ({ RESEND_API_KEY: SECRET, NOTIFICATION_FROM_EMAIL: "BookEasy <no-reply@x.com>" })[k],
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
    log: (m, d) => logs.push(JSON.stringify([m, d])),
    now: () => Date.parse("2026-10-08T12:00:00Z"),
  };
}
const ok = () => new Response("{}", { status: 200 });

function fakeAdmin(rows) {
  const updates = [];
  const admin = {
    updates,
    rpc: async () => ({ data: rows, error: null }),
    from: (t) => ({
      select: () => ({ in: async () => ({ data: [{ id: "b1", name: "Salon <Α>" }] }) }),
      update: (patch) => ({ eq: (c, id) => ({ eq: async () => { updates.push({ t, id, patch }); return {}; } }) }),
    }),
  };
  return admin;
}
const run = async (r, fetchImpl, s = SETTINGS) => {
  const deps = mkDeps(fetchImpl);
  const admin = fakeAdmin([r]);
  const res = await processBatch(admin, deps, s);
  return { res, deps, upd: admin.updates[0] };
};

test("1,3,12 booking confirmation -> provider, sent, idempotency key", async () => {
  const { res, deps, upd } = await run(row(), ok);
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.calls[0].url, "https://api.resend.com/emails");
  assert.equal(deps.calls[0].init.headers["Idempotency-Key"], "notification-outbox/n-1");
  assert.equal(res.sent, 1);
  assert.equal(upd.patch.status, "sent");
  const body = JSON.parse(deps.calls[0].init.body);
  assert.deepEqual(body.to, ["c@example.com"]);
  assert.equal(body.from, "BookEasy <no-reply@x.com>");
});

test("2 cancellation -> provider", async () => {
  const { deps, res } = await run(row({ type: "booking_cancellation" }), ok);
  assert.equal(res.sent, 1);
  assert.match(JSON.parse(deps.calls[0].init.body).subject, /Ακύρωση/);
});

for (const [name, status] of [["4 429", 429], ["5 5xx", 503]]) {
  test(`${name} -> retry with backoff`, async () => {
    const { res, upd } = await run(row({ attempts: 2 }), () => new Response("busy", { status }));
    assert.equal(res.retried, 1);
    assert.equal(upd.patch.status, "pending");
    assert.equal(upd.patch.available_at, new Date(Date.parse("2026-10-08T12:00:00Z") + 120000).toISOString());
  });
}

test("6 network error -> retry", async () => {
  const { res, upd } = await run(row(), () => { throw new TypeError("fetch failed"); });
  assert.equal(res.retried, 1);
  assert.equal(upd.patch.status, "pending");
});

test("7 4xx -> failed, no retry", async () => {
  const { res, upd } = await run(row(), () => new Response("bad", { status: 422 }));
  assert.equal(res.failed, 1);
  assert.equal(upd.patch.status, "failed");
});

test("8 missing customer_email -> failed, no provider call", async () => {
  const { res, deps } = await run(row({ payload: payload({ customer_email: "" }) }), ok);
  assert.equal(res.failed, 1);
  assert.equal(deps.calls.length, 0);
});

test("9 unsupported channel / type / malformed -> failed", async () => {
  for (const r of [row({ channel: "push" }), row({ type: "weird" }), row({ payload: null })]) {
    const { res, deps } = await run(r, ok);
    assert.equal(res.failed, 1);
    assert.equal(deps.calls.length, 0);
  }
});

test("10 max attempts -> failed even if recoverable", async () => {
  const { res, upd } = await run(row({ attempts: 3 }), () => new Response("busy", { status: 500 }));
  assert.equal(res.failed, 1);
  assert.equal(upd.patch.status, "failed");
});

test("11 retry keeps the same row/idempotency key (no second notification)", async () => {
  const d1 = mkDeps(() => new Response("x", { status: 500 }));
  const d2 = mkDeps(ok);
  await assert.rejects(deliver(row({ attempts: 1 }), d1), RecoverableError);
  await deliver(row({ attempts: 2 }), d2);
  assert.equal(d1.calls[0].init.headers["Idempotency-Key"], d2.calls[0].init.headers["Idempotency-Key"]);
  const admin = fakeAdmin([row()]);
  await processBatch(admin, mkDeps(() => new Response("x", { status: 500 })), SETTINGS);
  assert.ok(admin.updates.every((u) => u.t === "notification_outbox")); // updates only, never inserts
});

test("13 API key not in logs or stored errors", async () => {
  const d = mkDeps(() => new Response("denied " + "x", { status: 401 }));
  const admin = fakeAdmin([row()]);
  await processBatch(admin, d, SETTINGS);
  const ok2 = mkDeps(ok);
  await deliver(row(), ok2);
  assert.ok(![...d.logs, ...ok2.logs, JSON.stringify(admin.updates)].join("").includes(SECRET));
});

test("14 HTML escaping + 15 plain text + content rules", () => {
  const e = renderEmail(row(), "Salon <Α>");
  assert.ok(e.html.includes("Κούρεμα &lt;b&gt;"));
  assert.ok(e.html.includes("Μαρία &amp; Co"));
  assert.ok(e.html.includes("Salon &lt;Α&gt;"));
  assert.ok(!e.html.includes("<b>"));
  assert.ok(e.text.length > 0 && e.text.includes("Salon <Α>") && e.text.includes("Europe/Athens"));
  assert.ok(e.text.includes("10:30") || e.text.includes("10.30"));
  for (const bad of ["n-1", "attempts", "dedupe", "b1"]) assert.ok(!e.html.includes(bad) && !e.text.includes(bad));
  assert.match(renderEmail(row({ type: "booking_cancellation" })).text, /ακυρώθηκε/);
  assert.ok(e.html.includes("viewport"));
});

test("not configured -> recoverable, no call", async () => {
  const d = mkDeps(ok); d.env = () => undefined;
  await assert.rejects(deliver(row(), d), RecoverableError);
  assert.equal(d.calls.length, 0);
});
