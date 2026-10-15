import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SetupProblem } from "@/components/SetupProblem";
import { SignInForm } from "@/components/SignInForm";
import { Logo } from "@/components/ui";
import { SIGN_IN_ERRORS } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { pageAuth } from "@/lib/server/auth/page";

export const metadata: Metadata = { title: `Sign in to ${APP_NAME}` };

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

export default async function SignInPage({ searchParams }: Props) {
  await connection();
  const auth = await pageAuth();
  if (auth.state === "misconfigured") return <SetupProblem message={auth.message} />;
  // Nothing to do here when sign-in is off or the visitor is already signed in.
  if (auth.state !== "signed-out") redirect("/");

  const { error } = await searchParams;
  // Only our own fixed messages are ever shown, never text taken from the address bar.
  const problem = typeof error === "string" ? SIGN_IN_ERRORS[error] : undefined;

  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <p className="flex items-center justify-center gap-2 font-display text-2xl font-bold">
        <Logo />
        {APP_NAME}
      </p>
      <SignInForm methods={auth.methods} problem={problem} />
    </main>
  );
}
