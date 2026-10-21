import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  STYLE_IMPORTS,
  computedDisplay,
  loadDeclarations,
  matchingDeclarations,
  mediaMatches,
  PHONE_MAX,
  winning,
} from "./helpers/cssCascade";

/**
 * CSS contract for the storefront's responsive variants.
 *
 * The bug these tests exist for: `styles/storefront.css` turned the phone
 * «نمایش کالاهای بیشتر» button on inside `@media (max-width: 767px)` and then
 * hid it again with an UNCONDITIONAL `.shop__load-more { display: none; }`
 * further down the file. Same specificity, later wins, so the button was
 * `display:none` at every width — and because the numbered pager is hidden on
 * phones, a phone could only ever see the first 20 products of 160.
 *
 * These assertions read the real stylesheets in `app/layout.js` import order
 * and resolve the cascade at a given viewport width, so a rule added later in
 * any imported file that re-hides a phone control fails here.
 */
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const declarations = loadDeclarations();
const WIDTHS = [320, 375, 414, 767, 768, 1024, 1280, 1440];

const displayAt = (selector, width) => {
  const rule = computedDisplay(declarations, selector, width);
  return rule ? rule.value : null;
};

const isHidden = (selector, width) => displayAt(selector, width) === "none";

describe("phone load-more and desktop pager", () => {
  it("shows «نمایش کالاهای بیشتر» on every phone width", () => {
    for (const width of WIDTHS.filter((value) => value <= PHONE_MAX)) {
      expect(displayAt(".shop__load-more", width), `phone width ${width}px`).toBe("inline-flex");
    }
  });

  it("hides the load-more from 768px up, where the numbered pager is shown", () => {
    for (const width of WIDTHS.filter((value) => value >= 768)) {
      expect(isHidden(".shop__load-more", width), `desktop width ${width}px`).toBe(true);
      expect(isHidden(".pagination", width), `desktop width ${width}px`).toBe(false);
    }
  });

  it("hides the numbered pager on phones, so the load-more is the only paging control", () => {
    for (const width of WIDTHS.filter((value) => value <= PHONE_MAX)) {
      expect(isHidden(".pagination", width), `phone width ${width}px`).toBe(true);
    }
  });
});

describe("no unconditional rule may negate a phone-only visibility decision", () => {
  // Selectors are compared by exact text: that is how these files are written
  // and it keeps the checker honest (it never guesses at a match).
  const phoneApplies = (entry, width) => entry.media.length > 0 && mediaMatches(entry.media, width);

  it("keeps every phone-only display rule in force at 375px", () => {
    const selectors = new Set();
    for (const entry of declarations) {
      if (entry.prop !== "display") continue;
      if (!phoneApplies(entry, 375)) continue;
      for (const selector of entry.selectors) selectors.add(selector);
    }
    expect(selectors.size).toBeGreaterThan(10);

    const negated = [];
    for (const selector of selectors) {
      const phoneRule = winning(
        matchingDeclarations(declarations, selector, 375).filter((entry) => entry.media.length > 0),
        selector
      );
      const effective = computedDisplay(declarations, selector, 375);
      if (!phoneRule || !effective) continue;
      // Only the VISIBILITY decision is contractual: an unconditional rule may
      // refine the layout (block -> inline-grid) without hiding the control.
      if ((phoneRule.value === "none") !== (effective.value === "none")) {
        negated.push(
          `${selector}: phone-only ${phoneRule.value} (${phoneRule.file}) overridden by ` +
            `${effective.value} (${effective.file})`
        );
      }
    }
    expect(negated).toEqual([]);
  });

  it("has no unconditional rule in responsive-variants.css that hides a phone control", () => {
    const overrides = [];
    for (const entry of declarations) {
      if (entry.file !== "styles/responsive-variants.css") continue;
      if (entry.prop !== "display" || entry.media.length > 0) continue;
      if (entry.value !== "none") continue;
      for (const selector of entry.selectors) {
        const phoneRule = winning(
          matchingDeclarations(declarations, selector, 375).filter((item) => item.media.length > 0),
          selector
        );
        if (!phoneRule || phoneRule.value === "none") continue;
        // The unconditional rule is fine only if it is the DESKTOP default and
        // the phone rule still wins at 375px (that is how the variant pairs in
        // this file are written).
        if (displayAt(selector, 375) === "none") {
          overrides.push(`${selector}: phone shows ${phoneRule.value}, ${entry.file} hides it`);
        }
      }
    }
    expect(overrides).toEqual([]);
  });

  it("imports the stylesheets in the order app/layout.js imports them", () => {
    // Guards the checker itself: if the layout's import order changes, this
    // test fails instead of the cascade being resolved in the wrong order.
    const layout = readFileSync(path.join(WEB_ROOT, "app/layout.js"), "utf8");
    const imported = [...layout.matchAll(/import\s+"(\.\.\/styles\/[^"]+)\.css"/g)].map(
      (match) => match[1].replace("../", "") + ".css"
    );
    expect(imported).toEqual(STYLE_IMPORTS);
  });
});
