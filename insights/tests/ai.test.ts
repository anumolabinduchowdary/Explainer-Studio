import { beforeEach, describe, expect, it } from "vitest";
import { numbersAreFromFacts, writeReport, type AiClient } from "@/lib/ai";
import { sampleReport } from "@/lib/samples";

const NOW = Date.UTC(2026, 9, 20, 12);

/** A stand-in for OpenAI that gives back the answers it is handed, in order. */
function fakeClient(answers: unknown[]): AiClient & { calls: number } {
  const client = {
    calls: 0,
    responses: {
      parse: async () => {
        const answer = answers[Math.min(client.calls, answers.length - 1)];
        client.calls++;
        return { status: "completed", output_parsed: answer, output: [] };
      },
    },
  };
  return client as unknown as AiClient & { calls: number };
}

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("the AI write-up", () => {
  const report = sampleReport("viral", NOW);
  const extra = { title: report.video.title, short: true, studio: report.studio, baseline: null, now: NOW };

  it("uses the rules' own words when no OpenAI key is set", async () => {
    const writeup = await writeReport(report.analysis, extra);
    expect(writeup.source).toBe("rules");
    expect(writeup.summary).toMatch(/going viral/);
  });

  it("uses OpenAI's words when every number comes from the facts", async () => {
    const good = {
      summary: "This Short is going viral: 18.4K views, 5.6× your usual.",
      reasons: [{ status: "good", text: "YouTube kept showing it in the Shorts feed.", evidence: "85% of views came from YouTube recommending it." }],
      actions: ["Make a follow-up within a week."],
    };
    const client = fakeClient([good]);
    const writeup = await writeReport(report.analysis, extra, { client });
    expect(writeup.source).toBe("ai");
    expect(writeup.summary).toBe(good.summary);
  });

  it("sends back an answer with an invented number, then falls back to the rules", async () => {
    const invented = {
      summary: "This Short got 999,999 views.",
      reasons: [{ status: "good", text: "It did well.", evidence: "Views grew 4321%." }],
      actions: ["Keep going."],
    };
    const client = fakeClient([invented]);
    const writeup = await writeReport(report.analysis, extra, { client });
    expect(client.calls).toBe(2);
    expect(writeup.source).toBe("rules");
  });

  it("checks numbers against the facts text", () => {
    const wire = { summary: "5.6× your usual 3,298", reasons: [], actions: [] };
    expect(numbersAreFromFacts(wire, '{"x":"5.6×","y":"3,298"}')).toBe(true);
    expect(numbersAreFromFacts(wire, '{"x":"5.6×"}')).toBe(false);
  });
});
