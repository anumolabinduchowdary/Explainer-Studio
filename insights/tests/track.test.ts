import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/track/route";
import { connectChannel, getVideo } from "@/lib/store";

beforeAll(() => {
  // A fresh database in memory for these tests.
  process.env.INSIGHTS_DATA_DIR = "memory://";
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
});

const body = (videoId: string, channelId = "UCtestchannel000000000001") => ({
  videoId,
  channelId,
  uploadedBy: "ana@example.org",
  studio: {
    kind: "story",
    title: "Signs of speech delay",
    language: "English",
    health: true,
    aiVoices: true,
    durationSec: 45,
    shape: "9:16",
    scenes: [{ startSec: 0, text: "Opening" }],
  },
});

const call = (payload: unknown, secret?: string) =>
  POST(
    new Request("http://localhost:3001/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify(payload),
    }),
  );

describe("POST /api/track (from Explainer Studio)", () => {
  it("is closed until INSIGHTS_SECRET is set", async () => {
    delete process.env.INSIGHTS_SECRET;
    expect((await call(body("vid000001"), "anything")).status).toBe(503);
  });

  it("refuses a missing or wrong secret", async () => {
    process.env.INSIGHTS_SECRET = "s".repeat(40);
    expect((await call(body("vid000001"))).status).toBe(401);
    expect((await call(body("vid000001"), "wrong")).status).toBe(401);
    expect(await getVideo("vid000001")).toBeNull();
  });

  it("refuses ids that are not YouTube ids", async () => {
    const response = await call({ ...body("vid000001"), videoId: "../../etc" }, "s".repeat(40));
    expect(response.status).toBe(400);
  });

  it("keeps a video waiting until its channel is connected, then tracks it", async () => {
    const secret = "s".repeat(40);
    const response = await call(body("vid000001"), secret);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reportUrl: "http://localhost:3001/videos/vid000001", tracking: false });
    expect((await getVideo("vid000001"))?.state).toBe("waiting");

    await connectChannel({ id: "UCtestchannel000000000001", title: "Test", thumbnail: "", token: "sealed" }, "ana@example.org", Date.now());
    expect((await getVideo("vid000001"))?.state).toBe("tracking");

    const second = await call(body("vid000002"), secret);
    expect((await second.json()).tracking).toBe(true);
    expect((await getVideo("vid000002"))?.next_check_at).toBeGreaterThan(Date.now());
  });

  it("will not move a video to another channel", async () => {
    const response = await call(body("vid000001", "UCotherchannel00000000002"), "s".repeat(40));
    expect(response.status).toBe(409);
    expect((await getVideo("vid000001"))?.channel_id).toBe("UCtestchannel000000000001");
  });
});
