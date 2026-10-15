import { z } from "zod";
import { LANGUAGE_MAX } from "./languages";
import { LIMITS, type Storyboard } from "./schemas";
import { STORY_LIMITS, type Story } from "./story";

/**
 * Making a finished video in another language.
 *
 * Only the words are translated. Everything else (pictures, characters,
 * timing, illustrations) stays as it is, so a new language costs one text
 * request plus, for cartoon stories, new voice recordings.
 *
 * Texts are passed around as a flat list keyed by where they belong:
 *   title          the video's title
 *   s3.l2          scene 3, line 2 of a cartoon story
 *   s3.h, s3.b     scene 3's heading and body in an explainer video
 *   s3.p1          scene 3's second bullet point
 */
export type Texts = Record<string, string>;

const KEY = /^(title|s\d{1,2}\.(l\d{1,2}|h|b|p\d))$/;

export const TranslateRequestSchema = z.object({
  language: z
    .string()
    .trim()
    .min(2, "Please choose a language.")
    .max(LANGUAGE_MAX, "That language name is too long."),
  kind: z.enum(["story", "storyboard"]),
  texts: z
    .record(z.string().regex(KEY), z.string().max(LIMITS.body))
    .refine((texts) => Object.keys(texts).length > 0, "There is nothing to translate.")
    .refine((texts) => Object.keys(texts).length <= 250, "This video has too much text to translate at once."),
});
export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

export const TranslateResponseSchema = z.object({ texts: z.record(z.string(), z.string()) });

/** The longest a text may be where it goes, so a longer language still fits the video's limits. */
export function textLimit(key: string): number {
  if (key === "title") return Math.min(LIMITS.title, STORY_LIMITS.title);
  if (/\.l\d+$/.test(key)) return STORY_LIMITS.lineText;
  if (key.endsWith(".h")) return LIMITS.heading;
  if (key.endsWith(".b")) return LIMITS.body;
  return LIMITS.bullet;
}

export function storyTexts(story: Story): Texts {
  const texts: Texts = { title: story.title };
  story.scenes.forEach((scene, s) =>
    scene.lines.forEach((line, l) => {
      if (line.text.trim()) texts[`s${s}.l${l}`] = line.text;
    }),
  );
  return texts;
}

/** The story with these texts in place. Anything without a matching text is left as it was. */
export function withStoryTexts(story: Story, texts: Texts): Story {
  return {
    ...story,
    title: texts.title ?? story.title,
    scenes: story.scenes.map((scene, s) => ({
      ...scene,
      lines: scene.lines.map((line, l) => ({ ...line, text: texts[`s${s}.l${l}`] ?? line.text })),
    })),
  };
}

export function storyboardTexts(storyboard: Storyboard): Texts {
  const texts: Texts = { title: storyboard.title };
  storyboard.scenes.forEach((scene, s) => {
    if (scene.heading.trim()) texts[`s${s}.h`] = scene.heading;
    if (scene.body.trim()) texts[`s${s}.b`] = scene.body;
    scene.bullets.forEach((bullet, p) => {
      if (bullet.trim()) texts[`s${s}.p${p}`] = bullet;
    });
  });
  return texts;
}

export function withStoryboardTexts(storyboard: Storyboard, texts: Texts): Storyboard {
  return {
    ...storyboard,
    title: texts.title ?? storyboard.title,
    scenes: storyboard.scenes.map((scene, s) => ({
      ...scene,
      heading: texts[`s${s}.h`] ?? scene.heading,
      body: texts[`s${s}.b`] ?? scene.body,
      bullets: scene.bullets.map((bullet, p) => texts[`s${s}.p${p}`] ?? bullet),
    })),
  };
}
