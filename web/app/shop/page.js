import { permanentRedirect } from "next/navigation";

import ShopView from "../../shop/ShopView";
import JsonLd from "../../components/JsonLd";
import { getShopData, listBrands, listCategories, parseShopParams, shopHref } from "../../lib/catalog-server";
import { getSite } from "../../lib/api-server";
import { shopMetadata } from "../../lib/metadata";
import { breadcrumbJsonLd } from "../../lib/jsonld";
import { readShopPage, totalPages } from "../../utils/shopPaging";
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

  // `?page=` is a plain positive integer or it is not a page at all: an
  // invalid spelling 308s to the same listing with the parameter removed,
  // before any Django request is made.
  const { page, invalid } = readShopPage(params.page);
  if (invalid) permanentRedirect(shopHref("/shop/", params));

  const data = await getShopData(params, { basePath: "/shop/" });
  // Past the last page: 308 to the real last page (resolved from `count`),
  // never to an empty grid.
  if (data.redirectTo) permanentRedirect(data.redirectTo);

  const pages = totalPages(data.products?.count);

  // Same trail as the visible breadcrumbs: کازین گالری › فروشگاه › … › category
  const trail = [{ label: "کازین گالری", to: "/" }, { label: "فروشگاه", to: "/shop/" }];
  for (const category of categoryChain(params.category, data.categories)) {
    trail.push({ label: faDigits(category.name), to: categoryUrl(category) });
  }

  return (
    <>
      <JsonLd id="breadcrumb-jsonld" data={breadcrumbJsonLd(trail)} />
      {/* Paged listings advertise their neighbours to crawlers; the canonical
          stays page-less (see lib/metadata.js) and page > 1 is noindex. */}
      {page > 1 ? (
        <link
          rel="prev"
          href={shopHref("/shop/", params, { page: page - 1 })}
        />
      ) : null}
      {pages > page ? <link rel="next" href={shopHref("/shop/", params, { page: page + 1 })} /> : null}
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
