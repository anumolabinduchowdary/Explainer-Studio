import "server-only";
import { z } from "zod";
import { disclaimerIn, withoutDisclaimer } from "@/lib/disclaimer";
import { SOURCE_IDS, TRUSTED_SOURCES, type FactChange, type FactCheckResult } from "@/lib/quality";
import { textLimit, type Texts } from "@/lib/translate";

/** What the model returns: the items it fixed, and the sources it chose. */
export const FactCheckWireSchema = z.object({
  fixes: z.array(z.object({ id: z.string(), fixed: z.string(), reason: z.string() })),
  sources: z.array(z.enum(SOURCE_IDS)),
});
export type FactCheckWire = z.infer<typeof FactCheckWireSchema>;

export type FactCheckJob = {
  items: Array<{ id: string; text: string; max: number }>;
  /** The disclaimer each item ends with, put back after fixing. */
  endings: Map<string, string>;
  original: Texts;
};

/** Prepares the texts. The health disclaimer is fixed wording, so it is taken out first and never changed. */
export function prepareFactCheck(texts: Texts): FactCheckJob {
  const items: FactCheckJob["items"] = [];
  const endings = new Map<string, string>();
  for (const [id, text] of Object.entries(texts)) {
    const ending = disclaimerIn(text);
    const rest = ending ? withoutDisclaimer(text) : text.trim();
    if (!rest) continue;
    if (ending) endings.set(id, ending);
    items.push({ id, text: rest, max: textLimit(id) - (ending ? ending.length + 1 : 0) });
  }
  return { items, endings, original: texts };
}

function fit(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Applies the fixes, keeping only real changes to items that exist, and turns source ids into names and links. */
export function finishFactCheck(job: FactCheckJob, wire: FactCheckWire): FactCheckResult {
  const byId = new Map(job.items.map((item) => [item.id, item]));
  const texts: Texts = {};
  const changes: FactChange[] = [];
  for (const fix of wire.fixes) {
    const item = byId.get(fix.id.trim());
    const fixed = fix.fixed.trim();
    // An empty fix or one for an unknown item is ignored: lines are never silently deleted.
    if (!item || !fixed || fixed === item.text || texts[item.id] !== undefined) continue;
    const ending = job.endings.get(item.id);
    const after = fit(fixed, item.max);
    texts[item.id] = ending ? `${after} ${ending}` : after;
    changes.push({ key: item.id, before: item.text, after, reason: fix.reason.trim().slice(0, 200) || "Made more accurate." });
  }
  const sources = [...new Set(wire.sources)]
    .slice(0, 3)
    .map((id) => TRUSTED_SOURCES.find((source) => source.id === id))
    .filter((source): source is (typeof TRUSTED_SOURCES)[number] => Boolean(source))
    .map(({ name, url }) => ({ name, url }));
  return { texts, changes, sources, checked: job.items.length };
}
