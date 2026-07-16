import type {
  SkillAuthoringClarificationExample,
  SkillAuthoringGuidance,
  SkillAuthoringIllustration,
  SkillAuthoringInteraction,
  SkillAuthoringProgressionSummary,
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
    "How to use illustrations",
    ...renderBullets(guidance.illustrationRules),
    "",
    "Non-normative authoring illustrations",
    ...guidance.illustrations.flatMap((illustration, index) => [
      ...(index > 0 ? [""] : []),
      ...renderIllustration(illustration),
    ]),
    "",
    "Verification",
    ...renderNumbered(guidance.verification),
    "",
    "Boundary: LLM proposes. Renma verifies. Human approves. During authoring, the consuming LLM investigates, proposes, asks, and edits; the user supplies domain and governance truth; Renma provides deterministic rules and repository evidence.",
  ].join("\n");
}

export function renderSkillGuideJson(guidance: SkillAuthoringGuidance): string {
  return JSON.stringify(guidance, null, 2);
}

function renderIllustration(
  illustration: SkillAuthoringIllustration,
): string[] {
  return [
    `Illustration: ${illustration.title}`,
    "",
    "Demonstrates:",
    ...renderBullets(illustration.demonstrates),
    "",
    "Notice:",
    illustration.notice,
    "",
    "Input request:",
    illustration.request,
    "",
    ...renderDecisionSummary(illustration.clarification),
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
    "Unknown scopes:",
    `- Authoring decision: ${interaction.unknownScopes.authoringDecision}`,
    `- Runtime task unknown: ${interaction.unknownScopes.runtimeTaskUnknown}`,
    "",
    "Progression classes:",
    `- Blocking: ${interaction.progressionClasses.blocking}`,
    `- Reversible default: ${interaction.progressionClasses.reversibleDefault}`,
    `- Deferred: ${interaction.progressionClasses.deferred}`,
    "",
    "Unresolved-item dispositions:",
    `- Ask now: ${interaction.unresolvedItemDispositions.askNow}`,
    `- Queue as blocker: ${interaction.unresolvedItemDispositions.queueAsBlocker}`,
    `- Proceed with reversible default: ${interaction.unresolvedItemDispositions.proceedWithReversibleDefault}`,
    `- Defer: ${interaction.unresolvedItemDispositions.defer}`,
    `- Report as finding: ${interaction.unresolvedItemDispositions.reportAsFinding}`,
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
  ];
}

function renderDecisionSummary(
  clarification: Omit<SkillAuthoringClarificationExample, "request">,
): string[] {
  const progression = clarification.progression
    ? [
        "",
        ...renderProgressionSummary(
          clarification.progression,
          clarification.questions.length,
        ),
      ]
    : [];
  const runtimeTaskUnknowns = clarification.runtimeTaskUnknowns
    ? [
        "",
        "Epistemically unresolved runtime task knowledge handled by the finished Skill",
        ...renderBullets(clarification.runtimeTaskUnknowns),
      ]
    : [];
  const questions =
    clarification.questions.length > 0
      ? [
          "",
          clarification.questions.length === 1 ? "Question" : "Questions",
          ...renderNumbered(clarification.questions),
        ]
      : [];

  return [
    "Current understanding",
    "",
    "Confirmed",
    ...renderBullets(clarification.confirmed),
    "",
    "Proposed",
    ...renderBullets(clarification.proposed),
    "",
    "Unresolved",
    ...renderBullets(clarification.unresolved),
    ...runtimeTaskUnknowns,
    ...progression,
    ...questions,
  ];
}

function renderProgressionSummary(
  progression: SkillAuthoringProgressionSummary,
  questionCount: number,
): string[] {
  const queuedBlockerNumbers = progression.queuedBlockers.map(
    (blocker) => progression.blocking.indexOf(blocker) + 1,
  );
  const reversibleDefaultsHeading =
    progression.blocking.length === 0
      ? "Proceeding with reversible defaults"
      : "Proposed reversible defaults";

  return [
    "Current progression",
    "",
    `Blocking decisions: ${progression.blocking.length}`,
    ...renderBullets(progression.blocking),
    ...(questionCount > 0
      ? [
          `- Asking now: ${questionCount} highest-impact question${questionCount === 1 ? "" : "s"} below.`,
        ]
      : []),
    ...(progression.queuedBlockers.length > 0
      ? [
          "",
          `Queued from the complete blocker list above (not additional): ${queuedBlockerNumbers.join(", ")}.`,
        ]
      : []),
    ...(progression.reversibleDefaults.length > 0
      ? [
          "",
          reversibleDefaultsHeading,
          ...renderBullets(progression.reversibleDefaults),
        ]
      : []),
    ...(progression.deferred.length > 0
      ? ["", "Deferred", ...renderBullets(progression.deferred)]
      : []),
  ];
}

function renderBullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function renderNumbered(items: readonly string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`);
}
