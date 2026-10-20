"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatClock, formatCount, formatShare } from "@/lib/format";

/**
 * A line chart drawn in SVG: thin 2px lines, a light shaded range, hairline
 * grid, a legend, a crosshair with one tooltip for every series (pointer and
 * arrow keys), and the same numbers as a table underneath.
 */

export type LineSeries = {
  id: string;
  label: string;
  /** A CSS colour, e.g. "var(--series-1)". */
  color: string;
  points: Array<[number, number]>;
  /** [x, low, high]: a shaded range around the line. */
  band?: Array<[number, number, number]>;
  bandLabel?: string;
};

export type ChartMarker = { x: number; label: string };

type Props = {
  /** Read by screen readers as the chart's name. */
  label: string;
  series: LineSeries[];
  xMax: number;
  /** "hours": x is hours since publishing. "clock": x is the share of the video (0–1), shown as m:ss. */
  xFormat: "hours" | "clock";
  yFormat: "count" | "percent";
  durationSec?: number;
  markers?: ChartMarker[];
  height?: number;
};

const MARGIN = { top: 14, right: 18, bottom: 30, left: 52 };

function interpolate(points: ReadonlyArray<readonly number[]>, x: number, index = 1): number | null {
  if (!points.length || x < points[0][0] - 1e-9 || x > points[points.length - 1][0] + 1e-9) return null;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0] = points[i - 1];
      const [x1] = points[i];
      const y0 = points[i - 1][index];
      const y1 = points[i][index];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][index];
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

function hoursLabel(hours: number): string {
  if (hours === 0) return "0";
  if (hours % 24 !== 0) return `${Math.round(hours)}h`;
  const days = hours / 24;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function LineChart({ label, series, xMax, xFormat, yFormat, durationSec = 0, markers = [], height = 240 }: Props) {
  const id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const formatX = (x: number) => (xFormat === "clock" ? formatClock(x * durationSec) : hoursLabel(x));
  const formatXLong = (x: number) => {
    if (xFormat === "clock") return `At ${formatClock(x * durationSec)}`;
    if (x < 1) return `${Math.round(x * 60)} minutes after posting`;
    if (x < 48) return `${Math.round(x)} hours after posting`;
    return `${(x / 24).toFixed(1).replace(/\.0$/, "")} days after posting`;
  };
  const formatY = (y: number) => (yFormat === "percent" ? formatShare(y) : formatCount(y));

  const yMax = useMemo(() => {
    let highest = 0;
    for (const item of series) {
      for (const [, y] of item.points) highest = Math.max(highest, y);
      for (const [, , high] of item.band ?? []) highest = Math.max(highest, high);
    }
    return yFormat === "percent" ? Math.max(1, Math.ceil(highest * 10) / 10) : niceCeil(highest * 1.05);
  }, [series, yFormat]);

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const sx = (x: number) => MARGIN.left + (Math.min(x, xMax) / xMax) * plotW;
  const sy = (y: number) => MARGIN.top + plotH - (Math.min(y, yMax) / yMax) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * yMax);
  const xTicks = useMemo(() => {
    if (xFormat === "clock") {
      const steps = [5, 10, 15, 20, 30, 60, 120, 300];
      const step = steps.find((s) => durationSec / s <= 6) ?? 600;
      const ticks: number[] = [];
      for (let s = 0; s <= durationSec + 0.01; s += step) ticks.push(s / Math.max(1, durationSec));
      return ticks;
    }
    // Hours for the first two days, whole days after that, so every label is exact.
    const steps = xMax <= 48 ? [1, 2, 3, 6, 12, 24] : [24, 48, 72, 96, 168, 336];
    const step = steps.find((s) => xMax / s <= 6) ?? 336;
    const ticks: number[] = [];
    for (let h = 0; h <= xMax + 0.01; h += step) ticks.push(h);
    return ticks;
  }, [xFormat, xMax, durationSec]);

  // The crosshair snaps to the first series' points.
  const snaps = useMemo(() => series[0]?.points.map(([x]) => x).filter((x) => x <= xMax) ?? [], [series, xMax]);
  const activeX = active !== null ? snaps[Math.min(active, snaps.length - 1)] : null;

  const nearest = (px: number) => {
    const x = ((px - MARGIN.left) / plotW) * xMax;
    let best = 0;
    snaps.forEach((value, i) => {
      if (Math.abs(value - x) < Math.abs(snaps[best] - x)) best = i;
    });
    return best;
  };
  const onPointer = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (box) setActive(nearest(event.clientX - box.left));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!snaps.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      setActive((current) => {
        const start = current ?? snaps.length - 1;
        return Math.max(0, Math.min(snaps.length - 1, start + (event.key === "ArrowRight" ? step : -step)));
      });
    } else if (event.key === "Escape") setActive(null);
  };

  const path = (points: ReadonlyArray<readonly [number, number]>) =>
    points
      .filter(([x]) => x <= xMax + 1e-9)
      .map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
      .join("");
  const bandPath = (band: ReadonlyArray<readonly [number, number, number]>) => {
    const inside = band.filter(([x]) => x <= xMax + 1e-9);
    if (inside.length < 2) return "";
    const top = inside.map(([x, , high], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(high).toFixed(1)}`).join("");
    const bottom = [...inside].reverse().map(([x, low]) => `L${sx(x).toFixed(1)},${sy(low).toFixed(1)}`).join("");
    return `${top}${bottom}Z`;
  };

  // A dozen evenly spaced rows for the table view.
  const rowCount = Math.min(12, snaps.length);
  const tableRows = Array.from({ length: rowCount }, (_, i) => snaps[Math.round((i * (snaps.length - 1)) / Math.max(1, rowCount - 1))]);

  const tooltipLeft = activeX !== null ? Math.min(Math.max(sx(activeX) + 12, 8), width - 220) : 0;

  return (
    <figure className="m-0">
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-label="Legend">
        {series.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <svg width="18" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="17" y2="5" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {item.label}
          </li>
        ))}
        {series.some((item) => item.band?.length) && (
          <li className="flex items-center gap-2">
            <svg width="18" height="10" aria-hidden="true">
              <rect x="1" y="1" width="16" height="8" rx="2" fill="var(--band)" />
            </svg>
            {series.find((item) => item.band?.length)?.bandLabel ?? "Range"}
          </li>
        )}
      </ul>
      <div
        ref={wrapper}
        className="relative touch-pan-y rounded-xl outline-offset-4"
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use the left and right arrow keys to read the values.`}
        aria-describedby={`${id}-readout`}
        onKeyDown={onKey}
        onFocus={() => setActive((current) => current ?? (snaps.length ? snaps.length - 1 : null))}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block h-auto max-w-full" aria-hidden="true">
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(tick)} y2={sy(tick)} stroke={tick === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth="1" />
              <text x={MARGIN.left - 8} y={sy(tick)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--muted)] text-[11px]">
                {formatY(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={tick} x={sx(tick)} y={height - 8} textAnchor={tick === 0 ? "start" : "middle"} className="tabular fill-[var(--muted)] text-[11px]">
              {formatX(tick)}
            </text>
          ))}
          {series.map((item) =>
            item.band?.length ? <path key={`${item.id}-band`} d={bandPath(item.band)} fill="var(--band)" stroke="none" /> : null,
          )}
          {markers.map((marker) => (
            <g key={`${marker.x}-${marker.label}`}>
              <line x1={sx(marker.x)} x2={sx(marker.x)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="var(--bad)" strokeWidth="1" />
              <circle cx={sx(marker.x)} cy={MARGIN.top + 2} r="8" fill="var(--bad)" stroke="var(--surface)" strokeWidth="2" />
              <text x={sx(marker.x)} y={MARGIN.top + 2} dy="0.35em" textAnchor="middle" className="fill-white text-[10px] font-bold">
                {marker.label}
              </text>
            </g>
          ))}
          {[...series].reverse().map((item) => (
            <path key={item.id} d={path(item.points)} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((item) => {
            const last = item.points.filter(([x]) => x <= xMax + 1e-9).at(-1);
            return last ? <circle key={`${item.id}-end`} cx={sx(last[0])} cy={sy(last[1])} r="4" fill={item.color} stroke="var(--surface)" strokeWidth="2" /> : null;
          })}
          {activeX !== null && (
            <g>
              <line x1={sx(activeX)} x2={sx(activeX)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="var(--muted)" strokeWidth="1" />
              {series.map((item) => {
                const y = interpolate(item.points, activeX);
                return y === null ? null : <circle key={item.id} cx={sx(activeX)} cy={sy(y)} r="4.5" fill={item.color} stroke="var(--surface)" strokeWidth="2" />;
              })}
            </g>
          )}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={Math.max(0, plotW)}
            height={Math.max(0, plotH)}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        <div id={`${id}-readout`} role="status" aria-live="polite" className="sr-only">
          {activeX !== null &&
            `${formatXLong(activeX)}: ${series
              .map((item) => {
                const y = interpolate(item.points, activeX);
                return y === null ? "" : `${item.label} ${formatY(y)}`;
              })
              .filter(Boolean)
              .join(", ")}`}
        </div>
        {activeX !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-52 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg"
            style={{ left: tooltipLeft }}
            aria-hidden="true"
          >
            <p className="mb-1.5 text-xs text-muted">{formatXLong(activeX)}</p>
            {series.map((item) => {
              const y = interpolate(item.points, activeX);
              if (y === null) return null;
              const low = item.band ? interpolate(item.band, activeX, 1) : null;
              const high = item.band ? interpolate(item.band, activeX, 2) : null;
              return (
                <div key={item.id} className="flex items-start gap-2 py-0.5">
                  <svg width="12" height="10" className="mt-1.5 shrink-0" aria-hidden="true">
                    <line x1="1" y1="5" x2="11" y2="5" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  <div>
                    <span className="tabular font-bold">{formatY(y)}</span> <span className="text-muted">{item.label}</span>
                    {low !== null && high !== null && (
                      <span className="block text-xs text-muted">
                        most {formatY(low)}–{formatY(high)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 items-center font-semibold text-brand-strong">Show these numbers as a table</summary>
        <div className="overflow-x-auto">
          <table className="tabular mt-1 w-full min-w-[20rem] text-left">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {xFormat === "clock" ? "Moment" : "Time since posting"}
                </th>
                {series.map((item) => (
                  <th key={item.id} scope="col" className="py-1.5 pr-3 font-semibold">
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((x) => (
                <tr key={x} className="border-b border-line/60">
                  <th scope="row" className="py-1.5 pr-3 font-normal">
                    {xFormat === "clock" ? formatClock(x * durationSec) : formatXLong(x).replace(" after posting", "")}
                  </th>
                  {series.map((item) => {
                    const y = interpolate(item.points, x);
                    return (
                      <td key={item.id} className="py-1.5 pr-3">
                        {y === null ? "–" : formatY(y)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
