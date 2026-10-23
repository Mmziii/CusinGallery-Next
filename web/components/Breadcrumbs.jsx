import { useEffect, useRef } from "react";
import { Link } from "../lib/navigation";
import PropTypes from "prop-types";

/**
 * Part S2 item 7: breadcrumb trail for category/product/shop pages.
 * Every entry but the last is a link; the last one is plain text with
 * aria-current="page". Server-rendered: it only imports the link shim.
 */
export default function Breadcrumbs({ items }) {
  const navRef = useRef(null);

  // Phones scroll the trail horizontally. Bring the current (last) item into
  // view inside the <nav> only -- scrollLeft on the <nav>, never the page.
  // RTL-aware: offsetLeft/offsetWidth respect the inherited direction, so the
  // same math lands the current item at the trailing edge in both LTR and RTL.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    // Scroll the <nav> to its end so the current (last) item is visible --
    // inside the <nav> only, never the page. In RTL a scroller starts at
    // scrollLeft 0 and goes negative towards the left; the current item sits
    // at the left end, so scroll to -max instead of +max.
    const max = nav.scrollWidth - nav.clientWidth;
    if (max > 0) {
      nav.scrollLeft =
        getComputedStyle(nav).direction === "rtl" ? -max : max;
    }
    return undefined;
  }, []);

  if (!items || items.length === 0) return null;
  return (
    <nav ref={navRef} className="breadcrumbs" aria-label="مسیر صفحه">
      <ol>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {item.to && !isLast ? (
                <Link to={item.to}>{item.label}</Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

Breadcrumbs.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      to: PropTypes.string,
    })
  ).isRequired,
};
