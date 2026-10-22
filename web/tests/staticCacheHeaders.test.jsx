import { describe, expect, it } from "vitest";
import config from "../next.config.mjs";

/**
 * Static-file caching for `web/public`.
 *
 * Next answers `web/public` with `Cache-Control: public, max-age=0`, so the
 * browser revalidates the self-hosted Vazirmatn fonts and the brand artwork on
 * every page view. The retired SPA container sent exactly:
 *   /fonts/*                              -> public, max-age=31536000, immutable
 *   /brand/*, /favicon.svg, /favicon.ico  -> public, max-age=86400
 * `next.config.mjs` restores those rules without touching `/_next/static`
 * (already immutable) or any page/API header (`proxy.js` keeps stamping the
 * private routes, and route handlers keep their own `Cache-Control`).
 */
const rules = await config.headers();
const ruleFor = (source) => rules.find((rule) => rule.source === source);
const ONE_DAY = [{ key: "Cache-Control", value: "public, max-age=86400" }];

describe("next.config static-file Cache-Control parity with the retired SPA container", () => {
  it("serves /fonts/* with a one-year immutable cache", () => {
    expect(ruleFor("/fonts/:path*")).toEqual({
      source: "/fonts/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    });
  });

  it("serves /brand/*, /favicon.svg and /favicon.ico with a one-day cache", () => {
    for (const source of ["/brand/:path*", "/favicon.svg", "/favicon.ico"]) {
      expect(ruleFor(source), source).toEqual({ source, headers: ONE_DAY });
    }
  });

  it("declares exactly those rules: no /_next/static override and no page, API or redirect path", () => {
    expect(rules).toHaveLength(4);
    for (const rule of rules) {
      expect(rule.source, rule.source).not.toContain("/_next/");
      expect(rule.source, rule.source).not.toMatch(
        /^\/(?:api|account|admin|cart|checkout|payment|shop|products|brands|login|register|wishlist|media|static)\b/
      );
      // One header per rule, and the only header any of them sets is Cache-Control.
      expect(rule.headers).toHaveLength(1);
      expect(rule.headers[0].key).toBe("Cache-Control");
    }
  });
});
