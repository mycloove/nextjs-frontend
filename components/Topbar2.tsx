"use client";

import AnimatedBrandLogo from "@/components/animated-brand-logo/AnimatedBrandLogo";
import AuthNavButton from "@/components/AuthNavButton";
import MyclooveWordmark from "@/components/brand/mycloove/MyclooveWordmark";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string };

/*
  One global product navigation, mounted by every marketing route. The three
  editor applications (PDF Editor, Image Editor, Document AI) own their chrome
  and never render this bar, so the same five destinations can stay stable
  everywhere it does appear. Company pages live in the footer.
*/
const GLOBAL_NAV: readonly NavLink[] = [
  { href: "/#tools", label: "Tools" },
  { href: "/pdf-editor", label: "PDF Editor" },
  { href: "/image-editor", label: "Image Editor" },
  { href: "/document-ai", label: "Document AI" },
  { href: "/pricing", label: "Pricing" },
];

const sectionId = (href: string) => {
  const index = href.indexOf("#");
  return index === -1 ? null : href.slice(index + 1);
};

const ANCHOR_IDS = GLOBAL_NAV.map((link) => sectionId(link.href)).filter(
  (id): id is string => Boolean(id),
);

type Topbar2Props = {
  openFileHref?: string;
  /*
    Home passes this instead of openFileHref: its file input lives in the hero
    upload pane, so the header action is a real <button> that triggers it. The
    old <label htmlFor="heroFile"> looked identical to the /login link but was
    not keyboard-focusable, and it hard-wired this shared bar to one page's
    element id. A callback keeps the bar's contract to the page it sits on.
  */
  onOpenFile?: () => void;
  /*
    The brand lockup is mycloove — the single product identity. The old
    "ASTRUM" raster wordmark was retired in the full rollout; see
    /branding/mycloove/README.md.
  */
};

/** Global marketing chrome. Theme control lives in the account Settings modal. */
export default function Topbar2({
  openFileHref,
  onOpenFile,
}: Topbar2Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  /*
    The orange brand-v2 octopus is the product identity on every route this
    shared bar mounts on. The blink/track behaviour is untouched — the orange
    render has the identical frame, so the eye overlay positions still land.
  */

  /*
    The nav index splits by destination kind, because the content genuinely
    does: "/#tools" is a section of the marketing home, while the editors and
    Pricing are separate routes. The anchor earns an in-view state; path links
    earn a path state. The row stays one register of plain labels either way.
  */

  /*
    The bottom hairline of this bar IS the page's scroll rule: a --brand
    segment advances along it in proportion to scroll depth. It replaces the
    old 72px-to-62px height shrink plus drop-shadow, which reflowed the whole
    page at a 1px scroll boundary and carried no information at all.

    Progress is written straight onto the node as a custom property instead of
    being held in state — a useState value here would re-render the header on
    every scroll event of a very long page. setScrolled keeps its boolean
    guard, so React still renders only when the threshold is actually crossed.
  */
  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 12);

      const node = headerRef.current;
      if (!node) return;

      // Short pages (/login) have no scrollable distance. Hold the rule at 0
      // rather than letting a divide-by-zero paint it full width on a page
      // that cannot scroll.
      const distance =
        document.documentElement.scrollHeight - window.innerHeight;
      const progress =
        distance > 24 ? Math.min(1, Math.max(0, y / distance)) : 0;
      node.style.setProperty("--nav-progress", progress.toFixed(4));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  /*
    In-view state for the global "Tools" section. Path links are matched below;
    this observer only owns the one anchor in the global nav. It no-ops when the
    target is absent, so every non-home route can mount the same bar unchanged.
  */
  useEffect(() => {
    if (!ANCHOR_IDS.length || typeof IntersectionObserver === "undefined") return;

    const sections = ANCHOR_IDS
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!sections.length) return;

    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          ratios.set(
            entry.target.id,
            entry.isIntersecting ? entry.intersectionRatio : 0,
          );
        });

        let best = "";
        let bestRatio = 0;
        ratios.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        });
        setActiveSection(best || null);
      },
      // Biased to the upper band so a section reads as current while its
      // heading is near the top of the viewport, not when it first peeks in.
      // The -72px top inset is the bar's own height.
      {
        rootMargin: "-72px 0px -45% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75],
      },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const closeMenu = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setMenuOpen(false);
          menuButtonRef.current?.focus();
        }
        return;
      }

      if (!headerRef.current?.contains(event.target as Node))
        setMenuOpen(false);
    };

    document.addEventListener("keydown", closeMenu);
    document.addEventListener("pointerdown", closeMenu);
    return () => {
      document.removeEventListener("keydown", closeMenu);
      document.removeEventListener("pointerdown", closeMenu);
    };
  }, [menuOpen]);

  /*
    Magnetic + specular primary. The bar's one filled control tracks the cursor
    by a capped offset and lights a sheen where the pointer sits, so "Open a
    file" feels machined rather than flat. It mirrors AnimatedBrandLogo's
    discipline: rAF-eased follow, stop when settled, reset on leave, and a full
    reduced-motion / coarse-pointer bypass. Writes custom properties only, so the
    node animates transform/opacity and never repaints on scroll. No-ops when the
    bar renders neither branch (/login renders the link branch — it still runs).
  */
  useEffect(() => {
    const node = primaryRef.current;
    if (!node) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frameId = 0;
    let active = false;
    const current = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };

    const render = () => {
      current.x += (target.x - current.x) * 0.18;
      current.y += (target.y - current.y) * 0.18;
      node.style.setProperty("--tb-x", `${current.x.toFixed(2)}px`);
      node.style.setProperty("--tb-y", `${current.y.toFixed(2)}px`);

      const settled =
        Math.abs(target.x - current.x) < 0.05 &&
        Math.abs(target.y - current.y) < 0.05;
      if (active || !settled) {
        frameId = requestAnimationFrame(render);
      } else {
        frameId = 0;
      }
    };

    const start = () => {
      if (!frameId) frameId = requestAnimationFrame(render);
    };

    const onMove = (event: PointerEvent) => {
      if (reduceMotion.matches || !finePointer.matches) return;
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      const relX = (event.clientX - bounds.left) / bounds.width;
      const relY = (event.clientY - bounds.top) / bounds.height;
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const cap = 3;

      target.x = Math.max(-cap, Math.min(cap, dx * 0.16));
      target.y = Math.max(-cap, Math.min(cap, dy * 0.16));
      node.style.setProperty("--tb-px", `${(relX * 100).toFixed(1)}%`);
      node.style.setProperty("--tb-py", `${(relY * 100).toFixed(1)}%`);
      active = true;
      start();
    };

    const reset = () => {
      active = false;
      target.x = 0;
      target.y = 0;
      start();
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", reset);
    node.addEventListener("pointercancel", reset);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", reset);
      node.removeEventListener("pointercancel", reset);
    };
  }, []);

  const isActiveLink = (href: string) =>
    href.startsWith("/") && href !== "/" && pathname.startsWith(href);

  /** Current place: by path for routes, by section-in-view for the Tools anchor. */
  const isCurrent = (href: string) => {
    const section = sectionId(href);
    if (section) return pathname === "/" && activeSection === section;
    return isActiveLink(href);
  };

  const openFileIcon = (size: number, strokeWidth: number) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );

  return (
    <header
      ref={headerRef}
      className={`home-topbar${scrolled ? " scrolled" : ""}${menuOpen ? " menu-open" : ""}`}
    >
      {/*
        First focusable element on the page: the bar is sticky and carries five
        index items plus three controls, so keyboard users need a way past it.
        Off-screen until focused, then pinned above the bar (z-index 60 > 50).
      */}
      <a className="home-skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="home-nav-shell">
        <Link
          href="/"
          className="home-brand"
          aria-label="mycloove home"
        >
          <AnimatedBrandLogo
            className="home-animated-brand-logo"
            src="/animated-brand-logo-orange.png"
          />
          <MyclooveWordmark accent="orange" />
        </Link>

        <nav className="home-desktop-nav" aria-label="Primary navigation">
          {GLOBAL_NAV.map((link) => {
            const anchor = Boolean(sectionId(link.href));
            const current = isCurrent(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${anchor ? "is-anchor" : "is-app"}${current ? " active" : ""}`}
                aria-current={
                  current ? (anchor ? "location" : "page") : undefined
                }
              >
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="home-nav-actions">
          {/*
            Left: the primary action. Right: the account control, alone at the
            far edge. The theme toggle moved into the account Settings modal,
            so the utility register now carries only the auth control behind
            the hairline divider.
          */}
          {onOpenFile ? (
            <button
              type="button"
              className="home-open-file"
              ref={(node) => {
                primaryRef.current = node;
              }}
              onClick={onOpenFile}
            >
              {openFileIcon(14, 2.4)}
              <span className="home-open-file-label">Open a file</span>
            </button>
          ) : openFileHref ? (
            <Link
              href={openFileHref}
              className="home-open-file"
              ref={(node) => {
                primaryRef.current = node;
              }}
            >
              {openFileIcon(14, 2.4)}
              <span className="home-open-file-label">Open a file</span>
            </Link>
          ) : null}

          <div className="home-nav-utility">
            <AuthNavButton />
          </div>

          <button
            type="button"
            ref={menuButtonRef}
            className={`home-menu-button${menuOpen ? " open" : ""}`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="home-mobile-nav"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      <div
        id="home-mobile-nav"
        className={`home-mobile-nav${menuOpen ? " open" : ""}`}
        aria-hidden={!menuOpen}
      >
        <nav aria-label="Mobile navigation">
          {GLOBAL_NAV.map((link, i) => {
            const anchor = Boolean(sectionId(link.href));
            const current = isCurrent(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${anchor ? "is-anchor" : "is-app"}${current ? " active" : ""}`}
                onClick={() => setMenuOpen(false)}
                aria-current={
                  current ? (anchor ? "location" : "page") : undefined
                }
                tabIndex={menuOpen ? 0 : -1}
                style={{ animationDelay: menuOpen ? `${i * 45}ms` : "0ms" }}
              >
                <span>{link.label}</span>
                {/* Only links that actually leave the page get the chevron. */}
                {anchor ? null : (
                  <svg
                    className="home-mobile-chevron"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                )}
              </Link>
            );
          })}
        </nav>
        {onOpenFile ? (
          <button
            type="button"
            className="home-mobile-file"
            onClick={() => {
              setMenuOpen(false);
              onOpenFile();
            }}
          >
            {openFileIcon(16, 2.3)}
            Open a file
          </button>
        ) : openFileHref ? (
          <Link
            href={openFileHref}
            className="home-mobile-file"
            onClick={() => setMenuOpen(false)}
          >
            {openFileIcon(16, 2.3)}
            Open a file
          </Link>
        ) : null}
        <AuthNavButton variant="mobile" onNavigate={() => setMenuOpen(false)} />
        <p>Private by design. Files are processed securely.</p>
      </div>
    </header>
  );
}
