import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/.bin/next", import.meta.url));

const PAGES = {
  about: {
    slug: "about",
    path: "/about/",
    title: "دربارهٔ کازین گالری",
    body: "<h2>دربارهٔ ما</h2><p>انتخاب ظروف اصیل برای آشپزخانهٔ ایرانی.</p>",
    seo_title: "دربارهٔ کازین گالری",
    seo_description: "آشنایی با داستان و ارزش‌های کازین گالری.",
  },
  contact: {
    slug: "contact",
    path: "/contact/",
    title: "تماس با ما",
    body: "<h2>ارتباط مستقیم</h2><p>تلفن پشتیبانی: ۰۲۱-۸۸۰۰۱۱۲۲</p><p><a href=\"mailto:support@cusin.ir\">support@cusin.ir</a></p>",
    seo_title: "تماس با کازین گالری",
    seo_description: "راه‌های ارتباط با پشتیبانی کازین گالری.",
  },
  "shipping-returns": {
    slug: "shipping-returns",
    path: "/shipping-returns/",
    title: "ارسال و مرجوعی",
    body: "<h2>شرایط ارسال</h2><ul><li>بسته‌بندی ضدضربه</li></ul><p><a href=\"/contact/\">تماس با ما</a></p>",
    seo_title: "ارسال و مرجوعی | راهنمای خرید",
    seo_description: "شرایط ارسال و بازگشت کالا در فروشگاه.",
  },
  terms: {
    slug: "terms",
    path: "/terms/",
    title: "قوانین و مقررات",
    body: "<h2>مقررات خرید</h2><p>ثبت سفارش به معنی پذیرش قوانین سایت است.</p>",
    seo_title: "قوانین و مقررات",
    seo_description: "قوانین خرید اینترنتی از کازین گالری.",
  },
  privacy: {
    slug: "privacy",
    path: "/privacy/",
    title: "حریم خصوصی",
    body: "<h2>حفاظت از اطلاعات</h2><p>اطلاعات کاربران نزد ما امانت است.</p>",
    seo_title: "حریم خصوصی",
    seo_description: "سیاست حفظ حریم خصوصی کاربران کازین گالری.",
  },
};

let django;
let nextProc;
let origin;
let received = [];
let slugBehavior = {};

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const httpGet = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.get(
      `${origin}${path}`,
      {
        headers: {
          host: "cusin.ir",
          "x-forwarded-proto": "https",
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
  });

const stripScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

beforeAll(async () => {
  if (!existsSync(new URL("../.next/BUILD_ID", import.meta.url))) {
    throw new Error("Run `npm run build` before phase4Http.test.jsx");
  }

  django = http.createServer((req, res) => {
    received.push({
      url: req.url,
      host: req.headers.host,
      cookie: req.headers.cookie,
    });
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (req.url === "/api/v1/site/settings/") {
      return res.end(JSON.stringify({ site_name: "کازین گالری", og_image: "/brand/og.png" }));
    }
    if (req.url === "/api/v1/site/content/") {
      return res.end(JSON.stringify({ brand: { name: "کازین گالری" } }));
    }
    if (req.url.startsWith("/api/v1/categories/")) {
      return res.end(JSON.stringify({ results: [] }));
    }

    const pageMatch = /^\/api\/v1\/site\/pages\/([^/]+)\/$/.exec(req.url);
    if (pageMatch) {
      const slug = decodeURIComponent(pageMatch[1]);
      const mode = slugBehavior[slug];
      if (mode === "unpublished") {
        res.statusCode = 404;
        return res.end(JSON.stringify({ detail: "Not found." }));
      }
      if (mode === "down") {
        res.statusCode = 503;
        return res.end(JSON.stringify({ detail: "Backend unavailable." }));
      }
      if (PAGES[slug]) {
        return res.end(JSON.stringify(PAGES[slug]));
      }
      res.statusCode = 404;
      return res.end(JSON.stringify({ detail: "Not found." }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ detail: "Not found." }));
  });

  await new Promise((resolve) => django.listen(0, "127.0.0.1", resolve));
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;

  // Start Next via the standalone bundle (`output: "standalone"` in next.config.mjs),
  // using HOSTNAME=0.0.0.0 just like web/Dockerfile in production.
  nextProc = spawn(process.execPath, [".next/standalone/server.js"], {
    cwd: webDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "0.0.0.0",
      INTERNAL_API_URL: `http://127.0.0.1:${django.address().port}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  nextProc.stdout.on("data", (d) => {
    logs += d;
  });
  nextProc.stderr.on("data", (d) => {
    logs += d;
  });

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      // A static public file: proves the server is up without warming
      // any page/API cache the tests below assert against.
      await httpGet("/favicon.svg");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`next start timed out:\n${logs}`);
}, 35_000);

afterAll(async () => {
  if (nextProc && nextProc.exitCode === null) {
    nextProc.kill("SIGTERM");
    await new Promise((resolve) => nextProc.once("exit", resolve));
  }
  if (django) {
    await new Promise((resolve) => django.close(resolve));
  }
});

beforeEach(() => {
  received = [];
  slugBehavior = {};
});

describe("Phase 4 HTTP integration against real `next start` + `node:http` fake Django", () => {
  it.each([
    ["about", "/about/", "دربارهٔ کازین گالری | کازین گالری"],
    ["contact", "/contact/", "تماس با کازین گالری | کازین گالری"],
    ["shipping-returns", "/shipping-returns/", "ارسال و مرجوعی | راهنمای خرید | کازین گالری"],
    ["terms", "/terms/", "قوانین و مقررات | کازین گالری"],
    ["privacy", "/privacy/", "حریم خصوصی | کازین گالری"],
  ])(
    "SSR-renders %s with HTTP 200, trailing-slash canonical, indexable meta, and body HTML",
    async (slug, path, expectedTitle) => {
      const res = await httpGet(path, { cookie: "sessionid=secret-cookie" });
      expect(res.status).toBe(200);
      expect(res.headers["x-robots-tag"]).toBeUndefined();

      const htmlNoScripts = stripScripts(res.body);
      expect(htmlNoScripts).toContain(`lang="fa"`);
      expect(htmlNoScripts).toContain(`dir="rtl"`);
      expect(htmlNoScripts).toContain(`<title>${expectedTitle}</title>`);
      expect(htmlNoScripts).toContain(`content="${PAGES[slug].seo_description}"`);
      expect(htmlNoScripts).toContain(`<link rel="canonical" href="https://cusin.ir${path}"`);
      expect(htmlNoScripts).not.toMatch(/<meta[^>]+name="robots"[^>]+noindex/i);
      expect(htmlNoScripts).not.toContain("BreadcrumbList");
      expect(htmlNoScripts).toContain('class="site-header');
      expect(htmlNoScripts).toContain('class="site-footer"');
      expect(htmlNoScripts).toContain('<article class="container info-page">');
      expect(htmlNoScripts).toContain(`<h1>${PAGES[slug].title}</h1>`);
      expect(htmlNoScripts).toContain(PAGES[slug].body);

      const apiHits = received.filter((r) => r.url === `/api/v1/site/pages/${slug}/`);
      expect(apiHits.length).toBeGreaterThanOrEqual(1);
      for (const hit of apiHits) {
        expect(hit.host).toBe("cusin.ir");
        expect(hit.cookie).toBeUndefined();
      }

      // Repeat request within 60s reuses both proxy availability cache and unstable_cache.
      received = [];
      const cached = await httpGet(path);
      expect(cached.status).toBe(200);
      expect(received.filter((r) => r.url === `/api/v1/site/pages/${slug}/`)).toHaveLength(0);
    }
  );

  it("redirects unslashed info URLs with 308 to their canonical trailing-slash URL", async () => {
    const res = await httpGet("/about");
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("/about/");
  });

  it("returns real HTTP 404 with full Next not-found HTML and noindex when an info slug is unpublished", async () => {
    slugBehavior.terms = "unpublished";
    const res = await httpGet("/terms/", { host: "unpublished-check.cusin.ir" });

    expect(res.status).toBe(404);
    const htmlNoScripts = stripScripts(res.body);
    expect(htmlNoScripts).toMatch(/<meta[^>]+name="robots"[^>]+noindex/i);
    expect(htmlNoScripts).not.toContain('rel="canonical"');
    expect(htmlNoScripts).toContain('class="site-header');
    expect(htmlNoScripts).toContain('class="site-footer"');
    expect(htmlNoScripts).toContain('<section class="notfound">');
    expect(htmlNoScripts).toContain("<h1>۴۰۴</h1>");
    expect(htmlNoScripts).toContain("صفحه مورد نظر پیدا نشد؛ شاید نشانی عوض شده است.");
    expect(htmlNoScripts).toContain('<a class="btn btn--primary" href="/">بازگشت به فروشگاه</a>');

    // Unknown catalog detail slugs use the exact same proxy rewrite and return 404 over real HTTP too.
    const missingProduct = await httpGet("/products/missing-copper-pot/");
    expect(missingProduct.status).toBe(404);
    expect(stripScripts(missingProduct.body)).toContain('<section class="notfound">');
  });

  it("fails open (HTTP 200 with retryable fallback, never a false 404) when Django is down", async () => {
    slugBehavior.privacy = "down";
    const res = await httpGet("/privacy/", { host: "down-check.cusin.ir" });

    expect(res.status).toBe(200);
    const htmlNoScripts = stripScripts(res.body);
    expect(htmlNoScripts).toContain('class="site-header');
    expect(htmlNoScripts).toContain("<h1>حریم خصوصی</h1>");
    expect(htmlNoScripts).toContain("ارتباط با سرور برقرار نشد.");
    expect(htmlNoScripts).toContain("تلاش دوباره");
    expect(htmlNoScripts).toContain("بازگشت به فروشگاه");
    expect(htmlNoScripts).not.toContain('<section class="notfound">');
  });

  it.each(["/some/unknown/path/", "/about-x/"])(
    "renders %s with HTTP 404, robots noindex, and the full not-found HTML with SPA links",
    async (unknownPath) => {
      const res = await httpGet(unknownPath);
      expect(res.status).toBe(404);

      const htmlNoScripts = stripScripts(res.body);
      expect(htmlNoScripts).toContain("<title>صفحه یافت نشد | کازین گالری</title>");
      expect(htmlNoScripts).toMatch(/<meta[^>]+name="robots"[^>]+content="noindex/i);
      expect(htmlNoScripts).not.toContain('rel="canonical"');
      expect(htmlNoScripts).toContain('class="site-header');
      expect(htmlNoScripts).toContain('class="site-footer"');
      expect(htmlNoScripts).toContain('<section class="notfound">');
      expect(htmlNoScripts).toContain("<h1>۴۰۴</h1>");
      expect(htmlNoScripts).toContain("صفحه مورد نظر پیدا نشد؛ شاید نشانی عوض شده است.");
      expect(htmlNoScripts).toContain('<a class="btn btn--primary" href="/">بازگشت به فروشگاه</a>');

      // Storefront links in header/footer remain present in the SSR 404 HTML.
      for (const expectedHref of [
        'href="/"',
        'href="/shop/"',
        'href="/cart/"',
        'href="/about/"',
        'href="/contact/"',
        'href="/shipping-returns/"',
        'href="/terms/"',
        'href="/privacy/"',
      ]) {
        expect(htmlNoScripts).toContain(expectedHref);
      }
    }
  );
});
