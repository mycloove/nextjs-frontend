import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";

import { TOOL_CATALOG } from "@/lib/usage/catalog";

import PricingClient from "./PricingClient";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--pr-font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { absolute: "Pricing — mycloove" },
  description:
    "Every mycloove tool is free within a fair allowance — no card and no account to start. A higher-limit Pro plan is planned, and it is not for sale.",
};

export default function PricingPage() {
  // Pre-derived from the catalog: the tool count, and the guest/member
  // COMPARISON only (member > guest), so the page can pick truthful wording
  // ("raised allowance" vs "same"). No cap value is passed down or rendered —
  // the pricing page never quotes the allowance; each tool's meter does.
  const guestLimit = Math.min(...TOOL_CATALOG.map((tool) => tool.guest_limit));
  const memberLimit = Math.min(...TOOL_CATALOG.map((tool) => tool.member_limit));

  // IBM Plex Mono is a register decision for this page's console readouts
  // (module-local: the variable mounts on the pricing root only).
  return (
    <PricingClient
      toolCount={TOOL_CATALOG.length}
      guestLimit={guestLimit}
      memberLimit={memberLimit}
      monoClass={plexMono.variable}
    />
  );
}
