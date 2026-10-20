import Link from "next/link";
import { connection } from "next/server";
import { Dashboard } from "@/components/Dashboard";
import { Card, GoogleMark, Shell, buttonClass } from "@/components/ui";
import { SetupError, studioUrl } from "@/lib/config";
import { pageAuth, requestTime } from "@/lib/page";
import { channelsFor, videosFor } from "@/lib/store";

/** Messages for the sign-in problems the return route reports with ?error=. */
const SIGN_IN_ERRORS: Record<string, string> = {
  denied: "Google sign-in was cancelled. To track your videos, sign in and press Allow on Google's screen.",
  failed: "Google's answer could not be checked. Please try again.",
  scopes: "Video Insights needs both permissions on Google's screen (your YouTube channel and its analytics). Please try again and tick both.",
  no_channel: "This Google account has no YouTube channel. Sign in with the account that owns the channel Explainer Studio posts to.",
  not_allowed: "This Google account is not on the list of people allowed to use Video Insights.",
  no_refresh: "Google did not give lasting permission. Please try again.",
  busy: "Too many tries. Please wait a minute and try again.",
};

export default async function Home(props: PageProps<"/">) {
  await connection();
  const { error } = await props.searchParams;
  const auth = await pageAuth();
  const studio = studioUrl();

  if (auth.state === "setup") {
    return (
      <Shell studioUrl={studio}>
        <Card>
          <h1 className="font-display text-2xl font-bold">Video Insights needs setting up</h1>
          <p className="mt-2">{auth.message}</p>
          <p className="mt-2 text-sm text-muted">The README in the insights folder lists every setting and where to find it.</p>
        </Card>
        <Samples />
      </Shell>
    );
  }

  if (auth.state === "signed-out") {
    const message = typeof error === "string" ? SIGN_IN_ERRORS[error] : undefined;
    return (
      <Shell studioUrl={studio}>
        <div className="max-w-3xl">
          <h1 className="font-display text-4xl font-bold leading-tight">Find out why your videos go viral, or don&apos;t</h1>
          <p className="mt-3 text-lg">
            Video Insights watches every video Explainer Studio posts to YouTube. It compares each one with your channel&apos;s usual
            videos and tells you, in plain words, why it is taking off or not, and what to try next.
          </p>
          <ul className="mt-4 space-y-2">
            <li>• A verdict: going viral, above usual, about usual or below usual.</li>
            <li>• The reasons, with the numbers: the first seconds, where people stopped watching, where views came from, who watched.</li>
            <li>• Charts of views over time and how long people kept watching, scene by scene.</li>
          </ul>
          {message && (
            <p role="alert" className="mt-5 rounded-xl border border-bad/40 bg-bad-soft px-4 py-3 font-semibold text-bad-text">
              {message}
            </p>
          )}
          <a href="/api/auth/start" className={`${buttonClass.primary} mt-6`}>
            <span className="rounded-full bg-white p-0.5">
              <GoogleMark />
            </span>
            Sign in with Google
          </a>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Use the Google account that owns your YouTube channel. Video Insights asks only to <strong>read</strong> your channel and its
            analytics. It can never upload, change or delete anything.
          </p>
        </div>
        <Samples />
      </Shell>
    );
  }

  const now = requestTime();
  let data: { channels: Awaited<ReturnType<typeof channelsFor>>; videos: Awaited<ReturnType<typeof videosFor>> } | null = null;
  let problem = "";
  try {
    const [channels, videos] = await Promise.all([channelsFor(auth.user.email), videosFor(auth.user.email)]);
    data = { channels, videos };
  } catch (err) {
    if (!(err instanceof SetupError)) throw err;
    problem = err.message;
  }
  return (
    <Shell user={auth.user} studioUrl={studio}>
      {data ? (
        <Dashboard channels={data.channels} videos={data.videos} now={now} />
      ) : (
        <Card>
          <h1 className="font-display text-2xl font-bold">Video Insights needs setting up</h1>
          <p className="mt-2">{problem}</p>
        </Card>
      )}
    </Shell>
  );
}

function Samples() {
  return (
    <Card className="mt-8">
      <h2 className="font-display text-xl font-bold">See a sample report</h2>
      <p className="mt-1 text-muted">Made-up numbers, real analysis.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Link href="/sample/viral" className={buttonClass.secondary}>
          A video going viral
        </Link>
        <Link href="/sample/slow" className={buttonClass.secondary}>
          A video that isn&apos;t taking off
        </Link>
      </div>
    </Card>
  );
}
