import ToolRouteGate from "@/components/tools/ToolRouteGate";
import { pageMetadata } from "@/lib/metadata";
import "./styles/premium-shell.css";

export const metadata = pageMetadata(
  "/document-ai",
  "Document AI: Chat with Your Documents",
  "Ask questions about an uploaded document and inspect retrieved excerpts. AI answers can be wrong; compare important details with the original document.",
);

/**
 * Document AI shell.
 *
 * The premium shell is fully self-contained under the `.doc-ai-shell` class.
 * Google fonts are loaded via <link> so we don't need to touch project-wide
 * font pipeline. Everything else lives inside `styles/premium-shell.css`.
 */
export default function DocumentAILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
      />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <ToolRouteGate toolId="document-ai" label="Document AI">
        {children}
      </ToolRouteGate>
    </>
  );
}
