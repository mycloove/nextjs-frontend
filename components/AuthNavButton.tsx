"use client";

import ProfileMenu from "@/components/profile/ProfileMenu";
import profileStyles from "@/components/profile/profile.module.css";
import { useAccountViewer, type AccountViewerState } from "@/lib/account/useAccountViewer";
import { useCreditBalance } from "@/lib/usage/useCreditBalance";
import type { CreditBalanceState } from "@/lib/usage/credit-types";

export type AuthNavButtonProps = {
  variant?: "desktop" | "mobile";
  /**
   * Which chrome the control is mounted in. `home` (default) keeps the
   * marketing-nav placeholder while identity resolves; `tool` uses the profile
   * module's placeholder, because tool topbars do not import `home.css`.
   */
  chrome?: "home" | "tool";
  onNavigate?: () => void;
  /** A surface can own identity once for its desktop/mobile controls. */
  accountState?: AccountViewerState;
  /** The same authoritative balance feeds badge, popover and settings. */
  creditState?: CreditBalanceState;
  /** Hides shared balance UI when this tool has credits disabled. */
  creditDisplayToolId?: string;
};

type ResolvedProps = AuthNavButtonProps & {
  accountState: AccountViewerState;
  creditState: CreditBalanceState;
};

function AccountControl({
  variant = "desktop",
  chrome = "home",
  onNavigate,
  accountState,
  creditState,
  creditDisplayToolId,
}: ResolvedProps) {
  const { status, viewer } = accountState;

  if (status === "loading") {
    return (
      <span className={profileStyles.placeholder} role="status" aria-label="Loading account" data-account-chrome={chrome} />
    );
  }

  return (
    <ProfileMenu
      key={viewer?.id ?? "guest"}
      accountId={viewer?.id ?? null}
      accountActive={viewer?.active ?? null}
      email={viewer?.email ?? null}
      role={viewer?.role ?? null}
      name={viewer?.name ?? null}
      avatarUrl={viewer?.avatarUrl ?? null}
      variant={variant}
      onNavigate={onNavigate}
      creditState={creditState}
      creditDisplayToolId={creditDisplayToolId}
      onRefreshAccount={accountState.refresh}
      onSignOut={accountState.signOut}
    />
  );
}

function ResolveCredits(props: AuthNavButtonProps & { accountState: AccountViewerState }) {
  const { status, viewer } = props.accountState;
  const creditState = useCreditBalance(status === "loading" ? null : viewer?.id ?? "guest");
  return <AccountControl {...props} creditState={creditState} />;
}

function ResolveAccount(props: AuthNavButtonProps) {
  const accountState = useAccountViewer();
  return props.creditState
    ? <AccountControl {...props} accountState={accountState} creditState={props.creditState} />
    : <ResolveCredits {...props} accountState={accountState} />;
}

/** Optional parent state avoids duplicate resolvers; existing tool props still work. */
export default function AuthNavButton(props: AuthNavButtonProps) {
  if (!props.accountState) return <ResolveAccount {...props} />;
  if (!props.creditState) return <ResolveCredits {...props} accountState={props.accountState} />;
  return <AccountControl {...props} accountState={props.accountState} creditState={props.creditState} />;
}
