import { SITE_NAME, SITE_ORIGIN } from "./site";
import { shareImageUrl } from "../utils/shareImage";
import { faDigits } from "../utils/faDigits";

export const DEFAULT_DESCRIPTION =
  "فروشگاه آنلاین ظروف آشپزخانه، پخت‌وپز، بلور و کریستال و لوازم خانه. ارسال به سراسر ایران، پرداخت امن اینترنتی.";

const absolute = (path) => `${SITE_ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;

// Same suffix the SPA's usePageMeta appended to every page title.
const withSuffix = (title) => (title ? `${title} | ${SITE_NAME}` : null);

export function homeMetadata({ settings, content }) {
  const title = settings.seo_title || "کازین گالری | فروشگاه لوازم آشپزخانه، بلور و کریستال";
  const description = settings.seo_description || DEFAULT_DESCRIPTION;
  const url = new URL("/", SITE_ORIGIN).href;
  return { twitter: { card: "summary_large_image" }, metadataBase: new URL(SITE_ORIGIN), title, description: settings.seo_description || `کازین گالری - ${description}`, alternates: { canonical: url }, openGraph: { title, description, url, type: "website", locale: "fa_IR", siteName: content.brand?.name || SITE_NAME, images: [settings.og_image || "/brand/og.png"] } };
}

// Next validates og:type and only accepts its own enum ("product" is not in
// it -- asking for it throws and the whole metadata object is then dropped).
// Product rich results come from the JSON-LD Product instead, so the Open
// Graph type stays "website".
const OG_TYPES = new Set(["website", "article", "book", "profile", "music.album", "video.movie"]);

/**
 * Catalog metadata (title / description / canonical / OpenGraph), mirroring
 * what the SPA's usePageMeta produced client-side -- now in the HTML itself.
 *
 * Canonical policy: page and filter params never fork a canonical. A filtered
 * shop keeps only its category (the shareable, crawlable view), exactly as
 * phase 2 requires; a brand page always points at its own URL.
 */
function buildMetadata({ title, description, canonicalPath, image, type = "website", page = 1, settings = {}, content } = {}) {
  const url = absolute(canonicalPath);
  const finalTitle = withSuffix(title);
  const finalDescription = description || DEFAULT_DESCRIPTION;
  const ogImage = image || settings.og_image || "/brand/og.png";
  // ?page=N listings are the SAME products as page 1 (the pager concatenates
  // them), so they must never be indexed. The canonical already points at the
  // page-less URL; without this, crawlers would index /shop/?page=2..N as
  // duplicate content and keep discovering arbitrarily deep links.
  const paged = Number(page) > 1;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: finalTitle,
    description: finalDescription,
    alternates: { canonical: url },
    ...(paged ? { robots: { index: false, follow: true } } : {}),
    twitter: { card: "summary_large_image" },
    openGraph: {
      title: finalTitle,
      description: finalDescription,
      url,
      type: OG_TYPES.has(type) ? type : "website",
      locale: "fa_IR",
      siteName: content?.brand?.name || SITE_NAME,
      images: [ogImage],
    },
  };
}

/** Unfiltered shop canonical; a category filter keeps its own shareable URL. */
export function shopCanonicalPath(categorySlug) {
  return categorySlug ? `/shop/?category=${encodeURIComponent(categorySlug)}` : "/shop/";
}

export function shopMetadata({ params = {}, categories = [], brands = [], fixedBrand = null, settings = {}, content = {} } = {}) {
  const selectedCategory = categories.find((category) => category.slug === params.category) || null;
  const selectedBrand = fixedBrand || brands.find((brand) => brand.slug === params.brand) || null;
  const filtered = fixedBrand || selectedCategory || selectedBrand;
  const image = filtered
    ? shareImageUrl(fixedBrand ? fixedBrand.tile_image || fixedBrand.logo : selectedCategory ? selectedCategory.image : selectedBrand.tile_image || selectedBrand.logo)
    : undefined;
  const title = fixedBrand
    ? `محصولات برند ${faDigits(fixedBrand.name)}`
    : filtered
      ? faDigits(filtered.name)
      : "فروشگاه";
  const description =
    (fixedBrand ? `خرید محصولات برند ${faDigits(fixedBrand.name)} از کازین گالری؛ قیمت به تومان و ارسال به سراسر ایران.` : "") ||
    (selectedCategory && selectedCategory.description) ||
    (filtered ? `خرید آنلاین ${filtered.name} از کازین گالری؛ ارسال به سراسر ایران.` : DEFAULT_DESCRIPTION);
  return buildMetadata({
    title,
    description,
    canonicalPath: fixedBrand ? `/brands/${encodeURIComponent(fixedBrand.slug)}/` : shopCanonicalPath(selectedCategory?.slug),
    image,
    page: Number(params.page) || 1,
    settings,
    content,
  });
}

export function brandMetadata({ brand, page = 1, settings = {}, content = {} } = {}) {
  const name = brand?.name || "";
  return buildMetadata({
    title: `محصولات برند ${faDigits(name)}`,
    description: `خرید محصولات برند ${faDigits(name)} از کازین گالری؛ قیمت به تومان و ارسال به سراسر ایران.`,
    canonicalPath: `/brands/${encodeURIComponent(brand?.slug || "")}/`,
    image: shareImageUrl(brand?.tile_image || brand?.logo),
    page,
    settings,
    content,
  });
}

export function productMetadata({ product, slug, settings = {}, content = {} } = {}) {
  const image = product ? shareImageUrl(product.primary_image || product.images?.[0] || null) : undefined;
  return buildMetadata({
    title: product?.name ? faDigits(product.name) : "صفحه یافت نشد",
    description: product?.short_description ? faDigits(product.short_description) : undefined,
    canonicalPath: `/products/${encodeURIComponent(slug)}/`,
    image,
    type: "product",
    settings,
    content,
  });
}

export function infoPageMetadata({
  page,
  fallbackTitle,
  path,
  settings = {},
  content = {},
} = {}) {
  return buildMetadata({
    title: page?.seo_title || page?.title || fallbackTitle,
    description: page?.seo_description,
    canonicalPath: path,
    settings,
    content,
  });
}
