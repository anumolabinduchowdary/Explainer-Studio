import { readJson, youtubeRoute } from "@/lib/server/youtube";
import { z } from "zod";

/** Whether a channel is connected in this browser, and whose. */
export const POST = youtubeRoute(
  "api/youtube/status",
  { perMinute: 60, read: readJson(z.object({})), needsAccount: false },
  async ({ account, config }) => ({
    body: account
      ? { connected: true, email: account.email, privacy: config.privacy }
      : { connected: false, privacy: config.privacy },
  }),
);
