import { StartRequestSchema } from "@/lib/youtube";
import { accessToken, readJson, seal, startUpload, youtubeRoute } from "@/lib/server/youtube";

export const maxDuration = 30;

/**
 * Opens an upload on YouTube for the connected channel. The browser gets an
 * encrypted note for sending the pieces; it cannot read the YouTube address
 * or the access token inside it.
 */
export const POST = youtubeRoute(
  "api/youtube/start",
  { perMinute: 10, read: readJson(StartRequestSchema, 20_000) },
  async ({ req, body, config, account }) => {
    const token = await accessToken(config, account, req.signal);
    const session = await startUpload(config, token, body.details, body.size, body.mimeType, req.signal);
    // Access tokens last about an hour; the note expires a little sooner.
    const upload = await seal(config, "youtube-upload", { s: session, at: token, n: body.size }, 55 * 60);
    return { body: { upload } };
  },
);
