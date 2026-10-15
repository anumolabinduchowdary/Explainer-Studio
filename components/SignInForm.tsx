"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import { OTP_LENGTH, OTP_MINUTES, OkResponseSchema } from "@/lib/auth";
import { ERROR_COPY, type ErrorInfo } from "@/lib/errors";
import { Button, Card, inputClass } from "./ui";

type Props = {
  /** The ways of signing in that are set up on the server. */
  methods: { google: boolean; email: boolean };
  /** A message to show straight away, e.g. after Google sign-in did not finish. */
  problem?: string;
};

/** Seconds to wait before another code can be asked for. */
const RESEND_WAIT_SEC = 30;

/** Sign in with Google, or with a 6-digit code sent by email. */
export function SignInForm({ methods, problem }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "send" | "check">(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [notice, setNotice] = useState(problem ?? "");
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Counts down to when "Send a new code" can be pressed again.
  const waiting = resendIn > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setResendIn((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const sendCode = async () => {
    setBusy("send");
    setError(null);
    setNotice("");
    try {
      await postJson("/api/auth/email/start", { email }, OkResponseSchema, { timeoutMs: 30_000 });
      setCode("");
      setStep("code");
      setResendIn(RESEND_WAIT_SEC);
      // Wait for the code box to appear before moving to it.
      requestAnimationFrame(() => codeRef.current?.focus());
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
    }
  };

  const checkCode = async () => {
    setBusy("check");
    setError(null);
    try {
      await postJson("/api/auth/email/verify", { code }, OkResponseSchema, { timeoutMs: 30_000 });
      // The server now sees the session cookie, so the app opens instead of this page.
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(toErrorInfo(err));
      setBusy(null);
      codeRef.current?.focus();
      codeRef.current?.select();
    }
  };

  const nothingSetUp = !methods.google && !methods.email;

  return (
    <Card className="mt-6">
      <h1 className="font-display text-2xl font-bold">
        {step === "code" ? "Check your email" : "Sign in"}
      </h1>

      {notice && step === "start" && (
        <p className="mt-3 rounded-xl bg-sun-soft px-3 py-2" role="alert">
          {notice}
        </p>
      )}

      {nothingSetUp && (
        <p className="mt-3" role="alert">
          Sign-in is switched on, but no way of signing in has been set up yet. The person who
          runs this app needs to add the Google or email settings on the server.
        </p>
      )}

      {step === "start" && (
        <>
          {methods.google && (
            <a
              href="/api/auth/google"
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface px-5 font-semibold text-ink shadow-sm transition-colors duration-200 hover:border-brand hover:text-brand-strong"
            >
              <GoogleMark />
              Continue with Google
            </a>
          )}

          {methods.google && methods.email && (
            <p className="my-4 flex items-center gap-3 text-sm text-muted" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </p>
          )}

          {methods.email && (
            <form
              className={methods.google ? "" : "mt-4"}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void sendCode();
              }}
            >
              <label htmlFor="signin-email" className="mb-1 block font-semibold">
                Email address
              </label>
              <input
                id="signin-email"
                ref={emailRef}
                type="email"
                name="email"
                value={email}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={254}
                aria-describedby="signin-email-hint"
                onChange={(event) => setEmail(event.target.value)}
                className={`${inputClass} min-h-12`}
              />
              <p id="signin-email-hint" className="mt-1 text-sm text-muted">
                We&apos;ll email you a {OTP_LENGTH}-digit code. There is no password to remember.
              </p>
              <Button variant="primary" type="submit" loading={busy === "send"} className="mt-3 min-h-12 w-full">
                {busy === "send" ? "Sending the code…" : "Email me a code"}
              </Button>
            </form>
          )}
        </>
      )}

      {step === "code" && (
        <form
          className="mt-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void checkCode();
          }}
        >
          <p id="signin-code-hint" className="text-muted">
            If <span className="break-all font-semibold text-ink">{email.trim()}</span> can use this
            app, a {OTP_LENGTH}-digit code is on its way. It works for {OTP_MINUTES} minutes.
          </p>
          <label htmlFor="signin-code" className="mb-1 mt-4 block font-semibold">
            Code from the email
          </label>
          <input
            id="signin-code"
            ref={codeRef}
            type="text"
            name="code"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={OTP_LENGTH}
            required
            aria-describedby="signin-code-hint"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
            className={`${inputClass} min-h-14 text-center font-display text-3xl font-bold tracking-[0.4em]`}
          />
          <Button
            variant="primary"
            type="submit"
            loading={busy === "check"}
            disabled={code.length !== OTP_LENGTH}
            className="mt-3 min-h-12 w-full"
          >
            {busy === "check" ? "Signing you in…" : "Sign in"}
          </Button>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button compact disabled={waiting || busy !== null} loading={busy === "send"} onClick={() => void sendCode()}>
              {waiting ? `Send a new code (${resendIn}s)` : "Send a new code"}
            </Button>
            <Button
              compact
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setStep("start");
                setError(null);
                setCode("");
                requestAnimationFrame(() => emailRef.current?.focus());
              }}
            >
              Use a different email
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted">
            No email? Check the spam folder and the spelling of the address. If it still does not
            arrive, your address may not be approved for this app yet.
          </p>
        </form>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2" role="alert">
          <p className="font-bold text-danger">{ERROR_COPY[error.code].title}</p>
          <p>
            {error.message}
            {error.retryAfterSec ? ` You can try again in about ${error.retryAfterSec} seconds.` : ""}
          </p>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {busy === "send" ? "Sending the code." : ""}
        {busy === "check" ? "Checking the code." : ""}
      </p>
    </Card>
  );
}

/** Google's "G" mark, as its sign-in branding guidelines ask for on this button. */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5 2.3-8.7 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
