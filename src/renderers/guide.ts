import type {
  SkillAuthoringClarificationExample,
  SkillAuthoringExample,
  SkillAuthoringGuidance,
  SkillAuthoringInteraction,
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
    "Interactive authoring protocol",
    ...renderInteraction(guidance.interaction),
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
    ...renderExample(
      guidance.example,
      guidance.interaction.productAInitialClarification,
    ),
    "",
    "Verification",
    ...renderNumbered(guidance.verification),
    "",
    "Boundary: LLM investigates, proposes, asks, and edits. User supplies domain and governance truth. Renma provides deterministic authoring rules and repository evidence. Human approves meaningful decisions.",
  ].join("\n");
}

export function renderSkillGuideJson(guidance: SkillAuthoringGuidance): string {
  return JSON.stringify(guidance, null, 2);
}

function renderExample(
  example: SkillAuthoringExample,
  clarification: Omit<SkillAuthoringClarificationExample, "request">,
): string[] {
  return [
    "Input request:",
    example.request,
    "",
    "Expected first clarification turn:",
    ...renderDecisionSummary(clarification),
    "",
    "Expected initial Renma asset structure:",
    "```text",
    ...example.initialStructure,
    "```",
    "",
    "External source reference:",
    example.externalSourceReference,
    "",
    "SKILL.md responsibilities:",
    ...renderBullets(example.skillResponsibilities),
    "",
    "Context Asset responsibilities:",
    ...renderBullets(example.contextResponsibilities),
    "",
    "External source security review:",
    ...renderBullets(example.securityReview),
    "",
    "Not created by default:",
    ...renderBullets(example.notCreatedByDefault),
  ];
}

function renderInteraction(interaction: SkillAuthoringInteraction): string[] {
  return [
    interaction.openingRule,
    "",
    "Progressive phases:",
    ...renderNumbered(interaction.phases),
    "",
    "Truth sources:",
    ...renderBullets(interaction.truthSources),
    "",
    "Decision classes:",
    `- Confirmed: ${interaction.decisionClasses.confirmed}`,
    `- Proposed: ${interaction.decisionClasses.proposed}`,
    `- Unresolved: ${interaction.decisionClasses.unresolved}`,
    "",
    "Question rules:",
    ...renderBullets(interaction.questionRules),
    "",
    "Creation gate:",
    ...renderBullets(interaction.creationGate),
    "",
    "Post-validation actions:",
    ...renderBullets(interaction.postValidationActions),
    "",
    "Persistence rules:",
    ...renderBullets(interaction.persistenceRules),
    "",
    "Platform-native Skill authoring guidance handoff:",
    ...renderBullets(interaction.handoffRules),
    "",
    "Minimal-trigger example:",
    "Input request:",
    interaction.minimalTriggerExample.request,
    "",
    "Expected first response after running `renma guide skill`:",
    "I ran `renma guide skill`.",
    "",
    ...renderDecisionSummary(interaction.minimalTriggerExample),
  ];
}

function renderDecisionSummary(
  example: Omit<SkillAuthoringClarificationExample, "request">,
): string[] {
  return [
    "Current understanding",
    "",
    "Confirmed",
    ...renderBullets(example.confirmed),
    "",
    "Proposed",
    ...renderBullets(example.proposed),
    "",
    "Unresolved",
    ...renderBullets(example.unresolved),
    "",
    example.questions.length === 1 ? "Question" : "Questions",
    ...renderNumbered(example.questions),
  ];
}

function renderBullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function renderNumbered(items: readonly string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`);
}
