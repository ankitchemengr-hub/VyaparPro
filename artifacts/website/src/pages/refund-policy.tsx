import { LegalPage, type LegalSection } from "@/components/site/legal-page";
import { LEGAL } from "@/lib/legal";

const sections: LegalSection[] = [
  {
    id: "trial",
    title: "Try before you pay",
    body: (
      <p>
        Plans with a free trial give you full access at no cost, so you can check that {LEGAL.brand} suits your
        business before paying anything. No payment details are needed to start a trial.
      </p>
    ),
  },
  {
    id: "cancellation",
    title: "Cancellation",
    body: (
      <ul>
        <li>Subscriptions do <b>not</b> renew automatically, so there is nothing to cancel — simply don't renew.</li>
        <li>Your access continues until the end of the period you have paid for.</li>
        <li>You can come back and renew at any time; your data will still be there.</li>
      </ul>
    ),
  },
  {
    id: "refunds",
    title: "Refunds",
    body: (
      <>
        <p>Because you can try the software free first, subscription fees are generally <b>not refundable</b> once a paid period has started, including for any unused part of it.</p>
        <p>We <b>will</b> give a full refund when:</p>
        <ul>
          <li>you were charged more than once for the same subscription (duplicate payment);</li>
          <li>money was deducted but your subscription was not activated or renewed; or</li>
          <li>the service could not be provided because of a fault on our side that we could not fix.</li>
        </ul>
      </>
    ),
  },
  {
    id: "how-to-request",
    title: "How to ask for a refund",
    body: (
      <p>
        Email {LEGAL.email} (or call {LEGAL.phone}) within 7 days of the payment, with your registered mobile
        number and the Razorpay payment ID shown on your Payments page. We will reply within 2 working days.
      </p>
    ),
  },
  {
    id: "timeline",
    title: "Refund timeline",
    body: (
      <p>
        Approved refunds are made to the original payment method (card, UPI, net banking or wallet) through
        Razorpay within 5–7 working days. Your bank may take a few extra days to show it.
      </p>
    ),
  },
  {
    id: "delivery",
    title: "Service delivery",
    body: (
      <p>
        {LEGAL.brand} is software delivered online. Access is activated immediately after successful
        registration and payment; no physical goods are shipped.
      </p>
    ),
  },
];

export default function RefundPolicy() {
  return (
    <LegalPage
      path="/refund-policy"
      title="Refund & Cancellation Policy"
      intro={
        <p>
          This policy explains how cancellation and refunds work for {LEGAL.brand} subscriptions bought from{" "}
          {LEGAL.legalName}.
        </p>
      }
      sections={sections}
    />
  );
}
