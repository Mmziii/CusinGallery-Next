import { djangoRequest } from "./django-request";

/**
 * Does a catalog slug exist? Used by `proxy.js`, which cannot ask the page
 * (it runs before the render) and cannot throw `notFound()` itself.
 *
 * Why the proxy needs this at all: in Next 16.4 a `notFound()` thrown from a
 * dynamic page answers 404 with an EMPTY document — the not-found UI is only
 * in the RSC payload (vercel/next.js#99287). Re-rendering the 404 as a normal
 * page and keeping the 404 status is only possible from the proxy, and that
 * needs the answer before the page renders.
 *
 * Cost control:
 *  - 60-second TTL, the same window as the public catalog cache, so a busy
 *    product page costs at most one extra internal request per minute;
 *  - concurrent lookups of the same slug share one request;
 *  - an upstream failure is never treated as "missing" (null = unknown), and
 *    unknowns are cached only briefly, so a Django outage degrades to the
 *    old behaviour instead of 404-ing the whole catalog.
 */
const REVALIDATE_MS = 60_000;
const UNKNOWN_MS = 5_000;
const CHECK_TIMEOUT_MS = 3_000;

const cache = new Map();
const inflight = new Map();

/** The two catalog detail routes proxy.js checks, and their API collections. */
export const CATALOG_KINDS = new Set(["products", "brands"]);

/**
 * Pathname of the Django detail endpoint for a slug. `kind` is the URL
 * collection name ("products" / "brands").
 */
export function catalogPath(kind, slug) {
  return `/api/v1/${kind}/${encodeURIComponent(slug)}/`;
}

function remember(key, value) {
  const ttl = value === null ? UNKNOWN_MS : REVALIDATE_MS;
  cache.set(key, { value, expires: Date.now() + ttl });
  // Bound the map: this runs in the server process for the life of a
  // container, so stale slugs must not accumulate forever.
  if (cache.size > 5000) {
    const now = Date.now();
    for (const [entryKey, entry] of cache) {
      if (entry.expires <= now) cache.delete(entryKey);
    }
  }
}

/**
 * @returns {Promise<true|false|null>} true = exists, false = Django says 404,
 *   null = unknown (upstream error) — callers must fail open on null.
 */
export async function catalogSlugExists(kind, slug, { host, proto, forwardedFor } = {}) {
  const key = `${kind}:${slug}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const lookup = (async () => {
    try {
      await djangoRequest(catalogPath(kind, slug), {
        host,
        proto,
        forwardedFor,
        timeout: CHECK_TIMEOUT_MS,
        source: "proxy",
      });
      return true;
    } catch (error) {
      // Only Django's own 404 means "this slug is gone". Timeouts, 5xx and
      // socket errors stay unknown so a bad minute never 404s the catalog.
      if (error?.status === 404) return false;
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, lookup);
  const value = await lookup;
  remember(key, value);
  return value;
}

/** Test hook: forget every cached answer. */
export function resetCatalogAvailability() {
  cache.clear();
  inflight.clear();
}
