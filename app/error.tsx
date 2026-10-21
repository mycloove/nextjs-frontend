"use client";

import Link from "next/link";
import { useEffect } from "react";
import "./home.css";
import styles from "./system-state.module.css";

/**
 * Root error boundary. Catches render/data errors in any route under the root
 * layout (excluding the layout itself, which needs a global-error boundary).
 * The user's document work is untouched - they can retry or step back.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the digest for support. The message itself may name internals, so it
    // is not shown to the user.
    console.error("Page error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="home-page">
      <main className={styles.wrap}>
        <div className={styles.stack}>
          <span className={styles.ghostBack} aria-hidden="true" />
          <span className={styles.ghost} aria-hidden="true" />
          <section className={styles.card} role="alert">
            <p className={styles.code}>Something broke</p>
            <h1 className={styles.title}>This page hit a snag on our side.</h1>
            <p className={styles.lede}>
              Nothing you uploaded was lost. Try again, and if it keeps
              happening, head back to the tools and continue from there.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={reset}>
                Try again
              </button>
              <Link href="/" className={styles.ghostBtn}>
                Back to tools
              </Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
