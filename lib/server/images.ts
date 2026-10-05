import "server-only";
import { toFile } from "openai";
import type { AspectRatio } from "@/lib/schemas";
import { DEFAULT_ART_STYLE, type ImageRequest } from "@/lib/story";
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
export function imagePrompt(request: ImageRequest): string {
  const style = request.artStyle || DEFAULT_ART_STYLE;
  switch (request.kind) {
    case "character":
      return [
        `Art style: ${style}.`,
        `Draw one single character: ${request.look}`,
        "Show the whole character from head to toe, standing upright in a relaxed, friendly pose, turned slightly towards the right of the picture (three-quarter view).",
        "The mouth is closed in a gentle smile. Eyes open.",
        "Centre the character with a small margin on every side so nothing is cut off.",
        "Transparent background. No ground, no floor shadow, no scenery, no other people, animals or objects apart from what the description mentions.",
        "Draw the character respectfully and realistically proportioned for a cartoon. Any mobility aid or assistive device must look correct and be clearly part of how the character stands.",
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
    case "background":
      return [
        `Art style: ${style}.`,
        `Draw a background for an animated scene: ${request.look}`,
        "Scenery only: absolutely no people, animals, creatures or characters.",
        "View from eye level. Keep the lower third of the picture open and uncluttered, with flat ground or floor where characters will stand later. Soft, simple shapes so characters stand out in front of it.",
        "Fill the whole picture edge to edge.",
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
  if (request.kind === "talking") {
    const base64 = request.reference?.split(",")[1] ?? "";
    const reference = await toFile(Buffer.from(base64, "base64"), "character.png", {
      type: "image/png",
    });
    result = await client.images.edit(
      {
        ...shared,
        model: imageEditModel(),
        image: reference,
        size: PORTRAIT,
        background: "transparent",
      },
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
