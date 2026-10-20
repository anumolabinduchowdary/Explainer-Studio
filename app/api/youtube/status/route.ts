import { insightsConfig } from "@/lib/server/insights";
import { readJson, youtubeRoute } from "@/lib/server/youtube";
import { z } from "zod";

/** Whether a channel is connected in this browser, and whose; and whether uploads go to Video Insights. */
export const POST = youtubeRoute(
  "api/youtube/status",
  { perMinute: 60, read: readJson(z.object({})), needsAccount: false },
  async ({ account, config }) => {
    const insights = insightsConfig() !== null;
    return {
      body: account
        ? { connected: true, email: account.email, privacy: config.privacy, insights }
        : { connected: false, privacy: config.privacy, insights },
    };
  },
);
