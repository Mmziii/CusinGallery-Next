import { djangoRequest } from "./django-request";

/**
 * Does a catalog or info-page slug exist? Used by `proxy.js`, which cannot ask
 * the page (it runs before the render) and cannot throw `notFound()` itself.
 *
 * Why the proxy needs this at all: in Next 16.4 a `notFound()` thrown from a
 * dynamic page answers 404 with an EMPTY document — the not-found UI is only
 * in the RSC payload (vercel/next.js#99287). Re-rendering the 404 as a normal
 * page and keeping the 404 status is only possible from the proxy, and that
 * needs the answer before the page renders.
 *
 * Cost control:
 *  - 60-second TTL, the same window as the public catalog/info-page cache, so a
 *    busy page costs at most one extra internal request per minute;
 *  - concurrent lookups of the same slug share one request;
 *  - an upstream failure is never treated as "missing" (null = unknown), and
 *    unknowns are cached only briefly, so a Django outage degrades to the
 *    page's own fallback instead of 404-ing live URLs.
 */
const REVALIDATE_MS = 60_000;
const UNKNOWN_MS = 5_000;
const CHECK_TIMEOUT_MS = 3_000;

const cache = new Map();
const inflight = new Map();

/** The two catalog detail routes proxy.js checks, and their API collections. */
export const CATALOG_KINDS = new Set(["products", "brands"]);

/** The five owner-editable info-page routes proxy.js checks for publication. */
export const INFO_PAGE_SLUGS = new Set([
  "about",
  "contact",
  "shipping-returns",
  "terms",
  "privacy",
]);

/**
 * Pathname of the Django detail endpoint for a slug. `kind` is the URL
 * collection name ("products" / "brands").
 */
export function catalogPath(kind, slug) {
  return `/api/v1/${kind}/${encodeURIComponent(slug)}/`;
}

/** Pathname of the Django endpoint for an owner-editable info page. */
export function infoPagePath(slug) {
  return `/api/v1/site/pages/${encodeURIComponent(slug)}/`;
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

async function checkEndpointExists(key, apiPath, { host, proto, forwardedFor } = {}) {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const lookup = (async () => {
    try {
      await djangoRequest(apiPath, {
        host,
        proto,
        forwardedFor,
        timeout: CHECK_TIMEOUT_MS,
        source: "proxy",
      });
      return true;
    } catch (error) {
      // Only Django's own 404 means "this slug is gone / unpublished".
      // Timeouts, 5xx and socket errors stay unknown so a bad minute never
      // turns live pages into 404s.
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

/**
 * @returns {Promise<true|false|null>} true = exists, false = Django says 404,
 *   null = unknown (upstream error) — callers must fail open on null.
 */
export async function catalogSlugExists(kind, slug, meta = {}) {
  const hostKey = String(meta?.host || "").toLowerCase();
  return checkEndpointExists(`${hostKey}:${kind}:${slug}`, catalogPath(kind, slug), meta);
}

/**
 * @returns {Promise<true|false|null>} true = published, false = Django says 404
 *   (unpublished or missing), null = unknown (upstream error) — fail open.
 */
export async function infoPageExists(slug, meta = {}) {
  const hostKey = String(meta?.host || "").toLowerCase();
  return checkEndpointExists(`${hostKey}:info:${slug}`, infoPagePath(slug), meta);
}

/** Test hook: forget every cached answer. */
export function resetCatalogAvailability() {
  cache.clear();
  inflight.clear();
}
