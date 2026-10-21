export function homeMetadata({ settings, content }) {
  const origin = process.env.SITE_ORIGIN || "https://cusin.ir";
  const title = settings.seo_title || "کازین گالری | فروشگاه لوازم آشپزخانه، بلور و کریستال";
  const description = settings.seo_description || "فروشگاه آنلاین ظروف آشپزخانه، پخت‌وپز، بلور و کریستال و لوازم خانه. ارسال به سراسر ایران، پرداخت امن اینترنتی.";
  const url = new URL("/", origin).href;
  return { twitter: { card: "summary_large_image" }, metadataBase: new URL(origin), title, description: settings.seo_description || `کازین گالری - ${description}`, alternates: { canonical: url }, openGraph: { title, description, url, type: "website", locale: "fa_IR", siteName: content.brand?.name || "کازین گالری", images: [settings.og_image || "/brand/og.png"] } };
}
