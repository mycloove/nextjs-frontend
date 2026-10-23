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
  // IBM Plex Mono is a register decision for this page's console readouts
  // (module-local: the variable mounts on the pricing root only).
  return (
    <PricingClient
      toolCount={TOOL_CATALOG.length}
      monoClass={plexMono.variable}
    />
  );
}
