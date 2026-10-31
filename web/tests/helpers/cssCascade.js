import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

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
  "styles/design-system.css",
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

/** Specificity of a selector: [ids, classes/attrs/pseudo-classes, elements/pseudo-elements]. */
export function specificity(selector) {
  const pseudoElements = (selector.match(/::[\w-]+/g) || []).length;
  const cleanSelector = selector.replace(/::[\w-]+/g, "");
  const ids = (cleanSelector.match(/#[\w-]+/g) || []).length;
  const classes =
    (cleanSelector.match(/\.[\w-]+/g) || []).length +
    (cleanSelector.match(/\[[^\]]+\]/g) || []).length +
    (cleanSelector.match(/:[\w-]+(?:\([^)]*\))?/g) || []).length;
  const elements =
    (cleanSelector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length + pseudoElements;
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

export function compareSpecificity(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** The declaration the cascade picks: last one of the highest specificity. */
export function winning(entries, selector) {
  let best = null;
  for (const entry of entries) {
    let score;
    if (entry.specificity) {
      score = entry.specificity;
    } else if (entry.matchedSelector) {
      score = specificity(entry.matchedSelector);
    } else if (selector && entry.selectors && entry.selectors.includes(selector)) {
      score = specificity(selector);
    } else if (entry.selectors && entry.selectors.length > 0) {
      score = entry.selectors.reduce(
        (max, s) => {
          const sc = specificity(s);
          return compareSpecificity(sc, max) > 0 ? sc : max;
        },
        [0, 0, 0]
      );
    } else if (selector) {
      score = specificity(selector);
    } else {
      score = [0, 0, 0];
    }
    const comparison = best ? compareSpecificity(score, best.score) : 1;
    if (!best || comparison > 0 || (comparison === 0 && entry.order >= best.entry.order)) {
      best = { entry, score };
    }
  }
  return best ? best.entry : null;
}

/**
 * Declarations matching a DOM element (checking element.matches for each selector) at `width`.
 * Evaluates the selector specificity that matched this element.
 */
export function matchingDeclarationsForElement(declarations, element, width, { prop = null, phonesOnly = false } = {}) {
  const matches = [];
  for (const entry of declarations) {
    if (prop && entry.prop !== prop) continue;
    if (!mediaMatches(entry.media, width)) continue;
    if (phonesOnly && entry.media.length === 0) continue;

    let highestScore = null;
    let matchedSelector = null;
    for (const sel of entry.selectors) {
      const domSel = sel.replace(/::[\w-]+/g, "");
      try {
        if (element.matches(domSel)) {
          const score = specificity(sel);
          if (!highestScore || compareSpecificity(score, highestScore) > 0) {
            highestScore = score;
            matchedSelector = sel;
          }
        }
      } catch {
        // ignore unsupported selector syntax in jsdom
      }
    }
    if (matchedSelector) {
      matches.push({ ...entry, matchedSelector, specificity: highestScore });
    }
  }
  return matches;
}

/** Effective value of `prop` on `element` at `width` across imported stylesheets, respecting specificity and order. */
export function computedForElement(declarations, element, width, prop) {
  const matched = matchingDeclarationsForElement(declarations, element, width, { prop });
  const winner = winning(matched);
  return winner ? winner.value : null;
}

/**
 * Computes effective property value for `selector` inside `root` (HTML string or DOM element).
 */
export function computedStyle(declarations, root, selector, width, prop) {
  let element = null;
  if (typeof root === "string") {
    const doc = new JSDOM(root).window.document;
    element = doc.querySelector(selector);
  } else if (root?.querySelector) {
    element = root.querySelector(selector) || (root.matches?.(selector) ? root : null);
  } else {
    element = root;
  }
  if (!element) return null;
  return computedForElement(declarations, element, width, prop);
}

/** Effective `display` of `selector` at `width` across the imported files. */
export function computedDisplay(declarations, selector, width) {
  return winning(matchingDeclarations(declarations, selector, width), selector);
}
