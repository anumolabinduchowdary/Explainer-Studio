import { insightsSecret } from "@/lib/config";
import { bearer, requestOrigin, sameSecret } from "@/lib/session";
import { trackVideo } from "@/lib/store";
import { TrackRequestSchema } from "@/lib/types";

/**
 * Explainer Studio calls this after each upload, with the shared secret
 * INSIGHTS_SECRET. Nothing else may call it.
 */
export async function POST(req: Request): Promise<Response> {
  const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const secret = insightsSecret();
  if (!secret) return json({ error: { message: "INSIGHTS_SECRET is not set on Video Insights." } }, 503);
  if (!sameSecret(bearer(req), secret)) return json({ error: { message: "Wrong or missing secret." } }, 401);

  const text = await req.text();
  if (text.length > 64_000) return json({ error: { message: "That request is too large." } }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: { message: "The request was not valid JSON." } }, 400);
  }
  const parsed = TrackRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: { message: parsed.error.issues[0]?.message ?? "The request was not valid." } }, 400);

  const { videoId, channelId, uploadedBy, studio } = parsed.data;
  try {
    const result = await trackVideo({ id: videoId, channelId, uploadedBy: uploadedBy ?? null, studio }, Date.now());
    if (!result.sameChannel) return json({ error: { message: "This video is already tracked for another channel." } }, 409);
    return json({ reportUrl: `${requestOrigin(req)}/videos/${videoId}`, tracking: result.tracking });
  } catch (err) {
    console.error(`[track] ${err instanceof Error ? err.name : "error"}`);
    return json({ error: { message: "The video could not be saved. Please try again." } }, 500);
  }
}
