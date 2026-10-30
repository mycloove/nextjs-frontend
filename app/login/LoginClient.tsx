"use client";

import HomeFooter from "@/components/HomeFooter";
import Topbar2 from "@/components/Topbar2";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnRole } from "@/lib/supabase/roles";
import { claimUsageAfterLogin } from "@/lib/usage/useUsageSnapshot";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import "../home.css";
import "./login.css";

type AuthMode = "login" | "register" | "reset";

async function refuseIfTurnedOff(supabase: ReturnType<typeof createClient>) {
  const response = await fetch("/api/account/role", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return false;
  const body = (await response.json()) as { active?: boolean };
  if (body.active !== false) return false;
  await supabase.auth.signOut();
  return true;
}type LoginClientProps = {
  initialMode: AuthMode;
  authError?: string;
  /** The server gate found a signed-in session whose account is turned off. */
  signedInInactive?: boolean;
  /** Landing state from the verify-link redirect served by /auth/verify. */
  verifyNotice?: "verified" | "error" | null;
  signOutOnMount?: boolean;
};

const turnedOffMessage = "This account is turned off.";

/*
  supabase-js reports a transport-level failure as the fetch error's own message,
  so the form used to say "Failed to fetch" (Chrome), "NetworkError when
  attempting to fetch resource." (Firefox) or "Load failed" (Safari). Those read
  like a bug in the form while the real fault is that the auth origin could not
  be reached at all — a wrong or deleted NEXT_PUBLIC_SUPABASE_URL, an offline
  machine, a blocked request, or a paused project. Say what actually happened so
  the next step is obvious.
*/
const unreachableMessage =
  "We could not reach the sign-in service. Check your connection, then try again.";

const transportErrorPatterns = [
  "failed to fetch",
  "networkerror",
  "load failed",
  "network request failed",
];

function describeAuthError(message: string): string {
  const text = message.toLowerCase();
  return transportErrorPatterns.some((pattern) => text.includes(pattern))
    ? unreachableMessage
    : message;
}

/*
  Structural email check, deliberately stricter than type="email" (which accepts
  "a@b" and even "a"): exactly one @, a local part with no stray dots or
  provider-forbidden characters, and a dotted domain that ends in a real-looking
  TLD. The messages name the offending half so the fix is obvious without the
  user counting characters. Returns "" when the address is acceptable.
*/
function emailValidationError(value: string): string {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (/\s/.test(email)) return "Email addresses can't contain spaces.";

  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) {
    return "An email needs one @ with something before it, like you@example.com.";
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) {
    return "Add a domain after the @, like example.com.";
  }
  if (local.length > 64 || email.length > 254) {
    return "That address is too long to be a real email.";
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return "The part before the @ can't start with, end with, or repeat dots.";
  }
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) {
    return "The part before the @ contains a character emails don't allow.";
  }
  if (
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..") ||
    !domain.includes(".")
  ) {
    return "The domain after the @ needs a proper name and ending, like example.com.";
  }
  const labels = domain.split(".");
  if (!/^[A-Za-z0-9-]+$/.test(domain.replace(".", ""))) {
    return "The domain after the @ contains characters that aren't allowed.";
  }
  if (
    labels.some(
      (label) =>
        !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"),
    )
  ) {
    return "That domain doesn't look valid. Check it for typos.";
  }
  if (!/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) {
    return "The domain ending looks wrong — it should read like .com or .org.";
  }
  return "";
}

export default function LoginClient({
  initialMode,
  authError,
  signedInInactive = false,
  verifyNotice = null,
  signOutOnMount = false,
}: LoginClientProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  // Submit handlers run from form events; the ref keeps a double click from
  // launching a second request while the first is in flight.
  const busyRef = useRef(false);
  const [error, setError] = useState(authError ?? "");
  const [notice, setNotice] = useState("");
  const [canResendVerification, setCanResendVerification] = useState(verifyNotice === "error");
  const router = useRouter();

  const isRegister = mode === "register";
  const isReset = mode === "reset";

  const eyebrow = isReset ? "Members" : isRegister ? "New here" : "Members";
  const title = isReset
    ? "Set a new password"
    : isRegister
      ? "Create your account"
      : "Welcome back";
  const subtitle = isReset
    ? "Choose a new password for your account, then sign in with it."
    : isRegister
      ? "Save your workspace and pick up document tasks later."
      : "Sign in to keep your mycloove session across visits.";

  const passwordHint = useMemo(() => {
    if ((!isRegister && !isReset) || password.length === 0) return "";
    if (password.length < 8) return "Use at least 8 characters.";
    return "";
  }, [isRegister, isReset, password]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    // A turned-off session must not linger: clear BOTH identity systems (the
    // custom cookie and any Supabase session a legacy account holds).
    if (!signOutOnMount && !signedInInactive) return;
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    const supabase = createClient();
    void supabase.auth.signOut();
  }, [signOutOnMount, signedInInactive]);

  useEffect(() => {
    if (verifyNotice === "verified") {
      setNotice("Your email is confirmed. Log in with your email and password.");
    } else if (verifyNotice === "error") {
      setError("That confirmation link is invalid or has expired. Enter your email below to request a new verification link.");
      setCanResendVerification(true);
    }
  }, [verifyNotice]);

  const switchMode = (next: AuthMode) => {
    if (next === mode) return;
    setMode(next);
    setError("");
    setNotice("");
    setEmailError("");
    setConfirmPassword("");
    setCanResendVerification(false);
  };

  const onEmailChange = (value: string) => {
    setEmail(value);
    // Keep the message until typing produces a valid address — a flickering
    // error reads as a glitch, a dying one reads as feedback.
    if (emailError && !emailValidationError(value)) setEmailError("");
  };

  const onEmailBlur = () => {
    if (!email.trim()) return;
    setEmailError(emailValidationError(email));
  };

  const onGoogle = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const supabase = createClient();
      // Provider configuration lives in the Supabase dashboard (Auth →
      // Providers → Google); from here the only destination that matters is
      // /auth/callback, which already exchanges codes and refuses turned-off
      // accounts.
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (oauthError) setError(describeAuthError(oauthError.message));
      // On success the browser navigates away to Google; nothing to render.
    } catch {
      setError(unreachableMessage);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hydrated || busyRef.current) return;
    setError("");
    setNotice("");

    // Recovery flow: the user arrived from a reset email and already holds a
    // session, so there is no email field to collect - only a new password.
    if (isReset) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const supabase = createClient();
        const { error: updateError } = await supabase.auth.updateUser({
          password,
        });
        if (updateError) {
          setError(describeAuthError(updateError.message));
          return;
        }
        router.push("/");
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }

    const trimmedEmail = email.trim();

    if (isRegister) {
      // The email check is the hard gate: no account is created for an address
      // that fails the structural check.
      const emailMsg = emailValidationError(trimmedEmail);
      if (emailMsg) {
        setEmailError(emailMsg);
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        // Signup creates a pending account, never a login session. Keep the
        // person on the form and distinguish a mail outage from a sent link.
        const response = await fetch("/api/auth/signup", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: trimmedEmail,
            password,
            display_name: name.trim() || null,
          }),
        });
        const data = (await response.json().catch(() => null)) as
          | { error?: string; mail_sent?: boolean }
          | null;

        if (!response.ok) {
          const message = typeof data?.error === "string" ? data.error : "";
          setError(message ? describeAuthError(message) : "Something went wrong. Please try again.");
          return;
        }

        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setCanResendVerification(true);
        if (data?.mail_sent === true) {
          setNotice(
            `We sent a verification link to ${trimmedEmail}. Check your inbox and spam folder. Verify your email, then log in.`,
          );
        } else {
          setError(
            'Your account was created, but we could not confirm that a verification email was sent. Check your inbox and spam folder. If it is missing, wait a minute and use "Resend verification email". Verify your email before logging in.',
          );
        }
      } catch {
        setError(unreachableMessage);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }

    if (!trimmedEmail || !password) {
      setError("Enter your email and password to continue.");
      return;
    }
    const emailMsg = emailValidationError(trimmedEmail);
    if (emailMsg) {
      setEmailError(emailMsg);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      // Custom login: verifies the scrypt credential in auth_accounts. When
      // the address only exists in Supabase Auth (legacy account), the
      // server bridges it on this same password and provisions the custom
      // row — the next login never touches Supabase again.
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; code?: string; user?: { role?: string } }
        | null;

      if (!response.ok) {
        const message = typeof data?.error === "string" ? data.error : "";
        setError(message ? describeAuthError(message) : "Something went wrong. Please try again.");
        if (data?.code === "email_unverified") setCanResendVerification(true);
        return;
      }

      await claimUsageAfterLogin();
      const role = await fetchOwnRole();
      router.push(role && role !== "User" ? "/admin" : "/");
      router.refresh();
    } catch {
      setError(unreachableMessage);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onForgotPassword = async () => {
    if (busyRef.current) return;
    setError("");
    setNotice("");
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter your email first, then choose "Forgot password?".');
      return;
    }
    const emailMsg = emailValidationError(trimmedEmail);
    if (emailMsg) {
      setEmailError(emailMsg);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        trimmedEmail,
        {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        },
      );
      if (resetError) {
        setError(describeAuthError(resetError.message));
        return;
      }
      // Always the same message whether or not the email exists, so this cannot
      // be used to probe which addresses have accounts.
      setNotice(
        "If that email has an account, a reset link is on its way. Check your inbox and spam folder.",
      );
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onResendVerification = async () => {
    if (busyRef.current) return;
    const trimmedEmail = email.trim();
    const emailMsg = emailValidationError(trimmedEmail);
    if (emailMsg) {
      setEmailError(emailMsg);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/resend", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(typeof data?.error === "string" ? describeAuthError(data.error) : "We could not request a verification link. Try again in a moment.");
        return;
      }
      // The endpoint deliberately hides account existence and throttles recent
      // requests. Acknowledging the request is not proof of email delivery.
      setNotice(
        "Verification requested. If this email has an unverified account, check its inbox and spam folder. Requests less than a minute apart do not send another email.",
      );
    } catch {
      setError(unreachableMessage);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const emailField = (
    <label className={`auth-field${emailError ? " invalid" : ""}`}>
      <span>Email</span>
      <input
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        aria-invalid={emailError ? true : undefined}
        aria-describedby={emailError ? "auth-email-error" : undefined}
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        onBlur={onEmailBlur}
        placeholder="you@example.com"
        disabled={!hydrated || busy}
        required
      />
      {emailError ? (
        <small id="auth-email-error" role="alert">
          {emailError}
        </small>
      ) : null}
    </label>
  );

  return (
    <div className="home-page">
      <Topbar2 openFileHref="/" />

      {/* Target of the bar's skip link; topbar.css keyed off .home-page. */}
      <main className="auth-main" id="main-content" tabIndex={-1}>
        <div className="auth-bg" aria-hidden="true">
          <span className="home-hero-orb orb-1" />
          <span className="home-hero-orb orb-2" />
        </div>

        <section className="auth-card" aria-labelledby="auth-title">
          <aside className="auth-rail">
            <div>
              <p className="auth-rail-mark">mycloove</p>
              <p className="auth-rail-line">
                One desk for every document you convert, edit or read.
              </p>
            </div>
            <ul className="auth-rail-list">
              <li>PDF › Word, Markdown and images</li>
              <li>A surgical PDF text editor</li>
              <li>OCR, Document AI and more</li>
            </ul>
            <p className="auth-rail-foot">
              Your session follows you between visits — purchases, saved work
              and history stay attached to your account.
            </p>
          </aside>

          <div className="auth-panel">
            <p className="auth-eyebrow">
              <span aria-hidden="true">✦</span> {eyebrow}
            </p>
            <h1 id="auth-title">{title}</h1>
            <p className="auth-lede">{subtitle}</p>
            <noscript>
              <p className="auth-alert error">JavaScript is required to sign up or log in.</p>
            </noscript>

            {!isReset ? (
              <>
                <div
                  className="auth-tabs"
                  role="tablist"
                  aria-label="Account options"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!isRegister}
                    className={!isRegister ? "active" : undefined}
                    onClick={() => switchMode("login")}
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isRegister}
                    className={isRegister ? "active" : undefined}
                    onClick={() => switchMode("register")}
                  >
                    Create account
                  </button>
                </div>

                <button
                  type="button"
                  className="auth-google"
                  onClick={onGoogle}
                  disabled={!hydrated || busy}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  {busy ? "Please wait..." : "Continue with Google"}
                </button>
                <p className="auth-divider" aria-hidden="true">
                  <span>or continue with email</span>
                </p>
              </>
            ) : null}

            {/* Never put credentials in a URL if submission precedes hydration. */}
            <form className="auth-form" method="post" onSubmit={onSubmit} noValidate>
              {isRegister ? (
                <label className="auth-field">
                  <span>Full name</span>
                  <input
                    type="text"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name (optional)"
                    maxLength={80}
                    disabled={!hydrated || busy}
                  />
                </label>
              ) : null}

              {!isReset ? emailField : null}

              <label className="auth-field">
                <span>{isReset ? "New password" : "Password"}</span>
                <span className="auth-password-wrap">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete={
                      isRegister || isReset ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={
                      isRegister || isReset
                        ? "At least 8 characters"
                        : "Your password"
                    }
                    minLength={isRegister || isReset ? 8 : undefined}
                    disabled={!hydrated || busy}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((open) => !open)}
                    disabled={!hydrated}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </span>
                {passwordHint ? <small>{passwordHint}</small> : null}
              </label>

              {!isRegister && !isReset ? (
                <button
                  type="button"
                  className="auth-forgot"
                  onClick={onForgotPassword}
                  disabled={!hydrated || busy}
                >
                  Forgot password?
                </button>
              ) : null}

              {(isRegister || isReset) && (
                <label className="auth-field">
                  <span>Confirm password</span>
                  <input
                    type={showPassword ? "text" : "password"}
                    name="confirmPassword"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat your password"
                    disabled={!hydrated || busy}
                    required
                  />
                </label>
              )}

              {error ? (
                <p className="auth-alert error" role="alert">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p className="auth-alert success" role="status">
                  {notice}
                </p>
              ) : null}

              {canResendVerification && !isReset ? (
                <button
                  type="button"
                  className="auth-forgot"
                  onClick={onResendVerification}
                  disabled={!hydrated || busy}
                >
                  Resend verification email
                </button>
              ) : null}

              <button type="submit" className="auth-submit" disabled={!hydrated || busy}>
                {!hydrated
                  ? "Loading form..."
                  : busy
                  ? "Please wait…"
                  : isReset
                    ? "Update password"
                    : isRegister
                      ? "Create account"
                      : "Log in"}
              </button>
            </form>

            {!isReset ? (
              <p className="auth-switch">
                {isRegister ? (
                  <>
                    Already have an account?{" "}
                    <button type="button" onClick={() => switchMode("login")}>
                      Log in
                    </button>
                  </>
                ) : (
                  <>
                    New to mycloove?{" "}
                    <button type="button" onClick={() => switchMode("register")}>
                      Create an account
                    </button>
                  </>
                )}
              </p>
            ) : null}

            <p className="auth-footnote">
              Private by design. Sessions stay on this device until you sign
              out. <Link href="/">Back to tools</Link>
            </p>
          </div>
        </section>
      </main>

      <HomeFooter />
    </div>
  );
}
