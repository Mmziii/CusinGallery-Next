// trailingSlash is ON so the Next pages keep the storefront's existing URL
// shape (/shop/, /products/<slug>/, /brands/<slug>/): old links, canonicals
// and the Django sitemap stay valid, and filtering/paging query strings are
// appended to the same paths the SPA used.
export default {
  output: "standalone",
  poweredByHeader: false,
  trailingSlash: true,
  // Next serves web/public with `Cache-Control: public, max-age=0`, which
  // makes browsers revalidate the self-hosted fonts and the brand artwork on
  // every page view. The retired SPA container sent long-lived headers for
  // exactly these files; restore them here. /_next/static (immutable) and the
  // page/API headers set by proxy.js are not touched.
  async headers() {
    return [
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/brand/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/favicon.svg",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/favicon.ico",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};
