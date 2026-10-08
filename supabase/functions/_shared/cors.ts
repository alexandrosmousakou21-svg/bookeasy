// Optional ALLOWED_ORIGINS (comma separated). When unset, any origin is echoed
// (requests are authenticated by bearer token, not cookies).
export function corsHeadersFor(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = allowed.length
    ? allowed.includes(origin) ? origin : allowed[0]
    : origin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
