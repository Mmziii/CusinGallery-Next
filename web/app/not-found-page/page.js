import NotFoundPage from "../../components/NotFoundPage";

/**
 * The 404 document as a REAL page: same component as `app/not-found.js`, but
 * rendered through the root layout (header, footer, theme, fonts), which is
 * what `notFound()` cannot do on Next 16.4 (see proxy.js).
 *
 * `proxy.js` rewrites unknown /products/<slug>/ and /brands/<slug>/ here and
 * keeps the 404 status on the rewrite, so the server HTML carries the Persian
 * 404 with the site header in the first response. The address bar keeps the
 * requested URL (a rewrite, not a redirect).
 *
 * A direct visit to /not-found-page/ is possible; it is noindex so the only
 * URL search engines can associate with it stays the real one.
 */
export const metadata = {
  title: "صفحه یافت نشد | کازین گالری",
  robots: { index: false, follow: false },
};

export default function NotFoundRoute() {
  return <NotFoundPage />;
}
