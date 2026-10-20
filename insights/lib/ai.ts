import "server-only";
import OpenAI, { OpenAIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { pickReasons, rulesWriteup } from "./advice";
import { aiSettings } from "./config";
import { formatAge, formatClock, formatCount, formatRatio, formatShare } from "./format";
import type { Analysis, Baseline, StudioFacts, Writeup } from "./types";

/**
 * OpenAI explains the numbers in plain words: why the video is or isn't
 * going viral, and what to try next. It is only given facts the rules
 * already found, and its answer is checked: a number it did not get from the
 * facts sends it back, and if it still can't answer, the rules' own words are
 * used. The same pattern as Explainer Studio's generateStructured.
 */

const WireSchema = z.object({
  summary: z.string(),
  reasons: z.array(z.object({ status: z.enum(["good", "bad", "neutral"]), text: z.string(), evidence: z.string() })),
  actions: z.array(z.string()),
});
type Wire = z.infer<typeof WireSchema>;

export const INSTRUCTIONS = `You explain YouTube results to creators who are not technical: parents, therapists, teachers and small charities who make short awareness videos about special parenting, child development and health.

You get the facts about one video as JSON: its verdict compared with the channel's own usual videos, and the findings ("signals") an analysis already made, each with its numbers.

Write:
- "summary": 1–3 short sentences. Say plainly whether the video is going viral for this channel (or doing better, about the same, or worse than usual) and the single main reason. Use the verdict you are given; never change it.
- "reasons": 2–5 reasons, most important first. Each "text" is one plain sentence a parent would understand; "evidence" gives the numbers behind it. "status" is "good" when it helped the video, "bad" when it held it back.
- "actions": 2–5 concrete things to do differently in the next video (or now, for this one). Point at specific scenes, seconds or words from the facts when you can. Explainer Studio makes these videos, so you can refer to scenes by number.

Rules:
- Use only numbers that appear in the facts, copied exactly as written there. Never estimate, add up or invent a number.
- Say "likely" or "probably" when a cause is not certain. Never promise views or growth.
- No jargon. If you must name a YouTube idea (for example "retention"), explain it in the same sentence.
- Never mention impressions or click-through rate as known: YouTube does not share them with apps.
- Write in English, warm and direct, short sentences.`;

/** The facts handed to OpenAI. Every number is already written out, so it can be copied, not computed. */
export function factsForAi(analysis: Analysis, extra: { title: string; short: boolean; studio: StudioFacts | null; baseline: Baseline | null }) {
  const { title, short, studio, baseline } = extra;
  const best = [...(baseline?.videos ?? [])].sort((a, b) => b.views - a.views).slice(0, 3);
  return {
    video: {
      title,
      format: short ? "YouTube Short" : "regular video",
      age: formatAge(analysis.ageHours),
      madeWith: studio ? (studio.kind === "story" ? "Explainer Studio cartoon story" : "Explainer Studio explainer video") : "unknown",
      language: studio?.language || "unknown",
      healthTopic: studio?.health ?? false,
      length: studio ? formatClock(studio.durationSec) : "unknown",
      scenes: (studio?.scenes ?? []).slice(0, 20).map((scene, i) => `Scene ${i + 1} at ${formatClock(scene.startSec)}: ${scene.text}`),
    },
    verdict: analysis.verdict,
    views: formatCount(analysis.views),
    usualViewsAtThisAge: analysis.usual ? formatCount(analysis.usual.median) : null,
    timesTheUsual: analysis.ratio !== null ? formatRatio(analysis.ratio) : null,
    trend: analysis.momentum?.trend ?? null,
    findings: pickReasons(analysis).map((signal) => ({ status: signal.status, finding: signal.title, numbers: signal.detail })),
    whereViewsCameFrom: analysis.charts.traffic.map((row) => `${row.label}: ${formatShare(row.share)}`),
    channelsBiggestVideos: best.map((video) => `${video.title} (${formatCount(video.views)} views)`),
  };
}

/** Every number OpenAI wrote must appear in the facts it was given. */
export function numbersAreFromFacts(wire: Wire, factsText: string): boolean {
  const written = [wire.summary, ...wire.reasons.flatMap((reason) => [reason.text, reason.evidence]), ...wire.actions].join(" ");
  const numbers = written.match(/\d[\d,.:]*\d|\d/g) ?? [];
  return numbers.every((number) => factsText.includes(number.replace(/[.,:]$/, "")));
}

function refine(wire: Wire, factsText: string): Wire {
  const tidy = (text: string, max: number) => text.trim().replace(/\s+/g, " ").slice(0, max);
  const result: Wire = {
    summary: tidy(wire.summary, 500),
    reasons: wire.reasons
      .map((reason) => ({ status: reason.status, text: tidy(reason.text, 300), evidence: tidy(reason.evidence, 400) }))
      .filter((reason) => reason.text)
      .slice(0, 5),
    actions: wire.actions.map((action) => tidy(action, 300)).filter(Boolean).slice(0, 5),
  };
  if (!result.summary || result.reasons.length === 0 || result.actions.length === 0) throw new Error("Something was empty.");
  if (!numbersAreFromFacts(result, factsText)) throw new Error("It used a number that is not in the facts.");
  return result;
}

/** The OpenAI client; tests pass in a fake. */
export type AiClient = Pick<OpenAI, "responses">;

/**
 * The write-up for a report: OpenAI's, when it is set up and answers well,
 * otherwise the rules' own. Never throws.
 */
export async function writeReport(
  analysis: Analysis,
  extra: { title: string; short: boolean; studio: StudioFacts | null; baseline: Baseline | null; now: number },
  options: { client?: AiClient; signal?: AbortSignal } = {},
): Promise<Writeup> {
  const fallback = rulesWriteup(analysis, { short: extra.short, studio: extra.studio, now: extra.now });
  const settings = aiSettings();
  if (!settings && !options.client) return fallback;
  if (analysis.verdict === "early") return fallback;

  const client = options.client ?? new OpenAI({ apiKey: settings!.apiKey, maxRetries: 1, timeout: 45_000 });
  const model = settings?.model ?? "test-model";
  const facts = factsForAi(analysis, extra);
  const factsText = JSON.stringify(facts, null, 1);
  let problem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const input =
      attempt === 1 ? `Facts:\n${factsText}` : `Facts:\n${factsText}\n\nYour previous answer could not be used (${problem}). Answer again and follow every rule.`;
    try {
      const response = await client.responses.parse(
        {
          model,
          instructions: INSTRUCTIONS,
          input,
          text: { format: zodTextFormat(WireSchema, "video_report") },
          max_output_tokens: 3000,
          store: false,
          ...(settings?.effort ? { reasoning: { effort: settings.effort as NonNullable<OpenAI.Reasoning["effort"]> } } : {}),
        },
        { signal: options.signal },
      );
      if (response.status === "incomplete") {
        problem = "it was cut off before it finished";
        continue;
      }
      const parsed = WireSchema.safeParse(response.output_parsed);
      if (!parsed.success) {
        problem = "it did not match the required shape";
        continue;
      }
      try {
        const wire = refine(parsed.data, factsText);
        return { ...wire, source: "ai", writtenAt: extra.now };
      } catch (err) {
        problem = err instanceof Error ? err.message : "some parts could not be used";
      }
    } catch (err) {
      // A real API failure (key, quota, network) is not retried: the rules' words are used instead.
      if (err instanceof OpenAIError) {
        console.error(`[ai] OpenAI failed: ${err.name}`);
        return fallback;
      }
      problem = "it was not valid JSON in the required shape";
    }
  }
  return fallback;
}
