// Native Capacitor origins (iOS: capacitor://localhost, Android with androidScheme=https: https://localhost).
export const NATIVE_ORIGINS = [
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
];

export function allowedOrigins(env: string | undefined): string[] {
  const configured = (env || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return [...new Set([...configured, ...NATIVE_ORIGINS])];
}

// Reflects the request origin only if it is allow-listed (ALLOWED_ORIGINS + native origins).
// Never returns "*". Unknown origins get no Access-Control-Allow-Origin header.
export function corsHeadersFor(
  req: Request,
  env: string | undefined = Deno.env.get("ALLOWED_ORIGINS"),
): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Stripe redirect base comes only from server configuration (APP_BASE_URL), never from the client.
export function appBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch (_e) {
    return null;
  }
}
