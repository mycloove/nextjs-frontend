import { IBM_Plex_Mono, Syne } from "next/font/google";
import { pageMetadata } from "@/lib/metadata";

import { TOOL_CATALOG } from "@/lib/usage/catalog";

import PricingClient from "./PricingClient";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--pr-font-mono",
  display: "swap",
});

const displayFont = Syne({
  subsets: ["latin"],
  variable: "--pr-font-display",
  display: "swap",
});

export const metadata = pageMetadata(
  "/pricing",
  "Pricing",
  "Use mycloove tools within the current free-use allowance. Review action costs and account requirements in each workspace. A Pro plan is planned, not for sale.",
);

export default function PricingPage() {
  // Self-host the house display face and readout font on this route only.
  return (
    <PricingClient
      toolCount={TOOL_CATALOG.length}
      fontClass={`${plexMono.variable} ${displayFont.variable}`}
    />
  );
}
