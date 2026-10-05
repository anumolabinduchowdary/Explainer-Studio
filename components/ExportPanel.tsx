"use client";

import { formatBytes } from "@/lib/download";
import type { RecordingFormat } from "@/lib/recorder";
import { formatTime } from "@/lib/renderer";
import { Button, Card, DownloadIcon, RecordIcon } from "./ui";

export type RecordingState =
  | { status: "idle" }
  | { status: "recording"; time: number }
  | { status: "done"; url: string; size: number; format: RecordingFormat }
  | { status: "error" };

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
            This browser can&apos;t record video. Please open this page in a recent version of
            Chrome, Edge, Firefox or Safari. You can still download the storyboard and prompt
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
              <Button onClick={props.onRecord}>Record again</Button>
            </div>
          </div>
        )}

        {format && recording && (
          <div className="mt-3">
            <label htmlFor="record-progress" className="font-semibold">
              Recording… {formatTime(state.time)} of {formatTime(duration)}
            </label>
            <progress
              id="record-progress"
              value={state.time}
              max={duration}
              className="mt-2 block h-3 w-full overflow-hidden rounded-full accent-brand"
            />
            <p className="mt-2 text-muted">Keep this tab open and in front until it finishes.</p>
            <Button className="mt-3" onClick={props.onCancel}>
              Cancel recording
            </Button>
          </div>
        )}

        {format && (state.status === "idle" || state.status === "error") && (
          <div className="mt-3">
            {state.status === "error" && (
              <p className="mb-3 font-semibold text-danger" role="alert">
                The recording didn&apos;t work. Please try again.
              </p>
            )}
            <Button variant="primary" onClick={props.onRecord} className="w-full sm:w-auto">
              <RecordIcon />
              Record video ({format.label})
            </Button>
            <p className="mt-2 text-muted">
              Recording plays your video once from start to finish (about {formatTime(duration)}).
              Keep this tab open while it records.
            </p>
          </div>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="font-semibold">Other files</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button compact disabled={recording} onClick={props.onDownloadStoryboard}>
              <DownloadIcon />
              Storyboard (.json)
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
