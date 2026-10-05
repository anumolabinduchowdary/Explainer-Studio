/**
 * Records a canvas with the browser's MediaRecorder.
 * MP4 is preferred where the browser can produce it (Safari, recent Chrome);
 * otherwise WebM is used.
 */

export type RecordingFormat = {
  mimeType: string;
  /** The same format with a sound track, for videos that have voices. */
  withSound: string;
  extension: "mp4" | "webm";
  label: string;
};

const CANDIDATES: RecordingFormat[] = [
  {
    mimeType: "video/mp4;codecs=avc1.42E01E",
    withSound: "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    extension: "mp4",
    label: "MP4",
  },
  { mimeType: "video/mp4", withSound: "video/mp4", extension: "mp4", label: "MP4" },
  {
    mimeType: "video/webm;codecs=vp9",
    withSound: "video/webm;codecs=vp9,opus",
    extension: "webm",
    label: "WebM",
  },
  {
    mimeType: "video/webm;codecs=vp8",
    withSound: "video/webm;codecs=vp8,opus",
    extension: "webm",
    label: "WebM",
  },
  { mimeType: "video/webm", withSound: "video/webm", extension: "webm", label: "WebM" },
];

export function pickRecordingFormat(): RecordingFormat | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) {
    return null;
  }
  return CANDIDATES.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? null;
}

/** Where an export is up to, as shown in the Download panel. */
export type RecordingState =
  | { status: "idle" }
  | { status: "recording"; time: number }
  | { status: "done"; url: string; size: number; format: RecordingFormat; video: Blob }
  | { status: "error" };

export type Recording = {
  format: RecordingFormat;
  /** Finishes the recording and returns the video file. */
  stop: () => Promise<Blob>;
  /** Stops and throws the recording away. */
  cancel: () => void;
};

/**
 * Starts recording the canvas. Pass `sound` (an audio stream) to include a
 * sound track; the caller keeps ownership of that stream.
 */
export function startRecording(
  canvas: HTMLCanvasElement,
  sound: MediaStream | null = null,
  fps = 30,
): Recording {
  const format = pickRecordingFormat();
  if (!format) throw new Error("Recording is not supported in this browser.");

  const picture = canvas.captureStream(fps);
  const soundTracks = sound?.getAudioTracks() ?? [];
  const stream =
    soundTracks.length > 0 ? new MediaStream([...picture.getVideoTracks(), ...soundTracks]) : picture;
  const container = format.mimeType.split(";")[0];
  const mimeType =
    soundTracks.length === 0
      ? format.mimeType
      : MediaRecorder.isTypeSupported(format.withSound)
        ? format.withSound
        : container;
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  // Only the picture is ours to stop; the sound stream belongs to the audio player.
  const release = () => picture.getTracks().forEach((track) => track.stop());

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      release();
      resolve(new Blob(chunks, { type: container }));
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
