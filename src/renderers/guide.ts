import type { SkillAuthoringGuidance } from "../guidance/skill-authoring.js";

/** Render the short execution projection; JSON retains the complete reference. */
export function renderSkillGuidePrompt(
  guidance: SkillAuthoringGuidance,
): string {
  const core = guidance.coreContract;
  return [
    `Renma ${guidance.renmaVersion} Skill Authoring Guide`,
    "",
    "Core authoring contract",
    guidance.principle,
    ...renderBullets(core.interaction),
    "",
    "Asset boundary rules",
    ...renderBullets(core.placement),
    "",
    "Artifact rules",
    ...renderBullets(core.artifacts),
    "",
    "Metadata and conciseness rules",
    ...renderBullets(core.metadata),
    "",
    "Durable handoff boundary",
    ...renderBullets(core.handoff),
    "",
    "Verification and human review",
    ...renderBullets(core.verification),
    "",
    "Conditional reference guidance",
    ...renderBullets(core.references),
  ].join("\n");
}

export function renderSkillGuideJson(guidance: SkillAuthoringGuidance): string {
  return JSON.stringify(guidance, null, 2);
}

function renderBullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}
