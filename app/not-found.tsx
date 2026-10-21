import Link from "next/link";
import "./home.css";
import styles from "./system-state.module.css";

/**
 * Root 404 surface. Renders inside the root layout for any unmatched URL.
 * The metaphor is deliberate for a document product: the page fell out of the
 * stack, but the tools are still on the desk.
 */
export default function NotFound() {
  return (
    <div className="home-page">
      <main className={styles.wrap}>
        <div className={styles.stack}>
          <span className={styles.ghostBack} aria-hidden="true" />
          <span className={styles.ghost} aria-hidden="true" />
          <section className={styles.card}>
            <p className={styles.code}>404</p>
            <h1 className={styles.title}>This page slipped out of the stack.</h1>
            <p className={styles.lede}>
              The address you followed does not match any page here. Every tool
              is still where you left it.
            </p>
            <div className={styles.actions}>
              <Link href="/" className={styles.primary}>
                Back to tools
              </Link>
              <Link href="/pdf-editor" className={styles.ghostBtn}>
                Open the PDF editor
              </Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
