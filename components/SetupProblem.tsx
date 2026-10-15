import { APP_NAME } from "@/lib/config";
import { Card } from "./ui";

/** Shown instead of the app when a sign-in setting is missing on the server. */
export function SetupProblem({ message }: { message: string }) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <Card>
        <h1 className="font-display text-2xl font-bold">{APP_NAME} isn&apos;t fully set up</h1>
        <p className="mt-2" role="alert">
          {message}
        </p>
        <p className="mt-2 text-muted">
          The app stays closed until this is fixed, so nobody can use it without signing in.
        </p>
      </Card>
    </main>
  );
}
