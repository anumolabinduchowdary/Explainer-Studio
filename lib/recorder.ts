/**
 * Records a canvas with the browser's MediaRecorder.
 * MP4 is preferred where the browser can produce it (Safari, recent Chrome);
 * otherwise WebM is used.
 */

export type RecordingFormat = { mimeType: string; extension: "mp4" | "webm"; label: string };

const CANDIDATES: RecordingFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4", label: "MP4" },
  { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
  { mimeType: "video/webm;codecs=vp9", extension: "webm", label: "WebM" },
  { mimeType: "video/webm;codecs=vp8", extension: "webm", label: "WebM" },
  { mimeType: "video/webm", extension: "webm", label: "WebM" },
];

export function pickRecordingFormat(): RecordingFormat | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) {
    return null;
  }
  return CANDIDATES.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? null;
}

export type Recording = {
  format: RecordingFormat;
  /** Finishes the recording and returns the video file. */
  stop: () => Promise<Blob>;
  /** Stops and throws the recording away. */
  cancel: () => void;
};

export function startRecording(canvas: HTMLCanvasElement, fps = 30): Recording {
  const format = pickRecordingFormat();
  if (!format) throw new Error("Recording is not supported in this browser.");

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const release = () => stream.getTracks().forEach((track) => track.stop());

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      release();
      resolve(new Blob(chunks, { type: format.mimeType.split(";")[0] }));
    };
    recorder.onerror = () => {
      release();
      reject(new Error("Recording failed."));
    };
  });
  // Nobody may be waiting on this promise after a cancel.
  finished.catch(() => undefined);

  recorder.start(500);

  return {
    format,
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
      return finished;
    },
    cancel: () => {
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
