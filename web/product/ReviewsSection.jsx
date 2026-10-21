"use client";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { Link } from "../lib/navigation";

import Icon from "../components/Icon";
import StarRating from "../components/StarRating";
import { Alert, EmptyState, Spinner, errorMessage } from "../components/ui";
import * as reviewsApi from "../services/reviewsApi";
import useAuthStore from "../store/useAuthStore";
import { normalizeApiError } from "../utils/apiError";
import { faDigits, faDate } from "../utils/faDigits";
import { productDetailShape } from "../utils/shapes";

function Stars({ value, size = "md" }) {
  // Part R2: SVG stars (no text glyphs).
  return <StarRating rating={Math.round(value || 0)} size={size === "lg" ? 20 : 16} />;
}

function RatingInput({ value, onChange }) {
  return (
    <div className="rating-input" role="radiogroup" aria-label="امتیاز">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${faDigits(n)} ستاره`}
          className={n <= value ? "star star--on" : "star"}
          onClick={() => onChange(n)}
        >
          <Icon name="star" size={22} filled={n <= value} />
        </button>
      ))}
    </div>
  );
}

/**
 * Reviews: the summary and the first page are SERVER-rendered (they are part
 * of the page's content and belong in the HTML); pagination, the "my review"
 * lookup and the submit form stay client-side.
 */
function ReviewsSection({ product, initialSummary = null, initialReviews = null }) {
  const { isAuthenticated } = useAuthStore();
  const [summary] = useState(initialSummary);
  const [reviews, setReviews] = useState(initialReviews);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  // The "my review" state comes from the authenticated user's own list.
  const [myReviews, setMyReviews] = useState(null);

  const loadMyReviews = () => {
    if (!isAuthenticated) {
      setMyReviews(null);
      return Promise.resolve(null);
    }
    return reviewsApi
      .fetchMyReviews()
      .then((data) => setMyReviews(data))
      .catch(() => setMyReviews(null));
  };

  useEffect(() => {
    loadMyReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, product.id]);

  const myReview = useMemo(() => {
    if (!Array.isArray(myReviews)) return null;
    return myReviews.find((review) => review.product === product.id) || null;
  }, [myReviews, product.id]);

  const [form, setForm] = useState({ rating: 0, title: "", body: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formOk, setFormOk] = useState(null);

  useEffect(() => {
    if (myReview) setForm({ rating: myReview.rating, title: myReview.title, body: myReview.body });
  }, [myReview]);

  const submit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setFormOk(null);
    if (!form.rating) {
      setFormError("لطفاً امتیاز خود را انتخاب کنید.");
      return;
    }
    setSubmitting(true);
    try {
      if (myReview) {
        await reviewsApi.updateReview(myReview.id, form);
        setFormOk("نظر شما ویرایش شد و پس از تأیید نمایش داده می‌شود.");
      } else {
        await reviewsApi.createReview({ product_id: product.id, ...form });
        setFormOk("نظر شما ثبت شد و پس از تأیید نمایش داده می‌شود.");
      }
      // Refresh "my review" so the form switches to edit mode instead of
      // offering (and then 400ing) a duplicate submission.
      loadMyReviews();
    } catch (err) {
      setFormError(errorMessage(normalizeApiError(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await reviewsApi.fetchProductReviews(product.id, { page: page + 1 });
      setReviews((current) => ({
        ...next,
        results: [...(current?.results || []), ...(next.results || [])],
      }));
      setPage((value) => value + 1);
    } catch {
      // A failed page keeps the reviews already on screen.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="reviews" id="reviews">
      <h2>نظرات کاربران</h2>

      {summary && summary.count > 0 ? (
        <div className="reviews__summary">
          <span className="reviews__avg">{faDigits(summary.average_rating)}</span>
          <Stars value={summary.average_rating} />
          <span className="reviews__count">{faDigits(summary.count)} نظر</span>
        </div>
      ) : null}

      {loadingMore && !reviews ? <Spinner /> : null}
      {reviews && reviews.results?.length === 0 ? (
        <EmptyState title="هنوز نظری برای این محصول ثبت نشده است." />
      ) : null}

      <div className="reviews__list">
        {(reviews?.results || []).map((review) => (
          <article key={review.id} className="review">
            <header>
              <strong>{review.username}</strong>
              <Stars value={review.rating} size="sm" />
              {review.is_verified_purchase ? (
                <span className="review__verified">خرید تأیید شده</span>
              ) : null}
            </header>
            {review.title ? <h4>{review.title}</h4> : null}
            {review.body ? <p>{review.body}</p> : null}
            <time>{faDate(review.created_at)}</time>
          </article>
        ))}
      </div>

      {reviews && reviews.next ? (
        <button type="button" className="btn btn--outline btn--sm" onClick={loadMore} disabled={loadingMore}>
          نظرات بیشتر
        </button>
      ) : null}

      <div className="review-form-wrap">
        <h3>{myReview ? "ویرایش نظر شما" : "نظر خود را بنویسید"}</h3>
        {!isAuthenticated ? (
          <p>
            برای ثبت نظر <Link to="/login/">وارد شوید</Link>.
          </p>
        ) : (
          <form className="review-form" onSubmit={submit}>
            <RatingInput value={form.rating} onChange={(rating) => setForm((f) => ({ ...f, rating }))} />
            <input
              type="text"
              placeholder="عنوان نظر (اختیاری)"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <textarea
              placeholder="متن نظر…"
              rows={4}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
            <Alert>{formError}</Alert>
            {formOk ? <Alert kind="success">{formOk}</Alert> : null}
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? "در حال ارسال…" : myReview ? "به‌روزرسانی نظر" : "ثبت نظر"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

Stars.propTypes = { value: PropTypes.number, size: PropTypes.oneOf(["sm", "md", "lg"]) };
RatingInput.propTypes = { value: PropTypes.number.isRequired, onChange: PropTypes.func.isRequired };
ReviewsSection.propTypes = {
  product: productDetailShape.isRequired,
  initialSummary: PropTypes.object,
  initialReviews: PropTypes.object,
};

export default ReviewsSection;
