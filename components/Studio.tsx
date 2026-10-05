"use client";

import { useCallback, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import { APP_NAME } from "@/lib/config";
import type { ErrorInfo } from "@/lib/errors";
import { EMPTY_PROMPT } from "@/lib/prompt";
import { SAMPLE } from "@/lib/sample";
import {
  BuildPromptResponseSchema,
  StoryboardResponseSchema,
  type FiveStepPrompt,
  type Storyboard,
} from "@/lib/schemas";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { DescribeStep, type BuildOptions } from "./DescribeStep";
import { PromptStep } from "./PromptStep";
import { Stepper, type Step } from "./Stepper";
import { VideoStep } from "./VideoStep";
import { Button, KeyIcon } from "./ui";

type Props = {
  /** Whether the server has its own OpenAI key. The key itself never reaches the browser. */
  hasServerKey: boolean;
};

export default function Studio({ hasServerKey }: Props) {
  const [step, setStep] = useState<Step>("describe");
  const [hasNavigated, setHasNavigated] = useState(false);
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [lastBuild, setLastBuild] = useState<BuildOptions | undefined>(undefined);
  const [prompt, setPrompt] = useState<FiveStepPrompt | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [busy, setBusy] = useState<null | "prompt" | "storyboard">(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  // "Use my own key" mode: held in memory for this session only.
  const [apiKey, setApiKey] = useState("");
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);

  const goTo = (next: Step) => {
    setError(null);
    setHasNavigated(true);
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  const buildPrompt = async (options?: BuildOptions) => {
    setBusy("prompt");
    setError(null);
    setLastBuild(options);
    try {
      const result = await postJson(
        "/api/prompt",
        { description, ...options },
        BuildPromptResponseSchema,
        { apiKey: apiKey || undefined },
      );
      if (result.status === "needs_clarification") {
        setQuestions(result.questions);
      } else {
        setQuestions([]);
        setPrompt(result.prompt);
        goTo("prompt");
      }
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
    }
  };

  const generateStoryboard = async () => {
    if (!prompt) return;
    setBusy("storyboard");
    setError(null);
    try {
      const result = await postJson("/api/storyboard", { prompt }, StoryboardResponseSchema, {
        apiKey: apiKey || undefined,
        timeoutMs: 75_000,
      });
      setStoryboard(result.storyboard);
      goTo("video");
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
    }
  };

  const loadSample = () => {
    setDescription(SAMPLE.description);
    setQuestions([]);
    setPrompt(SAMPLE.prompt);
    setStoryboard(SAMPLE.storyboard);
    goTo("video");
  };

  const startOver = () => {
    if (!window.confirm("Start a new video? Your current video will be cleared.")) return;
    setDescription("");
    setQuestions([]);
    setPrompt(null);
    setStoryboard(null);
    goTo("describe");
  };

  const updateStoryboard = useCallback((update: (current: Storyboard) => Storyboard) => {
    setStoryboard((current) => (current ? update(current) : current));
  }, []);

  const openKeyPanel = () => {
    setKeyPanelOpen(true);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <p className="flex min-w-0 items-center gap-2 font-display text-xl font-bold">
            <Logo />
            <span className="truncate">{APP_NAME}</span>
          </p>
          <button
            type="button"
            onClick={() => setKeyPanelOpen((open) => !open)}
            aria-expanded={keyPanelOpen}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold transition-colors duration-200 hover:border-brand hover:text-brand-strong"
          >
            <KeyIcon />
            {apiKey ? "Using your key" : "API key"}
          </button>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16">
        <Stepper
          current={step}
          available={{ describe: true, prompt: prompt !== null, video: storyboard !== null }}
          onSelect={goTo}
        />

        {!hasServerKey && !apiKey && !keyPanelOpen && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-sun/40 bg-sun-soft px-4 py-3">
            <p>
              <span className="font-semibold">No OpenAI key is set up yet.</span> Add your own key
              to create new videos.
            </p>
            <Button compact onClick={() => setKeyPanelOpen(true)}>
              <KeyIcon />
              Add my key
            </Button>
          </div>
        )}

        {keyPanelOpen && (
          <ApiKeyPanel
            apiKey={apiKey}
            hasServerKey={hasServerKey}
            onChange={(key) => {
              setApiKey(key);
              setError(null);
            }}
            onClose={() => setKeyPanelOpen(false)}
          />
        )}

        {step === "describe" && (
          <DescribeStep
            description={description}
            onDescriptionChange={(value) => {
              setDescription(value);
              // Earlier questions no longer match an edited description.
              if (questions.length > 0) setQuestions([]);
            }}
            questions={questions}
            busy={busy === "prompt"}
            error={error}
            focusHeading={hasNavigated}
            onBuild={buildPrompt}
            onRetry={() => buildPrompt(lastBuild)}
            onLoadSample={loadSample}
            onUseOwnKey={openKeyPanel}
          />
        )}

        {step === "prompt" && (
          <PromptStep
            prompt={prompt ?? EMPTY_PROMPT}
            onChange={setPrompt}
            busy={busy === "storyboard"}
            error={error}
            hasStoryboard={storyboard !== null}
            onBack={() => goTo("describe")}
            onGenerate={generateStoryboard}
            onUseOwnKey={openKeyPanel}
          />
        )}

        {step === "video" && storyboard && (
          <VideoStep
            prompt={prompt ?? EMPTY_PROMPT}
            storyboard={storyboard}
            apiKey={apiKey}
            onStoryboardChange={updateStoryboard}
            onBackToPrompt={() => goTo("prompt")}
            onStartOver={startOver}
            onUseOwnKey={openKeyPanel}
          />
        )}
      </main>

      <footer className="border-t border-line bg-surface">
        <p className="mx-auto w-full max-w-6xl px-4 py-5 text-sm text-muted">
          Scripts are written by AI and can contain mistakes. Please check the facts before you
          share a video. Videos made here are for awareness and education, not medical advice.
        </p>
      </footer>
    </>
  );
}

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="10" fill="#0F766E" />
      <path d="M13 10.5v11l9-5.5z" fill="#FFFFFF" />
      <circle cx="24.5" cy="7.5" r="3" fill="#F59E0B" />
    </svg>
  );
}
