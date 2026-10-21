import { notFound } from "next/navigation";

import ProductDetail from "../../../product/ProductDetail";
import JsonLd from "../../../components/JsonLd";
import { getProduct, getProductReviews, isNotFound } from "../../../lib/catalog-server";
import { getSite } from "../../../lib/api-server";
import { productMetadata } from "../../../lib/metadata";
import { breadcrumbJsonLd, productJsonLd } from "../../../lib/jsonld";
import { faDigits } from "../../../utils/faDigits";
import { categoryUrl } from "../../../utils/categories";

// Prices depend on the live daily deals the backend applies to price_info, so
// a product page is rendered per request rather than pre-generated.
export const dynamic = "force-dynamic";

async function loadProduct(slug) {
  try {
    return await getProduct(slug);
  } catch (error) {
    // An unknown/inactive slug is a REAL 404 (status + the Persian page), not
    // an empty 200 shell. Anything else is a genuine upstream failure.
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const [product, site] = await Promise.all([loadProduct(slug), getSite()]);
  if (!product) return { title: "صفحه یافت نشد | کازین گالری", robots: { index: false, follow: false } };
  return productMetadata({ product, slug, settings: site.settings, content: site.content });
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product || !product.slug) notFound();
  const reviews = await getProductReviews(product.id);

  // Same trail the page renders: کازین گالری › …ancestors › category › product
  const trail = [{ label: "کازین گالری", to: "/" }];
  if (product.category) {
    for (const ancestor of product.category.ancestors || []) {
      trail.push({ label: faDigits(ancestor.name), to: categoryUrl(ancestor) });
    }
    trail.push({ label: faDigits(product.category.name), to: categoryUrl(product.category) });
  }
  trail.push({ label: faDigits(product.name) });

  return (
    <>
      <JsonLd id="breadcrumb-jsonld" data={breadcrumbJsonLd(trail)} />
      <JsonLd id="product-jsonld" data={productJsonLd(product, { slug })} />
      <ProductDetail product={product} slug={slug} reviews={reviews} />
    </>
  );
}
