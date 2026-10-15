import { z } from "zod";
import { clearCookie } from "@/lib/server/auth/session";
import { YOUTUBE_COOKIE, YOUTUBE_PATH, readJson, revoke, youtubeRoute } from "@/lib/server/youtube";

/** Disconnects the channel: the permission is withdrawn at Google and forgotten here. */
export const POST = youtubeRoute(
  "api/youtube/disconnect",
  { perMinute: 20, read: readJson(z.object({})), needsAccount: false },
  async ({ req, account }) => {
    if (account) await revoke(account.refreshToken);
    return { body: { connected: false }, cookies: [clearCookie(req, YOUTUBE_COOKIE, YOUTUBE_PATH)] };
  },
);
