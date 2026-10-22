import { notFound } from "next/navigation";

import { InfoPageArticle, InfoPageError } from "./InfoPage";
import { getSite } from "../lib/api-server";
import { INFO_FALLBACK_TITLES, INFO_PAGES, loadInfoPage } from "../lib/info-server";
import { infoPageMetadata } from "../lib/metadata";

export async function generateInfoMetadata(slug) {
  const path = INFO_PAGES[slug];
  const fallbackTitle = INFO_FALLBACK_TITLES[slug] || "اطلاعات فروشگاه";
  const [result, site] = await Promise.all([loadInfoPage(slug), getSite()]);
  if (result.notFound) {
    return {
      title: "صفحه یافت نشد | کازین گالری",
      robots: { index: false, follow: false },
    };
  }
  return infoPageMetadata({
    page: result.page,
    fallbackTitle,
    path,
    settings: site.settings,
    content: site.content,
  });
}

export async function renderInfoPage(slug) {
  const result = await loadInfoPage(slug);
  if (result.notFound) notFound();
  if (!result.page) {
    const title = INFO_FALLBACK_TITLES[slug] || "اطلاعات فروشگاه";
    return <InfoPageError title={title} message={result.errorMessage} />;
  }
  return <InfoPageArticle page={result.page} />;
}
