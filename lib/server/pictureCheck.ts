import "server-only";
import { z } from "zod";
import type { PictureCheck } from "@/lib/quality";
import { generateStructured, type OpenAIClient } from "./openai";

/** The model that looks at pictures. Defaults to the text model. */
function visionModel(): string | undefined {
  return process.env.OPENAI_VISION_MODEL?.trim() || undefined;
}

const PictureCheckWireSchema = z.object({ matches: z.boolean(), problems: z.array(z.string()) });

const CHARACTER_CHECK = `You check one drawing made for a family cartoon against its description, before it is used in a video.

The drawing is fine (matches: true) when it is a single cartoon character, not a photograph, and the important details match the description: rough age, skin tone, hair, the main clothes and their colours, glasses, and any wheelchair, walker, crutches, braces, hearing aid or other aid, drawn in a way that makes sense. Small differences of style or shade do not matter.

Set matches to false only for clear, important problems, such as: a missing or badly drawn mobility aid (for example a wheelchair without wheels), the wrong age or gender, very different clothes or skin tone, more than one person, extra or missing limbs, text or watermarks, or anything frightening or disrespectful.

problems: for each problem, one short instruction for the artist's redraw, for example "Give the wheelchair two large back wheels and two small front wheels". Empty when the drawing is fine.`;

const BACKGROUND_CHECK = `You check one background drawing made for a family cartoon against its description, before it is used in a video.

The background is fine (matches: true) when it is a cartoon or illustration of the described place as one single, continuous scene at one time of day, with no people or animals in it, no text or watermarks, and an open floor area in the lower part where characters can stand. Small differences of style do not matter.

Set matches to false only for clear problems: people or animals in it, text, the wrong kind of place, a cluttered floor where nobody could stand, or a picture split into two or more panels or showing two different times of day (for example a daytime half and a night-time half).

problems: for each problem, one short instruction for the artist's redraw. Empty when the background is fine.`;

const EXERCISE_CHECK = `You check one instruction picture made for a home exercise programme against its description, before it is used in a video.

The picture is fine (matches: true) when it is a cartoon or illustration (not a photograph) that clearly shows the described exercise position, with a natural and safe-looking posture, only the people and equipment described, and no text or watermarks. Small differences of style do not matter.

Set matches to false only for clear problems: the wrong position or exercise, an unsafe or impossible posture, extra or missing limbs, a missing mat or piece of equipment the description needs, text, or anything frightening or disrespectful.

problems: for each problem, one short instruction for the artist's redraw. Empty when the picture is fine.`;

const CHECKS = { character: CHARACTER_CHECK, background: BACKGROUND_CHECK, exercise: EXERCISE_CHECK } as const;

/** Compares a drawing with its description. */
export function checkPicture(
  client: OpenAIClient,
  request: { kind: keyof typeof CHECKS; look: string; image: string },
  signal?: AbortSignal,
): Promise<PictureCheck> {
  return generateStructured({
    client,
    name: "picture_check",
    instructions: CHECKS[request.kind],
    input: `Description:\n"""\n${request.look}\n"""`,
    image: request.image,
    model: visionModel(),
    schema: PictureCheckWireSchema,
    refine: (wire) => {
      const problems = wire.problems.map((problem) => problem.trim().slice(0, 200)).filter(Boolean).slice(0, 5);
      // A "no" with nothing to fix cannot guide a redraw, so it counts as a match.
      return { matches: wire.matches || problems.length === 0, problems: wire.matches ? [] : problems };
    },
    maxOutputTokens: 1500,
    signal,
  });
}
