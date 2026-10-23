/** Real layout regression: jsdom cannot detect wrapped/clipped Persian text.
 * Requires the running storefront and an in-stock, variant-free product.
 * E2E_PRODUCT_PATH can select one; otherwise use the first shop product.
 */
const { test, expect } = require("@playwright/test");

for (const width of [320, 375, 414]) {
  test(`product buy row fits one 44px line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    let productPath = process.env.E2E_PRODUCT_PATH;
    if (!productPath) {
      await page.goto("/shop/");
      productPath = await page.locator(".product-card__name").first().getAttribute("href");
    }
    await page.goto(productPath);
    const row = page.locator(".product-detail__buy");
    const buy = row.getByRole("button", { name: "افزودن به سبد خرید", exact: true });
    await expect(buy).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await expect(buy).toHaveText(width < 360 ? "افزودن به سبد" : "افزودن به سبد خرید", { useInnerText: true });
    const geometry = await row.evaluate((row) => {
      const box = row.getBoundingClientRect();
      const button = row.querySelector(".btn--primary");
      const label = button.firstElementChild;
      const labelBox = label.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      return {
        height: box.height,
        overflow: row.scrollWidth > row.clientWidth,
        controls: [...row.querySelectorAll("button")].map((control) => {
          const rect = control.getBoundingClientRect();
          return { width: rect.width, height: rect.height, top: rect.top - box.top };
        }),
        labelFits: labelBox.left >= buttonBox.left && labelBox.right <= buttonBox.right,
        labelHeight: labelBox.height,
        lineHeight: parseFloat(getComputedStyle(label).lineHeight),
      };
    });
    expect(geometry.height).toBe(44);
    expect(geometry.overflow).toBe(false);
    expect(geometry.labelFits).toBe(true);
    expect(geometry.labelHeight).toBeLessThanOrEqual(geometry.lineHeight + 1);
    for (const control of geometry.controls) {
      expect(control.width).toBeGreaterThanOrEqual(44);
      expect(control.height).toBe(44);
      expect(control.top).toBe(0);
    }
  });
}
