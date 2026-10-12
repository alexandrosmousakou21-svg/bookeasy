import { supabase } from "./supabase";
import { reportCriticalError } from "./errorReporting";

function isTransient(error) {
  const status = error?.status || error?.context?.status;
  if (!status) return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function invokeWithRetry(name, options, context = {}) {
  let lastError;
  const attempts = context.attempts || 3;
  const timeoutMs = context.timeoutMs || 15000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    let timeoutId;

    try {
      if (!supabase) throw new Error("Supabase is not configured");
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error("Request timed out"));
        }, timeoutMs);
      });
      const request = supabase.functions.invoke(name, {
        ...options,
        signal: controller.signal,
      });
      const result = await Promise.race([request, timeout]);
      clearTimeout(timeoutId);
      if (result.error) throw result.error;
      return result.data;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt + 1 >= attempts || !isTransient(error)) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(300 * 2 ** attempt, 1200)),
      );
    }
  }

  reportCriticalError(lastError, {
    feature: context.feature || name,
    operation: context.operation || "edge-function",
  });
  throw new Error("Η υπηρεσία δεν είναι προσωρινά διαθέσιμη. Δοκιμάστε ξανά.");
}
