import samplePromptJson from "@/examples/cerebral-palsy.prompt.json";
import sampleStoryboardJson from "@/examples/cerebral-palsy.storyboard.json";
import { FiveStepPromptSchema, StoryboardSchema } from "./schemas";

/** The three example chips on the home page. */
export const EXAMPLES = [
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
] as const;

/**
 * A ready-made example (see /examples) so people can try the player and
 * export without an API key. It was written by hand to show the format; it is
 * not a saved OpenAI response.
 */
export const SAMPLE = {
  description: EXAMPLES[0].description,
  prompt: FiveStepPromptSchema.parse(samplePromptJson),
  storyboard: StoryboardSchema.parse(sampleStoryboardJson),
};
