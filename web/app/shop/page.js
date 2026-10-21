import { permanentRedirect } from "next/navigation";

import ShopView from "../../shop/ShopView";
import JsonLd from "../../components/JsonLd";
import {
  getShopData,
  listBrands,
  listCategories,
  parseShopParams,
  readShopPage,
  shopPageHref,
} from "../../lib/catalog-server";
import { getSite } from "../../lib/api-server";
import { shopMetadata } from "../../lib/metadata";
import { breadcrumbJsonLd } from "../../lib/jsonld";
import { faDigits } from "../../utils/faDigits";
import { categoryChain, categoryUrl } from "../../utils/categories";

// Filter state lives in the query string and every render reads the live
// catalog, so these pages are never statically cached.
export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }) {
  const query = (await searchParams) || {};
  const params = parseShopParams(query);
  const [site, categories, brands] = await Promise.all([
    getSite(),
    listCategories().catch(() => ({ results: [] })),
    listBrands().catch(() => ({ results: [] })),
  ]);
  return shopMetadata({
    params,
    categories: categories.results || [],
    brands: brands.results || [],
    settings: site.settings,
    content: site.content,
  });
}

export default async function ShopPage({ searchParams }) {
  const query = (await searchParams) || {};
  const params = parseShopParams(query);

  // `?page=N` is capped (MAX_SHOP_PAGES) and validated BEFORE any Django call:
  // deeper or malformed pages 308 to the same listing, so a single request can
  // never fan out into an unbounded number of upstream calls.
  const { page, redirect } = readShopPage(params.page);
  if (redirect !== null) {
    permanentRedirect(shopPageHref("/shop/", params, { page: redirect === "drop" ? null : redirect }));
  }
  // Only a clean 1..MAX integer survives from here on ("007" upstream would
  // be a different, possibly invalid page parameter for Django).
  if (params.page !== undefined) params.page = String(page);

  const data = await getShopData(params);

  // Same trail as the visible breadcrumbs: کازین گالری › فروشگاه › … › category
  const trail = [{ label: "کازین گالری", to: "/" }, { label: "فروشگاه", to: "/shop/" }];
  for (const category of categoryChain(params.category, data.categories)) {
    trail.push({ label: faDigits(category.name), to: categoryUrl(category) });
  }

  return (
    <>
      <JsonLd id="breadcrumb-jsonld" data={breadcrumbJsonLd(trail)} />
      <ShopView
        params={params}
        products={data.products}
        categories={data.categories}
        brands={data.brands}
        facets={data.facets}
      />
    </>
  );
}
