export const IOS_STORE_URL = (import.meta.env.VITE_IOS_STORE_URL || "").trim();
export const ANDROID_STORE_URL = (import.meta.env.VITE_ANDROID_STORE_URL || "").trim();

export function detectDevice() {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  const isIPadOS =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || isIPadOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function getStoreLinks(device = detectDevice()) {
  const ios = { id: "ios", url: IOS_STORE_URL };
  const android = { id: "android", url: ANDROID_STORE_URL };
  const [primary, secondary] =
    device === "android" ? [android, ios] : [ios, android];
  return { device, primary, secondary };
}
