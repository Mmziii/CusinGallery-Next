import { SITE_ORIGIN } from "../lib/site";

/**
 * One place that decides which image represents a product, category or brand
 * in a share/SEO context (og:image, JSON-LD). Ported verbatim from the SPA:
 * primary_image is an OBJECT ({image, webp_400, ...}), so it must never be
 * string-concatenated onto the origin.
 */

/** Shared 1200x630 brand placeholder, rendered from the brand mark. */
export const OG_PLACEHOLDER = "/brand/og-placeholder.png";

//: Smallest share image we accept from the responsive variants.
const MIN_SHARE_WIDTH = 600;
const VARIANT_ORDER = ["webp_1200", "webp_800"];

function toAbsolute(value) {
  if (!value) return null;
  const url = String(value);
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${SITE_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Site-root-relative (or absolute) src of the best share image, or null. */
export function shareImageSrc(image) {
  if (!image) return null;
  if (typeof image === "string") return image || null;
  for (const key of VARIANT_ORDER) {
    if (image[key]) return image[key];
  }
  if (image.image) return image.image;
  return null;
}

/** ABSOLUTE share URL; the shared brand placeholder when there is none. */
export function shareImageUrl(image) {
  return toAbsolute(shareImageSrc(image)) || toAbsolute(OG_PLACEHOLDER);
}

/** ABSOLUTE URL for an already-resolved path (e.g. a canonical page URL). */
export function absoluteUrl(path) {
  return toAbsolute(path);
}

export { MIN_SHARE_WIDTH };
