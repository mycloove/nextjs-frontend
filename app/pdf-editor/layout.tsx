// ─── src/app/pdf-editor/layout.tsx ───────────────────────────
// Minimal layout — no global Navbar (editor is full-screen)

import type { Viewport } from 'next';
import ServiceGate from './pdfEdit-components/ServiceGate';

export const metadata = {
  title:       'PDF Editor — mycloove',
  description: 'Edit, annotate and sign PDFs directly in your browser. Free.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function PdfEditorLayout({ children }: { children: React.ReactNode }) {
  return <ServiceGate>{children}</ServiceGate>;
}