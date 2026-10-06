"use client";

import { useCallback, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import type { ErrorInfo } from "@/lib/errors";
import { PlanResponseSchema, type StoryPlan } from "@/lib/plan";
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
import { PlanStep } from "./PlanStep";
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

/**
 * The three-step flow for one kind of video. Explainer videos go Describe,
 * Prompt, Video. Cartoon stories go Describe, Plan, Video: the plan lists the
 * characters and places, so the story has exactly the cast the user asked for.
 */
export default function Studio({ kind, active, apiKey, onUseOwnKey }: Props) {
  const [step, setStep] = useState<Step>("describe");
  const [hasNavigated, setHasNavigated] = useState(false);
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [lastBuild, setLastBuild] = useState<BuildOptions | undefined>(undefined);
  const [prompt, setPrompt] = useState<FiveStepPrompt | null>(null);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  // Bumped for every newly generated video, so step 3 starts fresh each time.
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState<null | "prompt" | "result">(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const hasResult = kind === "story" ? story !== null : storyboard !== null;
  const hasBrief = kind === "story" ? plan !== null : prompt !== null;

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
    const request = { description, ...options };
    const sendOptions = { apiKey: apiKey || undefined };
    try {
      const result =
        kind === "story"
          ? await postJson("/api/plan", request, PlanResponseSchema, sendOptions)
          : await postJson("/api/prompt", request, BuildPromptResponseSchema, sendOptions);
      if (result.status === "needs_clarification") {
        setQuestions(result.questions);
      } else {
        setQuestions([]);
        if ("plan" in result) setPlan(result.plan);
        else setPrompt(result.prompt);
        goTo("prompt");
      }
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (kind === "story" ? !plan : !prompt) return;
    setBusy("result");
    setError(null);
    const options = { apiKey: apiKey || undefined, timeoutMs: 75_000 };
    try {
      if (kind === "story") {
        const result = await postJson("/api/story", { plan }, StoryResponseSchema, options);
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
      setPlan(SAMPLE_STORY.plan);
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
    setPlan(null);
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
        briefLabel={kind === "story" ? "Plan" : "Prompt"}
        available={{ describe: true, prompt: hasBrief, video: hasResult }}
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

      {step === "prompt" && kind === "story" && plan && (
        <PlanStep
          plan={plan}
          onChange={setPlan}
          busy={busy === "result"}
          error={error}
          hasResult={hasResult}
          onBack={() => goTo("describe")}
          onGenerate={generate}
          onUseOwnKey={onUseOwnKey}
        />
      )}

      {step === "prompt" && kind === "explainer" && (
        <PromptStep
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

      {/* Step 3 stays mounted while hidden, so pictures and recordings survive a trip back to step 2. */}
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
      {kind === "story" && story && plan && (
        <div hidden={step !== "video"}>
          <StoryStep
            key={generation}
            plan={plan}
            story={story}
            active={showingVideo}
            apiKey={apiKey}
            onStoryChange={updateStory}
            onBackToPlan={() => goTo("prompt")}
            onStartOver={startOver}
            onUseOwnKey={onUseOwnKey}
          />
        </div>
      )}
    </>
  );
}
