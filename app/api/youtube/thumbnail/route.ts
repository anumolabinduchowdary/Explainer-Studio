import { ThumbnailRequestSchema } from "@/lib/youtube";
import { AppError } from "@/lib/server/appError";
import { readJson, setThumbnail, unseal, youtubeRoute } from "@/lib/server/youtube";

export const maxDuration = 30;

/** Sets the thumbnail of the video just uploaded. */
export const POST = youtubeRoute(
  "api/youtube/thumbnail",
  { perMinute: 20, read: readJson(ThumbnailRequestSchema, 3_100_000) },
  async ({ req, body, config }) => {
    const note = await unseal(config, "youtube-upload", body.upload);
    if (typeof note?.at !== "string") {
      throw new AppError("youtube_failed", 410, { message: "This upload has expired, so the thumbnail was not set." });
    }
    const jpeg = new Uint8Array(Buffer.from(body.image.slice(body.image.indexOf(",") + 1), "base64"));
    return { body: await setThumbnail(note.at, body.videoId, jpeg, req.signal) };
  },
);
