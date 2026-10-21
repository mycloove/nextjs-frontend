'use client';

import Link from 'next/link';
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo';
import ThemeToggle2 from '@/components/ThemeToggle2';
import { NAV_LINKS } from '../constants/editorConfig';

interface EditorTopbarProps {
  isDark:          boolean;
  onThemeToggle:   (nextIsDark: boolean) => void;
}

export default function EditorTopbar({ isDark, onThemeToggle }: EditorTopbarProps) {
  return (
    <header className="ie-topbar">
      {/* Left — brand + breadcrumb */}
      <div className="ie-topbar-left">
        <Link href="/" className="ie-brand" aria-label="mycloove home">
          <AnimatedBrandLogo />
        </Link>
        <span className="ie-sep">/</span>
        <span className="ie-bc-root">mycloove</span>
        <span className="ie-sep">/</span>
        <span className="ie-bc-cur">Image Editor</span>
      </div>

      {/* Right — nav links + divider + theme toggle */}
      <div className="ie-topbar-right">
        <nav className="ie-nav-links">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`ie-nav-link ${link.href === '/image-editor' ? 'active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ie-vdivider" />
        <ThemeToggle2 onToggle={onThemeToggle} />
      </div>
    </header>
  );
}
