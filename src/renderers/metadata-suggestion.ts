import type { MetadataSuggestion } from "../decisions/metadata-suggestion.js";

type SkillSuggestionPromptState = "blocked" | "candidate" | "no-proposal";

export function renderMetadataPrompt(suggestion: MetadataSuggestion): string {
  // `decisionStatus` is the application gate. Blocked Skill migrations retain
  // partial candidate evidence for 0.18.2 JSON compatibility, so the renderer
  // must never promote that evidence into an applicable patch.
  if (suggestion.agentSkills)
    return renderAgentSkillMigrationPrompt(suggestion);
  const blocked = suggestion.decisionStatus === "blocked";
  const noChange = suggestion.decisionStatus === "no-change-recommended";
  const noProposal = blocked || noChange;
  const skillLocal = suggestion.classification.scope === "skill-local";
  return `${[
    blocked
      ? "# Renma Result: Metadata Proposal Blocked"
      : noProposal
        ? "# Renma Result: No Metadata Proposal"
        : "# Renma Task: Safely Retrofit Renma Metadata",
    "",
    blocked
      ? "Renma cannot safely produce an applicable metadata patch."
      : noProposal
        ? "No independent metadata retrofit is required."
        : "Review this existing Renma asset metadata candidate safely.",
    "",
    "Asset:",
    `- Path: \`${suggestion.path}\``,
    `- Kind: \`${suggestion.kind}\``,
    `- Mode: \`${suggestion.suggestedMode}\``,
    `- Decision status: \`${suggestion.decisionStatus}\``,
    "",
    "Classification:",
    ...classificationPromptLines(suggestion.classification),
    "",
    "Observed repository fact:",
    observedRepositoryFact(suggestion.classification),
    "",
    "Deterministic Renma interpretation:",
    deterministicInterpretation(suggestion.classification),
    "",
    noProposal ? "Recommendation:" : "Decision:",
    suggestion.decision.summary,
    ...(suggestion.decision.question
      ? ["", "Remaining human decision:", suggestion.decision.question]
      : []),
    ...(skillLocal
      ? suggestion.classification.parentResolution === "resolved"
        ? [
            "",
            "This file is structurally Skill-local support with one resolved parent:",
            suggestion.classification.parentAssetPath ??
              "(resolved parent path unavailable)",
            "",
            ...skillLocalGovernancePromptLines(suggestion),
            "Preserve existing metadata if present.",
            "Do not add an owner, move the file, or create a patch solely to manufacture work.",
          ]
        : [
            "",
            "This file is structurally Skill-local support, but its parent governance is unresolved.",
            `Parent resolution: ${suggestion.classification.parentResolution ?? "structural-candidate"}.`,
            "Do not claim inheritance or add an independent local owner until the repository layout resolves to one parent Skill.",
          ]
      : []),
    "",
    "Rules:",
    ...suggestion.instructions.map((instruction) => `- ${instruction}`),
    "",
    blocked
      ? "Candidate Metadata (not applicable while blocked):"
      : "Candidate Metadata:",
    ...(blocked
      ? ["- (suppressed because the decision is blocked)"]
      : metadataLines(suggestion.candidateMetadata)),
    "",
    "Blocked Metadata:",
    ...blockedMetadataLines(suggestion.blockedMetadata),
    "",
    "Verification:",
    ...(blocked
      ? suggestion.nextActions.length > 0
        ? [
            "- Resolve the blocked evidence and rerun `renma suggest-metadata`.",
            "- Run only the structured safe action; do not apply a patch from this result.",
          ]
        : [
            "- Establish the repository root with an explicit root or repository marker, then rerun `renma suggest-metadata`.",
            "- No verification command is safe while the repository boundary is unresolved.",
          ]
      : noChange
        ? ["- No verification change is required when no file change is made."]
        : [
            "- Run `renma scan . --fail-on high --format json`.",
            "- Run `renma ownership .`.",
          ]),
    "",
    blocked
      ? "Do not return or apply a patch while the decision is blocked. Preserve the existing source."
      : noChange
        ? "Stop without manufacturing work. Preserve the existing source."
        : suggestion.decisionStatus === "human-confirmation-required"
          ? "After confirming the stated human decision, return only the reviewed candidate fields. Do not invent unresolved owner, lifecycle, or source-of-truth metadata, and do not rewrite the asset body."
          : "Return a small reviewed patch containing only the deterministic candidate. Do not rewrite the asset body.",
  ].join("\n")}\n`;
}

function renderAgentSkillMigrationPrompt(
  suggestion: MetadataSuggestion,
): string {
  const migration = suggestion.agentSkills;
  if (!migration) return "";
  const metadataRetrofit =
    migration.proposalKind === "canonical-metadata-retrofit";
  const noMigrationProposed =
    migration.proposalKind === "none" &&
    migration.sourceFormat === "agent-skills";
  const candidate =
    suggestion.decisionStatus !== "blocked" && migration.canonicalFrontmatter
      ? [
          "Canonical Frontmatter Candidate:",
          "",
          "```yaml",
          migration.canonicalFrontmatter,
          "```",
        ]
      : [
          "Canonical Frontmatter Candidate:",
          "",
          "(not generated while migration is blocked or unnecessary)",
        ];
  const promptState: SkillSuggestionPromptState =
    suggestion.decisionStatus === "blocked"
      ? "blocked"
      : suggestion.decisionStatus === "no-change-recommended"
        ? "no-proposal"
        : "candidate";
  const verification = renderSkillSuggestionVerification(promptState);
  const nextSteps = renderSkillSuggestionNextSteps(promptState);
  return `${[
    noMigrationProposed
      ? "# Renma Task: Inspect Canonical Agent Skill (No Migration Proposed)"
      : metadataRetrofit
        ? "# Renma Task: Review Canonical Agent Skills Metadata Retrofit"
        : "# Renma Task: Review One-Way Agent Skills Migration",
    "",
    `Asset: \`${suggestion.path}\``,
    `Decision status: \`${suggestion.decisionStatus}\``,
    `Decision reason: \`${suggestion.decision.reasonCode}\``,
    "Classification:",
    ...classificationPromptLines(suggestion.classification),
    `Source format: \`${migration.sourceFormat}\``,
    `Direction: \`${migration.direction}\``,
    `Proposal: \`${migration.proposalKind}\``,
    `Source path: \`${migration.sourcePath}\``,
    `Target path: \`${migration.targetPath}\``,
    `Entrypoint migration: \`${migration.entrypointMigration}\``,
    "",
    "Rules:",
    ...suggestion.instructions.map((instruction) => `- ${instruction}`),
    "",
    "Candidate Agent Skills Fields:",
    ...metadataLines(migration.candidateAgentSkillsFields),
    "",
    "Candidate Renma Metadata:",
    ...metadataLines(migration.candidateRenmaMetadata),
    "",
    ...candidate,
    "",
    "Blocked Migration Evidence:",
    ...blockedMetadataLines(suggestion.blockedMetadata),
    "",
    "Human Review:",
    migration.reviewPrompt,
    "",
    ...verification,
    "",
    ...nextSteps,
    "",
    promptState === "blocked"
      ? "Do not return or apply a frontmatter patch while the decision is blocked. Preserve the existing source until every blocked item is resolved with human review."
      : promptState === "no-proposal"
        ? "No frontmatter patch is proposed. Do not return or apply a frontmatter patch; preserve the existing source."
        : suggestion.decisionStatus === "human-confirmation-required" &&
            migration.canonicalFrontmatter
          ? migration.entrypointMigration === "none"
            ? "After a human confirms the intended Skill semantics, return only the reviewed canonical frontmatter candidate. Do not invent unresolved fields or rewrite the Skill body."
            : "After a human confirms the intended Skill semantics, return one reviewed patch containing only the entrypoint path migration and canonical frontmatter candidate. Do not invent unresolved fields or rewrite the Skill body."
          : migration.canonicalFrontmatter
            ? migration.entrypointMigration === "none"
              ? "Return a small reviewed frontmatter patch. Do not rewrite the Skill body."
              : "Return one small reviewed patch containing both the entrypoint path migration and frontmatter migration. Do not rewrite the Skill body."
            : "Do not return a patch because no canonical candidate was generated.",
  ].join("\n")}\n`;
}

function renderSkillSuggestionVerification(
  state: SkillSuggestionPromptState,
): string[] {
  if (state === "no-proposal") {
    return [
      "Verification:",
      "- No verification change is required when no separate authoring change is made.",
      "- Only if a separate, intentional authoring change is made: run `renma scan . --fail-on high`, fix relevant diagnostics, and rerun the scan.",
    ];
  }

  return ["Verification:", "- Run `renma scan . --fail-on high`."];
}

function renderSkillSuggestionNextSteps(
  state: SkillSuggestionPromptState,
): string[] {
  if (state === "blocked") {
    return [
      "Next steps:",
      "1. Review the conflicts or invalid evidence and confirm the Skill's intent using your platform's standard Skill authoring guidance.",
      "2. Do not apply a candidate while Renma cannot generate it safely.",
      "3. Correct the source evidence, then rerun `renma suggest-metadata <SKILL.md>`.",
      "4. After intended corrections, run `renma scan . --fail-on high`, fix relevant diagnostics, and rerun the scan.",
    ];
  }

  if (state === "no-proposal") {
    return [
      "Next steps:",
      "1. Review the Skill's trigger description, instructions, workflow, constraints, and completion criteria using your platform's standard Skill authoring guidance.",
      "2. No metadata or migration change is proposed; preserve the existing source.",
      "3. If a separate, intentionally reviewed authoring change is made, run `renma scan . --fail-on high`, fix relevant diagnostics, and rerun the scan.",
      "4. If no separate change is made, stop without manufacturing work.",
    ];
  }

  return [
    "Next steps:",
    "1. Review the suggestion; Renma does not edit the Skill automatically.",
    "2. Review the Skill's trigger description, instructions, workflow, constraints, and completion criteria using your platform's standard Skill authoring guidance.",
    "3. Apply only the intended metadata or migration changes.",
    "4. Run `renma scan . --fail-on high`.",
    "5. Fix relevant diagnostics and rerun the scan.",
  ];
}

function metadataLines(candidateMetadata: Record<string, string>): string[] {
  const entries = Object.entries(candidateMetadata);
  if (entries.length === 0) {
    return ["- (none)"];
  }
  return entries.map(([field, value]) => `- ${field}: \`${value}\``);
}

function blockedMetadataLines(
  blockedMetadata: MetadataSuggestion["blockedMetadata"],
): string[] {
  if (blockedMetadata.length === 0) {
    return ["- (none)"];
  }
  return blockedMetadata.map((item) => `- ${item.field}: ${item.reason}`);
}

function skillLocalGovernancePromptLines(
  suggestion: MetadataSuggestion,
): string[] {
  switch (suggestion.decision.reasonCode) {
    case "skill-local-governance-inherited":
      return [
        "Effective governance is inherited from this one resolved parent Skill.",
      ];
    case "skill-local-existing-metadata-preserved":
      return [
        "Existing explicit local governance is preserved and is not relabeled as inherited.",
      ];
    case "skill-local-unowned":
      return [
        "The parent is resolved, but no effective owner is declared locally or by the parent.",
      ];
    case "explicit-human-provided-override":
      return [
        "The parent is resolved; the local candidate is an explicit human-provided override.",
      ];
    default:
      return [
        "Governance provenance remains separate from this structural parent resolution.",
      ];
  }
}

function classificationPromptLines(
  classification: MetadataSuggestion["classification"],
): string[] {
  return [
    `- kind: \`${classification.kind}\``,
    `- scope: \`${classification.scope}\``,
    `- matched rule: \`${classification.matchedRule}\``,
    `- reason code: \`${classification.reasonCode}\``,
    ...(classification.recognizedRoot
      ? [`- recognized root: \`${classification.recognizedRoot}\``]
      : []),
    ...(classification.parentAssetPath
      ? [`- parent asset: \`${classification.parentAssetPath}\``]
      : []),
    ...(classification.parentAssetCandidatePath
      ? [
          `- parent candidate: \`${classification.parentAssetCandidatePath}\``,
          `- parent resolution: \`${classification.parentResolution ?? "structural-candidate"}\``,
        ]
      : []),
    ...(classification.parentAssetCandidates?.length
      ? [
          `- parent candidates: ${classification.parentAssetCandidates.map((candidate) => `\`${candidate}\``).join(", ")}`,
        ]
      : []),
    ...(classification.supportDirectory
      ? [`- support directory: \`${classification.supportDirectory}\``]
      : []),
    ...(classification.ignoredNestedSegments?.length
      ? [
          `- ignored nested segments: ${classification.ignoredNestedSegments.map((segment) => `\`${segment}\``).join(", ")}`,
        ]
      : []),
    `- reason: ${classification.reason}`,
  ];
}

function observedRepositoryFact(
  classification: MetadataSuggestion["classification"],
): string {
  if (classification.matchedRule === "skill-local-support") {
    return `The target is under a canonical ${classification.supportDirectory}/ directory within a recognized Skill-root path shape.`;
  }
  if (
    classification.matchedRule === "context-root" ||
    classification.matchedRule === "context-root-legacy"
  ) {
    return `The target is under ${classification.recognizedRoot}/**.`;
  }
  return classification.reason;
}

function deterministicInterpretation(
  classification: MetadataSuggestion["classification"],
): string {
  if (classification.scope === "skill-local") {
    return classification.parentResolution === "resolved"
      ? `The target is structurally Skill-local support and its parent resolves to ${classification.parentAssetPath}; governance provenance is evaluated separately.`
      : "The target is structurally Skill-local support, but inherited governance is unresolved.";
  }
  if (classification.scope === "independent") {
    return `The target is an independently governed ${classification.kind} asset.`;
  }
  if (classification.scope === "repository-support") {
    return "The target is repository support, not an independently governed Context Asset.";
  }
  return "Renma does not classify the target as an independently governed asset.";
}
