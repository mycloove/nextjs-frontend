import Link from "next/link";
import type { Metadata } from "next";

import LegalLayout, { type LegalSection } from "@/components/legal/LegalLayout";

import "../home.css";

const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@mycloove.com";

export const metadata: Metadata = {
  title: { absolute: "Privacy — mycloove" },
  description:
    "How mycloove handles your data: what we process, what we keep, the cookies we use, your rights, and how to reach us.",
};

const sections: LegalSection[] = [
  {
    id: "summary",
    heading: "Summary",
    body: (
      <>
        <p>
          mycloove is built to need as little of your data as possible. Most
          tools work without an account, files are processed to produce your
          result, and we do not sell your data or run advertising trackers.
        </p>
      </>
    ),
  },
  {
    id: "what-we-process",
    heading: "What we process",
    body: (
      <>
        <ul>
          <li>the files you choose to upload;</li>
          <li>
            basic technical data needed to serve a request, such as a request
            identifier and a timestamp;
          </li>
          <li>account details, if you sign in;</li>
          <li>usage events (which tool, and when).</li>
        </ul>
      </>
    ),
  },
  {
    id: "your-files",
    heading: "Your files",
    body: (
      <>
        <p>
          Files you upload are processed on our servers to produce the result
          you requested. For most tools, the uploaded file and the generated
          output are deleted from the server as soon as the response is sent.
        </p>
        <p>
          Some features keep a document for the duration of a session — for
          example, Document AI, so you can keep asking questions about it.
          Ending or starting a new session releases it.
        </p>
      </>
    ),
  },
  {
    id: "account-data",
    heading: "Account data",
    body: (
      <>
        <p>
          If you create an account, we store your email address — handled by our
          authentication provider, Supabase — and a display name. You can change
          your display name in profile settings.
        </p>
      </>
    ),
  },
  {
    id: "usage-data",
    heading: "Usage data",
    body: (
      <>
        <p>
          To apply fair usage limits we record which tool was used and when. If
          you are signed in and a file name is available, it is stored with your
          usage history so it can appear in your own activity list. That history
          is visible only to you and is never shown to administrators or other
          users.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    heading: "Cookies",
    body: (
      <>
        <p>
          We use cookies that are necessary to run the service: a session cookie
          when you sign in, and an anonymous identifier that lets guest usage be
          counted fairly. We do not use cookies for advertising.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    heading: "Third parties",
    body: (
      <>
        <p>
          We use a small number of processors to run the service — for example
          Supabase for authentication and the database, and an email service for
          the contact form. They process data only to provide their function. We
          do not sell personal data.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    heading: "Retention",
    body: (
      <>
        <p>
          Uploaded files and generated outputs are not kept beyond processing
          (see &ldquo;Your files&rdquo;). Usage records are kept to apply limits
          and to show your own activity. Account data is kept while your account
          exists.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    heading: "Your rights",
    body: (
      <>
        <p>
          Depending on where you live, you may have the right to access, correct,
          or delete your personal data. You can edit your profile in settings,
          and you can ask us to delete your data by emailing{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </>
    ),
  },
  {
    id: "children",
    heading: "Children",
    body: (
      <>
        <p>
          The service is not directed to children under 13 — or the minimum age
          in your country. Please do not use it if you are below that age.
        </p>
      </>
    ),
  },
  {
    id: "security",
    heading: "Security",
    body: (
      <>
        <p>
          We use industry-standard measures, including encryption in transit. No
          service can promise perfect security, so keep your account password
          confidential.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    heading: "Changes",
    body: (
      <>
        <p>
          We may update this policy. The &ldquo;last updated&rdquo; date reflects
          the current version.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    heading: "Contact",
    body: (
      <>
        <p>
          Privacy questions? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or use the{" "}
          <Link href="/contact-us">contact form</Link>.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated="October 2026"
      intro="A plain-language account of what mycloove does with your data — what we process, what we keep, and what we never do."
      sections={sections}
    />
  );
}
