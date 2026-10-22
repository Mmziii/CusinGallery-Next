import { generateInfoMetadata, renderInfoPage } from "../../info/InfoPageRoute";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return generateInfoMetadata("terms");
}

export default function TermsPage() {
  return renderInfoPage("terms");
}
