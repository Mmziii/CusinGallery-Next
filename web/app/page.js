import Home from "../home/Home";
import { getHomeData, getSite } from "../lib/api-server";
import { homeMetadata } from "../lib/metadata";
export async function generateMetadata() { return homeMetadata(await getSite()); }
export default async function HomePage() { const [initialData, site] = await Promise.all([getHomeData(), getSite()]);
  return <Home initialData={initialData} content={site.content} />; }
