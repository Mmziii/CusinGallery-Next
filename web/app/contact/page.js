import { generateInfoMetadata, renderInfoPage } from "../../info/InfoPageRoute";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return generateInfoMetadata("contact");
}

export default function ContactPage() {
  return renderInfoPage("contact");
}
