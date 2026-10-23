"use client";
import PropTypes from "prop-types";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "../lib/navigation";

import Breadcrumbs from "../components/Breadcrumbs";
import Icon from "../components/Icon";
import PriceTag from "../components/PriceTag";
import ProductCard from "../components/ProductCard";
import ProductGallery from "../components/ProductGallery";
import RecentlyViewed from "../components/RecentlyViewed";
import { Alert } from "../components/ui";
import ReviewsSection from "./ReviewsSection";
import { subscribeBackInStock } from "../services/productsApi";
import useAuthStore from "../store/useAuthStore";
import useCartStore from "../store/useCartStore";
import useWishlistStore from "../store/useWishlistStore";
import { normalizeApiError } from "../utils/apiError";
import { faDigits } from "../utils/faDigits";
import { brandUrl } from "../utils/brands";
import { categoryUrl } from "../utils/categories";
import { isValidIranianPhone, normalizePhone } from "../utils/iranianFields";
import { recordView } from "../utils/recentlyViewed";
import { productDetailShape } from "../utils/shapes";
import { trackEvent } from "../utils/behaviour";
import { errorMessage } from "../components/ui";

/**
 * Product page, server-rendered.
 *
 * Name, gallery images, price (including an active daily-deal price, which the
 * backend already folds into price_info), stock, description, specifications,
 * the reviews summary/first page and the related rows are all in the initial
 * HTML. Only the genuinely interactive parts are client-side: gallery and
 * lightbox, variant/qty pickers, add-to-cart, wishlist, the back-in-stock
 * form, the review form and the browser-local recently-viewed write.
 *
 * The desktop sections and the phone accordions are BOTH rendered and CSS
 * picks one (see responsive-variants.css) -- no window width is read to build
 * markup.
 */

/** Full content stays beside the gallery; phones use native accordions. */
function ProductContentSection({ title, children }) {
  return (
    <>
      <details className="product-detail__section product-detail__section--collapsible">
        <summary><h2>{title}</h2><Icon name="chevron-down" size={18} /></summary>
        {children}
      </details>
      <section className="product-detail__section product-detail__section--static">
        <h2>{title}</h2>
        {children}
      </section>
    </>
  );
}

function ProductDetail({ product, slug, reviews = {} }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const addItem = useCartStore((s) => s.addItem);

  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState({}); // attribute name -> value
  const [added, setAdded] = useState(null);
  const wishlist = useWishlistStore();
  const wishlisted = wishlist.items.some((item) => item.product.id === product?.id);
  const [wishlistBusy, setWishlistBusy] = useState(false);
  const [bisPhone, setBisPhone] = useState("");
  const [bisState, setBisState] = useState(null); // null | busy | done | error
  const buyRef = useRef(null);
  // SSR default: hidden, so nothing jumps before hydration. The bar is shown
  // only below 768px (CSS) and only while the main add-to-cart button is out
  // of view (IntersectionObserver toggles this flag after hydration).
  const [stickyVisible, setStickyVisible] = useState(false);

  useEffect(() => {
    const button = buyRef.current;
    if (!button) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setStickyVisible(!entry.isIntersecting);
      },
      { threshold: 0 }
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, []);

  const images = product?.images || [];

  // Part R5 item 10: record the view in browser-local storage only.
  useEffect(() => {
    if (product?.id) recordView(product.id);
    // Privacy-friendly analytics: one product_view per product page.
    if (product?.id) trackEvent("product_view", { product_id: product.id });
  }, [product?.id]);

  // Group variants by attribute for the option buttons.
  const attributeOptions = useMemo(() => {
    if (!product?.variants?.length) return [];
    const groups = {};
    const order = [];
    product.variants.forEach((variant) => {
      variant.attribute_values.forEach((av) => {
        if (!groups[av.attribute]) {
          groups[av.attribute] = new Set();
          order.push(av.attribute);
        }
        groups[av.attribute].add(av.value);
      });
    });
    return order.map((attribute) => ({ attribute, values: [...groups[attribute]] }));
  }, [product]);

  const activeVariant = useMemo(() => {
    if (!product?.variants?.length) return null;
    if (Object.keys(selected).length < attributeOptions.length) return null;
    return (
      product.variants.find((variant) =>
        variant.attribute_values.every((av) => selected[av.attribute] === av.value)
      ) || null
    );
  }, [product, selected, attributeOptions]);

  const hasVariants = Boolean(product?.variants?.length);
  const displayPrice = activeVariant ? activeVariant.price_info : product?.price_info;
  const stockStatus = activeVariant ? activeVariant.stock_status : product?.stock_status;
  const availableStock = activeVariant?.stock_quantity ?? product?.stock_quantity ?? Infinity;
  const outOfStock = stockStatus === "out_of_stock";
  useEffect(() => { setQuantity((q) => Math.max(1, Math.min(q, availableStock))); }, [availableStock, activeVariant?.id]);

  useEffect(() => {
    setSelected({});
    setQuantity(1);
    setAdded(null);
  }, [slug]);

  // Stage 1: the breadcrumb trail as data -- shared by the visible
  // <Breadcrumbs> and the JSON-LD BreadcrumbList emitted by the server page.
  const crumbTrail = useMemo(() => {
    if (!product) return [];
    const trail = [{ label: "کازین گالری", to: "/" }];
    if (product.category) {
      for (const ancestor of product.category.ancestors || []) {
        trail.push({ label: faDigits(ancestor.name), to: categoryUrl(ancestor) });
      }
      trail.push({
        label: faDigits(product.category.name),
        to: categoryUrl(product.category),
      });
    }
    trail.push({ label: faDigits(product.name) });
    return trail;
  }, [product]);

  if (!product) return null;

  const handleAdd = async () => {
    setAdded(null);
    const result = await addItem(product.id, activeVariant?.id ?? null, quantity);
    if (result.success) {
      setAdded("به سبد خرید اضافه شد.");
    } else {
      setAdded({ error: result.error });
    }
  };

  const handleWishlist = async () => {
    if (!isAuthenticated || wishlistBusy) return;
    setWishlistBusy(true);
    await wishlist.toggle(product.id);
    setWishlistBusy(false);
  };

  return (
    <div className="product-detail">
      {/* Part S2 item 7: breadcrumbs on the product page; every trail starts
          کازین گالری › آشپزخانه, then the deeper levels of the tree. */}
      <Breadcrumbs items={crumbTrail} />
      <div className="product-detail__body">
        <div className="product-detail__gallery">
          {/* Part S5 item 3: main image + thumbnail row (cross-fade, keyboard,
              swipe, scroll-snap) -- every image still goes through the shared
              SmartImage, so a broken one shows the placeholder. */}
          <ProductGallery images={images} name={faDigits(product.name)} />
          {product.sku ? (
            <p className="product-detail__sku">کد کالا: <bdi dir="ltr">{faDigits(product.sku)}</bdi></p>
          ) : null}
        </div>

        <div className="product-detail__info">
          <h1>{faDigits(product.name)}</h1>
          {product.brand ? (
            <div className="product-detail__brand">
              {product.brand.slug ? <Link to={brandUrl(product.brand.slug)}>برند: {faDigits(product.brand.name)}</Link> : `برند: ${faDigits(product.brand.name)}`}
            </div>
          ) : null}
          {product.short_description ? <p className="product-detail__short">{faDigits(product.short_description)}</p> : null}

          <PriceTag priceInfo={displayPrice} size="lg" />

          <span className={`stock stock--${stockStatus}`}>
            {outOfStock ? "ناموجود" : stockStatus === "low_stock" ? "تعداد محدود" : "موجود در انبار"}
          </span>

          {hasVariants ? (
            <div className="variant-select">
              {attributeOptions.map(({ attribute, values }) => (
                <div key={attribute} className="variant-select__group">
                  <span>{faDigits(attribute)}:</span>
                  {values.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={selected[attribute] === value ? "chip chip--active" : "chip"}
                      onClick={() => setSelected((s) => ({ ...s, [attribute]: value }))}
                    >
                      {faDigits(value)}
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(selected).length === attributeOptions.length && !activeVariant ? (
                <Alert>این ترکیب گزینه‌ها موجود نیست.</Alert>
              ) : null}
            </div>
          ) : null}

          <div className="product-detail__buy">
            <div className="qty-picker" hidden={outOfStock}>
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="کاهش"><Icon name="minus" size={16} /></button>
              <span>{faDigits(quantity)}</span>
              <button type="button" disabled={quantity >= availableStock} onClick={() => setQuantity((q) => Math.min(availableStock, q + 1))} aria-label="افزایش"><Icon name="plus" size={16} /></button>
            </div>

            <button
              ref={buyRef}
              type="button"
              className="btn btn--primary"
              onClick={handleAdd}
              disabled={outOfStock || (hasVariants && !activeVariant)}
            >
              {outOfStock ? "ناموجود" : hasVariants && !activeVariant ? "انتخاب گزینه‌ها" : "افزودن به سبد خرید"}
            </button>

            <button
              type="button"
              className={`icon-btn icon-btn--lg ${wishlisted ? "icon-btn--active" : ""}`}
              onClick={handleWishlist}
              aria-pressed={wishlisted}
              disabled={!isAuthenticated || wishlistBusy}
              title={wishlisted ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
              aria-label={wishlisted ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
            >
              <Icon name="heart" filled={wishlisted} size={20} />
            </button>
          </div>

          {outOfStock ? (
            <div className="back-in-stock">
              <p className="muted">این کالا فعلاً موجود نیست. شمارهٔ موبایل‌تان را بگذارید تا وقتی موجود شد خبرتان کنیم.</p>
              <div className="back-in-stock__row">
                <input
                  type="text"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="شماره موبایل"
                  maxLength={20}
                  value={bisPhone}
                  onChange={(e) => setBisPhone(normalizePhone(e.target.value))}
                  aria-label="شماره موبایل برای اطلاع‌رسانی موجودی"
                />
                <button
                  type="button"
                  className="btn btn--outline"
                  disabled={bisState === "busy" || !isValidIranianPhone(bisPhone)}
                  onClick={async () => {
                    setBisState("busy");
                    try {
                      await subscribeBackInStock(product.id, activeVariant?.id ?? null, bisPhone.trim());
                      setBisState("done");
                    } catch (err) {
                      setBisState(errorMessage(normalizeApiError(err)));
                    }
                  }}
                >
                  اطلاع به من
                </button>
              </div>
              {bisState === "done" ? (
                <p className="field-help">ثبت شد؛ به محض موجود‌شدن اطلاع‌رسانی می‌شود.</p>
              ) : bisState && bisState !== "busy" ? (
                <p className="field-help field-help--error">{bisState}</p>
              ) : null}
            </div>
          ) : null}

          {added && added.error ? <Alert>{errorMessage(added.error)}</Alert> : null}
          {typeof added === "string" ? <Alert kind="success">{added}</Alert> : null}

          <div className="product-detail__content">
            <ProductContentSection title="توضیحات">
              <p className="product-detail__description">
                {faDigits(product.description || product.short_description || "توضیحاتی ثبت نشده است.")}
              </p>
            </ProductContentSection>
            {product.specifications?.length ? (
              <ProductContentSection title="مشخصات">
                <table className="specs">
                  <tbody>
                    {product.specifications.map((spec) => (
                      <tr key={spec.attribute}>
                        <th scope="row">{faDigits(spec.attribute)}</th>
                        <td>{faDigits(spec.values.join("، "))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ProductContentSection>
            ) : null}
          </div>
        </div>
      </div>

      {product.related_products?.length ? (
        <section className="product-detail__related">
          <h2>محصولات مرتبط</h2>
          <div className="related-grid">
            {product.related_products.map((related) => (
              <ProductCard key={related.id} product={related} />
            ))}
          </div>
        </section>
      ) : null}

      <ReviewsSection
        product={product}
        initialSummary={reviews.summary}
        initialReviews={reviews.reviews}
      />

      {/* Part R5 item 10: browser-local, the server knows nothing about it */}
      <RecentlyViewed excludeId={product.id} />

      <div
        className={`product-detail__stickybar${stickyVisible ? " product-detail__stickybar--visible" : ""}`}
      >
        <PriceTag priceInfo={displayPrice} size="md" />
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleAdd}
          disabled={outOfStock || (hasVariants && !activeVariant)}
        >
          {outOfStock ? "ناموجود" : "افزودن به سبد خرید"}
        </button>
      </div>
    </div>
  );
}

ProductContentSection.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

ProductDetail.propTypes = {
  product: productDetailShape.isRequired,
  slug: PropTypes.string.isRequired,
  reviews: PropTypes.shape({ summary: PropTypes.object, reviews: PropTypes.object }),
};

export default ProductDetail;
