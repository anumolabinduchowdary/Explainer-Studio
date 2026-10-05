"use client";

import { useId, useMemo, useState } from "react";
import type { RecordingFormat } from "@/lib/recorder";
import { Button, CheckIcon, CopyIcon, ShareIcon, inputClass } from "./ui";

type Props = {
  /** The finished recording. */
  video: Blob;
  format: RecordingFormat;
  fileBase: string;
  title: string;
  /** A suggested caption; the user can change it before sharing. */
  defaultCaption: string;
};

/**
 * Sends the finished video to other apps (Instagram, YouTube, WhatsApp…)
 * through the phone's own share menu, with a caption ready to paste.
 *
 * This uses the browser's Web Share feature, so it needs no account details
 * and each person posts from their own apps. Browsers without it (most
 * desktop browsers) are told to download instead.
 */
export function SharePanel({ video, format, fileBase, title, defaultCaption }: Props) {
  const id = useId();
  const [edited, setEdited] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "shared" | "failed">("idle");
  const caption = edited ?? defaultCaption;

  const file = useMemo(
    () => new File([video], `${fileBase}.${format.extension}`, { type: video.type }),
    [video, fileBase, format.extension],
  );
  const canShare = useMemo(() => {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    try {
      return navigator.canShare?.({ files: [file] }) ?? false;
    } catch {
      return false;
    }
  }, [file]);

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  const share = async () => {
    // Most apps ignore the text that comes with a shared video, so the caption
    // is also put on the clipboard, ready to paste.
    void navigator.clipboard?.writeText(caption).catch(() => undefined);
    try {
      await navigator.share({ files: [file], title, text: caption });
      setStatus("shared");
    } catch (err) {
      // Closing the share menu without choosing an app is not an error.
      if (!(err instanceof DOMException && err.name === "AbortError")) setStatus("failed");
    }
  };

  return (
    <div className="mt-4 border-t border-brand/20 pt-3">
      <h3 className="font-semibold">Share it</h3>

      {format.extension !== "mp4" && (
        <p className="mt-2 rounded-xl bg-sun-soft px-3 py-2">
          This browser saved a WebM file, which Instagram and some other apps do not accept. For
          an MP4, record the video in Chrome or Safari.
        </p>
      )}

      <label htmlFor={`${id}-caption`} className="mb-1 mt-2 block font-semibold">
        Caption
      </label>
      <textarea
        id={`${id}-caption`}
        value={caption}
        rows={4}
        maxLength={2200}
        onChange={(event) => {
          setEdited(event.target.value);
          setStatus("idle");
        }}
        className={`${inputClass} field-sizing-content min-h-24 resize-y leading-relaxed`}
      />

      <div className="mt-2 flex flex-wrap gap-2">
        {canShare && (
          <Button variant="primary" onClick={share}>
            <ShareIcon />
            Share to Instagram, YouTube…
          </Button>
        )}
        <Button onClick={copyCaption}>
          {status === "copied" ? <CheckIcon /> : <CopyIcon />}
          {status === "copied" ? "Caption copied" : "Copy caption"}
        </Button>
      </div>

      <p className="mt-2 text-sm text-ink">
        {canShare
          ? "Share opens your device's share menu. On a phone, choose Instagram or YouTube, then paste the caption: it is copied for you. On a computer those apps are usually not in the menu, so download the video and upload it instead."
          : "To post straight from here, open this site on your phone, where a Share button appears. On a computer, download the video and upload it to Instagram or YouTube yourself."}
      </p>
      <p aria-live="polite" className={status === "failed" ? "mt-2 font-semibold text-danger" : "sr-only"}>
        {status === "copied" ? "Caption copied." : ""}
        {status === "shared" ? "Sent to the app you chose." : ""}
        {status === "failed" ? "That didn't work. Download the video and share it from your gallery instead." : ""}
      </p>
    </div>
  );
}
