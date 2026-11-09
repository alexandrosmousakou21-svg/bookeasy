export function safeReturnPath(value, fallback = "/customer") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  try {
    const base = "https://bookeasy.invalid";
    const parsed = new URL(value, base);
    if (parsed.origin !== base || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(parsed.pathname)) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}