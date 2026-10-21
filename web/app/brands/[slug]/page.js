import { notFound, permanentRedirect } from "next/navigation";

import ShopView from "../../../shop/ShopView";
import JsonLd from "../../../components/JsonLd";
import {
  getBrand,
  getShopData,
  isNotFound,
  parseShopParams,
  readShopPage,
  shopPageHref,
} from "../../../lib/catalog-server";
import { getSite } from "../../../lib/api-server";
import { brandMetadata } from "../../../lib/metadata";
import { breadcrumbJsonLd } from "../../../lib/jsonld";
import { faDigits } from "../../../utils/faDigits";

export const dynamic = "force-dynamic";

async function loadBrand(slug) {
  try {
    return await getBrand(slug);
  } catch (error) {
    // A real brand lookup prevents an empty listing from hiding a 404.
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function generateMetadata({ params, searchParams }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // ?page=N pages are duplicates of the brand listing: noindex them, and keep
  // the canonical on the page-less brand URL.
  const page = readShopPage(parseShopParams(query || {}).page).page;
  const [brand, site] = await Promise.all([loadBrand(slug), getSite()]);
  if (!brand) return { title: "صفحه یافت نشد | کازین گالری", robots: { index: false, follow: false } };
  return brandMetadata({ brand, page, settings: site.settings, content: site.content });
}

export default async function BrandPage({ params, searchParams }) {
  const { slug } = await params;
  const brand = await loadBrand(slug);
  if (!brand || brand.slug !== slug) notFound();

  const query = (await searchParams) || {};
  const shopParams = parseShopParams(query, { brandSlug: slug });

  // Same ?page= guard as /shop/: cap at MAX_SHOP_PAGES and normalise anything
  // malformed, before any listing request is issued.
  const { page, redirect } = readShopPage(shopParams.page);
  if (redirect !== null) {
    permanentRedirect(
      shopPageHref(`/brands/${encodeURIComponent(slug)}/`, shopParams, {
        page: redirect === "drop" ? null : redirect,
        fixedBrand: brand,
      })
    );
  }
  if (shopParams.page !== undefined) shopParams.page = String(page);

  const data = await getShopData(shopParams, { fixedBrand: brand });

  const trail = [
    { label: "کازین گالری", to: "/" },
    { label: "برندها" },
    { label: faDigits(brand.name) },
  ];

  return (
    <>
      <JsonLd id="breadcrumb-jsonld" data={breadcrumbJsonLd(trail)} />
      <ShopView
        params={shopParams}
        fixedBrand={brand}
        products={data.products}
        categories={data.categories}
        brands={data.brands}
        facets={data.facets}
      />
    </>
  );
}
