"use client";

import ProfileMenu from "@/components/profile/ProfileMenu";
import profileStyles from "@/components/profile/profile.module.css";
import { useAccountViewer } from "@/lib/account/useAccountViewer";

type AuthNavButtonProps = {
  variant?: "desktop" | "mobile";
  /**
   * Which chrome the control is mounted in. `home` (default) keeps the
   * marketing-nav placeholder while identity resolves; `tool` uses the profile
   * module's placeholder, because tool topbars do not import `home.css`.
   */
  chrome?: "home" | "tool";
  onNavigate?: () => void;
};

/**
 * The top-right account control. It resolves identity through the shared
 * `useAccountViewer` hook (session + profile), then hands the whole signed-in
 * *and* guest experience to `ProfileMenu`: an avatar chip — the uploaded photo
 * when the owner has one, otherwise the initial of their display name — with a
 * menu for signed-in users, and a placeholder avatar that opens the settings
 * modal for guests (CLAUDE.md: the account store is the single authority on
 * identity).
 */
export default function AuthNavButton({
  variant = "desktop",
  chrome = "home",
  onNavigate,
}: AuthNavButtonProps) {
  const { status, viewer } = useAccountViewer();

  if (status === "loading") {
    if (chrome === "tool") {
      return <span className={profileStyles.placeholder} aria-hidden="true" />;
    }
    return (
      <span
        className={`home-login-btn home-login-btn-placeholder${variant === "mobile" ? " mobile" : ""}`}
        aria-hidden="true"
      />
    );
  }

  return (
    <ProfileMenu
      email={viewer?.email ?? null}
      role={viewer?.role ?? null}
      name={viewer?.name ?? null}
      avatarUrl={viewer?.avatarUrl ?? null}
      variant={variant}
      onNavigate={onNavigate}
    />
  );
}
