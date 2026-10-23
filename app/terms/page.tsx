import Link from "next/link";
import type { Metadata } from "next";

import LegalLayout, { type LegalSection } from "@/components/legal/LegalLayout";

import "../home.css";

const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@mycloove.com";

export const metadata: Metadata = {
  title: { absolute: "Terms — mycloove" },
  description:
    "The terms that govern your use of mycloove: your files, your account, usage limits, and acceptable use.",
};

const sections: LegalSection[] = [
  {
    id: "using",
    heading: "Using mycloove",
    body: (
      <>
        <p>
          mycloove is a set of tools for working with documents — converting,
          extracting from, and inspecting files you choose to upload. By using
          the service you agree to these terms. If you do not agree, please do
          not use it.
        </p>
      </>
    ),
  },
  {
    id: "your-files",
    heading: "Your files",
    body: (
      <>
        <p>
          You keep all rights to the files you upload, and you are responsible
          for having the right to process them. Conversion runs on our servers
          only to produce the result you asked for. Your files are not
          published, sold, or shared with other users.
        </p>
      </>
    ),
  },
  {
    id: "account",
    heading: "Your account",
    body: (
      <>
        <p>
          Most tools work without an account. If you create one, use accurate
          information and keep your password confidential — you are responsible
          for activity that happens under your account.
        </p>
      </>
    ),
  },
  {
    id: "limits",
    heading: "Usage limits",
    body: (
      <>
        <p>
          Free usage is governed by the active fair-use policy. When credits are
          enabled, billable actions draw from a shared allowance at the displayed
          cost. Credits are not money, cannot be transferred, and return according
          to the configured rolling window. Guest activity may be linked to your
          account when you sign in. We may adjust allowances and action costs,
          and we may suspend accounts that abuse the service.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    heading: "Acceptable use",
    body: (
      <>
        <p>Please do not:</p>
        <ul>
          <li>upload content you do not have the right to process;</li>
          <li>attempt to disrupt, probe, or overload the service;</li>
          <li>use the service to break the law or infringe others&rsquo; rights;</li>
          <li>resell the service or automate it in a way that harms it.</li>
        </ul>
      </>
    ),
  },
  {
    id: "intellectual-property",
    heading: "Intellectual property",
    body: (
      <>
        <p>
          The mycloove name, interface, and code belong to us or our licensors.
          You may not copy or reuse them except as these terms allow. The output
          files you generate are yours.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    heading: "Availability and changes",
    body: (
      <>
        <p>
          The service is provided as-is and may change, be interrupted, or be
          discontinued. We may update these terms; the &ldquo;last updated&rdquo;
          date reflects the current version, and continued use means you accept
          it.
        </p>
      </>
    ),
  },
  {
    id: "disclaimer",
    heading: "Disclaimer",
    body: (
      <>
        <p>
          The tools are provided without warranties of any kind. Document
          conversion is not perfect — verify important output before relying on
          it, especially for legal, financial, or safety-critical work.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    heading: "Limitation of liability",
    body: (
      <>
        <p>
          To the extent allowed by law, we are not liable for indirect or
          consequential losses, or for lost or corrupted files. Please keep your
          own copies of anything important.
        </p>
      </>
    ),
  },
  {
    id: "governing-law",
    heading: "Governing law",
    body: (
      <>
        <p>
          These terms are governed by the laws of Bangladesh, without regard to
          its conflict-of-law rules.
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
          Questions about these terms? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or use the{" "}
          <Link href="/contact-us">contact form</Link>.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      updated="October 2026"
      intro="These terms explain what you can expect from mycloove and what we expect from you. They are written to be read, not to hide things."
      sections={sections}
    />
  );
}
