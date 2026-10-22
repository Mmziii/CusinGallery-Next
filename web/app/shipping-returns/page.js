import { generateInfoMetadata, renderInfoPage } from "../../info/InfoPageRoute";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return generateInfoMetadata("shipping-returns");
}

export default function ShippingReturnsPage() {
  return renderInfoPage("shipping-returns");
}
