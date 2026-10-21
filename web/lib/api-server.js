import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { normalizeContent } from "../content/defaults";

const REQUEST_TIMEOUT_MS = 20000;
const PUBLIC_REVALIDATE_SECONDS = 60;

// One concise server-side line per failure: path + status/cause, never the body.
function logFailure(path, detail) {
  console.error(`[api-server] GET ${path} failed: ${detail}`);
}

// Server-side GET to Django built on node:http(s) — deliberately NOT fetch:
// undici silently drops a user-supplied Host header and sends the URL's
// authority instead (e.g. "backend:8000"), which Django rejects with
// DisallowedHost (400). http.request with `setHost: false` sends the incoming
// public Host verbatim, so Django validates it against ALLOWED_HOSTS and builds
// absolute media/image URLs against the public origin. Do not "simplify" this
// back to fetch. Follows no redirects (3xx is treated as an error below).
function djangoRequest(path, { host, proto, forwardedFor, cookie }) {
  return new Promise((resolve, reject) => {
    const base = new URL(process.env.INTERNAL_API_URL || "http://backend:8000");
    const target = new URL(path, base);
    const isHttps = target.protocol === "https:";
    const requestHeaders = {
      Host: host,
      "X-Forwarded-Proto": proto,
      Accept: "application/json",
      // node:http does not decompress; ask the internal upstream for identity.
      "Accept-Encoding": "identity",
    };
    if (forwardedFor) requestHeaders["X-Forwarded-For"] = forwardedFor;
    if (cookie) requestHeaders.Cookie = cookie;

    let settled = false;
    const fail = (error, logDetail = error.code || error.message) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      logFailure(path, logDetail);
      reject(error);
    };

    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: "GET",
        headers: requestHeaders,
        setHost: false,
        timeout: REQUEST_TIMEOUT_MS,
        // TLS SNI/verification must use the internal name, not the public Host.
        ...(isHttps ? { servername: target.hostname } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", (error) => fail(error));
        res.on("end", () => {
          if (settled) return;
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            // Body is discarded on purpose: it is neither parsed nor logged.
            fail(new Error(`Django ${path}: ${status}`), status);
            return;
          }
          settled = true;
          clearTimeout(deadline);
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            logFailure(path, `${status} invalid JSON`);
            reject(new Error(`Django ${path}: ${status} invalid JSON`));
          }
        });
      }
    );
    // Total deadline (AbortSignal.timeout equivalent), on top of the socket
    // inactivity timeout above. destroy() re-enters via the "error" handler.
    const deadline = setTimeout(
      () => req.destroy(new Error(`Django ${path}: timeout`)),
      REQUEST_TIMEOUT_MS
    );
    deadline.unref?.();
    req.on("timeout", () => req.destroy(new Error(`Django ${path}: timeout`)));
    req.on("error", (error) => fail(error, error.code || (error.message.includes("timeout") ? "timeout" : error.message)));
    req.end();
  });
}

// Public calls never forward cookies. Opt-in private calls are never cached.
export async function apiServer(path, { privateData = false } = {}) {
  if (typeof path !== "string" || !path.startsWith("/api/v1/") || path.startsWith("//")) {
    throw new Error("Expected a relative Django API path");
  }
  const incoming = await headers();
  const host = incoming.get("host") || "localhost";
  const proto = incoming.get("x-forwarded-proto") || "http";
  const forwardedFor = incoming.get("x-forwarded-for") || undefined;
  if (privateData) {
    return djangoRequest(path, { host, proto, forwardedFor, cookie: incoming.get("cookie") || undefined });
  }
  // Public data is cached for 60s keyed by (path + public host) only: Django
  // builds absolute URLs from the forwarded host, so different public hosts
  // must never share an entry, while per-visitor data (cookie, X-Forwarded-For)
  // must not fragment the cache. The cookie is never sent on public calls.
  // headers() is read above, outside the cached callback, as unstable_cache
  // callbacks must not read request data.
  const load = unstable_cache(
    async () => djangoRequest(path, { host, proto, forwardedFor }),
    ["api-server", path, host],
    { revalidate: PUBLIC_REVALIDATE_SECONDS }
  );
  return load();
}

export async function allPages(path) {
  const first = await apiServer(path);
  if (Array.isArray(first)) return { results: first };
  const results = [...(first.results || [])];
  let next = first.next;
  const seen = new Set([path]);
  while (next) {
    const url = new URL(next, "http://django");
    const relative = url.pathname + url.search;
    if (seen.has(relative)) throw new Error("Pagination loop");
    seen.add(relative);
    const page = await apiServer(relative);
    results.push(...(page.results || []));
    next = page.next;
  }
  return { ...first, results, next: null };
}

export const getSite = cache(async () => {
  const [settings, content] = await Promise.all([
    apiServer("/api/v1/site/settings/").catch(() => ({})),
    apiServer("/api/v1/site/content/").catch(() => null),
  ]);
  return { settings, content: normalizeContent(content) };
});

export async function getHomeData() {
  const [banners, categories, deals, brands, featured, fresh, best_sellers, reviewProducts] = await Promise.all([
    allPages("/api/v1/banners/").catch(() => ({ results: [] })),
    allPages("/api/v1/categories/tree/").catch(() => ({ results: [] })),
    allPages("/api/v1/banners/daily-deals/").catch(() => ({ results: [] })),
    allPages("/api/v1/brands/?is_featured=true").catch(() => ({ results: [] })),
    apiServer("/api/v1/products/?is_featured=true").catch(() => ({ results: [], failed: true })),
    apiServer("/api/v1/products/?is_new=true").catch(() => ({ results: [], failed: true })),
    apiServer("/api/v1/products/?is_best_seller=true").catch(() => ({ results: [], failed: true })),
    apiServer("/api/v1/products/?is_best_seller=true&page_size=4").catch(() => ({ results: [], failed: true })),
  ]);
  const reviews = (
    await Promise.all(
      (reviewProducts.results || []).slice(0, 3).map(async (product) => {
        try {
          const data = await apiServer(`/api/v1/reviews/product/${product.id}/?page_size=1`);
          return { product, review: data.results?.[0] };
        } catch {
          return { product };
        }
      })
    )
  ).filter((entry) => entry.review);
  return { banners: banners.results, categories: categories.results, deals, brands, featured, new: fresh, best_sellers, reviewProducts, reviews };
}
