"use client";

import { useEffect, useId, useRef, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import type { ErrorInfo } from "@/lib/errors";
import { formatBytes } from "@/lib/download";
import {
  DetailsResponseSchema,
  StartResponseSchema,
  ThumbnailResponseSchema,
  TrackResponseSchema,
  YouTubeStatusSchema,
  sendVideo,
  studioLink,
  youtubeLink,
  type VideoDetails,
  type YouTubeInfo,
  type YouTubeStatus,
} from "@/lib/youtube";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui";

type Phase =
  | { step: "idle" }
  | { step: "working"; label: string; sent?: number; total?: number }
  | {
      step: "done";
      videoId: string;
      details: VideoDetails;
      thumbnail: string | null;
      thumbnailNote?: string;
      /** Video Insights' report on the video, once it has one. */
      reportUrl?: string;
    }
  | { step: "error"; error: ErrorInfo };

const PRIVACY_WORDS = { public: "public", unlisted: "unlisted (only people with the link)", private: "private" } as const;

/**
 * "Upload to YouTube": connect the channel once, then each press posts the
 * finished video with a written title, description, tags and a thumbnail.
 */
export function YouTubePanel({ video, info }: { video: Blob; info: YouTubeInfo }) {
  const id = useId();
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [check, setCheck] = useState(0);
  const [connectError, setConnectError] = useState<ErrorInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Is a channel connected in this browser?
  useEffect(() => {
    let cancelled = false;
    postJson("/api/youtube/status", {}, YouTubeStatusSchema, { timeoutMs: 20_000 }).then(
      (result) => {
        if (!cancelled) setStatus(result);
      },
      (err) => {
        if (!cancelled) setConnectError(toErrorInfo(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [check]);

  // The connection window reports back with a message, then closes itself.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; youtube?: unknown; detail?: unknown } | null;
      if (data?.source !== "explainer-studio") return;
      setConnecting(false);
      setPopupBlocked(false);
      if (data.youtube === "connected") {
        setConnectError(null);
        setStatus(null);
        setCheck((n) => n + 1);
      } else {
        setConnectError({
          code: "youtube_failed",
          message: typeof data.detail === "string" && data.detail ? data.detail : "YouTube was not connected.",
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const connect = () => {
    setConnectError(null);
    const popup = window.open("/api/youtube/connect", "youtube-connect", "popup,width=520,height=720");
    if (!popup) {
      setPopupBlocked(true);
      return;
    }
    setConnecting(true);
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect YouTube? The app will no longer be able to post to this channel.")) return;
    try {
      await postJson("/api/youtube/disconnect", {}, YouTubeStatusSchema, { timeoutMs: 20_000 });
    } finally {
      setStatus((current) => ({ connected: false, privacy: current?.privacy }));
      setPhase({ step: "idle" });
    }
  };

  /**
   * Hands the posted video to Video Insights, in the background. It never holds
   * up or spoils "Posted": any failure is simply left out.
   */
  const track = async (videoId: string, receipt: string) => {
    try {
      const studio = {
        kind: info.kind,
        title: info.title.slice(0, 200),
        language: info.language,
        health: info.health,
        aiVoices: info.aiVoices,
        durationSec: info.durationSec ?? 0,
        shape: info.shape ?? "",
        scenes: info.scenes ?? [],
      };
      const { reportUrl } = await postJson("/api/youtube/track", { receipt, studio }, TrackResponseSchema, { timeoutMs: 30_000 });
      if (!reportUrl) return;
      setPhase((current) => (current.step === "done" && current.videoId === videoId ? { ...current, reportUrl } : current));
    } catch {
      // Not shown: the video is posted either way.
    }
  };

  const upload = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    const mimeType = (video.type || "video/mp4").split(";")[0];
    try {
      setPhase({ step: "working", label: "Writing the title, description and tags…" });
      const { details } = await postJson(
        "/api/youtube/details",
        {
          kind: info.kind,
          title: info.title,
          script: info.script.slice(0, 12_000),
          language: info.language,
          health: info.health,
          aiVoices: info.aiVoices,
          sources: info.sources,
          follow: info.follow,
        },
        DetailsResponseSchema,
        { apiKey: info.apiKey || undefined, timeoutMs: 180_000 },
      );
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");

      setPhase({ step: "working", label: "Making the thumbnail…" });
      const thumbnail = await info.makeThumbnail().catch(() => null);

      setPhase({ step: "working", label: "Starting the upload…" });
      const { upload: note } = await postJson(
        "/api/youtube/start",
        { details, size: video.size, mimeType },
        StartResponseSchema,
        { timeoutMs: 30_000 },
      );
      const { videoId, receipt } = await sendVideo(note, video, {
        signal: controller.signal,
        onProgress: (sent, total) => setPhase({ step: "working", label: "Uploading the video…", sent, total }),
      });

      let thumbnailNote: string | undefined;
      if (thumbnail) {
        setPhase({ step: "working", label: "Setting the thumbnail…" });
        try {
          const result = await postJson(
            "/api/youtube/thumbnail",
            { upload: note, videoId, image: thumbnail },
            ThumbnailResponseSchema,
            { timeoutMs: 30_000 },
          );
          if (!result.ok) thumbnailNote = result.reason;
        } catch {
          thumbnailNote = "The thumbnail could not be set, so YouTube chose one from the video.";
        }
      } else {
        thumbnailNote = "No thumbnail could be made, so YouTube chose one from the video.";
      }
      setPhase({ step: "done", videoId, details, thumbnail, thumbnailNote });
      if (status?.insights && receipt) void track(videoId, receipt);
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase({ step: "idle" });
        return;
      }
      const error = toErrorInfo(err);
      if (error.code === "youtube_reconnect") setStatus((current) => ({ connected: false, privacy: current?.privacy }));
      setPhase({ step: "error", error });
    } finally {
      abortRef.current = null;
    }
  };

  const working = phase.step === "working";
  const privacy = PRIVACY_WORDS[status?.privacy ?? "public"];

  return (
    <section aria-labelledby={`${id}-title`} className="mt-4 border-t border-brand/20 pt-4">
      <h3 id={`${id}-title`} className="flex items-center gap-2 font-semibold">
        <YouTubeMark />
        YouTube
      </h3>

      {!status && !connectError && <p className="mt-1 text-muted">Checking YouTube…</p>}

      {status && !status.connected && (
        <>
          <p className="mt-1">
            Post this video straight to your YouTube channel. Connect your channel once; after
            that, one press uploads it as {privacy}, with a title, description, tags and
            thumbnail written for you.
          </p>
          <Button className="mt-2" loading={connecting} onClick={connect}>
            {connecting ? "Waiting for Google…" : "Connect YouTube"}
          </Button>
          {connecting && (
            <p className="mt-1 text-sm text-muted">
              Finish in the Google window that opened, then come back here.
            </p>
          )}
          {popupBlocked && (
            <p className="mt-2 rounded-xl bg-sun-soft px-3 py-2">
              Your browser blocked the Google window.{" "}
              <a
                href="/api/youtube/connect"
                target="_blank"
                rel="opener"
                className="font-semibold text-brand-strong underline underline-offset-4"
              >
                Open it here
              </a>
              , allow uploading, then come back to this page.
            </p>
          )}
        </>
      )}

      {status?.connected && phase.step !== "done" && (
        <>
          {!working && (
            <Button variant="primary" className="mt-2" onClick={() => void upload()}>
              <YouTubeMark light />
              Upload to YouTube
            </Button>
          )}
          <p className="mt-1 text-sm text-muted">
            Posts as {privacy} to the channel of {status.email ?? "your Google account"}.{" "}
            {!working && (
              <button
                type="button"
                onClick={() => void disconnect()}
                className="min-h-11 font-semibold text-brand-strong underline underline-offset-4"
              >
                Disconnect
              </button>
            )}
          </p>
        </>
      )}

      {phase.step === "working" && (
        <div className="mt-2">
          <p className="font-semibold" role="status">
            {phase.label}
            {phase.total ? ` ${Math.round(((phase.sent ?? 0) / phase.total) * 100)}%` : ""}
          </p>
          {phase.total ? (
            <>
              <progress
                value={phase.sent ?? 0}
                max={phase.total}
                aria-label="Upload progress"
                className="mt-2 block h-3 w-full overflow-hidden rounded-full accent-brand"
              />
              <p className="mt-1 text-sm text-muted">
                {formatBytes(phase.sent ?? 0)} of {formatBytes(phase.total)}. Please keep this page open.
              </p>
            </>
          ) : null}
          <Button compact className="mt-2" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        </div>
      )}

      {phase.step === "done" && (
        <div className="mt-2 rounded-xl bg-surface p-3">
          <p className="font-semibold text-brand-strong" role="status">
            Posted to YouTube.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={youtubeLink(phase.videoId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-brand-strong"
            >
              Watch on YouTube
            </a>
            <a
              href={studioLink(phase.videoId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface px-4 font-semibold transition-colors duration-200 hover:border-brand hover:text-brand-strong"
            >
              Edit in YouTube Studio
            </a>
          </div>
          <p className="mt-2 break-all text-sm text-muted">{youtubeLink(phase.videoId)}</p>
          <p className="mt-1 text-sm text-muted">
            YouTube may take a few minutes to process the video before it can be watched.
          </p>
          {phase.reportUrl && (
            <p className="mt-1">
              <a
                href={phase.reportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center font-semibold text-brand-strong underline underline-offset-4"
              >
                See how this video is doing&nbsp;<span aria-hidden="true">→</span>
              </a>
            </p>
          )}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            {phase.thumbnail && (
              // A data URL made in this page, so the plain img element is right here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={phase.thumbnail}
                alt="The thumbnail that was set"
                className="w-full max-w-60 rounded-lg border border-line"
              />
            )}
            <div className="min-w-0">
              <p className="font-semibold">{phase.details.title}</p>
              <details className="mt-1">
                <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-brand-strong">
                  Description and tags
                </summary>
                <p className="whitespace-pre-wrap break-words text-sm">{phase.details.description}</p>
                {phase.details.tags.length > 0 && (
                  <p className="mt-2 text-sm text-muted">Tags: {phase.details.tags.join(", ")}</p>
                )}
              </details>
            </div>
          </div>
          {phase.thumbnailNote && <p className="mt-2 rounded-xl bg-sun-soft px-3 py-2 text-sm">{phase.thumbnailNote}</p>}
          <Button compact className="mt-3" onClick={() => setPhase({ step: "idle" })}>
            Upload again
          </Button>
        </div>
      )}

      {phase.step === "error" && (
        <ErrorNotice
          className="mt-3"
          error={phase.error}
          onRetry={phase.error.code === "youtube_reconnect" ? undefined : () => void upload()}
        />
      )}
      {connectError && <ErrorNotice className="mt-3" error={connectError} onRetry={() => setCheck((n) => n + 1)} />}
    </section>
  );
}

function YouTubeMark({ light = false }: { light?: boolean }) {
  return (
    <svg width="22" height="16" viewBox="0 0 28 20" aria-hidden="true" className="shrink-0">
      <rect width="28" height="20" rx="5" fill={light ? "#FFFFFF" : "#FF0033"} />
      <path d="M11 5.5v9l8-4.5z" fill={light ? "#0F766E" : "#FFFFFF"} />
    </svg>
  );
}
