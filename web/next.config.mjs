// trailingSlash is ON so the Next pages keep the storefront's existing URL
// shape (/shop/, /products/<slug>/, /brands/<slug>/): old links, canonicals
// and the Django sitemap stay valid, and filtering/paging query strings are
// appended to the same paths the SPA used.
export default { output: "standalone", poweredByHeader: false, trailingSlash: true };
