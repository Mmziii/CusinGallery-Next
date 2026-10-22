"use client";

import { useRouter } from "next/navigation";

import { ErrorState } from "../components/ui";
import { Link } from "../lib/navigation";

/**
 * Owner-editable info/trust page article (about, contact, ...).
 *
 * Content is owner-edited rich text sanitised on write in Django's core.models.
 */
export function InfoPageArticle({ page }) {
  return (
    <article className="container info-page">
      <h1>{page.title}</h1>
      <div
        className="info-page__body card rich-text"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: page.body || "" }}
      />
    </article>
  );
}

export function InfoPageError({ title, message }) {
  const router = useRouter();
  return (
    <div className="container info-page">
      <h1>{title}</h1>
      <ErrorState message={message} onRetry={() => router.refresh()} />
      <p>
        <Link to="/">بازگشت به فروشگاه</Link>
      </p>
    </div>
  );
}
