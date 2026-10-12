const reporters = new Set();
const occurrences = new Map();
const MAX_SIGNATURES = 100;

function redact(value) {
  return String(value || "")
    .replace(/(authorization|api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|sb_secret|sb_publishable)-[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .slice(0, 500);
}

export function registerErrorReporter(reporter) {
  reporters.add(reporter);
  return () => reporters.delete(reporter);
}

export function reportCriticalError(error, context = {}) {
  const errorName = error?.name || "Error";
  const message = redact(error?.message || error || "Unknown error");
  const feature = redact(context.feature || "application");
  const operation = redact(context.operation || "unknown");
  const signature = `${feature}:${errorName}:${message}`;
  const count = (occurrences.get(signature) || 0) + 1;

  if (!occurrences.has(signature) && occurrences.size >= MAX_SIGNATURES) {
    occurrences.delete(occurrences.keys().next().value);
  }
  occurrences.set(signature, count);

  const event = {
    timestamp: new Date().toISOString(),
    environment: import.meta.env.MODE || "unknown",
    route: typeof window === "undefined" ? "unknown" : window.location.pathname,
    feature,
    operation,
    errorName: redact(errorName),
    errorCode: redact(error?.code || ""),
    message,
    count,
  };

  console.error("BookEasy error report", event);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bookeasy:critical-error", { detail: event }));
  }

  for (const reporter of reporters) {
    try {
      reporter(event);
    } catch {
      // Monitoring must not cause a second application failure.
    }
  }

  const sentry = typeof window !== "undefined" ? window.Sentry : null;
  if (sentry?.captureException) {
    try {
      sentry.captureException(new Error(message), { extra: event });
    } catch {
      // An optional provider is isolated from application behavior.
    }
  }

  return event;
}
