import type {
  SkillAuthoringExample,
  SkillAuthoringGuidance,
} from "../guidance/skill-authoring.js";

export function renderSkillGuidePrompt(
  guidance: SkillAuthoringGuidance,
): string {
  return [
    `Renma ${guidance.renmaVersion} Skill Authoring Guide`,
    "",
    "Principle",
    guidance.principle,
    "",
    "Authoring workflow",
    ...renderNumbered(guidance.workflow),
    "",
    "Placement rules",
    ...renderBullets(guidance.placementRules),
    "",
    "Artifact rules",
    ...renderBullets(guidance.artifactRules),
    "",
    "Conciseness rules",
    ...renderBullets(guidance.concisenessRules),
    "",
    "Metadata rules",
    ...renderBullets(guidance.metadataRules),
    "",
    "Product A example",
    ...renderExample(guidance.example),
    "",
    "Verification",
    ...renderNumbered(guidance.verification),
    "",
    "Boundary: LLM proposes. Renma verifies. Human approves.",
  ].join("\n");
}

export function renderSkillGuideJson(guidance: SkillAuthoringGuidance): string {
  return JSON.stringify(guidance, null, 2);
}

function renderExample(example: SkillAuthoringExample): string[] {
  return [
    "Input request:",
    example.request,
    "",
    "Expected initial asset graph:",
    "```text",
    ...example.assetGraph,
    "```",
    "",
    "SKILL.md responsibilities:",
    ...renderBullets(example.skillResponsibilities),
    "",
    "Context Asset responsibilities:",
    ...renderBullets(example.contextResponsibilities),
    "",
    "Not created by default:",
    ...renderBullets(example.notCreatedByDefault),
  ];
}

function renderBullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function renderNumbered(items: readonly string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`);
}
