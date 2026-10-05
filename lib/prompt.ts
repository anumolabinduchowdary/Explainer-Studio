import type { FiveStepPrompt } from "./schemas";

export type PromptStepKey = keyof FiveStepPrompt;

export const PROMPT_STEPS: ReadonlyArray<{
  key: PromptStepKey;
  label: string;
  hint: string;
  placeholder: string;
  required: boolean;
  rows: number;
}> = [
  {
    key: "actAs",
    label: "Act as",
    hint: "Who should the AI be? Give it a role with the right expertise.",
    placeholder: "e.g. a children's health educator and motion designer",
    required: true,
    rows: 2,
  },
  {
    key: "goal",
    label: "Goal",
    hint: "What should viewers understand, feel or do after watching?",
    placeholder: "e.g. help parents recognise early signs and feel hopeful",
    required: true,
    rows: 3,
  },
  {
    key: "context",
    label: "Context",
    hint: "Audience, topic, tone, language, region and the key facts to include.",
    placeholder: "e.g. parents in India; warm and hopeful; simple English",
    required: true,
    rows: 6,
  },
  {
    key: "constraints",
    label: "Constraints",
    hint: "Length, shape, style rules and anything to avoid.",
    placeholder: "e.g. 2 minutes, vertical 9:16, no medical jargon",
    required: false,
    rows: 4,
  },
  {
    key: "output",
    label: "Output",
    hint: "Exactly what to produce: length, shape and number of scenes.",
    placeholder: "e.g. a 60-second 9:16 video in 8 scenes",
    required: true,
    rows: 3,
  },
];

export const EMPTY_PROMPT: FiveStepPrompt = {
  actAs: "",
  goal: "",
  context: "",
  constraints: "",
  output: "",
};

/**
 * Assembles the 5-step prompt into the exact text sent to OpenAI as the user
 * message. Used by both the live preview and the server, so they never drift.
 */
export function assemblePrompt(prompt: FiveStepPrompt): string {
  const sections: Array<[string, string]> = [
    ["ACT AS", prompt.actAs],
    ["GOAL", prompt.goal],
    ["CONTEXT", prompt.context],
    ["CONSTRAINTS", prompt.constraints],
    ["OUTPUT", prompt.output],
  ];
  return sections
    .map(([title, text]) => [title, text.trim()] as const)
    .filter(([, text]) => text.length > 0)
    .map(([title, text]) => `${title}\n${text}`)
    .join("\n\n");
}
