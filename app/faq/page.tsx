import Link from "next/link";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/metadata";

import HomeFooter from "@/components/HomeFooter";
import Topbar2 from "@/components/Topbar2";

import "../home.css";
import styles from "../marketing.module.css";

export const metadata = pageMetadata(
  "/faq",
  "FAQ",
  "Answers to common questions about mycloove: pricing, accounts, what happens to your files, size limits, and Bangla support.",
);

type Faq = { q: string; plain: string; body: ReactNode };

const FAQ: Faq[] = [
  {
    q: "Is mycloove free to use?",
    plain:
      "Yes. Every tool is free within a fair-use limit, and no credit card is required. A Pro plan is planned but is not available yet.",
    body: (
      <>
        <p>Yes. Tools are free within a fair-use allowance, and no credit card is required. When credit mode is enabled, billable actions share your account balance and show their cost before work starts. Open your avatar to see the current allowance.</p>
        <p>See the <Link href="/pricing">pricing page</Link> for what is planned next.</p>
      </>
    ),
  },
  {
    q: "Do I need an account?",
    plain:
      "No. Most tools work without an account. Creating one links guest activity, keeps a record of conversions, and uses the configured account allowance.",
    body: (
      <>
        <p>No. Most tools work without an account. Creating one links your guest activity once and keeps recent conversions under your profile. Guest and account allowances are configured separately; the avatar menu shows what is available now. Either way, your files are handled the same way.</p>
      </>
    ),
  },
  {
    q: "What happens to my files?",
    plain:
      "File handling varies by tool. Document AI may retain uploads and derived content for follow-up questions, and editors may save work in your browser. Read the privacy policy before uploading sensitive content.",
    body: (
      <>
        <p>File handling varies by tool. Document AI may retain uploads and derived content for follow-up questions, and editors may save work in your browser. Closing a tab does not guarantee that server-side content has been deleted. Read the <Link href="/privacy">privacy policy</Link> before uploading sensitive content.</p>
      </>
    ),
  },
  {
    q: "What file sizes are supported?",
    plain:
      "Up to 100 MB per file. A few tools cap lower and say so on their own page.",
    body: (
      <>
        <p>Up to <strong>100 MB per file</strong>. A few tools cap lower for a good reason and state the limit on their own page, so you always know before you start.</p>
      </>
    ),
  },
  {
    q: "Can it read and convert Bangla?",
    plain:
      "Bijoy to Unicode converts legacy Bijoy-encoded Bangla text. Bangla OCR depends on the processing service's installed language support; review every result against the source.",
    body: (
      <>
        <p>The <Link href="/bijoy-converter">Bijoy to Unicode</Link> tool converts legacy Bijoy-encoded Bangla text. The <Link href="/image-to-text">Image to Text</Link> tool offers OCR language options, but Bangla recognition depends on the processing service&rsquo;s installed language support. Review every result against the source.</p>
      </>
    ),
  },
  {
    q: "Does it work on my phone?",
    plain:
      "Yes. Every tool is responsive and runs in the browser — there is nothing to install.",
    body: (
      <>
        <p>Yes. Every tool is responsive and runs in your browser — there is nothing to install, and the same tools work on desktop and mobile.</p>
      </>
    ),
  },
  {
    q: "Do you offer an API?",
    plain:
      "Not publicly at launch. If you need programmatic access, contact us and tell us about your use case.",
    body: (
      <>
        <p>Not publicly at launch. If you need programmatic access, <Link href="/contact-us">contact us</Link> and tell us about your use case.</p>
      </>
    ),
  },
  {
    q: "How do I report a problem or request a tool?",
    plain:
      "Use the contact form. Bug reports and tool requests are both welcome.",
    body: (
      <>
        <p>Use the <Link href="/contact-us">contact form</Link>. Bug reports and tool requests are both welcome — a short description and, for bugs, the file type you were working with is all we need.</p>
      </>
    ),
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.plain },
  })),
};

const chevron = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export default function FaqPage() {
  return (
    <div className="home-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Topbar2 openFileHref="/" />
      <main className={styles.main}>
        <div className={styles.shell}>
          <p className={styles.eyebrow}>Questions</p>
          <h1 className={styles.title}>Frequently asked questions</h1>
          <p className={styles.lede}>
            Straight answers about pricing, accounts, and what happens to your
            files. If something is missing, the contact form reaches a person.
          </p>

          <section className={styles.section}>
            <div className={styles.faq}>
              {FAQ.map((item) => (
                <details className={styles.item} key={item.q}>
                  <summary className={styles.summary}>
                    {item.q}
                    <span className={styles.chev}>{chevron}</span>
                  </summary>
                  <div className={styles.answer}>{item.body}</div>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
