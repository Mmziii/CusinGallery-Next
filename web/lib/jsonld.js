import { SITE_NAME, SITE_ORIGIN } from "./site";
import { shareImageUrl } from "../utils/shareImage";

/**
 * Structured data, server-rendered (the SPA appended these with effects, so
 * crawlers that do not execute JavaScript never saw them).
 *
 * Prices: the storefront stores and displays whole Toman; schema.org/Google
 * want an ISO-4217 currency with a minor unit, so the published price is
 * converted to IRR (Rial = Toman * 10) and labelled "IRR". The visible page
 * keeps showing Toman.
 */
export const TOMAN_TO_RIAL = 10;

const absolute = (path, origin) => {
  const base = (origin || SITE_ORIGIN).replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
};

/** schema.org price for a Toman amount, as a string (Google's preference). */
export function rialPrice(toman) {
  if (toman == null || toman === "" || !Number.isFinite(Number(toman))) return undefined;
  const rial = Math.round(Number(toman) * TOMAN_TO_RIAL);
  return String(rial);
}

export function productJsonLd(product, { slug, origin } = {}) {
  const url = absolute(`/products/${encodeURIComponent(slug)}/`, origin);
  const image = shareImageUrl(product?.primary_image || product?.images?.[0] || null);
  const price = rialPrice(product?.price_info?.price);
  const outOfStock = product?.stock_status === "out_of_stock";
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product?.name,
    image: [image],
    description: product?.short_description || product?.description || undefined,
    sku: product?.sku || undefined,
    brand: product?.brand?.name ? { "@type": "Brand", name: product.brand.name } : undefined,
    url,
    offers: {
      "@type": "Offer",
      price,
      priceCurrency: "IRR",
      availability: outOfStock
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
      url,
    },
  };
}

export function breadcrumbJsonLd(items, { origin } = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: (items || []).map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      ...(crumb.to ? { item: absolute(crumb.to, origin) } : {}),
    })),
  };
}

export function websiteJsonLd({ origin, description } = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absolute("/", origin),
    inLanguage: "fa-IR",
    description: description || undefined,
    potentialAction: {
      "@type": "SearchAction",
      target: `${absolute("/shop/", origin)}?search={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function organizationJsonLd({ origin, settings = {}, content } = {}) {
  const footer = content?.footer || {};
  const phone = footer.phones?.[0] || settings?.phone || undefined;
  const email = footer.email || settings?.email || undefined;
  const socials = footer.socials || {};
  const sameAs = Object.values(socials || {}).filter(
    (value) => typeof value === "string" && /^https?:\/\//.test(value)
  );
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: content?.brand?.name || SITE_NAME,
    url: absolute("/", origin),
    logo: absolute(content?.brand?.logo || "/brand/lockup.svg", origin),
    ...(phone ? { telephone: phone } : {}),
    ...(email ? { email } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/** `<script type="application/ld+json">` payload as a plain string. */
export function jsonLdScript(data) {
  return JSON.stringify(data);
}
