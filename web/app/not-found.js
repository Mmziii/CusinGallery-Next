import NotFoundPage from "../components/NotFoundPage";

/**
 * Real 404 (status code + the storefront's Persian design), identical to the
 * SPA's NotFound page. Used for unmatched URLs -- the catalog segments have
 * their own boundary (app/products/[slug]/not-found.js) that renders the same
 * component when notFound() is raised for an unknown slug.
 */
export const metadata = { title: "صفحه یافت نشد | کازین گالری" };

export default function NotFound() {
  return <NotFoundPage />;
}
