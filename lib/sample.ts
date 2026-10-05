import samplePromptJson from "@/examples/cerebral-palsy.prompt.json";
import sampleStoryJson from "@/examples/cerebral-palsy.story.json";
import sampleStoryboardJson from "@/examples/cerebral-palsy.storyboard.json";
import { FiveStepPromptSchema, StoryboardSchema, type VideoKind } from "./schemas";
import { StorySchema } from "./story";

type Example = { label: string; description: string };

/** The three example chips on the home page, for each kind of video. */
export const EXAMPLES: Record<VideoKind, readonly Example[]> = {
  explainer: [
    {
      label: "Cerebral palsy for parents",
      description:
        "A 2-minute vertical video explaining cerebral palsy to parents in India, warm and hopeful, showing children with different abilities.",
    },
    {
      label: "An inclusive classroom",
      description:
        "A 60-second square video for primary school teachers on welcoming a child who uses a wheelchair into the classroom, friendly and practical.",
    },
    {
      label: "Baby hearing checks",
      description:
        "A 90-second vertical video in simple Hindi for new mothers about signs that a baby may need a hearing check, calm and reassuring.",
    },
  ],
  story: [
    {
      label: "A doctor explains cerebral palsy",
      description:
        "A 45-second vertical cartoon where a friendly doctor explains cerebral palsy to a worried mother in India, with her young son who uses a walker. Warm and hopeful.",
    },
    {
      label: "A new friend at school",
      description:
        "A 40-second vertical cartoon for primary school children where a teacher helps the class welcome a new classmate who uses a wheelchair. Cheerful and kind.",
    },
    {
      label: "The brain explains therapy",
      description:
        "A 45-second vertical cartoon where a friendly talking brain explains to a child why daily therapy exercises help. Playful and encouraging.",
    },
  ],
};

/**
 * Ready-made examples (see /examples) so people can try the player and export
 * without an API key. They were written by hand to show the format; they are
 * not saved OpenAI responses. The story example has no pictures: those are
 * only drawn when a key is available.
 */
export const SAMPLE = {
  description: EXAMPLES.explainer[0].description,
  prompt: FiveStepPromptSchema.parse(samplePromptJson),
  storyboard: StoryboardSchema.parse(sampleStoryboardJson),
};

export const SAMPLE_STORY = {
  description: EXAMPLES.story[0].description,
  prompt: FiveStepPromptSchema.parse({
    ...samplePromptJson,
    output:
      "A 45-second, 9:16 vertical cartoon story in 5 scenes with 3 characters: a friendly doctor, a mother and her young son who uses a walker.",
    constraints:
      'Length: about 45 seconds. Shape: vertical 9:16. Show the child as active, capable and included. Use person-first language such as "children with cerebral palsy". Avoid pity, fear, blame and miracle-cure claims. No statistics. No diagnosis or treatment advice. End with the line: "For awareness, not medical advice."',
  }),
  story: StorySchema.parse(sampleStoryJson),
};
