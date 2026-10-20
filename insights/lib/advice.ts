import { formatAge, formatClock, formatCount, formatRatio } from "./format";
import type { Analysis, Signal, StudioFacts, Writeup } from "./types";

/**
 * The report in plain words, from the rules alone. Used when no OpenAI key is
 * set or OpenAI could not answer, and given to OpenAI as the facts to explain.
 */

export function headline(analysis: Analysis, short: boolean): string {
  const kind = short ? "Shorts" : "videos";
  const { views, ageHours, ratio, verdict, usual } = analysis;
  const numbers = `${formatCount(views)} views in ${formatAge(ageHours)}`;
  const versus = ratio !== null && usual ? `, ${formatRatio(ratio)} your usual ${formatCount(usual.median)}` : "";
  switch (verdict) {
    case "viral":
      return `This video is going viral for your channel: ${numbers}${versus}.`;
    case "above":
      return `This video is doing better than your usual ${kind}: ${numbers}${versus}.`;
    case "usual":
      return `This video is doing about as well as your usual ${kind}: ${numbers}${versus}.`;
    case "below":
      return `This video is getting fewer views than your usual ${kind}: ${numbers}${versus}.`;
    case "early":
      return `It's too early to judge: the video is only ${formatAge(ageHours)} old (${formatCount(views)} views so far). The first comparison comes after 6 hours, and the full picture after 2–3 days.`;
    case "unknown":
      return `${numbers}. Your channel needs at least 3 earlier videos before the app can tell what “usual” is, so for now the report looks at how viewers behaved.`;
  }
}

/** The signals worth telling, the reasons for the verdict first. */
export function pickReasons(analysis: Analysis): Signal[] {
  const told = analysis.signals.filter((signal) => signal.id !== "reach" && signal.status !== "unknown");
  const positive = analysis.verdict === "viral" || analysis.verdict === "above";
  const lead = told.filter((signal) => signal.status === (positive ? "good" : "bad"));
  const other = told.filter((signal) => signal.status !== (positive ? "good" : "bad"));
  // A private video is always the first reason, whatever the numbers.
  const privacy = told.filter((signal) => signal.id === "privacy");
  return [...privacy, ...lead, ...other].filter((signal, i, all) => all.indexOf(signal) === i).slice(0, 5);
}

function actionFor(signal: Signal, analysis: Analysis, short: boolean): string | null {
  const drop = analysis.charts.retention?.drops[signal.id === "drop2" ? 1 : 0];
  const good = signal.status === "good";
  switch (signal.id) {
    case "privacy":
      return "Make the video public in YouTube Studio (Content → Visibility). It can't spread until it is public.";
    case "hook":
      return good
        ? "Keep opening the way this one does: the first seconds held people."
        : "Open with the most surprising picture or line in the first 2 seconds, for example the question the video answers or the result, and keep titles and logos for later.";
    case "retention":
      return good
        ? "Keep this pace and length; people stayed with it."
        : short
          ? "Make the next one shorter and quicker: cut pauses and any scene that repeats a point."
          : "Trim the slow parts and get to each point sooner; people stopped watching early.";
    case "drop1":
    case "drop2":
      if (!drop) return null;
      return drop.scene
        ? `Look again at scene ${drop.scene.index}${drop.scene.text ? ` (“${drop.scene.text}”)` : ""}: shorten it or make its point quicker. That is where many people left.`
        : `Look again at what happens at ${formatClock(drop.atSec)}: shorten it or make the point quicker. That is where many people left.`;
    case "rewatch":
      return "People replayed one moment. Make more of what happens there: it is what they came for.";
    case "recommended":
      return good
        ? "Post your next video on a similar topic soon, while YouTube is showing your channel to new people."
        : "YouTube showed it to few new people. That usually happens when many viewers leave early, so a stronger start helps most. A clear, specific title also helps YouTube know who it is for.";
    case "outside":
      return "Links shared in apps brought many views. Share each new video in the same groups and pages, and ask viewers to pass it on.";
    case "search":
      return good
        ? "People search for this. Make more videos that answer similar questions, with the same words in the title."
        : "Use the words parents type into search in the title and the first line of the description.";
    case "newViewers":
      return good
        ? "Pin a comment inviting new viewers to subscribe for more on this topic."
        : "To reach new people, make the first seconds clear to someone who has never seen your channel.";
    case "shares":
      return good
        ? "People share this topic. Make a follow-up and end it by asking viewers to send it to someone it would help."
        : "End with one short line asking viewers to share it with someone it would help.";
    case "likes":
    case "comments":
      return good ? null : "Ask one simple question at the end, for example “What has helped your child?”, to invite comments.";
    case "subscribers":
      return good ? null : "In the last seconds, say what the channel offers and ask viewers to subscribe.";
    case "length":
      return "Aim for under 60 seconds for Shorts.";
    case "momentum":
      return good ? "Reply to comments in the next day or two; activity helps keep it spreading." : null;
    default:
      return null;
  }
}

export function pickActions(analysis: Analysis, short: boolean): string[] {
  const actions: string[] = [];
  if (analysis.verdict === "viral") actions.push("Make a follow-up on the same topic within a week, while interest is high.");
  for (const signal of pickReasons(analysis)) {
    const action = actionFor(signal, analysis, short);
    if (action && !actions.includes(action)) actions.push(action);
  }
  if (analysis.verdict === "below" && actions.length < 2) {
    actions.push("Try the same topic again with a different opening and title: the first seconds and the title make the biggest difference.");
  }
  if (analysis.verdict === "early") actions.push("Check back after a day. Nothing needs changing yet.");
  return actions.slice(0, 5);
}

export function rulesWriteup(analysis: Analysis, options: { short: boolean; studio: StudioFacts | null; now: number }): Writeup {
  const { short, now } = options;
  const reasons = pickReasons(analysis);
  let summary = headline(analysis, short);
  const lead = reasons[0];
  if (lead && (analysis.verdict === "viral" || analysis.verdict === "above") && lead.status === "good") {
    summary += ` The main reason: ${lead.title}`;
  } else if (lead && (analysis.verdict === "below" || analysis.verdict === "usual") && lead.status === "bad") {
    summary += ` The main thing holding it back: ${lead.title}`;
  }
  if (analysis.momentum?.trend === "rising") summary += " Views are still speeding up.";
  if (analysis.momentum?.trend === "fading" && analysis.verdict !== "below") summary += " Views are now slowing down.";
  return {
    summary,
    reasons: reasons.map((signal) => ({ status: signal.status, text: signal.title, evidence: signal.detail })),
    actions: pickActions(analysis, short),
    source: "rules",
    writtenAt: now,
  };
}
