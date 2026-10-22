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

  it("keeps CheckoutStepper identical to SPA and ensures no purchase file uses JS viewport queries or window.confirm", () => {
    const stepperWeb = read("../components/CheckoutStepper.jsx")
      .replace(/^"use client";\n/, "")
      .replace(/from "\.\.\/lib\/navigation"/g, 'from "react-router-dom"');
    expect(stepperWeb).toBe(read("../../frontend/src/components/CheckoutStepper.jsx"));

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
      const nextRegexes = [...conf.matchAll(/location ~ (\S+) \{/g)].map((m) => new RegExp(m[1]));
      expect(nextRegexes.some((re) => re.test("/cart/"))).toBe(true);
      expect(nextRegexes.some((re) => re.test("/checkout/"))).toBe(true);
      expect(nextRegexes.some((re) => re.test("/payment/result/"))).toBe(true);
      expect(nextRegexes.some((re) => re.test("/payment/result/42/"))).toBe(true);
      expect(nextRegexes.some((re) => re.test("/payment/callback/"))).toBe(false);
    }
  });
});
