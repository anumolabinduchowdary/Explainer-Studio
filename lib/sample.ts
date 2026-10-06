import samplePlanJson from "@/examples/cerebral-palsy.plan.json";
import samplePromptJson from "@/examples/cerebral-palsy.prompt.json";
import sampleStoryJson from "@/examples/cerebral-palsy.story.json";
import sampleStoryboardJson from "@/examples/cerebral-palsy.storyboard.json";
import { StoryPlanSchema } from "./plan";
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
      label: "Four friends at physiotherapy",
      description:
        "A 60-second vertical cartoon with 4 children in a physiotherapy centre and their physiotherapist, showing that exercises can be fun. Playful and encouraging.",
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
  plan: StoryPlanSchema.parse(samplePlanJson),
  story: StorySchema.parse(sampleStoryJson),
};
