import { describe, expect, it } from "vitest";
import { CAST_FILE_APP, buildCastFile, characterPoses, matchCast, parseCastFile, storyWithCast } from "@/lib/cast";
import { slugify } from "@/lib/download";
import { DEFAULT_ART_STYLE, StorySchema, pictureKey, type Story } from "@/lib/story";

const PICTURE = "data:image/webp;base64,UklGRiQAAABXRUJQ";
const KARTHI = "A cheerful seven-year-old Indian boy with curly black hair, sitting in a black manual wheelchair, wearing a red superhero vest.";
const ANJANEYA = "Sri Anjaneya Swamy as a kind, strong divine monkey hero with golden-orange fur and a small golden crown.";

const episode = (characters: Array<{ id: string; name: string; look: string; voice?: string }>, places = [{ id: "l1", name: "Room", look: "A bright child's bedroom with cricket posters." }]): Story =>
  StorySchema.parse({
    title: "హనుమంతుడి ధైర్యం",
    aspectRatio: "9:16",
    artStyle: "bold comic cartoon",
    narratorVoice: "sage",
    characters: characters.map((character) => ({
      size: "small",
      voice: character.voice ?? "verse",
      voiceAge: "child",
      voiceStyle: "",
      ...character,
    })),
    locations: places,
    scenes: [{ id: "s1", locationId: places[0].id, onStage: characters.map((c) => c.id).slice(0, 5), lines: [{ speaker: "c1", text: "Hi." }] }],
  });

describe("saving a cast", () => {
  it("keeps every drawn pose of each character, their voice and the places, and leaves out the undrawn", () => {
    const story = episode([
      { id: "c1", name: "Karthi", look: KARTHI, voice: "Puck" },
      { id: "c2", name: "Anjaneya", look: ANJANEYA },
    ]);
    const drawn = new Map([
      [pictureKey.character("c1"), PICTURE],
      [pictureKey.talking("c1"), PICTURE],
      [pictureKey.expression("c1", "happy"), PICTURE],
      [pictureKey.flying("c1"), PICTURE],
      [pictureKey.place("l1"), PICTURE],
    ]);
    const file = buildCastFile(story, (key) => drawn.get(key), new Date("2026-10-20T10:00:00Z"));
    expect(file.app).toBe(CAST_FILE_APP);
    expect(file.artStyle).toBe("bold comic cartoon");
    // Anjaneya has no standing picture yet, so he isn't saved.
    expect(file.characters.map((character) => character.name)).toEqual(["Karthi"]);
    expect(Object.keys(file.characters[0].pictures).sort()).toEqual(["character", "expression:happy", "flying", "talking"]);
    expect(file.characters[0]).toMatchObject({ look: KARTHI, voice: "Puck", voiceAge: "child" });
    expect(file.places).toEqual([{ name: "Room", look: "A bright child's bedroom with cricket posters.", aspectRatio: "9:16", picture: PICTURE }]);
    // Saved and read back, it is the same.
    expect(parseCastFile(JSON.stringify(file))).toEqual(file);
  });

  it("names the file after the story, keeping Telugu vowel signs", () => {
    expect(slugify("హనుమంతుడి ధైర్యం")).toBe("హనుమంతుడి-ధైర్యం");
    expect(slugify("Karthi & Anjaneya!")).toBe("karthi-anjaneya");
  });

  it("refuses files that are not a saved cast, or were changed to hold something else", () => {
    expect(() => parseCastFile("not json")).toThrow("isn't a saved cast");
    expect(() => parseCastFile(JSON.stringify({ hello: "world" }))).toThrow("isn't a saved cast");
    const story = episode([{ id: "c1", name: "Karthi", look: KARTHI }]);
    const file = buildCastFile(story, (key) => (key === pictureKey.character("c1") ? PICTURE : undefined), new Date());
    const tampered = { ...file, characters: [{ ...file.characters[0], pictures: { character: "javascript:alert(1)" } }] };
    expect(() => parseCastFile(JSON.stringify(tampered))).toThrow();
  });

  it("covers every pose the app draws, with a different key for each", () => {
    const poses = characterPoses("c1");
    expect(new Set(poses.map(([, key]) => key)).size).toBe(poses.length);
    expect(poses.map(([pose]) => pose)).toEqual(expect.arrayContaining(["character", "talking", "gesture", "explain", "flying", "expression:sad", "expression-talking:sad"]));
  });
});

describe("loading a cast into a new episode", () => {
  const saved = (() => {
    const story = episode(
      [
        { id: "c1", name: "Karthi", look: KARTHI, voice: "Puck" },
        { id: "c2", name: "Anjaneya", look: ANJANEYA, voice: "Algenib" },
      ],
      [{ id: "l1", name: "Karthi's room", look: "A bright child's bedroom with cricket posters." }],
    );
    return buildCastFile(story, (key) => (key.startsWith("character:") || key.startsWith("place:") ? PICTURE : undefined), new Date());
  })();

  it("matches characters by name, or by a description that is mostly the same, each only once", () => {
    const next = episode([
      { id: "c1", name: "Amma", look: "A warm Indian mother in a green saree." },
      { id: "c2", name: "karthi", look: "A boy." },
      // The planner wrote a new name, but the description is nearly the same.
      { id: "c3", name: "ఆంజనేయ స్వామి", look: "Sri Anjaneya Swamy, a kind strong divine monkey hero with golden-orange fur and a golden crown." },
    ]);
    expect(matchCast(next, saved).characters).toEqual(["c2", "c3"]);
    // Nobody alike: nothing is matched.
    expect(matchCast(episode([{ id: "c1", name: "Ravi", look: "A tall man in a blue shirt." }]), saved).characters).toEqual([null, null]);
  });

  it("puts in the saved descriptions, voices (only ones this story can use) and drawing style", () => {
    const next = episode([
      { id: "c1", name: "Karthi", look: "A boy." },
      { id: "c2", name: "Anjaneya", look: "A monkey." },
    ]);
    const choice = matchCast(next, saved);
    const result = storyWithCast(next, saved, choice, (voice) => voice === "Puck");
    expect(result.artStyle).toBe("bold comic cartoon");
    expect(result.characters[0]).toMatchObject({ look: KARTHI, voice: "Puck" });
    // Algenib isn't available here, so Anjaneya keeps this story's voice.
    expect(result.characters[1]).toMatchObject({ look: ANJANEYA, voice: "verse" });
    expect(storyWithCast(next, saved, { characters: [null, null], places: [] }, () => true).characters[0].look).toBe("A boy.");
    // The story's own style is replaced by the saved one; other details are left alone.
    expect(result.title).toBe(next.title);
    expect(DEFAULT_ART_STYLE).not.toBe(result.artStyle);
  });
});
