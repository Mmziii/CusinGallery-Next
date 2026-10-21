// Never allow a return URL to leave this origin (including browser URL
// normalization of backslashes/control characters into protocol-relative URLs).
export function safeNext(value, fallback = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://same-site.invalid");
    if (url.origin !== "https://same-site.invalid") return fallback;
  } catch { return fallback; }
  return value;
}
export function loginUrl(path) {
  return `/login/?next=${encodeURIComponent(safeNext(path))}`;
}
export const isProtectedPath = (path) => /^\/(account|wishlist)(\/|$)/.test(path);
export const isAuthPath = (path) => /^\/(login|register|password-reset|reset-password)(\/|$)/.test(path);
