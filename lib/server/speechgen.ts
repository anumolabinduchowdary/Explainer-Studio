import "server-only";
import { z } from "zod";
import { VOICE_AGE_SETTINGS, type SpeechRequest } from "@/lib/story";
import { ageRate, type VoiceOption } from "@/lib/voices";
import { AppError } from "./appError";
import { missingSetting } from "./openai";

/**
 * SpeechGen (speechgen.io) as the voice service.
 *
 * It is used instead of OpenAI's voices when SPEECHGEN_API_TOKEN and
 * SPEECHGEN_EMAIL are set on the server. Like the OpenAI key, the token is
 * read from the environment only: it is sent to SpeechGen in the body of a
 * POST request and is never logged, put in a URL or sent to the browser.
 *
 * API reference: https://speechgen.io/en/node/api/
 */

const DEFAULT_API = "https://speechgen.io/index.php?r=api";
const MAX_AUDIO_BYTES = 8_000_000;

/** SpeechGen's methods are named in the query string: index.php?r=api/text */
function endpoint(method: string): string {
  const base = process.env.SPEECHGEN_API_URL?.trim() || DEFAULT_API;
  return `${base}/${method}`;
}

export type SpeechgenCredentials = { token: string; email: string };

/** The account to use, or null when SpeechGen is not set up and OpenAI's voices are used. */
export function speechgenCredentials(): SpeechgenCredentials | null {
  const token = process.env.SPEECHGEN_API_TOKEN?.trim();
  const email = process.env.SPEECHGEN_EMAIL?.trim();
  if (!token && !email) return null;
  // SpeechGen needs both; half a setup is reported instead of silently ignored.
  if (!token) {
    throw new AppError("server_misconfigured", 500, { message: missingSetting("SPEECHGEN_API_TOKEN") });
  }
  if (!email) {
    throw new AppError("server_misconfigured", 500, { message: missingSetting("SPEECHGEN_EMAIL") });
  }
  return { token, email };
}

/** Which accent to prefer when a language has several, e.g. "Indian" for English (Indian). */
function preferredAccent(): string {
  return process.env.SPEECHGEN_ACCENT?.trim() ?? "Indian";
}

/* ------------------------------------------------------------------ */
/* The voice list                                                      */
/* ------------------------------------------------------------------ */

const RawVoiceSchema = z.object({
  voice: z.string().min(1),
  /** "female", "male", "girl", "boy", "grandpa" or "neutral". */
  sex: z.string().optional(),
  /** "pro", "hd" or "base". */
  type: z.string().optional(),
  /** Speaking styles the voice can act, on the few voices that have them. */
  styles: z.array(z.object({ value: z.string() })).optional(),
});
type RawVoice = z.infer<typeof RawVoiceSchema>;

/** Language name -> voices, exactly as SpeechGen lists them. */
const CatalogueSchema = z.record(z.string(), z.array(RawVoiceSchema));
export type Catalogue = z.infer<typeof CatalogueSchema>;

const CATALOGUE_TTL_MS = 6 * 60 * 60 * 1000;
let cached: { at: number; catalogue: Catalogue } | null = null;

export function resetCatalogueCache() {
  cached = null;
}

const isAbort = (err: unknown) =>
  err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");

/** SpeechGen's public list of voices. It changes rarely, so it is kept for a few hours. */
export async function loadCatalogue(signal?: AbortSignal): Promise<Catalogue> {
  if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return cached.catalogue;
  try {
    const response = await fetch(endpoint("voices"), { signal, cache: "no-store" });
    if (!response.ok) throw new Error("The voice list could not be read.");
    const catalogue = CatalogueSchema.parse(await response.json());
    if (Object.keys(catalogue).length === 0) throw new Error("The voice list is empty.");
    cached = { at: Date.now(), catalogue };
    return catalogue;
  } catch (err) {
    // An older list is better than none.
    if (cached) return cached.catalogue;
    if (isAbort(err)) throw err;
    throw new AppError("voice_busy", 503);
  }
}

function toOption(voice: RawVoice, label: string): VoiceOption {
  const sex = voice.sex?.toLowerCase() ?? "";
  const gender = ["female", "girl", "grandma"].includes(sex)
    ? "female"
    : ["male", "boy", "grandpa"].includes(sex)
      ? "male"
      : "neutral";
  const age = sex === "girl" || sex === "boy" ? "child" : sex === "grandpa" || sex === "grandma" ? "older" : "adult";
  return { id: voice.voice, label, gender, age };
}

/** Other ways people write a language or accent. */
const ALIASES: Record<string, string> = {
  american: "us",
  usa: "us",
  uk: "british",
  india: "indian",
  mandarin: "chinese",
  farsi: "persian",
};
const words = (text: string) => (text.toLowerCase().match(/\p{L}+/gu) ?? []).map((word) => ALIASES[word] ?? word);

const TYPE_ORDER: Record<string, number> = { pro: 0, hd: 1, base: 2 };
const byQuality = (a: RawVoice, b: RawVoice) => (TYPE_ORDER[a.type ?? ""] ?? 3) - (TYPE_ORDER[b.type ?? ""] ?? 3);

const MAX_MAIN_VOICES = 80;
const MAX_EXTRA_VOICES = 40;

/**
 * The voices to offer for a story in `language`, best first.
 *
 * SpeechGen lists some 6,000 voices in 145 languages and accents, so the list
 * is narrowed to one accent of the story's language (the preferred accent if
 * the language has it), followed by the real children's and older voices of
 * that language's other accents. For example, for "English" with the accent
 * "Indian": every English (Indian) voice, then the children's voices of
 * English US, British and Australian, since Indian English has none.
 */
export function voicesForLanguage(
  catalogue: Catalogue,
  language: string,
  accent: string = preferredAccent(),
): VoiceOption[] {
  const names = Object.keys(catalogue).filter((name) => catalogue[name].length > 0);
  const accentWord = words(accent)[0];
  const rank = (wanted: ReadonlySet<string>) =>
    names
      .map((name, index) => {
        const nameWords = words(name);
        return {
          name,
          index,
          nameWords,
          score: nameWords.filter((word) => wanted.has(word)).length,
          accented: accentWord ? nameWords.includes(accentWord) : false,
        };
      })
      .filter((group) => group.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.accented) - Number(a.accented) ||
          a.name.length - b.name.length ||
          a.index - b.index,
      );

  let wanted = new Set(words(language));
  let ranked = rank(wanted);
  if (ranked.length === 0) {
    wanted = new Set(["english"]);
    ranked = rank(wanted);
  }
  const main = ranked[0];
  if (!main) return [];

  // The language itself ("english"), as opposed to the accent ("indian").
  const family = main.nameWords.find((word) => wanted.has(word) && word !== accentWord) ?? main.nameWords[0];
  const mainVoices = [...catalogue[main.name]]
    .sort(byQuality)
    .slice(0, MAX_MAIN_VOICES)
    .map((voice) => toOption(voice, voice.voice));
  const extras = names
    .filter((name) => name !== main.name && words(name).includes(family))
    .flatMap((name) =>
      [...catalogue[name]].sort(byQuality).map((voice) => toOption(voice, `${voice.voice} (${name})`)),
    )
    .filter((voice) => voice.age !== "adult")
    .slice(0, MAX_EXTRA_VOICES);
  return [...mainVoices, ...extras];
}

function findVoice(catalogue: Catalogue, name: string): RawVoice | undefined {
  for (const voices of Object.values(catalogue)) {
    const found = voices.find((voice) => voice.voice === name);
    if (found) return found;
  }
  return undefined;
}

/** A speaking style the voice supports that the character's manner mentions, e.g. "cheerful". */
function matchingStyle(voice: RawVoice, manner: string | undefined): string | undefined {
  if (!manner || !voice.styles?.length) return undefined;
  const mentioned = new Set(words(manner));
  return voice.styles.find((style) => mentioned.has(style.value.toLowerCase()))?.value;
}

/* ------------------------------------------------------------------ */
/* Speaking a line                                                     */
/* ------------------------------------------------------------------ */

const ReplySchema = z.object({
  /** 1 = ready, 0 = still working, -1 = failed. */
  status: z.coerce.number(),
  id: z.union([z.string(), z.number()]).optional(),
  file: z.string().nullish(),
  error: z.string().nullish(),
});
type Reply = z.infer<typeof ReplySchema>;

async function call(method: string, fields: Record<string, string>, signal?: AbortSignal): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(endpoint(method), {
      method: "POST",
      // Form fields in the body, as SpeechGen expects. The token never goes in the URL.
      body: new URLSearchParams(fields),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new AppError("voice_busy", 503);
  }
  if (response.status === 401 || response.status === 403) throw new AppError("voice_key_invalid", 401);
  if (!response.ok) throw new AppError("voice_busy", 503);
  try {
    return ReplySchema.parse(await response.json());
  } catch {
    throw new AppError("voice_busy", 503);
  }
}

/**
 * SpeechGen reports failures as a sentence. It is sorted into one of our own
 * errors and never passed on or logged, since it may repeat the request.
 */
function speechgenError(message: string | null | undefined): AppError {
  const text = (message ?? "").toLowerCase();
  if (/token|e-?mail|auth|account|user|access|denied/.test(text)) return new AppError("voice_key_invalid", 401);
  if (/balan|limit|money|fund|credit|pay|tariff|subscri/.test(text)) return new AppError("voice_credit", 402);
  if (/voice|speaker/.test(text)) return new AppError("voice_unavailable", 422);
  return new AppError("voice_busy", 503);
}

/** The finished recording is fetched from the link SpeechGen returns. */
async function download(link: string, signal?: AbortSignal): Promise<string> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new AppError("voice_busy", 502);
  }
  // Only public HTTPS links are followed (or the API's own address, for local testing).
  const sameAsApi = url.origin === new URL(endpoint("text")).origin;
  const publicHttps =
    url.protocol === "https:" &&
    url.hostname.includes(".") &&
    !/^[\d.]+$/.test(url.hostname) &&
    !url.hostname.includes(":") &&
    !/\.(local|internal|localhost)$/.test(url.hostname);
  if (!sameAsApi && !publicHttps) throw new AppError("voice_busy", 502);

  let response: Response;
  try {
    response = await fetch(url, { signal, cache: "no-store" });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new AppError("voice_busy", 503);
  }
  if (!response.ok) throw new AppError("voice_busy", 503);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) throw new AppError("bad_model_output", 502);
  return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Turns one line into speech with SpeechGen and returns it as an MP3 data URL. */
export async function speakWithSpeechgen(
  credentials: SpeechgenCredentials,
  request: SpeechRequest,
  signal?: AbortSignal,
): Promise<string> {
  const catalogue = await loadCatalogue(signal);
  const voice = findVoice(catalogue, request.voice);
  if (!voice) throw new AppError("voice_unavailable", 422);

  const age = request.age ?? "adult";
  // An adult voice playing a child is pitched up in the browser, which also speeds it
  // up, so it is asked to speak a little slower. A real child's voice is left alone.
  const shifted = ageRate(age, toOption(voice, voice.voice)) !== 1;
  const style = matchingStyle(voice, request.style);
  const account = { token: credentials.token, email: credentials.email };

  let reply = await call(
    "text",
    {
      ...account,
      voice: voice.voice,
      text: request.text,
      format: "mp3",
      speed: (shifted ? VOICE_AGE_SETTINGS[age].pace : 1).toFixed(2),
      ...(style ? { style } : {}),
    },
    signal,
  );
  // Short lines are normally ready at once. If not, ask again for a little while.
  for (let attempt = 0; reply.status === 0 && reply.id !== undefined && attempt < 8; attempt++) {
    await sleep(1500, signal);
    reply = await call("result", { ...account, id: String(reply.id) }, signal);
  }
  if (reply.status === 0) throw new AppError("voice_busy", 503);
  if (reply.status !== 1 || !reply.file) throw speechgenError(reply.error);
  return download(reply.file, signal);
}
