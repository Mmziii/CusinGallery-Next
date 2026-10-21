/**
 * The storefront's Persian 404, rendered by app/not-found.js. The response
 * carries a REAL 404 status (notFound()) and Next marks it noindex itself, so
 * no robots tag is duplicated here.
 */
export default function NotFoundPage() {
  return (
    <section className="notfound">
      <h1>۴۰۴</h1>
      <p>صفحه مورد نظر پیدا نشد؛ شاید نشانی عوض شده است.</p>
      <a className="btn btn--primary" href="/">بازگشت به فروشگاه</a>
    </section>
  );
}
