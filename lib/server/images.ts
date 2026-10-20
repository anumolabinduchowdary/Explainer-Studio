import "server-only";
import { toFile } from "openai";
import type { AspectRatio } from "@/lib/schemas";
import { DEFAULT_ART_STYLE, type Emotion, type ImageRequest } from "@/lib/story";
import { AppError } from "./appError";
import { missingSetting, type OpenAIClient } from "./openai";

/** Image model names come from the environment, like the text model. */
function imageModel(): string {
  const model = process.env.OPENAI_IMAGE_MODEL?.trim();
  if (!model) {
    throw new AppError("server_misconfigured", 500, { message: missingSetting("OPENAI_IMAGE_MODEL") });
  }
  return model;
}

/** Optional separate model for redrawing a character with its mouth open. */
function imageEditModel(): string {
  return process.env.OPENAI_IMAGE_EDIT_MODEL?.trim() || imageModel();
}

type ImageQuality = "low" | "medium" | "high" | "auto";

function imageQuality(): ImageQuality | undefined {
  const quality = process.env.OPENAI_IMAGE_QUALITY?.trim();
  return quality ? (quality as ImageQuality) : undefined;
}

const PORTRAIT = "1024x1536";

function backgroundSize(aspectRatio: AspectRatio): string {
  if (aspectRatio === "16:9") return "1536x1024";
  if (aspectRatio === "1:1") return "1024x1024";
  return PORTRAIT;
}

const NO_EXTRAS = "No text, letters, numbers, captions, logos or watermarks anywhere in the picture.";

/**
 * The prompts sent to the image model. They are deliberately fixed and plain
 * so every picture in a story shares one look. Styles are described in words;
 * we never ask for an artist's, studio's or existing character's style.
 */
/** What each feeling looks like on a cartoon face, for the artist. */
const EXPRESSION_FACES: Record<Exclude<Emotion, "neutral">, string> = {
  happy: "a big warm smile with the mouth closed, cheerful crinkled eyes and raised cheeks.",
  sad: "eyes looking a little down, the inner ends of the eyebrows raised, and a small downturned mouth.",
  angry: "eyebrows drawn down and together, narrowed eyes and a tight, straight frown; cross, not scary.",
  surprised: "wide open eyes, eyebrows raised high and the mouth in a small round 'o'.",
  worried: "eyebrows raised and pinched together in the middle, eyes looking to one side, and a small uncertain mouth.",
};

const feeling = (request: ImageRequest): Exclude<Emotion, "neutral"> =>
  request.emotion && request.emotion !== "neutral" ? request.emotion : "happy";

export function imagePrompt(request: ImageRequest): string {
  const prompt = basePrompt(request);
  return request.fix ? `${prompt} Important, the last attempt got this wrong, so make sure: ${request.fix}` : prompt;
}

/** Whether the character uses a wheelchair: then they sit in it in every picture, and it flies with them. */
export function usesWheelchair(look: string): boolean {
  return /wheel\s?-?chair|వీల్\s?చైర్|వీల్‌చైర్|व्हीलचेयर|व्हील चेयर/i.test(look);
}

/** Where the character stays when only part of them changes: on their feet, or in their wheelchair. */
const stayPut = (look: string) =>
  usesWheelchair(look)
    ? "sitting in the same wheelchair in the same place, with the wheels where they are now"
    : "standing in the same place with the feet where they are now";

function basePrompt(request: ImageRequest): string {
  const style = request.artStyle || DEFAULT_ART_STYLE;
  const seated = usesWheelchair(request.look);
  switch (request.kind) {
    case "character":
      return [
        `Art style: ${style}.`,
        `Draw one single cartoon character, as an illustration and never a photograph: ${request.look}`,
        seated
          ? "Show the whole character and the whole wheelchair, sitting comfortably in it with both wheels on the ground, in a relaxed, friendly pose, turned slightly towards the right of the picture (three-quarter view)."
          : "Show the whole character from head to toe, standing upright in a relaxed, friendly pose, turned slightly towards the right of the picture (three-quarter view).",
        "The mouth is closed in a gentle smile. Eyes open.",
        "Centre the character with a small margin on every side so nothing is cut off.",
        "Transparent background. No ground, no floor shadow, no scenery, no other people, animals or objects apart from what the description mentions.",
        "Draw the character respectfully and realistically proportioned for a cartoon. Any mobility aid or assistive device must look correct and be clearly part of how the character sits or stands.",
        NO_EXTRAS,
      ].join(" ");
    case "talking":
      return [
        `This is a cartoon character for an animation: ${request.look}`,
        "Redraw exactly the same character: the same drawing, pose, size, position, clothes, colours and outline. Do not move or resize anything.",
        "Change one thing only: the mouth is now open as if the character is in the middle of saying a word.",
        "Keep the background transparent.",
        NO_EXTRAS,
      ].join(" ");
    case "gesture":
      return [
        `This is a cartoon character for an animation: ${request.look}`,
        `Redraw exactly the same character: the same drawing style, face, hair, clothes, colours, outline and size, ${stayPut(request.look)}.`,
        "Change the arms only: the character lifts one hand to about chest height with an open palm, the way people do when explaining something in conversation.",
        "If the character holds or uses a walker, wheelchair, cane or any other aid, keep it exactly as it is and keep a hand on it; gesture with the free hand only. If the character has no arms, tilt the body slightly instead.",
        "The mouth stays closed in a gentle smile. Keep the background transparent.",
        NO_EXTRAS,
      ].join(" ");
    case "explain":
      return [
        `This is a cartoon character for an animation: ${request.look}`,
        `Redraw exactly the same character: the same drawing style, face, hair, clothes, colours, outline and size, ${stayPut(request.look)}.`,
        "Change the arms only: both hands are held open in front of the body at waist height, palms turned up, the way people do when they explain something warmly.",
        "If the character holds or uses a walker, wheelchair, cane or any other aid, keep it exactly as it is and keep a hand on it; open the free hand only. If the character has no arms, tilt the body slightly instead.",
        "The mouth stays closed in a gentle smile. Keep the background transparent.",
        NO_EXTRAS,
      ].join(" ");
    case "flying":
      return [
        `This is a cartoon character for an animation: ${request.look}`,
        "Redraw exactly the same character in the same drawing style, with the same face, hair, clothes, colours and outline, now flying through the air like a hero in an action scene.",
        seated
          ? "They stay sitting in their wheelchair, which soars through the air like a chariot, tilted slightly forward and heading to the right of the picture: one arm raised forward in excitement, hair and clothes streaming backwards in the wind. The wheelchair must still look correct."
          : "The body is stretched out almost level, heading to the right of the picture: one arm reaching forward, the other along the body, legs together and trailing behind, clothes and any tail or scarf streaming backwards in the wind.",
        "A brave, determined face with a slight smile. Show the whole character with nothing cut off. Keep the background transparent: no sky, clouds, ground or effects.",
        NO_EXTRAS,
      ].join(" ");
    case "expression":
      return [
        `This is a cartoon character for an animation: ${request.look}`,
        `Redraw exactly the same character: the same drawing style, pose, body, hair, clothes, colours, outline and size, ${stayPut(request.look)}. Do not move or resize anything.`,
        `Change the face only, to a clearly ${feeling(request)} expression: ${EXPRESSION_FACES[feeling(request)]}`,
        "Keep it gentle and suitable for a children's cartoon, never frightening. Keep the background transparent.",
        NO_EXTRAS,
      ].join(" ");
    case "exercise":
      return [
        `Art style: ${style}.`,
        `Draw a clear, friendly instruction picture for a home exercise: ${request.look}`,
        "Show the whole body from a side or three-quarter view so the position is easy to see and copy, with a natural, safe posture.",
        "Use a plain, light background, with a soft mat if the exercise is done on the floor. Show only the people and equipment the description mentions.",
        "Draw everyone respectfully. Any mobility aid or assistive device must look correct.",
        NO_EXTRAS,
      ].join(" ");
    case "background":
      return [
        `Art style: ${style}.`,
        `Draw a background for an animated scene: ${request.look}`,
        "Scenery only: absolutely no people, animals, creatures or characters.",
        "View from eye level. Keep the lower third of the picture open and uncluttered, with flat ground or floor where characters will stand later. Soft, simple shapes so characters stand out in front of it.",
        "Fill the whole picture edge to edge with one single, continuous scene at one time of day: never split it into two or more panels or frames, and never show two moments together (such as day and night).",
        NO_EXTRAS,
      ].join(" ");
  }
}

/** Asks the image model for one picture and returns it as a WebP data URL. */
export async function generatePicture(
  client: OpenAIClient,
  request: ImageRequest,
  signal?: AbortSignal,
): Promise<string> {
  const quality = imageQuality();
  const shared = {
    prompt: imagePrompt(request),
    n: 1,
    // WebP keeps transparency and stays small enough for one serverless response.
    output_format: "webp" as const,
    output_compression: 85,
    ...(quality ? { quality } : {}),
  };

  let result;
  if (["talking", "gesture", "explain", "expression", "flying"].includes(request.kind)) {
    const base64 = request.reference?.split(",")[1] ?? "";
    const reference = await toFile(Buffer.from(base64, "base64"), "character.png", {
      type: "image/png",
    });
    result = await client.images.edit(
      {
        ...shared,
        model: imageEditModel(),
        image: reference,
        // A flying body lies level, so it gets a wide picture.
        size: request.kind === "flying" ? "1536x1024" : PORTRAIT,
        background: "transparent",
      },
      { signal },
    );
  } else if (request.kind === "exercise") {
    result = await client.images.generate(
      { ...shared, model: imageModel(), size: "1024x1024", background: "opaque" },
      { signal },
    );
  } else {
    const character = request.kind === "character";
    result = await client.images.generate(
      {
        ...shared,
        model: imageModel(),
        size: character ? PORTRAIT : backgroundSize(request.aspectRatio),
        background: character ? "transparent" : "opaque",
      },
      { signal },
    );
  }

  const base64 = result.data?.[0]?.b64_json;
  if (!base64) throw new AppError("bad_model_output", 502);
  return `data:image/webp;base64,${base64}`;
}
