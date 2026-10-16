import { LegalPage, type LegalSection } from "@/components/site/legal-page";
import { LEGAL } from "@/lib/legal";

const sections: LegalSection[] = [
  {
    id: "what-we-collect",
    title: "Information we collect",
    body: (
      <>
        <p><b>When you register or contact us:</b> your name, business name, mobile number, email address, and business details such as GSTIN, city and state.</p>
        <p><b>Business data you enter in the software:</b> your customers, suppliers, products, invoices, purchases, payments and accounts. You control this data.</p>
        <p><b>Payments:</b> the payment status and transaction reference from Razorpay. Card, UPI and bank details are handled by Razorpay and are not stored by us.</p>
        <p><b>Technical data:</b> login records (time and IP address) for security, and a session cookie that keeps you logged in.</p>
      </>
    ),
  },
  {
    id: "how-we-use",
    title: "How we use it",
    body: (
      <ul>
        <li>To create and run your account and provide the software.</li>
        <li>To process subscription payments and send related messages (receipts, renewal reminders, password reset emails).</li>
        <li>To keep the service secure — for example, detecting repeated failed logins.</li>
        <li>To reply to demo requests and support queries.</li>
      </ul>
    ),
  },
  {
    id: "sharing",
    title: "Who we share it with",
    body: (
      <>
        <p>We do <b>not</b> sell your data or your customers' data. We share it only with service providers we need to run the service, and only for that purpose:</p>
        <ul>
          <li>Razorpay — payment processing.</li>
          <li>Our cloud hosting and database provider — to store and run the service.</li>
          <li>Email delivery provider — to send account and password emails.</li>
          <li>WhatsApp Business (Meta) — only if you use the feature to send invoices or messages to your customers.</li>
          <li>GST verification services — only when you look up a GSTIN.</li>
        </ul>
        <p>We may disclose information if required by law or a lawful order from a government authority.</p>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect it",
    body: (
      <ul>
        <li>Each company's data is kept separate; one business cannot see another's records.</li>
        <li>Passwords are stored only in hashed (encrypted) form — no one, including us, can read them.</li>
        <li>Access within your company is controlled by the roles you assign (admin, store, accountant, customer, etc.).</li>
        <li>Data is transferred over secure (HTTPS) connections and backed up regularly.</li>
      </ul>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <p>
        We keep your data while your account is active. If your subscription ends, your data is kept so you
        can renew and continue where you left off. You can ask us to export or delete your company's data at
        any time by writing to {LEGAL.email}; some records may be kept longer where the law requires (for
        example, our own tax and payment records).
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: (
      <ul>
        <li>See and correct your account details from your dashboard, or by contacting us.</li>
        <li>Ask for a copy of your data, or for it to be deleted.</li>
        <li>Withdraw consent for optional messages at any time.</li>
      </ul>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We use a necessary session cookie to keep you signed in, and the browser's local storage for small
        preferences (such as your last-used filters). We do not use advertising cookies.
      </p>
    ),
  },
  {
    id: "grievance",
    title: "Grievance officer",
    body: (
      <p>
        For any complaint about how your data is handled, contact our Grievance Officer,{" "}
        {LEGAL.grievanceOfficer}, at {LEGAL.grievanceEmail}. We acknowledge complaints within 24 hours and
        aim to resolve them within 15 days.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change this policy, we will update the "Last updated" date above, and tell you about significant
        changes by email or in the app.
      </p>
    ),
  },
];

export default function Privacy() {
  return (
    <LegalPage
      path="/privacy"
      title="Privacy Policy"
      intro={
        <p>
          This policy explains what information {LEGAL.legalName} collects when you use {LEGAL.brand}, how it
          is used, and the choices you have. It is written in line with the Information Technology Act, 2000 and
          the Digital Personal Data Protection Act, 2023.
        </p>
      }
      sections={sections}
    />
  );
}
