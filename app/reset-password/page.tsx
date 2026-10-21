import LoginClient from "@/app/login/LoginClient";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

/**
 * Landing page for the password-recovery email link.
 *
 * The recovery link points at `/auth/callback?next=/reset-password`, so by the
 * time this page renders the callback has already exchanged the code for a
 * session. With a session we show the set-a-new-password form; without one the
 * link is stale or was opened in a different browser, so we fall back to the
 * normal sign-in form with an explanation rather than a form that cannot work.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <LoginClient
      initialMode={data.user ? "reset" : "login"}
      authError={
        data.user
          ? undefined
          : "That reset link is invalid or has expired. Enter your email and choose \"Forgot password?\" to get a new one."
      }
    />
  );
}
