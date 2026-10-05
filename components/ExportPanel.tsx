"use client";

import { formatBytes } from "@/lib/download";
import type { RecordingFormat, RecordingState } from "@/lib/recorder";
import { formatTime } from "@/lib/renderer";
import { SharePanel } from "./SharePanel";
import { Button, Card, DownloadIcon, RecordIcon } from "./ui";

type Props = {
  /** Null when this browser cannot record a canvas. */
  format: RecordingFormat | null;
  state: RecordingState;
  duration: number;
  fileBase: string;
  onRecord: () => void;
  onCancel: () => void;
  onDownloadStoryboard: () => void;
  onDownloadPrompt: () => void;
  /** Label for the script download, e.g. "Storyboard (.json)". */
  scriptLabel?: string;
  /** Shown above the record button, e.g. when pictures are still missing. */
  notice?: string;
  /** When set, recording is not possible yet and this explains why. */
  holdReason?: string;
  /** True when the video is being recorded live as it plays (the fallback for older browsers). */
  live: boolean;
  /** The video's title and a suggested caption, used when sharing. */
  title: string;
  caption: string;
};

export function ExportPanel(props: Props) {
  const { format, state, duration } = props;
  const recording = state.status === "recording";

  return (
    <Card>
      <section aria-labelledby="export-title">
        <h2 id="export-title" className="font-display text-2xl font-bold">
          Download
        </h2>

        {!format && (
          <p className="mt-2 text-ink">
            This browser can&apos;t create video files. Please open this page in a recent version
            of Chrome, Edge, Firefox or Safari. You can still download the storyboard and prompt
            below.
          </p>
        )}

        {format && state.status === "done" && (
          <div className="mt-3 rounded-xl bg-brand-soft p-3">
            <p className="font-semibold text-brand-strong" role="status">
              Your video is ready.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={state.url}
                download={`${props.fileBase}.${state.format.extension}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-brand-strong"
              >
                <DownloadIcon />
                Download video ({state.format.label}, {formatBytes(state.size)})
              </a>
              <Button onClick={props.onRecord}>Create again</Button>
            </div>
            <SharePanel
              key={state.url}
              video={state.video}
              format={state.format}
              fileBase={props.fileBase}
              title={props.title}
              defaultCaption={props.caption}
            />
          </div>
        )}

        {format && recording && (
          <div className="mt-3">
            <label htmlFor="record-progress" className="font-semibold">
              {props.live
                ? `Recording… ${formatTime(state.time)} of ${formatTime(duration)}`
                : `Creating your video… ${Math.min(100, Math.round((state.time / Math.max(duration, 0.1)) * 100))}%`}
            </label>
            <progress
              id="record-progress"
              value={state.time}
              max={duration}
              className="mt-2 block h-3 w-full overflow-hidden rounded-full accent-brand"
            />
            <p className="mt-2 text-muted">
              {props.live
                ? "Keep this tab open and in front until it finishes."
                : "Every frame is drawn one by one, so the picture never freezes. Please keep this page open until it finishes."}
            </p>
            <Button className="mt-3" onClick={props.onCancel}>
              Cancel
            </Button>
          </div>
        )}

        {format && (state.status === "idle" || state.status === "error") && (
          <div className="mt-3">
            {state.status === "error" && (
              <p className="mb-3 font-semibold text-danger" role="alert">
                The video couldn&apos;t be created. Please try again.
              </p>
            )}
            {props.notice && <p className="mb-3 rounded-xl bg-sun-soft px-3 py-2">{props.notice}</p>}
            <Button
              variant="primary"
              onClick={props.onRecord}
              disabled={Boolean(props.holdReason)}
              className="w-full sm:w-auto"
            >
              <RecordIcon />
              Create video ({format.label})
            </Button>
            {props.holdReason && <p className="mt-2 font-semibold">{props.holdReason}</p>}
            <p className="mt-2 text-muted">
              Your video is {formatTime(duration)} long. Creating it takes about that long, often
              less, and you can watch the progress here.
            </p>
          </div>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="font-semibold">Other files</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button compact disabled={recording} onClick={props.onDownloadStoryboard}>
              <DownloadIcon />
              {props.scriptLabel ?? "Storyboard (.json)"}
            </Button>
            <Button compact disabled={recording} onClick={props.onDownloadPrompt}>
              <DownloadIcon />
              Prompt (.txt)
            </Button>
          </div>
        </div>
      </section>
    </Card>
  );
}
