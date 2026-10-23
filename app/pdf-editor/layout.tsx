// ─── src/app/pdf-editor/layout.tsx ───────────────────────────
// Minimal layout — no global Navbar (editor is full-screen)

import type { Metadata, Viewport } from 'next';
import ServiceGate from './pdfEdit-components/ServiceGate';

// Metadata stays local to the editor: no imports from another feature or lib.
const description = 'Edit, annotate, and sign PDFs in your browser. Review supported changes and export your document.';
export const metadata: Metadata = {
  title: 'PDF Editor',
  description,
  alternates: { canonical: '/pdf-editor' },
  openGraph: {
    type: 'website',
    siteName: 'mycloove',
    title: 'PDF Editor | mycloove',
    description,
    url: '/pdf-editor',
    locale: 'en_US',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'mycloove document tools' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PDF Editor | mycloove',
    description,
    images: [{ url: '/opengraph-image', alt: 'mycloove document tools' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function PdfEditorLayout({ children }: { children: React.ReactNode }) {
  return <ServiceGate>{children}</ServiceGate>;
}
