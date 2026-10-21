import ShopView from "../../shop/ShopView";
import JsonLd from "../../components/JsonLd";
import { getShopData, listBrands, listCategories, parseShopParams } from "../../lib/catalog-server";
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
