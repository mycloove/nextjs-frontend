import type { ReactNode } from "react";

import HomeFooter from "@/components/HomeFooter";
import Topbar2 from "@/components/Topbar2";

import styles from "./LegalLayout.module.css";

export type LegalSection = {
  id: string;
  heading: string;
  body: ReactNode;
};

/**
 * Shared shell for the legal pages (Terms, Privacy).
 *
 * Concept: a reference sheet. Long policies are hard to scan, so the page is a
 * two-column ledger - a sticky numbered index on the left, the policy as
 * numbered sections separated by hairlines on the right. The number marker is
 * the one accent, so the structure reads as an index, not decoration.
 */
export default function LegalLayout({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <div className="home-page">
      <Topbar2 openFileHref="/" />
      <main className={styles.main}>
        <div className={styles.shell}>
          <aside className={styles.toc} aria-label="On this page">
            <p className={styles.tocTitle}>On this page</p>
            <ol>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span className={styles.tocNum}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </aside>

          <article className={styles.doc}>
            <p className={styles.eyebrow}>Legal</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.updated}>Last updated {updated}</p>
            <p className={styles.intro}>{intro}</p>

            {sections.map((section, index) => (
              <section id={section.id} key={section.id} className={styles.section}>
                <h2>
                  <span className={styles.num} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {section.heading}
                </h2>
                <div className={styles.prose}>{section.body}</div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
