"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import type { ErrorInfo } from "@/lib/errors";
import { formatTime } from "@/lib/renderer";
import { MAX_AUDIO_CHARS, TranscribeResponseSchema } from "@/lib/schemas";
import { ErrorNotice } from "./ErrorNotice";
import { Button, MicIcon, Spinner } from "./ui";

/** Recordings stop by themselves after this long. */
const MAX_SECONDS = 60;

/** Formats OpenAI accepts, in order of preference. Browsers differ in what they can record. */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function canRecord(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

const subscribeNever = () => () => undefined;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The recording could not be read."));
    reader.readAsDataURL(blob);
  });
}

function microphoneProblem(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone is blocked for this site. Allow it in your browser (look for the microphone or lock icon near the address bar), then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Plug one in or check your device's sound settings, then try again.";
  }
  return "The microphone could not be started. Please try again.";
}

type Phase = "idle" | "starting" | "listening" | "writing";

type Props = {
  /** Called with the words that were heard. */
  onText: (text: string) => void;
  apiKey: string;
  disabled?: boolean;
  onUseOwnKey: () => void;
};

/**
 * "Speak instead of typing": records a short description with the microphone
 * and has OpenAI write it down. The recording is held in memory only for as
 * long as it takes to send.
 */
export function SpeakButton({ onText, apiKey, disabled = false, onUseOwnKey }: Props) {
  // Checked after the page has loaded, so server and browser render the same thing first.
  const supported = useSyncExternalStore(subscribeNever, canRecord, () => false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);
  const latest = useRef({ onText, apiKey });
  useEffect(() => {
    latest.current = { onText, apiKey };
  });

  const release = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Let go of the microphone if the user leaves this step while it is on.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      release();
    };
  }, [release]);

  const transcribe = async (blob: Blob) => {
    if (blob.size < 1_000) {
      setPhase("idle");
      setProblem("We couldn't hear anything. Please try again and speak a little closer to the microphone.");
      return;
    }
    setPhase("writing");
    try {
      const audio = await blobToDataUrl(blob);
      if (audio.length > MAX_AUDIO_CHARS) {
        throw new Error("too long");
      }
      const { text } = await postJson("/api/transcribe", { audio }, TranscribeResponseSchema, {
        apiKey: latest.current.apiKey || undefined,
        timeoutMs: 60_000,
      });
      if (!aliveRef.current) return;
      if (text.trim()) latest.current.onText(text.trim());
      else setProblem("We couldn't make out any words. Please try again.");
    } catch (err) {
      if (!aliveRef.current) return;
      if (err instanceof Error && err.message === "too long") {
        setProblem("That recording is too long. Please try again with a shorter description.");
      } else {
        setError(toErrorInfo(err));
      }
    } finally {
      if (aliveRef.current) setPhase("idle");
    }
  };

  const start = async () => {
    setProblem(null);
    setError(null);
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!aliveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        // Plenty for speech, and keeps a minute of sound small enough to send.
        audioBitsPerSecond: 32_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
        release();
        void transcribe(new Blob(chunks, { type }));
      };
      recorderRef.current = recorder;
      recorder.start();

      setSeconds(0);
      setPhase("listening");
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS && recorder.state !== "inactive") recorder.stop();
      }, 250);
    } catch (err) {
      release();
      if (aliveRef.current) {
        setPhase("idle");
        setProblem(microphoneProblem(err));
      }
    }
  };

  const stop = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  if (!supported) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {phase === "listening" ? (
          <>
            <Button variant="primary" onClick={stop}>
              <span className="size-3 rounded-sm bg-white" aria-hidden="true" />
              Stop and write it down
            </Button>
            <p className="flex items-center gap-2 font-semibold text-danger">
              <span className="size-3 animate-pulse rounded-full bg-danger" aria-hidden="true" />
              Listening… {formatTime(seconds)} of {formatTime(MAX_SECONDS)}
            </p>
          </>
        ) : phase === "writing" ? (
          <p className="flex min-h-11 items-center gap-2 font-semibold text-brand-strong">
            <Spinner />
            Writing down what you said…
          </p>
        ) : (
          <Button onClick={start} disabled={disabled || phase === "starting"} loading={phase === "starting"}>
            {phase !== "starting" && <MicIcon />}
            Speak instead of typing
          </Button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {phase === "listening" ? "Listening. Press Stop when you have finished speaking." : ""}
        {phase === "writing" ? "Writing down what you said." : ""}
      </p>
      {phase === "idle" && !problem && !error && (
        <p className="mt-1 text-sm text-muted">
          Speak in any language, for up to a minute. Your recording is sent to OpenAI to be
          written down and is not kept by this app.
        </p>
      )}
      {problem && (
        <p className="mt-2 rounded-xl bg-sun-soft px-3 py-2" role="alert">
          {problem}
        </p>
      )}
      {error && <ErrorNotice className="mt-2" error={error} onRetry={start} onUseOwnKey={onUseOwnKey} />}
    </div>
  );
}
