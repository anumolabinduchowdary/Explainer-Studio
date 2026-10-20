import Image from "next/image";
import Link from "next/link";
import { formatAge, formatAgo, formatCount, formatRatio } from "@/lib/format";
import { readReport, type ChannelRow, type VideoRow } from "@/lib/store";
import { Card, GoogleMark, VerdictChip, buttonClass } from "./ui";

/** The signed-in home page: the connected channels and every video Studio sent. */

export function Dashboard({ channels, videos, now }: { channels: ChannelRow[]; videos: VideoRow[]; now: number }) {
  const channelTitle = new Map(channels.map((channel) => [channel.id, channel.title]));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold leading-tight">Your videos</h1>
        <p className="mt-1 text-muted">
          Every video Explainer Studio posts to {channels.length === 1 ? "this channel" : "these channels"} is checked here for four
          weeks: often at first, then daily.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {channels.map((channel) => (
          <li key={channel.id}>
            <ChannelCard channel={channel} />
          </li>
        ))}
      </ul>

      {videos.length === 0 ? (
        <Card>
          <h2 className="font-display text-xl font-bold">No videos yet</h2>
          <p className="mt-1 max-w-2xl">
            When you post a video to YouTube from Explainer Studio, it appears here within a few minutes, with a first report after a few
            hours and a full one after 2–3 days.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {videos.map((video) => (
            <li key={video.id}>
              <VideoCard video={video} now={now} channel={channels.length > 1 ? channelTitle.get(video.channel_id) : undefined} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChannelCard({ channel }: { channel: ChannelRow }) {
  return (
    <Card as="div" className="!p-4">
      <div className="flex items-center gap-3">
        {channel.thumbnail ? (
          <Image src={channel.thumbnail} alt="" width={40} height={40} className="size-10 rounded-full" />
        ) : (
          <span className="size-10 rounded-full bg-surface-2" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{channel.title || "Your channel"}</p>
          <p className={`text-sm ${channel.status === "ok" ? "text-good-text" : "text-bad-text"}`}>
            {channel.status === "ok" ? "Connected: videos are being watched" : "Paused: Google's permission ran out"}
          </p>
        </div>
      </div>
      {channel.status !== "ok" && (
        <a href="/api/auth/start" className={`${buttonClass.primary} mt-3 w-full`}>
          <span className="rounded-full bg-white p-0.5">
            <GoogleMark />
          </span>
          Sign in again to continue
        </a>
      )}
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 items-center font-semibold text-muted">Disconnect this channel…</summary>
        <p className="mt-1">
          Video Insights stops watching this channel, withdraws its permission at Google and deletes everything it saved about the
          channel and its videos. This cannot be undone.
        </p>
        <form method="post" action="/api/channel/disconnect" className="mt-2">
          <input type="hidden" name="channel" value={channel.id} />
          <button type="submit" className={buttonClass.danger}>
            Disconnect and delete
          </button>
        </form>
      </details>
    </Card>
  );
}

function VideoCard({ video, now, channel }: { video: VideoRow; now: number; channel?: string }) {
  const report = readReport(video);
  const published = video.published_at ?? video.added_at;
  const age = (now - published) / 3_600_000;
  return (
    <Link
      href={`/videos/${video.id}`}
      className="group flex h-full gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm transition-colors hover:border-brand"
    >
      {video.thumbnail ? (
        <Image src={video.thumbnail} alt="" width={160} height={90} className="aspect-video w-28 shrink-0 rounded-lg object-cover sm:w-36" />
      ) : (
        <span className="aspect-video w-28 shrink-0 rounded-lg bg-surface-2 sm:w-36" aria-hidden="true" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="line-clamp-2 font-semibold leading-snug group-hover:text-brand-strong">{video.title || "New video"}</p>
        <p className="text-xs text-muted">
          {channel ? `${channel} · ` : ""}
          {video.published_at ? `posted ${formatAge(age)} ago` : `sent from Studio ${formatAgo(video.added_at, now)}`}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {video.state === "gone" ? (
            <span className="text-sm font-semibold text-muted">No longer on YouTube</span>
          ) : video.verdict ? (
            <VerdictChip verdict={video.verdict} />
          ) : (
            <span className="text-sm text-muted">First check in a few minutes</span>
          )}
          {video.views !== null && (
            <span className="tabular text-sm">
              <strong>{formatCount(video.views)}</strong> views
              {video.ratio !== null && <span className="text-muted"> · {formatRatio(video.ratio)} usual</span>}
            </span>
          )}
        </div>
        {report && <Sparkline views={report.analysis.charts.views} usual={report.analysis.charts.usual} />}
      </div>
    </Link>
  );
}

/** A small line of this video's views (blue) against the usual (grey). */
function Sparkline({ views, usual }: { views: Array<[number, number]>; usual: Array<[number, number, number, number]> }) {
  if (views.length < 2) return null;
  const width = 160;
  const height = 28;
  const xMax = Math.max(1, views[views.length - 1][0]);
  const yMax = Math.max(1, ...views.map(([, v]) => v), ...usual.filter(([h]) => h <= xMax).map(([, m]) => m));
  const line = (points: Array<[number, number]>) =>
    points
      .filter(([x]) => x <= xMax)
      .map(([x, y], i) => `${i ? "L" : "M"}${((x / xMax) * (width - 4) + 2).toFixed(1)},${(height - 2 - (y / yMax) * (height - 4)).toFixed(1)}`)
      .join("");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full" aria-hidden="true">
      {usual.length > 1 && <path d={line(usual.map(([h, m]) => [h, m]))} fill="none" stroke="var(--series-usual)" strokeWidth="1.5" />}
      <path d={line(views)} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
