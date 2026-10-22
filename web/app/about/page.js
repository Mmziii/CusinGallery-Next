import { generateInfoMetadata, renderInfoPage } from "../../info/InfoPageRoute";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return generateInfoMetadata("about");
}

export default function AboutPage() {
  return renderInfoPage("about");
}
