import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The stylesheets the App Router document imports, in `app/layout.js` order.
 * Later files win ties, exactly like the browser's cascade — which is why this
 * list must follow the import list, not the directory listing.
 */
export const STYLE_IMPORTS = [
  "styles/fonts.css",
  "styles/variables.css",
  "styles/globals.css",
  "styles/storefront.css",
  "styles/responsive-variants.css",
];

/** Phone breakpoint used by the storefront: phones are <= 767px. */
export const PHONE_MAX = 767;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Minimal (but faithful for these files) CSS reader: flat rules and at-rule
 * blocks such as @media. Returns one entry per declaration, in source order.
 *
 * @returns {Array<{file: string, media: string[], selectors: string[], prop: string, value: string, order: number}>}
 */
export function parseStylesheet(file, css) {
  const text = stripComments(css);
  const declarations = [];
  const stack = [];
  let buffer = "";
  let order = 0;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (char === "{") {
      const header = buffer.trim();
      buffer = "";
      if (header.startsWith("@")) {
        stack.push(header);
        index += 1;
        continue;
      }
      // A declaration block: read up to its matching brace (no nesting here).
      let depth = 1;
      let body = "";
      let cursor = index + 1;
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === "{") depth += 1;
        else if (text[cursor] === "}") depth -= 1;
        if (depth > 0) body += text[cursor];
        cursor += 1;
      }
      const media = stack.filter((frame) => frame.startsWith("@media"));
      const selectors = header.split(",").map((selector) => selector.trim()).filter(Boolean);
      for (const chunk of body.split(";")) {
        const colon = chunk.indexOf(":");
        if (colon === -1) continue;
        declarations.push({
          file,
          media,
          selectors,
          prop: chunk.slice(0, colon).trim().toLowerCase(),
          value: chunk.slice(colon + 1).trim(),
          order: order++,
        });
      }
      index = cursor;
      continue;
    }
    if (char === "}") {
      stack.pop();
      buffer = "";
      index += 1;
      continue;
    }
    buffer += char;
    index += 1;
  }
  return declarations;
}

export function loadDeclarations(files = STYLE_IMPORTS) {
  return files
    .flatMap((file) => parseStylesheet(file, readFileSync(path.join(WEB_ROOT, file), "utf8")))
    .map((entry, order) => ({ ...entry, order }));
}

/** Specificity of a simple selector: [ids, classes/attrs/pseudo-classes, elements]. */
export function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) || []).length + (selector.match(/\[[^\]]+\]/g) || []).length;
  const elements = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [ids, classes, elements];
}

/**
 * Does a media-query frame list apply at `width`? Width features are the only
 * ones this stylesheet uses to select a variant; anything else (e.g.
 * prefers-reduced-motion) is treated as not applying, which is correct for
 * visibility questions.
 */
export function mediaMatches(media, width) {
  for (const frame of media) {
    const features = frame.slice("@media".length).trim();
    if (!features) continue;
    const widthFeatures = features.match(/\((min|max)-width:\s*(\d+)px\)/g);
    if (!widthFeatures) return false;
    for (const feature of widthFeatures) {
      const [, kind, raw] = feature.match(/\((min|max)-width:\s*(\d+)px\)/);
      const limit = Number(raw);
      if (kind === "max" && width > limit) return false;
      if (kind === "min" && width < limit) return false;
    }
  }
  return true;
}

/** Rules that declare `prop` on exactly `selector` and apply at `width`. */
export function matchingDeclarations(declarations, selector, width, { prop = "display", phonesOnly = false } = {}) {
  return declarations.filter(
    (entry) =>
      entry.prop === prop &&
      entry.selectors.includes(selector) &&
      mediaMatches(entry.media, width) &&
      (!phonesOnly || entry.media.length > 0)
  );
}

function compareSpecificity(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** The declaration the cascade picks: last one of the highest specificity. */
export function winning(entries, selector) {
  let best = null;
  for (const entry of entries) {
    const score = specificity(selector);
    const comparison = best ? compareSpecificity(score, best.score) : 1;
    if (!best || comparison > 0 || (comparison === 0 && entry.order >= best.entry.order)) {
      best = { entry, score };
    }
  }
  return best ? best.entry : null;
}

/** Effective `display` of `selector` at `width` across the imported files. */
export function computedDisplay(declarations, selector, width) {
  return winning(matchingDeclarations(declarations, selector, width), selector);
}
