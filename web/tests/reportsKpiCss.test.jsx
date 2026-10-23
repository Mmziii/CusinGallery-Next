import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { computedForElement, parseStylesheet } from "./helpers/cssCascade";

const admin = new URL("../../backend/", import.meta.url);
const declarations = ["theme.css", "reports.css"].flatMap((file) =>
  parseStylesheet(file, readFileSync(new URL(`static/admin_theme/css/${file}`, admin), "utf8"))
).map((entry, order) => ({ ...entry, order }));
// Use the actual six KPI value elements from the template (Django values
// don't affect selectors). This also catches a missing value/amount class.
const template = readFileSync(new URL("apps/analytics/templates/analytics/reports.html", admin), "utf8");
const values = template.match(/<strong class="cusin-kpi-value[\s\S]*?<\/strong>/g);
const document = new JSDOM(`<body class="cusin-admin cusin-reports"><div id="container">
  <div class="cusin-report"><div class="cusin-report-kpis">
  ${values.map((value) => `<article class="cusin-report-kpi">${value}</article>`).join("")}
  </div></div></div></body>`).window.document;
const style = (element, width, prop) => computedForElement(declarations, element, width, prop);

describe("report KPIs: shared value sizing and wider cards", () => {
  it.each([320, 359, 360, 375, 414, 767, 768, 1023, 1024, 1366, 1920])(
    "keeps six equal-sized values with inline money at %ipx", (width) => {
      const sizes = [...document.querySelectorAll(".cusin-kpi-value")].map((value) => style(value, width, "font-size"));
      expect(sizes).toHaveLength(6);
      expect(new Set(sizes).size).toBe(1);
      expect(sizes[0]).toBe(width < 768
        ? "clamp(0.875rem, 3.8vw, 1.125rem)"
        : "clamp(1.38rem, 2.1vw, 1.9rem)");
      for (const amount of document.querySelectorAll(".cusin-kpi-amount")) {
        expect(style(amount, width, "font-size")).toBe("inherit");
        expect(style(amount, width, "white-space")).toBe("nowrap");
        expect(style(amount.parentElement, width, "flex-wrap")).toBe("nowrap");
      }
      for (const unit of document.querySelectorAll(".cusin-kpi-unit")) {
        expect(style(unit, width, "font-size")).toBe("0.68rem");
        expect(style(unit, width, "color")).toBe("var(--cusin-muted)");
      }
      expect(style(document.querySelector(".cusin-report-kpis"), width, "grid-template-columns")).toBe(
        width < 360 ? "minmax(0, 1fr)" : `repeat(${width < 768 ? 2 : 3}, minmax(0, 1fr))`
      );
    }
  );
});
