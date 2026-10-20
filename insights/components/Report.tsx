import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { CURVE_HOURS } from "@/lib/baseline";
import { formatAge, formatAgo, formatClock, formatCount, formatDate, formatDecimal, formatRatio, formatShare } from "@/lib/format";
import type { Kpi, Report } from "@/lib/types";
import { LineChart } from "./LineChart";
import { Card, SectionTitle, StatusMark, VerdictChip } from "./ui";

/** The whole report for one video. Everything here is drawn from the saved report, so old reports look as they did. */

export type HistoryLink = { label: string; href: string; current: boolean };

export function ReportView({
  report,
  now,
  sample = false,
  checkSlot,
  history = [],
  milestoneNote,
}: {
  report: Report;
  now: number;
  sample?: boolean;
  checkSlot?: ReactNode;
  history?: HistoryLink[];
  milestoneNote?: string;
}) {
  const { analysis, writeup, video } = report;
  const kind = video.short ? "Short" : "video";
  const charts = analysis.charts;
  const span = Math.max(6, Math.min(analysis.ageHours, CURVE_HOURS));

  return (
    <div className="space-y-5">
      {sample && (
        <p className="rounded-xl border border-warn/60 bg-warn-soft px-4 py-3 text-sm font-semibold">
          This is a sample report with made-up numbers, so you can see what Video Insights shows. Your own reports use your channel&apos;s real numbers.
        </p>
      )}

      <Card className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {video.thumbnail ? (
          <Image
            src={video.thumbnail}
            alt=""
            width={320}
            height={180}
            className="aspect-video w-full rounded-xl object-cover sm:w-48"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-surface-2 text-muted sm:w-48" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="size-10">
              <path d="M9 7.5v9l7.5-4.5z" fill="currentColor" />
            </svg>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold leading-tight">{video.title || "Untitled video"}</h1>
          <p className="mt-1 text-sm text-muted">
            {video.short ? "Short" : "Video"} · {formatClock(video.durationSec)} long · posted {formatDate(video.publishedAt)} (
            {formatAge(analysis.ageHours)} ago)
            {video.privacy !== "public" && <span className="font-semibold text-bad-text"> · {video.privacy}</span>}
          </p>
          {!sample && (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
              <a className="text-brand-strong underline-offset-2 hover:underline" href={`https://youtu.be/${video.id}`} target="_blank" rel="noopener noreferrer">
                Watch on YouTube
              </a>
              <a
                className="text-brand-strong underline-offset-2 hover:underline"
                href={`https://studio.youtube.com/video/${video.id}/analytics`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in YouTube Studio
              </a>
            </p>
          )}
          {checkSlot}
        </div>
      </Card>

      {history.length > 0 && (
        <nav aria-label="Reports for this video" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-muted">Reports:</span>
          {history.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 font-semibold ${
                item.current ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface hover:border-brand"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
      {milestoneNote && <p className="text-sm text-muted">{milestoneNote}</p>}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <VerdictChip verdict={analysis.verdict} large />
          {analysis.momentum && analysis.momentum.trend !== "steady" && (
            <span className="text-sm font-semibold text-muted">
              {analysis.momentum.trend === "rising" ? "Views are speeding up" : "Views are slowing down"}
            </span>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
          <p>
            <span className="block text-5xl font-bold leading-none">{formatCount(analysis.views)}</span>
            <span className="text-sm text-muted">views in {formatAge(analysis.ageHours)}</span>
          </p>
          {analysis.ratio !== null && analysis.usual && (
            <p>
              <span className="block text-3xl font-bold leading-none">{formatRatio(analysis.ratio)}</span>
              <span className="text-sm text-muted">
                your usual {kind} ({formatCount(analysis.usual.median)} at this age)
              </span>
            </p>
          )}
        </div>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed">{writeup.summary}</p>
      </Card>

      <section aria-labelledby="numbers-title">
        <h2 id="numbers-title" className="sr-only">
          Key numbers
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {analysis.kpis.map((kpi) => (
            <StatTile key={kpi.id} kpi={kpi} />
          ))}
        </ul>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle hint={writeup.source === "ai" ? "Explained by AI from the numbers on this page." : "Worked out from the numbers on this page."}>
            {analysis.verdict === "viral" || analysis.verdict === "above" ? "Why it's taking off" : analysis.verdict === "below" ? "Why it isn't taking off" : "What's happening"}
          </SectionTitle>
          {writeup.reasons.length ? (
            <ul className="space-y-4">
              {writeup.reasons.map((reason, i) => (
                <li key={i} className="flex gap-3">
                  <StatusMark status={reason.status} />
                  <div>
                    <p className="font-semibold leading-snug">{reason.text}</p>
                    <p className="mt-0.5 text-sm text-muted">{reason.evidence}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">The reasons appear once YouTube has more numbers about this video.</p>
          )}
        </Card>
        <Card>
          <SectionTitle hint="Small changes for this video or your next one.">What to try next</SectionTitle>
          <ol className="space-y-3">
            {writeup.actions.map((action, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong">
                  {i + 1}
                </span>
                <p className="leading-snug">{action}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card>
        <SectionTitle hint={`Views since posting, against your usual ${kind} at the same age.`}>Views over time</SectionTitle>
        <LineChart
          label="Views over time: this video against your usual"
          xFormat="hours"
          yFormat="count"
          xMax={span}
          series={[
            { id: "this", label: "This video", color: "var(--series-1)", points: charts.views },
            ...(charts.usual.length
              ? [
                  {
                    id: "usual",
                    label: `Your usual ${kind}`,
                    color: "var(--series-usual)",
                    points: charts.usual.map(([h, median]) => [h, median] as [number, number]),
                    band: charts.usual.map(([h, , low, high]) => [h, low, high] as [number, number, number]),
                    bandLabel: "Middle half of your earlier videos",
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Card>
        <SectionTitle hint="The share of viewers still watching at each moment of the video. Over 100% means people replayed it.">
          How long people kept watching
        </SectionTitle>
        {charts.retention ? (
          <>
            <LineChart
              label="Share of viewers still watching at each moment"
              xFormat="clock"
              yFormat="percent"
              xMax={1}
              durationSec={charts.retention.durationSec}
              markers={charts.retention.drops.map((drop, i) => ({ x: drop.atSec / charts.retention!.durationSec, label: String(i + 1) }))}
              series={[
                { id: "this", label: "This video", color: "var(--series-1)", points: charts.retention.actual },
                ...(charts.retention.usual ? [{ id: "usual", label: `Your usual ${kind}`, color: "var(--series-usual)", points: charts.retention.usual }] : []),
              ]}
            />
            {charts.retention.drops.length > 0 && (
              <ul className="mt-3 space-y-2">
                {charts.retention.drops.map((drop, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bad text-xs font-bold text-white">{i + 1}</span>
                    <span>
                      <strong>{formatClock(drop.atSec)}</strong>
                      {drop.scene ? `, scene ${drop.scene.index}${drop.scene.text ? `: “${drop.scene.text}”` : ""}` : ""}. Watching fell from{" "}
                      {formatShare(Math.min(1, drop.from))} to {formatShare(Math.min(1, drop.to))}.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Waiting />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="Where viewers were when they started watching.">Where the views came from</SectionTitle>
          {charts.traffic.length ? (
            <>
              <BarList
                rows={charts.traffic.map((row) => ({ name: row.label, share: row.share, usual: row.usualShare, extra: `${formatCount(row.views)} views` }))}
                showUsual={charts.traffic.some((row) => row.usualShare !== null)}
              />
              {charts.searchTerms.length > 0 && (
                <div className="mt-5">
                  <h3 className="font-semibold">What people searched for</h3>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {charts.searchTerms.map((term) => (
                      <li key={term.term} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm">
                        {term.term} <span className="tabular text-muted">· {formatCount(term.views)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <Waiting />
          )}
        </Card>
        <Card>
          <SectionTitle hint="From YouTube's audience numbers.">Who watched</SectionTitle>
          {charts.audience ? (
            <div className="space-y-5">
              {charts.audience.newViewerShare !== null && (
                <p>
                  <span className="block text-3xl font-bold leading-none">{formatShare(charts.audience.newViewerShare)}</span>
                  <span className="text-sm text-muted">
                    of views were from people who don&apos;t subscribe to you
                    {charts.audience.usualNewViewerShare !== null && ` (usually ${formatShare(charts.audience.usualNewViewerShare)})`}
                  </span>
                </p>
              )}
              {charts.audience.countries.length > 0 && (
                <div>
                  <h3 className="mb-1 font-semibold">Countries</h3>
                  <BarList rows={charts.audience.countries.map((row) => ({ name: row.name, share: row.share }))} />
                </div>
              )}
              {charts.audience.ages.length > 0 && (
                <div>
                  <h3 className="mb-1 font-semibold">Ages (signed-in viewers)</h3>
                  <BarList rows={charts.audience.ages.map((row) => ({ name: row.name, share: row.share }))} />
                </div>
              )}
              {charts.audience.genders.length > 0 && (
                <p className="text-sm">
                  <span className="font-semibold">Gender: </span>
                  {charts.audience.genders.map((row) => `${row.name} ${formatShare(row.share)}`).join(" · ")}
                </p>
              )}
              {charts.audience.devices.length > 0 && (
                <p className="text-sm">
                  <span className="font-semibold">Devices: </span>
                  {charts.audience.devices.map((row) => `${row.name} ${formatShare(row.share)}`).join(" · ")}
                </p>
              )}
              {charts.audience.sharing.length > 0 && (
                <p className="text-sm">
                  <span className="font-semibold">Shared with the share button to: </span>
                  {charts.audience.sharing.map((row) => `${row.name} (${formatCount(row.shares)})`).join(" · ")}
                </p>
              )}
            </div>
          ) : (
            <Waiting />
          )}
        </Card>
      </div>

      <Card as="div" className="text-sm text-muted">
        <h2 className="mb-2 font-semibold text-ink">About these numbers</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          {analysis.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
          <li>
            {writeup.source === "ai"
              ? `The explanation was written by AI (OpenAI) from these numbers ${formatAgo(writeup.writtenAt, now)}; it can be wrong, so check it against the charts.`
              : "The explanation was worked out by the app's built-in rules from these numbers."}{" "}
            Numbers last read from YouTube {formatAgo(report.createdAt, now)}.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Waiting() {
  return <p className="text-muted">YouTube hasn&apos;t sent these numbers yet. They usually arrive 1–3 days after a video is posted.</p>;
}

function formatKpi(kpi: Kpi, value: number): string {
  if (kpi.format === "count") return formatCount(value);
  if (kpi.format === "percent") return formatShare(value);
  return formatDecimal(value);
}

function StatTile({ kpi }: { kpi: Kpi }) {
  const { value, typical } = kpi;
  let delta: { text: string; good: boolean | null } | null = null;
  if (value !== null && typical !== null) {
    const better = typical > 0 ? value / typical : value > 0 ? 2 : 1;
    if (better >= 1.1) delta = { text: "Above your usual", good: true };
    else if (better <= 0.9) delta = { text: "Below your usual", good: false };
    else delta = { text: "About your usual", good: null };
  }
  return (
    <li className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <p className="text-sm text-muted">{kpi.label}</p>
      <p className="mt-1 text-3xl font-bold leading-none">{value === null ? "–" : formatKpi(kpi, value)}</p>
      {delta && (
        <p className={`mt-2 flex items-center gap-1 text-sm font-semibold ${delta.good === true ? "text-good-text" : delta.good === false ? "text-bad-text" : "text-muted"}`}>
          <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden="true">
            <path
              d={delta.good === true ? "M3 10l5-5 5 5" : delta.good === false ? "M3 6l5 5 5-5" : "M3 8h10"}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {delta.text}
        </p>
      )}
      {typical !== null && <p className="mt-0.5 text-sm text-muted">Usual: {formatKpi(kpi, typical)}</p>}
      {kpi.note && <p className="mt-2 text-xs text-muted">{kpi.note}</p>}
    </li>
  );
}

/** Horizontal bars for shares of a whole. A grey tick marks the usual share when there is one. */
function BarList({
  rows,
  showUsual = false,
}: {
  rows: Array<{ name: string; share: number; usual?: number | null; extra?: string }>;
  showUsual?: boolean;
}) {
  return (
    <div>
      {showUsual && (
        <p className="mb-2 flex items-center gap-2 text-xs text-muted">
          <svg width="10" height="14" aria-hidden="true">
            <rect x="4" y="0" width="2" height="14" rx="1" fill="var(--series-usual)" />
          </svg>
          Your channel&apos;s usual share
        </p>
      )}
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{row.name}</span>
              <span className="tabular shrink-0 font-semibold">
                {formatShare(row.share)}
                {row.usual !== undefined && row.usual !== null && <span className="font-normal text-muted"> · usual {formatShare(row.usual)}</span>}
              </span>
            </div>
            <div className="relative mt-1 h-2.5 rounded-full bg-surface-2" title={row.extra}>
              <div className="h-full rounded-full bg-series" style={{ width: `${Math.min(100, Math.max(row.share > 0 ? 1.5 : 0, row.share * 100))}%` }} />
              {row.usual !== undefined && row.usual !== null && (
                <div
                  className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-usual"
                  style={{ left: `calc(${Math.min(100, row.usual * 100)}% - 1px)` }}
                  aria-hidden="true"
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
