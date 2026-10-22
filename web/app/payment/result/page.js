import PaymentResultPage from "../../../purchase/PaymentResultPage";
import { privateMetadata } from "../../../lib/auth-server";

export const dynamic = "force-dynamic";
export const metadata = privateMetadata("نتیجهٔ پرداخت");

export default function PaymentResultIndexRoute() {
  return <PaymentResultPage />;
}
