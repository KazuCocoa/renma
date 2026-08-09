/**
 * Canonical prose that Renma writes into Skill and Context starter files.
 *
 * Detection intentionally matches only these Renma-owned strings after
 * trimming surrounding line whitespace. It is not a vocabulary heuristic:
 * words such as "describe", "input", "output", and "placeholder" remain
 * ordinary author prose everywhere else.
 */
export const RENMA_SCAFFOLD_PLACEHOLDERS = {
  skill: {
    description:
      "Replace this capability and routing placeholder with repository-grounded wording. Use when the agreed recurring workflow needs this Skill; do not use for unrelated tasks or runtime context selection.",
    purpose:
      "Describe the recurring task, decision, or workflow this skill should guide.",
    requiredInput:
      "- List the inputs, evidence, or repository artifacts the agent should inspect before acting.",
    inspectInstruction:
      "1. State the inputs, evidence, or repository artifacts the agent should inspect.",
    reviewInstruction:
      "2. Describe the review steps, checks, or decision points that should remain explicit and reviewable.",
    expectedOutput: "3. Identify the expected output, artifact, or handoff.",
  },
  context: {
    summary:
      "Describe the durable context, rule, constraint, or domain fact this asset records.",
    appliesWhen:
      "- Describe the systems, workflows, or skills that should consider this context.",
    doesNotApplyWhen:
      "- Describe nearby cases that should use a different context asset.",
  },
} as const;

export type RenmaScaffoldPlaceholderKind =
  keyof typeof RENMA_SCAFFOLD_PLACEHOLDERS;

export type RenmaScaffoldPlaceholderName =
  | keyof (typeof RENMA_SCAFFOLD_PLACEHOLDERS)["skill"]
  | keyof (typeof RENMA_SCAFFOLD_PLACEHOLDERS)["context"];

export interface RenmaScaffoldPlaceholderMarker {
  kind: RenmaScaffoldPlaceholderKind;
  name: RenmaScaffoldPlaceholderName;
  source: "description" | "body";
  text: string;
}

/**
 * Flattened marker inventory shared by deterministic scan detection. The Skill
 * description is resolved through YAML before comparison; body markers are
 * compared to one complete trimmed source line.
 */
export const RENMA_SCAFFOLD_PLACEHOLDER_MARKERS: readonly RenmaScaffoldPlaceholderMarker[] =
  [
    {
      kind: "skill",
      name: "description",
      source: "description",
      text: RENMA_SCAFFOLD_PLACEHOLDERS.skill.description,
    },
    ...Object.entries(RENMA_SCAFFOLD_PLACEHOLDERS.skill)
      .filter(([name]) => name !== "description")
      .map(([name, text]) => ({
        kind: "skill" as const,
        name: name as Exclude<
          keyof (typeof RENMA_SCAFFOLD_PLACEHOLDERS)["skill"],
          "description"
        >,
        source: "body" as const,
        text,
      })),
    ...Object.entries(RENMA_SCAFFOLD_PLACEHOLDERS.context).map(
      ([name, text]) => ({
        kind: "context" as const,
        name: name as keyof (typeof RENMA_SCAFFOLD_PLACEHOLDERS)["context"],
        source: "body" as const,
        text,
      }),
    ),
  ];
