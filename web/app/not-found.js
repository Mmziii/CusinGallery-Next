import NotFoundPage from "../components/NotFoundPage";

/**
 * Real 404 (status code + the storefront's Persian design), identical to the
 * SPA's NotFound page.
 *
 * Unmatched URLs render this through the root layout in full, with a 404
 * status, no extra plumbing. A `notFound()` thrown by a dynamic catalog page
 * is different: Next 16.4 serves that as an EMPTY 404 document (the UI only
 * reaches the browser in the RSC payload — vercel/next.js#99287), so
 * `proxy.js` rewrites an unknown /products/<slug>/ or /brands/<slug>/ to
 * `app/not-found-page/page.js`, which renders this same component inside the
 * layout and keeps the 404 status. Both paths therefore show one 404 design.
 */
export const metadata = { title: "صفحه یافت نشد | کازین گالری" };

export default function NotFound() {
  return <NotFoundPage />;
}
