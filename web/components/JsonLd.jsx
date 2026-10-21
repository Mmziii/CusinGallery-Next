/**
 * Server-rendered structured data. Emitted in the HTML itself so crawlers that
 * never execute JavaScript (social previewers, most bots) see it, unlike the
 * SPA's document.head effects.
 */
export default function JsonLd({ data, id }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      id={id}
      // The payload is built from our own API objects, never from raw input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
