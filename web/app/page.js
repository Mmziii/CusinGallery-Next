import Home from "../home/Home";
import JsonLd from "../components/JsonLd";
import { getHomeData, getSite } from "../lib/api-server";
import { homeMetadata } from "../lib/metadata";
import { organizationJsonLd, websiteJsonLd } from "../lib/jsonld";

export async function generateMetadata() { return homeMetadata(await getSite()); }

export default async function HomePage() {
  const [initialData, site] = await Promise.all([getHomeData(), getSite()]);
  return (
    <>
      <JsonLd
        id="website-jsonld"
        data={websiteJsonLd({ description: site.settings.seo_description })}
      />
      <JsonLd id="organization-jsonld" data={organizationJsonLd({ settings: site.settings, content: site.content })} />
      <Home initialData={initialData} content={site.content} />
    </>
  );
}
