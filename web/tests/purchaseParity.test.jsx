import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computedDisplay, loadDeclarations } from "./helpers/cssCascade";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const declarations = loadDeclarations();
const WIDTHS = [320, 375, 414, 767, 768, 1024, 1280, 1440];

const displayAt = (selector, width) => computedDisplay(declarations, selector, width)?.value ?? null;

describe("Phase 3b responsive CSS & edge routing contracts", () => {
  it("switches .checkout__mobile-bar vs .checkout__desktop-action and .cart-page__mobile-bar cleanly across every viewport width", () => {
    for (const width of WIDTHS) {
      const mobile = width <= 767;
      expect(displayAt(".checkout__mobile-bar", width), `checkout mobile bar at ${width}px`).toBe(
        mobile ? "flex" : "none"
      );
      expect(displayAt(".checkout__desktop-action", width), `checkout desktop action at ${width}px`).toBe(
        mobile ? "none" : "flex"
      );
      expect(displayAt(".cart-page__mobile-bar", width), `cart mobile bar at ${width}px`).toBe(
        mobile ? "flex" : "none"
      );
    }
  });

  it("keeps CheckoutStepper markup and ensures no purchase file uses JS viewport queries or window.confirm", () => {
    // NOTE (Phase 5): the pre-migration diff against
    // the retired-Vite CheckoutStepper.jsx was removed with the
    // retired Vite app; the stepper below is the storefront now, and its
    // rendering is pinned by the purchase HTTP tests instead.
    expect(read("../components/CheckoutStepper.jsx")).toContain("checkout__steps");

    for (const file of [
      "../purchase/CartPage.jsx",
      "../purchase/CheckoutPage.jsx",
      "../purchase/PaymentResultPage.jsx",
      "../components/CheckoutStepper.jsx",
    ]) {
      expect(read(file), file).not.toMatch(/useMediaQuery|window\.(innerWidth|matchMedia|confirm)/);
    }
  });

  it("keeps /payment/callback/ strictly isolated from /payment/result/... across all three Nginx configs", () => {
    for (const file of [
      "../../nginx/conf.d/cusin.conf",
      "../../nginx/prod.d/cusin.conf",
      "../../nginx/prod.d/00-bootstrap-http.conf.example",
    ]) {
      const conf = read(file);
      // Phase 5: the per-route Next regexes were folded into the catch-all,
      // so /cart/, /checkout/ and /payment/result/... reach web:3000 by
      // falling through to `location /` -- while /payment/callback/ keeps
      // its exact-prefix backend block and no regex may divert it.
      for (const gone of ["^/cart/?$", "^/checkout/?$", "^/payment/result(?:/.*)?$"]) {
        expect(conf).not.toContain(`location ~ ${gone} {`);
      }
      const callback = conf.split("location /payment/callback/ {")[1]?.split("}")[0];
      expect(callback).toContain("proxy_pass http://backend_upstream;");
      expect(conf.match(/location \/ \{[^}]*proxy_pass http:\/\/web:3000;[^}]*\}/)?.[0]).toBeTruthy();
      const regexes = [...conf.matchAll(/location (~\*?)\s+(\S+) \{/g)].map((m) => new RegExp(m[2].replace(/^["']|["']$/g, ""), m[1] === "~*" ? "i" : ""));
      expect(regexes.some((re) => re.test("/payment/callback/"))).toBe(false);
    }
  });
});
