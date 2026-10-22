import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { headerState, routerMock, revalidateCalls } = vi.hoisted(() => ({
  headerState: { host: "cusin.ir", proto: "https", pathname: "/" },
  routerMock: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  },
  revalidateCalls: [],
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["host", headerState.host],
      ["x-forwarded-proto", headerState.proto],
      ["x-forwarded-for", "198.51.100.77"],
      ["cookie", "sessionid=must-not-leak-to-public-info-cache"],
    ]),
}));

vi.mock("next/cache", () => {
  const store = new Map();
  return {
    unstable_cache: (fn, keyParts, opts) => {
      revalidateCalls.push({ keyParts, revalidate: opts?.revalidate });
      return (...args) => {
        const key = JSON.stringify([keyParts, args]);
        if (!store.has(key)) {
          const pending = Promise.resolve()
            .then(() => fn(...args))
            .catch((err) => {
              store.delete(key);
              throw err;
            });
          store.set(key, pending);
        }
        return store.get(key);
      };
    },
  };
});

class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSignal();
  },
  usePathname: () => headerState.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => routerMock,
  useParams: () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...props }) => (
    <a href={href} data-next-router={prefetch === false ? "next-link" : "next-link-prefetch"} {...props}>
      {children}
    </a>
  ),
}));

import AboutPage, { generateMetadata as aboutMeta } from "../app/about/page";
import ContactPage, { generateMetadata as contactMeta } from "../app/contact/page";
import ShippingReturnsPage, { generateMetadata as shippingMeta } from "../app/shipping-returns/page";
import TermsPage, { generateMetadata as termsMeta } from "../app/terms/page";
import PrivacyPage, { generateMetadata as privacyMeta } from "../app/privacy/page";
import NotFound from "../app/not-found";
import { DJANGO_OWNED_PREFIXES, Link, NavLink, isDjangoOwnedPath, isNextOwnedPath, useNavigate } from "../lib/navigation";
import { DEFAULT_DESCRIPTION } from "../lib/metadata";

const readRepoFile = (relPath) =>
  readFileSync(new URL(`../../${relPath}`, import.meta.url), "utf8");

const PAGES_FIXTURE = {
  about: {
    slug: "about",
    path: "/about/",
    title: "دربارهٔ کازین گالری",
    body: "<h2>داستان ما</h2><p>کازین گالری همراه آشپزخانهٔ ایرانی است.</p>",
    seo_title: "دربارهٔ کازین گالری",
    seo_description: "آشنایی با کازین گالری، فروشگاه تخصصی لوازم آشپزخانه.",
  },
  contact: {
    slug: "contact",
    path: "/contact/",
    title: "تماس با کازین گالری",
    body: "<h2>راه‌های ارتباطی</h2><ul><li>تلفن: <a href=\"tel:02188001122\">۰۲۱-۸۸۰۰۱۱۲۲</a></li><li>ایمیل: <a href=\"mailto:support@cusin.ir\">support@cusin.ir</a></li></ul>",
    seo_title: "",
    seo_description: "تلفن، ایمیل و نشانی پشتیبانی کازین گالری.",
  },
  "shipping-returns": {
    slug: "shipping-returns",
    path: "/shipping-returns/",
    title: "شرایط ارسال و مرجوعی کالا",
    body: "<h2>ارسال سفارش‌ها</h2><p>ارسال با بسته‌بندی ایمن انجام می‌شود.</p><p><a href=\"/contact/\">تماس با ما</a></p>",
    seo_title: "ارسال و مرجوعی | راهنمای خرید",
    seo_description: "شرایط ارسال، بسته‌بندی و بازگشت ۷ روزه در کازین گالری.",
  },
  terms: {
    slug: "terms",
    path: "/terms/",
    title: "قوانین و مقررات استفاده",
    body: "<h2>شرایط عمومی</h2><p>ثبت سفارش به منزلهٔ پذیرش قوانین است.</p>",
    seo_title: "قوانین و مقررات",
    seo_description: "",
  },
  privacy: {
    slug: "privacy",
    path: "/privacy/",
    title: "حریم خصوصی کاربران",
    body: "<h2>محرمانگی اطلاعات</h2><p>اطلاعات شما نزد کازین گالری محفوظ است.</p>",
    seo_title: "حریم خصوصی",
    seo_description: "شیوهٔ حفاظت از اطلاعات کاربران در کازین گالری.",
  },
};

let server;
let receivedRequests = [];
let pageMode = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    receivedRequests.push({
      url: req.url,
      host: req.headers.host,
      cookie: req.headers.cookie,
      proto: req.headers["x-forwarded-proto"],
    });
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (req.url === "/api/v1/site/settings/") {
      return res.end(JSON.stringify({ site_name: "کازین گالری", og_image: "/brand/og.png" }));
    }
    if (req.url === "/api/v1/site/content/") {
      return res.end(JSON.stringify({ brand: { name: "کازین گالری" } }));
    }

    const match = /^\/api\/v1\/site\/pages\/([^/]+)\/$/.exec(req.url);
    if (match) {
      const slug = decodeURIComponent(match[1]);
      const mode = pageMode[slug];
      if (mode === "404") {
        res.statusCode = 404;
        return res.end(JSON.stringify({ detail: "Not found." }));
      }
      if (mode === "503") {
        res.statusCode = 503;
        return res.end(JSON.stringify({ detail: "Service unavailable." }));
      }
      if (mode === "drop") {
        return req.socket.destroy();
      }
      if (PAGES_FIXTURE[slug]) {
        return res.end(JSON.stringify(PAGES_FIXTURE[slug]));
      }
      res.statusCode = 404;
      return res.end(JSON.stringify({ detail: "Not found." }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ detail: "Not found." }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.INTERNAL_API_URL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  receivedRequests = [];
  pageMode = {};
  headerState.host = "cusin.ir";
  headerState.proto = "https";
  headerState.pathname = "/";
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  routerMock.refresh.mockClear();
});

describe("Phase 4 info pages SSR, SEO metadata, 404 & fail-open", () => {
  it.each([
    ["about", "/about/", AboutPage, aboutMeta, "دربارهٔ کازین گالری | کازین گالری", PAGES_FIXTURE.about.seo_description],
    ["contact", "/contact/", ContactPage, contactMeta, "تماس با کازین گالری | کازین گالری", PAGES_FIXTURE.contact.seo_description],
    ["shipping-returns", "/shipping-returns/", ShippingReturnsPage, shippingMeta, "ارسال و مرجوعی | راهنمای خرید | کازین گالری", PAGES_FIXTURE["shipping-returns"].seo_description],
    ["terms", "/terms/", TermsPage, termsMeta, "قوانین و مقررات | کازین گالری", DEFAULT_DESCRIPTION],
    ["privacy", "/privacy/", PrivacyPage, privacyMeta, "حریم خصوصی | کازین گالری", PAGES_FIXTURE.privacy.seo_description],
  ])(
    "SSR-renders %s with 60s public cache, trailing-slash canonical, indexable meta, and rich-text body",
    async (slug, expectedPath, PageComponent, generateMetadata, expectedTitle, expectedDescription) => {
      const meta = await generateMetadata();
      expect(meta.title).toBe(expectedTitle);
      expect(meta.description).toBe(expectedDescription);
      expect(meta.alternates.canonical).toBe(`https://cusin.ir${expectedPath}`);
      expect(meta.openGraph.url).toBe(`https://cusin.ir${expectedPath}`);
      expect(meta.robots).toBeUndefined();

      const element = await PageComponent();
      const html = renderToStaticMarkup(element);
      expect(html).toContain('<article class="container info-page">');
      expect(html).toContain(`<h1>${PAGES_FIXTURE[slug].title}</h1>`);
      expect(html).toContain('class="info-page__body card rich-text"');
      expect(html).toContain(PAGES_FIXTURE[slug].body);
      expect(html).not.toContain("application/ld+json");

      // Public cache must forward public Host, strip Cookie, and reuse the 60s cached entry.
      const slugHits = receivedRequests.filter((r) => r.url === `/api/v1/site/pages/${slug}/`);
      expect(slugHits).toHaveLength(1);
      expect(slugHits[0].host).toBe("cusin.ir");
      expect(slugHits[0].cookie).toBeUndefined();
      expect(revalidateCalls.every((c) => c.revalidate === 60)).toBe(true);
    }
  );

  it("throws notFound() and marks metadata noindex when an info slug is unpublished (404)", async () => {
    headerState.host = "unpublished.cusin.ir";
    pageMode.terms = "404";

    const meta = await termsMeta();
    expect(meta.robots).toEqual({ index: false, follow: false });
    await expect(TermsPage()).rejects.toThrow(NotFoundSignal);
  });

  it("fails open with the SPA retryable fallback (never a false 404) when Django is down", async () => {
    headerState.host = "outage.cusin.ir";
    pageMode.about = "503";

    const meta = await aboutMeta();
    expect(meta.title).toBe("دربارهٔ ما | کازین گالری");
    expect(meta.alternates.canonical).toBe("https://cusin.ir/about/");
    expect(meta.robots).toBeUndefined();

    const html = renderToStaticMarkup(await AboutPage());
    expect(html).toContain('<div class="container info-page">');
    expect(html).toContain("<h1>دربارهٔ ما</h1>");
    expect(html).toContain("ارتباط با سرور برقرار نشد.");
    expect(html).toContain("تلاش دوباره");
    expect(html).toContain('href="/"');
    expect(html).toContain("بازگشت به فروشگاه");

    headerState.host = "socketdrop.cusin.ir";
    pageMode.contact = "drop";
    const dropHtml = renderToStaticMarkup(await ContactPage());
    expect(dropHtml).toContain("<h1>تماس با ما</h1>");
    expect(dropHtml).toContain("ارتباط با سرور برقرار نشد.");
  });

  it("matches frontend/src/pages/NotFound.jsx markup, Persian copy, and home link", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toBe(
      '<section class="notfound"><h1>۴۰۴</h1><p>صفحه مورد نظر پیدا نشد؛ شاید نشانی عوض شده است.</p><a class="btn btn--primary" href="/">بازگشت به فروشگاه</a></section>'
    );
  });
});

describe("Phase 4 navigation cutover", () => {
  it("uses the Next router for every storefront path and plain <a> only for Django/external paths", () => {
    expect(DJANGO_OWNED_PREFIXES).toEqual([
      "/admin",
      "/api",
      "/payment/callback",
      "/media",
      "/static",
    ]);

    const storefrontPaths = [
      "/",
      "/shop/",
      "/shop/?category=pots",
      "/products/copper-pot/",
      "/brands/zarin/",
      "/login/",
      "/register/",
      "/password-reset/",
      "/reset-password/confirm/?uid=u&token=t",
      "/account/",
      "/account/orders/",
      "/wishlist/",
      "/cart/",
      "/checkout/",
      "/payment/result/42/",
      "/about/",
      "/contact/",
      "/shipping-returns/",
      "/terms/",
      "/privacy/",
      "/some/unknown/path/",
      "/about-x/",
      "/admin-guide/",
      "/api-docs/",
      "/payment/callback-help/",
      "/media-kit/",
      "/static-pages/",
    ];

    for (const path of storefrontPaths) {
      expect(isNextOwnedPath(path)).toBe(true);
      expect(isDjangoOwnedPath(path)).toBe(false);
      const html = renderToStaticMarkup(<Link to={path}>go</Link>);
      expect(html).toContain('data-next-router="next-link"');
    }

    const djangoPaths = [
      "/admin/",
      "/admin/products/product/image-import/",
      "/api/",
      "/api/v1/orders/7/invoice/",
      "/payment/callback/",
      "/payment/callback/?Authority=A000&Status=OK",
      "/media/products/pot.jpg",
      "/static/admin/css/base.css",
    ];

    for (const path of djangoPaths) {
      expect(isDjangoOwnedPath(path)).toBe(true);
      expect(isNextOwnedPath(path)).toBe(false);
      const html = renderToStaticMarkup(<Link to={path}>django</Link>);
      expect(html).not.toContain("data-next-router");
      expect(html).toContain(`href="${path.replace(/&/g, "&amp;")}"`);
    }

    for (const external of ["https://cusin.ir/shop/", "//evil.example/", "mailto:hi@cusin.ir", "tel:02112345678"]) {
      expect(isNextOwnedPath(external)).toBe(false);
      const html = renderToStaticMarkup(<Link to={external}>ext</Link>);
      expect(html).not.toContain("data-next-router");
    }

    headerState.pathname = "/about/";
    const navHtml = renderToStaticMarkup(<NavLink to="/about/">درباره</NavLink>);
    expect(navHtml).toContain('data-next-router="next-link"');
    expect(navHtml).toContain('aria-current="page"');
  });

  it("useNavigate pushes/replaces storefront paths via Next router and sends Django paths via window.location", () => {
    const assign = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { assign, replace }, history: { go: vi.fn() } });
    try {
      const navigate = useNavigate();
      navigate("/about/");
      expect(routerMock.push).toHaveBeenCalledWith("/about/");
      navigate("/some/unknown/path/", { replace: true });
      expect(routerMock.replace).toHaveBeenCalledWith("/some/unknown/path/");

      navigate("/admin/");
      expect(assign).toHaveBeenCalledWith("/admin/");
      navigate("/payment/callback/?Authority=A000", { replace: true });
      expect(replace).toHaveBeenCalledWith("/payment/callback/?Authority=A000");
      navigate("/api/v1/orders/1/invoice/");
      expect(assign).toHaveBeenCalledWith("/api/v1/orders/1/invoice/");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("mirrors DJANGO_OWNED_PREFIXES and isNextOwnedPath logic in frontend/src/utils/nextRoutes.jsx", () => {
    const spaNextRoutes = readRepoFile("frontend/src/utils/nextRoutes.jsx");
    expect(spaNextRoutes).not.toContain("NEXT_OWNED_PREFIXES");
    expect(spaNextRoutes).toContain("DJANGO_OWNED_PREFIXES");
    for (const prefix of DJANGO_OWNED_PREFIXES) {
      expect(spaNextRoutes).toContain(`"${prefix}"`);
    }
  });
});

function stripNginxComments(text) {
  return text
    .split("\n")
    .map((line) => {
      let out = "";
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          out += ch;
          if (ch === quote && line[i - 1] !== "\\") quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
          out += ch;
        } else if (ch === "#") {
          break;
        } else {
          out += ch;
        }
      }
      return out;
    })
    .join("\n");
}

function parseStorefrontServerLocations(configText) {
  const clean = stripNginxComments(configText);
  const lines = clean.split("\n");
  const servers = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)server\s*\{\s*$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const body = [];
    i += 1;
    while (i < lines.length) {
      if (lines[i].trim() === "}" && lines[i].search(/\S/) === indent) break;
      body.push(lines[i]);
      i += 1;
    }
    servers.push(body.join("\n"));
  }
  const mainServer = servers.find((s) => s.includes("proxy_pass")) || "";
  const locations = [];
  const locLines = mainServer.split("\n");
  for (let i = 0; i < locLines.length; i += 1) {
    const m = /^(\s*)location\s+(.+?)\s*\{\s*$/.exec(locLines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const spec = m[2].trim();
    const body = [];
    i += 1;
    while (i < locLines.length) {
      if (locLines[i].trim() === "}" && locLines[i].search(/\S/) === indent) break;
      body.push(locLines[i]);
      i += 1;
    }
    locations.push({ spec, body: body.join("\n") });
  }
  return locations;
}

function matchNginxLocation(locations, uriPath) {
  // 1. Exact `=` match
  for (const loc of locations) {
    if (loc.spec.startsWith("=")) {
      const target = loc.spec.slice(1).trim();
      if (uriPath === target) return loc;
    }
  }
  // 2. Longest prefix match (`^~` or plain prefix)
  let bestPrefix = null;
  let bestLen = -1;
  let bestNoRegex = false;
  for (const loc of locations) {
    if (loc.spec.startsWith("=") || loc.spec.startsWith("~")) continue;
    const noRegex = loc.spec.startsWith("^~");
    const prefix = (noRegex ? loc.spec.slice(2) : loc.spec).trim();
    if (uriPath.startsWith(prefix) && prefix.length > bestLen) {
      bestPrefix = loc;
      bestLen = prefix.length;
      bestNoRegex = noRegex;
    }
  }
  if (bestPrefix && bestNoRegex) return bestPrefix;

  // 3. Regex locations (`~` / `~*`) in config order
  for (const loc of locations) {
    if (!loc.spec.startsWith("~")) continue;
    const caseInsensitive = loc.spec.startsWith("~*");
    const rawPattern = loc.spec.slice(caseInsensitive ? 2 : 1).trim().replace(/^["']|["']$/g, "");
    const re = new RegExp(rawPattern, caseInsensitive ? "i" : "");
    if (re.test(uriPath)) return loc;
  }

  return bestPrefix;
}

describe("Phase 4 Nginx routing & guardrails", () => {
  it.each([
    "nginx/conf.d/cusin.conf",
    "nginx/prod.d/cusin.conf",
    "nginx/prod.d/00-bootstrap-http.conf.example",
  ])("%s sends catch-all to Next with required headers while preserving every Django & asset route", (configPath) => {
    const locations = parseStorefrontServerLocations(readRepoFile(configPath));
    const catchAll = locations.find((l) => l.spec === "/");
    expect(catchAll).toBeTruthy();
    expect(catchAll.body).toContain("proxy_pass http://web:3000;");
    expect(catchAll.body).toContain("proxy_set_header Host $http_host;");
    expect(catchAll.body).toContain("proxy_set_header X-Real-IP $remote_addr;");
    expect(catchAll.body).toContain("proxy_set_header X-Forwarded-Proto $scheme;");
    expect(catchAll.body).toContain("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
    expect(catchAll.body).toContain("proxy_set_header X-Forwarded-Host $http_host;");

    for (const nextUrl of [
      "/",
      "/about/",
      "/contact/",
      "/shipping-returns/",
      "/terms/",
      "/privacy/",
      "/some/unknown/path/",
      "/about-x/",
      "/shop/",
      "/products/copper-pot/",
      "/brands/zarin/",
      "/login/",
      "/account/orders/",
      "/wishlist/",
      "/cart/",
      "/checkout/",
      "/payment/result/42/",
      "/_next/static/chunks/main.js",
    ]) {
      const winner = matchNginxLocation(locations, nextUrl);
      expect(winner?.body, `${configPath} -> ${nextUrl}`).toContain("proxy_pass http://web:3000;");
    }

    for (const djangoUrl of [
      "/api/",
      "/api/v1/products/",
      "/admin/",
      "/admin/login/",
      "/admin/products/product/image-import/",
      "/payment/callback/",
      "/healthz",
      "/robots.txt",
      "/sitemap.xml",
      "/seo/",
      "/seo/product/copper-pot/",
    ]) {
      const winner = matchNginxLocation(locations, djangoUrl);
      expect(winner?.body, `${configPath} -> ${djangoUrl}`).toContain("proxy_pass http://backend_upstream;");
    }

    expect(matchNginxLocation(locations, "/static/admin/css/base.css")?.body).toContain("alias /app/staticfiles/");
    expect(matchNginxLocation(locations, "/media/products/pot.jpg")?.body).toContain("alias /app/media/");

    for (const spaAsset of ["/assets/index.js", "/fonts/vazirmatn.woff2", "/brand/og.png", "/favicon.svg", "/favicon.ico"]) {
      const winner = matchNginxLocation(locations, spaAsset);
      expect(winner?.body, `${configPath} -> ${spaAsset}`).toContain("proxy_pass http://frontend_upstream;");
    }
  });

  it("keeps phase 5 cleanup targets untouched and avoids fetch/useMediaQuery in Next info code", () => {
    expect(existsSync(new URL("../../frontend/src/App.jsx", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../../backend/apps/core/spa.py", import.meta.url))).toBe(true);
    expect(readRepoFile("backend/config/urls.py")).toContain("spa_page");

    for (const file of ["web/lib/info-server.js", "web/info/InfoPage.jsx", "web/info/InfoPageRoute.jsx"]) {
      const src = readRepoFile(file);
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/useMediaQuery|window\.(innerWidth|matchMedia|confirm)/);
    }
  });
});
