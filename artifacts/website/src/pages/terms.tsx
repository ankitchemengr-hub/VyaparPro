import { Link } from "wouter";
import { LegalPage, type LegalSection } from "@/components/site/legal-page";
import { LEGAL } from "@/lib/legal";

const sections: LegalSection[] = [
  {
    id: "service",
    title: "The service",
    body: (
      <>
        <p>
          {LEGAL.brand} is an online business-management software (billing, GST invoicing, inventory,
          purchases, accounts and related features) provided by {LEGAL.legalName} ("we", "us") on a
          subscription basis. You ("the customer") use it through a web browser or mobile device.
        </p>
        <p>
          The service is delivered online. Your account is activated as soon as registration (and payment,
          for a paid plan) is complete — nothing is shipped physically.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <ul>
        <li>You must give correct business and contact details when registering, and keep them up to date.</li>
        <li>The person who registers becomes the admin of the company account and is responsible for the logins they create for staff, customers or accountants.</li>
        <li>Keep passwords confidential. You are responsible for activity under your account. Tell us at once if you suspect misuse.</li>
        <li>You must be at least 18 years old and authorised to act for the business you register.</li>
      </ul>
    ),
  },
  {
    id: "plans",
    title: "Plans, free trial and payment",
    body: (
      <ul>
        <li>Plans, their prices (in Indian Rupees) and limits are listed on the <Link href="/pricing" className="text-blue-700 hover:underline">Pricing</Link> page. Applicable GST is charged in addition where required.</li>
        <li>Plans that offer a free trial give full access for the trial period at no charge. When the trial ends, you need to subscribe to continue.</li>
        <li>Payments are processed securely by our payment partner Razorpay. We do not store your card, UPI or bank details.</li>
        <li>Subscriptions do not renew automatically — you renew from your account before the end date. We may remind you before it ends.</li>
        <li>If a subscription is not renewed, access to the software is suspended after the end date until it is renewed.</li>
        <li>We may change prices for future periods; changes never affect a period you have already paid for.</li>
      </ul>
    ),
  },
  {
    id: "refunds",
    title: "Cancellation and refunds",
    body: (
      <p>
        Cancellation and refunds are covered by our{" "}
        <Link href="/refund-policy" className="text-blue-700 hover:underline">Refund &amp; Cancellation Policy</Link>,
        which forms part of these terms.
      </p>
    ),
  },
  {
    id: "your-data",
    title: "Your data",
    body: (
      <>
        <p>
          The business data you enter (customers, items, invoices, accounts, etc.) belongs to you. We process
          it only to provide the service, as described in our{" "}
          <Link href="/privacy" className="text-blue-700 hover:underline">Privacy Policy</Link>.
        </p>
        <p>
          You are responsible for the correctness of the data you enter and of the invoices, GST returns and
          other documents you prepare with it. The software is a tool; it does not replace advice from your
          Chartered Accountant or tax consultant.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <ul>
        <li>Use the service only for lawful business purposes and in line with GST and other applicable laws.</li>
        <li>Do not try to access other customers' data, break security, overload the system, or copy, resell or reverse-engineer the software.</li>
        <li>Do not use the service to send spam or unlawful messages (including through any WhatsApp or email features).</li>
      </ul>
    ),
  },
  {
    id: "availability",
    title: "Availability and support",
    body: (
      <p>
        We work to keep the service available at all times, but it may occasionally be unavailable for
        maintenance, updates or reasons outside our control (for example internet or hosting outages). Support
        is available through the contact details below.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <p>
        To the extent permitted by law, we are not liable for indirect or consequential losses (such as loss
        of profit or business) arising from use of, or inability to use, the service. Our total liability for
        any claim is limited to the subscription fees you paid us in the 3 months before the claim arose.
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and termination",
    body: (
      <p>
        You may stop using the service at any time. We may suspend or close an account that breaches these
        terms or is used unlawfully, with notice where reasonably possible.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We may update these terms from time to time. The "Last updated" date above shows the latest version.
        Continuing to use the service after a change means you accept the updated terms.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of India. Disputes are subject to the exclusive jurisdiction of
        the courts at {LEGAL.jurisdictionCity}.
      </p>
    ),
  },
];

export default function Terms() {
  return (
    <LegalPage
      path="/terms"
      title="Terms & Conditions"
      intro={
        <p>
          These terms apply to your use of {LEGAL.brand} — this website and the business software it gives
          access to. By registering, subscribing or using the service, you agree to them.
        </p>
      }
      sections={sections}
    />
  );
}
