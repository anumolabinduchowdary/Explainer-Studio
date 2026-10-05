/**
 * The illustration library. A storyboard may only reference these IDs.
 * This file holds metadata only (safe to import on the server); the artwork
 * itself lives in visualArt.ts.
 */
export const VISUALS = [
  {
    id: "brain",
    label: "Brain",
    alt: "A friendly pink brain",
    use: "the brain, thinking, learning, or where a condition begins",
  },
  {
    id: "child-walking",
    label: "Child walking",
    alt: "A smiling child walking",
    use: "a child walking independently, being active, growing up",
  },
  {
    id: "child-walker",
    label: "Child with walker",
    alt: "A smiling child walking with a walker",
    use: "a child using a walker or other mobility aid",
  },
  {
    id: "child-wheelchair",
    label: "Child in wheelchair",
    alt: "A smiling child using a wheelchair",
    use: "a child who uses a wheelchair, taking part and included",
  },
  {
    id: "friends",
    label: "Friends",
    alt: "Two children holding hands, one waving",
    use: "children together, friendship, inclusion, every child is different",
  },
  {
    id: "family",
    label: "Family",
    alt: "Two parents holding hands with their child",
    use: "parents and child, caregivers, support at home, the audience",
  },
  {
    id: "doctor",
    label: "Doctor",
    alt: "A doctor in a white coat with a stethoscope",
    use: "doctors, health workers, check-ups, asking a professional",
  },
  {
    id: "therapy-ball",
    label: "Therapy ball",
    alt: "A large blue therapy ball",
    use: "physiotherapy, exercise, therapy sessions, practice",
  },
  {
    id: "speech-bubble",
    label: "Speech bubbles",
    alt: "Two speech bubbles",
    use: "talking, speech, conversation, asking questions",
  },
  {
    id: "picture-tablet",
    label: "Picture tablet",
    alt: "A tablet showing a grid of picture symbols",
    use: "communicating with pictures or a tablet, assistive technology",
  },
  {
    id: "helping-hands",
    label: "Caring hands",
    alt: "Two hands holding a heart",
    use: "support, care, community, you are not alone",
  },
  {
    id: "heart",
    label: "Heart",
    alt: "A warm red heart",
    use: "love, kindness, acceptance, emotional wellbeing",
  },
  {
    id: "checklist",
    label: "Checklist",
    alt: "A clipboard with ticked items",
    use: "signs to look for, steps to take, things to remember",
  },
  {
    id: "chart",
    label: "Chart",
    alt: "A bar chart with a rising line",
    use: "progress, growth over time, facts and figures",
  },
  {
    id: "calendar",
    label: "Calendar",
    alt: "A calendar with one day marked",
    use: "acting early, routines, appointments, timelines",
  },
  {
    id: "globe",
    label: "Globe",
    alt: "A globe of the world",
    use: "around the world, communities, awareness days",
  },
  {
    id: "school",
    label: "School",
    alt: "A school building with a flag",
    use: "school, education, inclusive classrooms, teachers",
  },
  {
    id: "home",
    label: "Home",
    alt: "A cosy house with a heart above the door",
    use: "home life, daily routines, safe spaces",
  },
  {
    id: "book",
    label: "Book",
    alt: "An open book",
    use: "learning more, stories, information, resources",
  },
  {
    id: "lightbulb",
    label: "Light bulb",
    alt: "A glowing light bulb",
    use: "ideas, tips, key facts, did you know",
  },
  {
    id: "question",
    label: "Question mark",
    alt: "A question mark in a circle",
    use: "what is it, common questions, myths and facts",
  },
  {
    id: "star",
    label: "Star",
    alt: "A bright gold star",
    use: "strengths, achievements, celebration, every child can shine",
  },
  {
    id: "sun",
    label: "Rising sun",
    alt: "The sun rising over green hills",
    use: "hope, a new day, a positive closing message",
  },
] as const;

export type Visual = (typeof VISUALS)[number];
export type VisualId = Visual["id"];

export const VISUAL_IDS = VISUALS.map((v) => v.id) as [VisualId, ...VisualId[]];

const BY_ID = new Map<string, Visual>(VISUALS.map((v) => [v.id, v]));

export function getVisual(id: VisualId): Visual {
  return BY_ID.get(id) ?? VISUALS[0];
}
