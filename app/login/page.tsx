import LoginClient from "@/app/login/LoginClient";
import { currentSessionUser } from "@/lib/auth/current-user";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Log in",
  description:
    "Sign in or create a mycloove account with Google, or with email and password.",
  robots: { index: false, follow: false },
};

type LoginPageProps = {
  searchParams: Promise<{ mode?: string; error?: string; verified?: string; verify?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  // One gate for both identity systems: the custom account session (cookie)
  // and the Supabase bridge are unified inside currentSessionUser. A signed-in
  // visitor lands in the product (admins go to the bench) instead of seeing
  // the form again.
  const user = await currentSessionUser();

  let turnedOff = params.error === "inactive";
  if (user) {
    turnedOff = !user.active;
  }

  // A verification link must land on the form, even if this browser also
  // holds a separate Google/legacy session. Confirmation is not a login.
  const verificationLanding = params.verified === "1" || params.verify === "error";
  if (user && !turnedOff && !verificationLanding) {
    redirect(user.role !== "User" ? "/admin" : "/");
  }

  return (
    <LoginClient
      initialMode={params.mode === "register" ? "register" : "login"}
      signedInInactive={Boolean(user) && turnedOff}
      verifyNotice={
        params.verified === "1"
          ? "verified"
          : params.verify === "error"
            ? "error"
            : null
      }
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
