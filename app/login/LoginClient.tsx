"use client";

import HomeFooter from "@/components/HomeFooter";
import Topbar2 from "@/components/Topbar2";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnRole } from "@/lib/supabase/roles";
import { claimUsageAfterLogin } from "@/lib/usage/useUsageSnapshot";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardEvent as ReactClipboardEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../home.css";
import "./login.css";

type AuthMode = "login" | "register" | "reset";
/* Register is a two-step intake: account details first, then a 6-digit code
   emailed to the address from step 1 (signInWithOtp → verifyOtp). The password
   collected in step 1 is applied once the account actually exists. */
type RegisterStep = "details" | "code";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

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
}

type LoginClientProps = {
  initialMode: AuthMode;
  authError?: string;
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
  signOutOnMount = false,
}: LoginClientProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [registerStep, setRegisterStep] = useState<RegisterStep>("details");
  const [pendingCodeEmail, setPendingCodeEmail] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // Auto-submit on the sixth OTP digit fires from input events; the ref keeps a
  // double keypress from launching a second verification while the first runs.
  const busyRef = useRef(false);
  const [error, setError] = useState(authError ?? "");
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [resendIn, setResendIn] = useState(0);
  const [pendingContinue, setPendingContinue] = useState(false);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const router = useRouter();

  const isRegister = mode === "register";
  const isReset = mode === "reset";
  const isVerify = isRegister && registerStep === "code";

  const eyebrow = isReset
    ? "Members"
    : isVerify
      ? "One step to go"
      : isRegister
        ? "New here"
        : "Members";
  const title = isReset
    ? "Set a new password"
    : isVerify
      ? "Verify your email"
      : isRegister
        ? "Create your account"
        : "Welcome back";
  const subtitle = isReset
    ? "Choose a new password for your account, then sign in with it."
    : isVerify
      ? "Six digits are on their way to your inbox."
      : isRegister
        ? "Save your workspace and pick up document tasks later."
        : "Sign in to keep your mycloove session across visits.";

  const passwordHint = useMemo(() => {
    if ((!isRegister && !isReset) || password.length === 0) return "";
    if (password.length < 8) return "Use at least 8 characters.";
    return "";
  }, [isRegister, isReset, password]);

  useEffect(() => {
    if (!signOutOnMount) return;
    const supabase = createClient();
    void supabase.auth.signOut();
  }, [signOutOnMount]);

  // A one-second-at-a-time chain keeps the countdown and its cleanup simple.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // Landing on the code step should land the caret in the first box.
  useEffect(() => {
    if (!isVerify) return;
    codeRefs.current[0]?.focus();
  }, [isVerify]);

  const switchMode = (next: AuthMode) => {
    if (next === mode) return;
    setMode(next);
    setRegisterStep("details");
    setPendingCodeEmail("");
    setCode(Array(CODE_LENGTH).fill(""));
    setResendIn(0);
    setPendingContinue(false);
    setError("");
    setNotice("");
    setEmailError("");
    setConfirmPassword("");
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

  const backToDetails = () => {
    setRegisterStep("details");
    setPendingCodeEmail("");
    setCode(Array(CODE_LENGTH).fill(""));
    setResendIn(0);
    setPendingContinue(false);
    setError("");
    setNotice("");
  };

  const finishAfterSignIn = async (
    supabase: ReturnType<typeof createClient>,
  ) => {
    if (await refuseIfTurnedOff(supabase)) {
      setError(turnedOffMessage);
      return;
    }
    await claimUsageAfterLogin();
    const role = await fetchOwnRole();
    router.push(role && role !== "User" ? "/admin" : "/");
    router.refresh();
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

  const verifyCode = async (digits: string[]) => {
    if (busyRef.current) return;
    const token = digits.join("");
    if (token.length !== CODE_LENGTH) {
      setError("Type all six digits of the code, then continue.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    const supabase = createClient();
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: pendingCodeEmail,
        token,
        type: "email",
      });
      if (verifyError) {
        setError(describeAuthError(verifyError.message));
        return;
      }

      // Step 1 collected a password; apply it now that the account exists so
      // the next visit can use the password form. If it fails the session is
      // still live and a password can be added later — say so and stay put
      // rather than silently dropping the user on the home page.
      if (password.length >= 8) {
        const { error: updateError } = await supabase.auth.updateUser({
          password,
        });
        if (updateError) {
          setNotice(
            "Your email is verified, but your password could not be saved. Continue in and add one under Settings.",
          );
          setPendingContinue(true);
          setConfirmPassword("");
          return;
        }
        setPassword("");
        setConfirmPassword("");
      }
      await finishAfterSignIn(supabase);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const continueAfterVerify = async (
    supabase: ReturnType<typeof createClient>,
  ) => {
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await finishAfterSignIn(supabase);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (busyRef.current || resendIn > 0) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: pendingCodeEmail,
        options: { shouldCreateUser: true },
      });
      if (otpError) {
        setError(describeAuthError(otpError.message));
        return;
      }
      setResendIn(RESEND_SECONDS);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const setDigit = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);
    if (digit && index < CODE_LENGTH - 1) {
      codeRefs.current[index + 1]?.focus();
    }
    if (next.every(Boolean)) void verifyCode(next);
  };

  const onCodeKeyDown = (
    index: number,
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Backspace" && !code[index] && index > 0) {
      event.preventDefault();
      const next = [...code];
      next[index - 1] = "";
      setCode(next);
      codeRefs.current[index - 1]?.focus();
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      codeRefs.current[index - 1]?.focus();
      return;
    }
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      event.preventDefault();
      codeRefs.current[index + 1]?.focus();
    }
  };

  const onCodePaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, CODE_LENGTH)
      .split("");
    if (!digits.length) return;
    const next = Array<string>(CODE_LENGTH).fill("");
    digits.forEach((digit, index) => {
      next[index] = digit;
    });
    setCode(next);
    codeRefs.current[Math.min(digits.length, CODE_LENGTH - 1)]?.focus();
    if (next.every(Boolean)) void verifyCode(next);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const supabase = createClient();

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

    if (isVerify) {
      if (pendingContinue) {
        await continueAfterVerify(supabase);
        return;
      }
      await verifyCode(code);
      return;
    }

    const trimmedEmail = email.trim();

    if (isRegister) {
      // Step 1: details. The email check is the hard gate the request asked
      // for — no code is sent to an address that fails the structural check.
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
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: trimmedEmail,
          options: {
            shouldCreateUser: true,
            // The display name rides along in user metadata; /auth/callback
            // records it (and a provider photo) where the row is still empty.
            data: { display_name: name.trim() || undefined },
          },
        });
        if (otpError) {
          setError(describeAuthError(otpError.message));
          return;
        }
        setPendingCodeEmail(trimmedEmail);
        setRegisterStep("code");
        setCode(Array(CODE_LENGTH).fill(""));
        setResendIn(RESEND_SECONDS);
      } catch {
        setError("Something went wrong. Please try again.");
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
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (signInError) {
        setError(describeAuthError(signInError.message));
        return;
      }
      await finishAfterSignIn(supabase);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onForgotPassword = async () => {
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
            <p className="auth-lede">
              {isVerify ? (
                <>
                  Six digits are heading to{" "}
                  <strong className="auth-verify-email">
                    {pendingCodeEmail}
                  </strong>
                  . Type them below to finish creating your account.
                </>
              ) : (
                subtitle
              )}
            </p>

            {!isReset && !isVerify ? (
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
                  disabled={busy}
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
                  {busy ? "Opening Google…" : "Continue with Google"}
                </button>
                <p className="auth-divider" aria-hidden="true">
                  <span>or continue with email</span>
                </p>
              </>
            ) : null}

            {isVerify ? (
              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (pendingContinue) void continueAfterVerify(createClient());
                  else void verifyCode(code);
                }}
                noValidate
              >
                <span className="auth-otp" aria-label="6-digit verification code">
                  {code.map((digit, index) => (
                    <input
                      key={index}
                      ref={(node) => {
                        codeRefs.current[index] = node;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      maxLength={1}
                      aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
                      value={digit}
                      disabled={busy || pendingContinue}
                      onChange={(event) => setDigit(index, event.target.value)}
                      onKeyDown={(event) => onCodeKeyDown(index, event)}
                      onPaste={onCodePaste}
                    />
                  ))}
                </span>

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

                <button type="submit" className="auth-submit" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : pendingContinue
                      ? "Continue"
                      : "Verify code"}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={onSubmit} noValidate>
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
                      required
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowPassword((open) => !open)}
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
                    disabled={busy}
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

                <button type="submit" className="auth-submit" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : isReset
                      ? "Update password"
                      : isRegister
                        ? "Send verification code"
                        : "Log in"}
                </button>
              </form>
            )}

            {isVerify ? (
              <>
                <div className="auth-resend">
                  <span>Didn&apos;t get the code?</span>
                  <button
                    type="button"
                    onClick={onResend}
                    disabled={busy || resendIn > 0}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                  </button>
                </div>
                <p className="auth-verify-fallback">
                  The same email also carries a sign-in link — open it on this
                  device if you&apos;d rather not type the code.
                </p>
                <button
                  type="button"
                  className="auth-forgot"
                  onClick={backToDetails}
                  disabled={busy}
                >
                  Use a different email
                </button>
              </>
            ) : null}

            {!isReset && !isVerify ? (
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
