"use client";

import SiteHeader from "@/components/site-header/SiteHeader";
import { GLOBAL_NAV } from "@/components/site-header/siteNav";
import { useAccountViewer } from "@/lib/account/useAccountViewer";
import { useCreditBalance } from "@/lib/usage/useCreditBalance";

type Topbar2Props = {
  openFileHref?: string;
  /*
    Home passes this instead of openFileHref: its file input lives in the hero
    upload pane, so the header action is a real <button> that triggers it. A
    callback keeps the bar's contract to the page it sits on.
  */
  onOpenFile?: () => void;
};

/**
 * Global marketing chrome: the site header with the five global destinations
 * and the "Open a file" action. The bar itself (design, motion, keyboard) is
 * components/site-header/SiteHeader, shared with tool pages and editor entry
 * screens. Theme control lives in the account Settings modal.
 */
export default function Topbar2({ openFileHref, onOpenFile }: Topbar2Props) {
  const accountState = useAccountViewer();
  const creditState = useCreditBalance(accountState.status === "loading" ? null : accountState.viewer?.id ?? "guest");
  const primaryAction = onOpenFile
    ? { label: "Open a file", onClick: onOpenFile }
    : openFileHref
      ? { label: "Open a file", href: openFileHref }
      : undefined;

  return (
    <SiteHeader
      accountState={accountState}
      creditState={creditState}
      links={GLOBAL_NAV}
      primaryAction={primaryAction}
      sheetNote="Private by design. Files are processed securely."
    />
  );
}
