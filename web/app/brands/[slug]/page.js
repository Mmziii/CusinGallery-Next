import { notFound, permanentRedirect } from "next/navigation";

import ShopView from "../../../shop/ShopView";
import JsonLd from "../../../components/JsonLd";
import {
  getBrand,
  getShopData,
  isNotFound,
  parseShopParams,
  shopHref,
} from "../../../lib/catalog-server";
import { getSite } from "../../../lib/api-server";
import { brandMetadata } from "../../../lib/metadata";
import { breadcrumbJsonLd } from "../../../lib/jsonld";
import { readShopPage, totalPages } from "../../../utils/shopPaging";
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
  const basePath = `/brands/${encodeURIComponent(slug)}/`;

  // Same page contract as /shop/: invalid spellings 308 to the page-less URL,
  // a page past the end 308s to the real last page. Nothing here loops.
  const { page, invalid } = readShopPage(shopParams.page);
  if (invalid) permanentRedirect(shopHref(basePath, shopParams, { fixedBrand: brand }));

  const data = await getShopData(shopParams, { fixedBrand: brand, basePath });
  if (data.redirectTo) permanentRedirect(data.redirectTo);

  const pages = totalPages(data.products?.count);

  const trail = [
    { label: "کازین گالری", to: "/" },
    { label: "برندها" },
    { label: faDigits(brand.name) },
  ];

  return (
    <>
      <JsonLd id="breadcrumb-jsonld" data={breadcrumbJsonLd(trail)} />
      {page > 1 ? (
        <link
          rel="prev"
          href={shopHref(basePath, shopParams, { page: page - 1, fixedBrand: brand })}
        />
      ) : null}
      {pages > page ? (
        <link rel="next" href={shopHref(basePath, shopParams, { page: page + 1, fixedBrand: brand })} />
      ) : null}
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
