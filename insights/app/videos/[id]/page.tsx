import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CheckNow } from "@/components/CheckNow";
import { ReportView, type HistoryLink } from "@/components/Report";
import { Card, GoogleMark, Shell, buttonClass } from "@/components/ui";
import { formatAgo, formatDate } from "@/lib/format";
import { REFRESH_ON_VIEW } from "@/lib/monitor";
import { pageAuth, requestTime, studioUrl } from "@/lib/page";
import { canSee, getVideo, milestonesFor, readReport } from "@/lib/store";
import { MILESTONES } from "@/lib/types";

export const metadata: Metadata = { title: "Video report" };

function SignInCard({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <Card>
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="mt-2 max-w-2xl">{text}</p>
      <a href={`/api/auth/start?next=${encodeURIComponent(`/videos/${id}`)}`} className={`${buttonClass.primary} mt-4`}>
        <span className="rounded-full bg-white p-0.5">
          <GoogleMark />
        </span>
        Sign in with Google
      </a>
    </Card>
  );
}

export default async function VideoPage(props: PageProps<"/videos/[id]">) {
  await connection();
  const { id } = await props.params;
  const { m } = await props.searchParams;
  if (!/^[\w-]{6,20}$/.test(id)) notFound();
  const auth = await pageAuth();
  const studio = studioUrl();

  if (auth.state === "setup") {
    return (
      <Shell studioUrl={studio}>
        <Card>
          <h1 className="font-display text-2xl font-bold">Video Insights needs setting up</h1>
          <p className="mt-2">{auth.message}</p>
        </Card>
      </Shell>
    );
  }
  if (auth.state === "signed-out") {
    return (
      <Shell studioUrl={studio}>
        <SignInCard
          id={id}
          title="Sign in to see this report"
          text="Use the Google account that owns the YouTube channel. Video Insights only reads your channel's numbers; it can never upload, change or delete anything."
        />
      </Shell>
    );
  }

  const video = await getVideo(id);
  const back = (
    <p className="mb-4 text-sm">
      <Link href="/" className="font-semibold text-brand-strong underline-offset-2 hover:underline">
        ← All your videos
      </Link>
    </p>
  );
  if (!video) {
    return (
      <Shell user={auth.user} studioUrl={studio}>
        {back}
        <Card>
          <h1 className="font-display text-2xl font-bold">This video isn&apos;t tracked yet</h1>
          <p className="mt-2 max-w-2xl">
            Videos appear here when Explainer Studio posts them to YouTube. If you just posted it, wait a minute and reload this page.
          </p>
        </Card>
      </Shell>
    );
  }
  if (!(await canSee(auth.user.email, video.channel_id))) {
    return (
      <Shell user={auth.user} studioUrl={studio}>
        {back}
        <SignInCard
          id={id}
          title="This video is on a channel you haven't connected"
          text="Sign in with the Google account that owns the channel this video was posted to. Its videos start being tracked straight away."
        />
      </Shell>
    );
  }

  const now = requestTime();
  const latest = readReport(video);
  const saved = await milestonesFor(id);
  const chosen = saved.find((item) => item.milestone === m);
  const report = chosen?.report ?? latest;

  const history: HistoryLink[] =
    saved.length > 0
      ? [
          { label: video.state === "finished" ? "Final" : "Latest", href: `/videos/${id}`, current: !chosen },
          ...saved.map((item) => ({
            label: MILESTONES.find((milestone) => milestone.id === item.milestone)?.label ?? item.milestone,
            href: `/videos/${id}?m=${item.milestone}`,
            current: chosen?.milestone === item.milestone,
          })),
        ]
      : [];

  const tracking = video.state === "tracking";
  const stale = tracking && !chosen && now - (video.last_check_at ?? 0) > REFRESH_ON_VIEW;
  let checkedLabel = video.last_check_at ? `Checked ${formatAgo(video.last_check_at, now)}` : "Not checked yet";
  if (video.state === "finished") checkedLabel = "Final report: the video was watched for four weeks.";
  if (video.state === "gone") checkedLabel = "YouTube no longer shows this video, so it is not checked any more.";
  const checkSlot = chosen ? null : <CheckNow videoId={id} checkedLabel={checkedLabel} stale={stale} canCheck={tracking} />;

  return (
    <Shell user={auth.user} studioUrl={studio}>
      {back}
      {report ? (
        <ReportView
          report={report}
          now={now}
          checkSlot={checkSlot}
          history={history}
          milestoneNote={chosen ? `This is the report saved on ${formatDate(chosen.created_at)}, as it was then.` : undefined}
        />
      ) : (
        <Card>
          <h1 className="font-display text-2xl font-bold">{video.title || "New video"}</h1>
          <p className="mt-2 max-w-2xl">
            {video.state === "waiting"
              ? "This channel isn't connected yet, so the video can't be checked."
              : "The first check is on its way. YouTube takes a few minutes to process a new upload; the first comparison with your usual videos comes after about 6 hours."}
          </p>
          {checkSlot}
        </Card>
      )}
    </Shell>
  );
}
