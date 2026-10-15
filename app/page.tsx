import { redirect } from "next/navigation";
import { connection } from "next/server";
import AppShell from "@/components/AppShell";
import { SetupProblem } from "@/components/SetupProblem";
import { pageAuth } from "@/lib/server/auth/page";
import { youtubeConfig } from "@/lib/server/youtube";

/** Whether the "Upload to YouTube" button is offered. A half-finished setup simply leaves it out. */
function youtubeEnabled(): boolean {
  try {
    return youtubeConfig() !== null;
  } catch {
    return false;
  }
}

export default async function Home() {
  // Read at request time so the page reflects the server's current settings.
  await connection();
  const auth = await pageAuth();
  if (auth.state === "misconfigured") return <SetupProblem message={auth.message} />;
  if (auth.state === "signed-out") redirect("/signin");

  // Only a yes/no ever reaches the browser, never the key itself.
  const hasServerKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  return (
    <AppShell
      hasServerKey={hasServerKey}
      user={auth.state === "signed-in" ? auth.user : null}
      youtubeEnabled={auth.state === "signed-in" && youtubeEnabled()}
    />
  );
}
