import PaymentResultPage from "../../../../purchase/PaymentResultPage";
import { apiServer } from "../../../../lib/api-server";
import { privateMetadata } from "../../../../lib/auth-server";

export const dynamic = "force-dynamic";
export const metadata = privateMetadata("نتیجه پرداخت");

export default async function PaymentResultDetailRoute({ params }) {
  const { paymentId } = await params;
  let initialPayment;
  try {
    const data = await apiServer(`/api/v1/payments/${encodeURIComponent(paymentId)}/`, {
      privateData: true,
    });
    if (data && typeof data === "object" && typeof data.status === "string") {
      initialPayment = data;
    }
  } catch {
    initialPayment = undefined;
  }
  return <PaymentResultPage initialPayment={initialPayment} serverPaymentId={paymentId} />;
}
