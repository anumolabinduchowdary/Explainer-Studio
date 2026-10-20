"use client";

import { useCallback, useState } from "react";
import { postJson, toErrorInfo } from "@/lib/api";
import type { ErrorInfo } from "@/lib/errors";
import { checkFacts, textsKey, type FactsState } from "@/lib/checks";
import { PlanResponseSchema, type StoryKind, type StoryPlan } from "@/lib/plan";
import {
  storyTexts,
  storyboardTexts,
  withStoryTexts,
  withStoryboardTexts,
  type Texts,
} from "@/lib/translate";
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
import {
  EMPTY_CHILD,
  EMPTY_THERAPY,
  type ChildDetails,
  type TherapyDetails,
} from "./StoryKindFields";
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
  /** Whether finished videos can be posted straight to YouTube. */
  youtubeEnabled: boolean;
  onUseOwnKey: () => void;
};

/**
 * The three-step flow for one kind of video. Explainer videos go Describe,
 * Prompt, Video. Cartoon stories go Describe, Plan, Video: the plan lists the
 * characters and places, so the story has exactly the cast the user asked for.
 */
export default function Studio({ kind, active, apiKey, youtubeEnabled, onUseOwnKey }: Props) {
  const [step, setStep] = useState<Step>("describe");
  const [hasNavigated, setHasNavigated] = useState(false);
  const [description, setDescription] = useState("");
  // The language chosen on the Describe step; empty means the language the description is written in.
  const [language, setLanguage] = useState("");
  // Cartoon stories: what kind (story, Social Story or home exercises) and its extra details.
  const [storyKind, setStoryKind] = useState<StoryKind>("story");
  const [child, setChild] = useState<ChildDetails>(EMPTY_CHILD);
  const [therapy, setTherapy] = useState<TherapyDetails>(EMPTY_THERAPY);
  const [questions, setQuestions] = useState<string[]>([]);
  const [lastBuild, setLastBuild] = useState<BuildOptions | undefined>(undefined);
  const [prompt, setPrompt] = useState<FiveStepPrompt | null>(null);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  // Bumped for every newly generated video, so step 3 starts fresh each time.
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState<null | "prompt" | "result">(null);
  // What the button says while a long step runs, e.g. "Checking the facts…".
  const [busyLabel, setBusyLabel] = useState("");
  // The automatic fact check of the newest script, handed to step 3.
  const [facts, setFacts] = useState<FactsState>({ status: "none" });
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
    const request = {
      description,
      ...(language.trim() ? { language: language.trim() } : {}),
      ...(kind === "story" ? { kind: storyKind } : {}),
      ...(kind === "story" && storyKind === "social" ? { child } : {}),
      ...(kind === "story" && storyKind === "exercises" ? { therapy } : {}),
      ...options,
    };
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

  /**
   * Checks a new script's facts and wording and applies the fixes, so what
   * reaches step 3 is ready to use. If the check cannot be done, the script
   * is kept as written and step 3 offers to check again.
   */
  async function withFactCheck<T>(
    value: T,
    language: string,
    read: (value: T) => Texts,
    write: (value: T, texts: Texts) => T,
  ): Promise<{ value: T; facts: FactsState }> {
    setBusyLabel("Checking the facts…");
    try {
      const result = await checkFacts(kind, language, read(value), apiKey);
      const fixed = write(value, result.texts);
      return { value: fixed, facts: { status: "checked", result, texts: textsKey(read(fixed)) } };
    } catch (err) {
      return { value, facts: { status: "failed", message: toErrorInfo(err).message } };
    }
  }

  const generate = async () => {
    if (kind === "story" ? !plan : !prompt) return;
    setBusy("result");
    setBusyLabel("");
    setError(null);
    const options = { apiKey: apiKey || undefined, timeoutMs: 180_000 };
    try {
      if (kind === "story" && plan) {
        const result = await postJson("/api/story", { plan }, StoryResponseSchema, options);
        const checked = await withFactCheck(result.story, plan.language, storyTexts, withStoryTexts);
        setStory(checked.value);
        setFacts(checked.facts);
      } else {
        const result = await postJson("/api/storyboard", { prompt }, StoryboardResponseSchema, options);
        const checked = await withFactCheck(result.storyboard, language, storyboardTexts, withStoryboardTexts);
        setStoryboard(checked.value);
        setFacts(checked.facts);
      }
      setGeneration((n) => n + 1);
      goTo("video");
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  };

  const loadSample = () => {
    setQuestions([]);
    setFacts({ status: "none" });
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
          language={language}
          onLanguageChange={setLanguage}
          storyKind={storyKind}
          onStoryKindChange={(next) => {
            setStoryKind(next);
            if (questions.length > 0) setQuestions([]);
          }}
          child={child}
          onChildChange={setChild}
          therapy={therapy}
          onTherapyChange={setTherapy}
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
          busyLabel={busyLabel}
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
          busyLabel={busyLabel}
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
            language={language}
            storyboard={storyboard}
            initialFacts={facts}
            active={showingVideo}
            apiKey={apiKey}
            youtubeEnabled={youtubeEnabled}
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
            initialFacts={facts}
            active={showingVideo}
            apiKey={apiKey}
            youtubeEnabled={youtubeEnabled}
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
