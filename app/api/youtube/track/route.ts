import { TrackRequestSchema } from "@/lib/youtube";
import { AppError } from "@/lib/server/appError";
import { insightsConfig, trackUpload } from "@/lib/server/insights";
import { readJson, unseal, youtubeRoute } from "@/lib/server/youtube";

export const maxDuration = 30;

/**
 * Tells the Video Insights app about a video this browser has just posted,
 * so it can follow how the video does. The upload's receipt proves which
 * video and channel it was. Does nothing when Insights is not set up.
 */
export const POST = youtubeRoute(
  "api/youtube/track",
  { perMinute: 10, read: readJson(TrackRequestSchema, 20_000) },
  async ({ req, body, config, user }) => {
    const receipt = await unseal(config, "youtube-receipt", body.receipt);
    if (typeof receipt?.v !== "string" || typeof receipt.c !== "string") {
      throw new AppError("invalid_input", 403, { message: "This upload's receipt is not valid or has expired." });
    }
    const insights = insightsConfig();
    if (!insights) return { body: { reportUrl: null, tracking: false } };
    const result = await trackUpload(
      insights,
      { videoId: receipt.v, channelId: receipt.c, ...(user?.email ? { uploadedBy: user.email } : {}), studio: body.studio },
      req.signal,
    );
    return { body: result };
  },
);
