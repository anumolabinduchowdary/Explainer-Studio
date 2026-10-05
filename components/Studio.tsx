"use client";

import { useCallback, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import type { ErrorInfo } from "@/lib/errors";
import { EMPTY_PROMPT } from "@/lib/prompt";
import { SAMPLE, SAMPLE_STORY } from "@/lib/sample";
import {
  BuildPromptResponseSchema,
  StoryboardResponseSchema,
  type FiveStepPrompt,
  type Storyboard,
  type VideoKind,
} from "@/lib/schemas";
import { StoryResponseSchema, type Story } from "@/lib/story";
import { DescribeStep, type BuildOptions } from "./DescribeStep";
import { PromptStep } from "./PromptStep";
import { Stepper, type Step } from "./Stepper";
import { StoryStep } from "./StoryStep";
import { VideoStep } from "./VideoStep";

type Props = {
  /** Which section this is: text-and-picture explainers, or cartoon stories. */
  kind: VideoKind;
  /** False while the other section is showing. This one stays mounted to keep its work. */
  active: boolean;
  /** "Use my own key" mode: sent with each request, never stored. */
  apiKey: string;
  onUseOwnKey: () => void;
};

/** The three-step flow (Describe, Prompt, Video) for one kind of video. */
export default function Studio({ kind, active, apiKey, onUseOwnKey }: Props) {
  const [step, setStep] = useState<Step>("describe");
  const [hasNavigated, setHasNavigated] = useState(false);
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [lastBuild, setLastBuild] = useState<BuildOptions | undefined>(undefined);
  const [prompt, setPrompt] = useState<FiveStepPrompt | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  // Bumped for every newly generated video, so step 3 starts fresh each time.
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState<null | "prompt" | "result">(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const hasResult = kind === "story" ? story !== null : storyboard !== null;

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
        { description, kind, ...options },
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

  const generate = async () => {
    if (!prompt) return;
    setBusy("result");
    setError(null);
    const options = { apiKey: apiKey || undefined, timeoutMs: 75_000 };
    try {
      if (kind === "story") {
        const result = await postJson("/api/story", { prompt }, StoryResponseSchema, options);
        setStory(result.story);
      } else {
        const result = await postJson("/api/storyboard", { prompt }, StoryboardResponseSchema, options);
        setStoryboard(result.storyboard);
      }
      setGeneration((n) => n + 1);
      goTo("video");
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
    }
  };

  const loadSample = () => {
    setQuestions([]);
    if (kind === "story") {
      setDescription(SAMPLE_STORY.description);
      setPrompt(SAMPLE_STORY.prompt);
      setStory(SAMPLE_STORY.story);
    } else {
      setDescription(SAMPLE.description);
      setPrompt(SAMPLE.prompt);
      setStoryboard(SAMPLE.storyboard);
    }
    setGeneration((n) => n + 1);
    goTo("video");
  };

  const startOver = () => {
    const what = kind === "story" ? "story, including its pictures," : "video";
    if (!window.confirm(`Start again? Your current ${what} will be cleared.`)) return;
    setDescription("");
    setQuestions([]);
    setPrompt(null);
    setStoryboard(null);
    setStory(null);
    goTo("describe");
  };

  const updateStoryboard = useCallback((update: (current: Storyboard) => Storyboard) => {
    setStoryboard((current) => (current ? update(current) : current));
  }, []);
  const updateStory = useCallback((update: (current: Story) => Story) => {
    setStory((current) => (current ? update(current) : current));
  }, []);

  const showingVideo = active && step === "video";

  return (
    <>
      <Stepper
        current={step}
        available={{ describe: true, prompt: prompt !== null, video: hasResult }}
        onSelect={goTo}
      />

      {step === "describe" && (
        <DescribeStep
          kind={kind}
          description={description}
          onDescriptionChange={(value) => {
            setDescription(value);
            // Earlier questions no longer match an edited description.
            if (questions.length > 0) setQuestions([]);
          }}
          questions={questions}
          busy={busy === "prompt"}
          error={error}
          apiKey={apiKey}
          focusHeading={hasNavigated}
          onBuild={buildPrompt}
          onRetry={() => buildPrompt(lastBuild)}
          onLoadSample={loadSample}
          onUseOwnKey={onUseOwnKey}
        />
      )}

      {step === "prompt" && (
        <PromptStep
          kind={kind}
          prompt={prompt ?? EMPTY_PROMPT}
          onChange={setPrompt}
          busy={busy === "result"}
          error={error}
          hasResult={hasResult}
          onBack={() => goTo("describe")}
          onGenerate={generate}
          onUseOwnKey={onUseOwnKey}
        />
      )}

      {/* Step 3 stays mounted while hidden, so pictures and recordings survive a trip back to the prompt. */}
      {kind === "explainer" && storyboard && (
        <div hidden={step !== "video"}>
          <VideoStep
            key={generation}
            prompt={prompt ?? EMPTY_PROMPT}
            storyboard={storyboard}
            active={showingVideo}
            apiKey={apiKey}
            onStoryboardChange={updateStoryboard}
            onBackToPrompt={() => goTo("prompt")}
            onStartOver={startOver}
            onUseOwnKey={onUseOwnKey}
          />
        </div>
      )}
      {kind === "story" && story && (
        <div hidden={step !== "video"}>
          <StoryStep
            key={generation}
            prompt={prompt ?? EMPTY_PROMPT}
            story={story}
            active={showingVideo}
            apiKey={apiKey}
            onStoryChange={updateStory}
            onBackToPrompt={() => goTo("prompt")}
            onStartOver={startOver}
            onUseOwnKey={onUseOwnKey}
          />
        </div>
      )}
    </>
  );
}
