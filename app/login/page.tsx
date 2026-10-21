import LoginClient from "@/app/login/LoginClient";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileRecord, readAccountStatus } from "@/lib/usage/store";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Log in",
  description:
    "Sign in or create a mycloove account with Google, or with email and password.",
  robots: { index: false, follow: false },
};

type LoginPageProps = {
  searchParams: Promise<{ mode?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  let turnedOff = params.error === "inactive";

  if (data.user) {
    let destination = "/";
    try {
      await ensureProfileRecord(data.user.id, data.user.email ?? null);
      const status = await readAccountStatus(data.user.id);
      turnedOff = !status.active;
      if (status.active && status.role !== "User") destination = "/admin";
    } catch {
      destination = "/";
    }
    if (!turnedOff) redirect(destination);
  }

  return (
    <LoginClient
      initialMode={params.mode === "register" ? "register" : "login"}
      signOutOnMount={turnedOff}
      authError={
        turnedOff
          ? "This account is turned off."
          : params.error === "auth"
            ? "That confirmation link is invalid or has expired. Try signing in again."
            : undefined
      }
    />
  );
}
