import { MAX_CHECK_IMAGE_CHARS, PictureCheckRequestSchema } from "@/lib/quality";
import { createPostHandler } from "@/lib/server/handler";
import { checkPicture } from "@/lib/server/pictureCheck";
import { imagesPerMinute } from "@/lib/server/rateLimit";

export const maxDuration = 60;

/** Looks at a drawing and says whether it matches its description, and if not, what to fix. */
export const POST = createPostHandler({
  route: "api/check/picture",
  schema: PictureCheckRequestSchema,
  rateLimit: { bucket: "images", perMinute: imagesPerMinute },
  maxBodyChars: MAX_CHECK_IMAGE_CHARS + 2_000,
  async run({ body, client, signal }) {
    return checkPicture(client, body, signal);
  },
});
