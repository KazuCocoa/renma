import type {
  SkillAuthoringGuidance,
  SkillAuthoringHandoffGuidance,
  SkillAuthoringInteraction,
} from "../guidance/skill-authoring.js";

/** Render the compact execution contract; use JSON for the complete reference. */
export function renderSkillGuidePrompt(
  guidance: SkillAuthoringGuidance,
): string {
  return [
    `Renma ${guidance.renmaVersion} Skill Authoring Guide`,
    "",
    "Core authoring contract",
    guidance.principle,
    "",
    ...renderCoreInteraction(guidance.interaction),
    "",
    "Asset boundary rules",
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
    "Conditional reference guidance",
    guidance.externalTraversalApplicabilityRule,
    "",
    "Durable handoff boundary",
    ...renderCompactHandoffGuidance(guidance.handoff),
    "",
    "Verification",
    ...renderBullets(guidance.verification),
    "",
    "Complete reference",
    "Use `renma guide skill --format json` for the deterministic complete structured reference, including adaptive activities, disposition and platform-handoff reference tables, conditional external-traversal guidance, the handoff template, and non-normative illustrations. The prompt preserves their required outcomes in the applicable contract sections without repeating the reference tables; they do not add a reasoning sequence or mandatory progress format.",
    "",
    "Boundary: the external LLM investigates, reasons, clarifies only when needed, proposes, and edits; Renma validates supplied structure and deterministic repository evidence; and a human reviews meaningful decisions. Renma does not certify that the handoff's authoring or domain claims are true.",
  ].join("\n");
}

export function renderSkillGuideJson(guidance: SkillAuthoringGuidance): string {
  return JSON.stringify(guidance, null, 2);
}

function renderCoreInteraction(
  interaction: SkillAuthoringInteraction,
): string[] {
  return [
    interaction.openingRule,
    "",
    "Evidence and epistemic state:",
    ...renderBullets(interaction.truthSources),
    `- Confirmed: ${interaction.decisionClasses.confirmed}`,
    `- Proposed: ${interaction.decisionClasses.proposed}`,
    `- Unresolved: ${interaction.decisionClasses.unresolved}`,
    "",
    "Unknown scopes:",
    `- Authoring decision: ${interaction.unknownScopes.authoringDecision}`,
    `- Runtime task unknown: ${interaction.unknownScopes.runtimeTaskUnknown}`,
    "",
    "Progression:",
    `- Blocking: ${interaction.progressionClasses.blocking}`,
    `- Reversible default: ${interaction.progressionClasses.reversibleDefault}`,
    `- Deferred: ${interaction.progressionClasses.deferred}`,
    "",
    "Adaptive clarification guidance:",
    ...renderBullets(interaction.questionRules),
    "",
    "Creation gate:",
    ...renderBullets(interaction.creationGate),
    "",
    "Post-validation and boundary re-entry:",
    ...renderBullets(interaction.postValidationActions),
    "",
    "Persistence:",
    ...renderBullets(interaction.persistenceRules),
    "",
    "Human review:",
    ...renderBullets(interaction.humanReviewRules),
  ];
}

function renderCompactHandoffGuidance(
  handoff: SkillAuthoringHandoffGuidance,
): string[] {
  return [
    `Schema: ${handoff.schemaVersion}`,
    handoff.purpose,
    handoff.boundary,
    ...renderBullets(handoff.rules),
  ];
}

function renderBullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}
