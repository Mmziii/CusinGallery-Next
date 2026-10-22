import { generateInfoMetadata, renderInfoPage } from "../../info/InfoPageRoute";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return generateInfoMetadata("privacy");
}

export default function PrivacyPage() {
  return renderInfoPage("privacy");
}
