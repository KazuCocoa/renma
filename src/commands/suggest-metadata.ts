import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "../markdown.js";
import { parseAssetMetadata } from "../metadata.js";
import {
  classifyAssetPath,
  classifyAbsoluteSkillEntrypointPath,
  classifyRepositorySkillEntrypointPath,
  repositoryClassificationPath,
  type SkillEntrypointPath,
} from "../discovery.js";
import {
  buildAgentSkillMigrationSuggestion,
  type AgentSkillMigrationSuggestion,
} from "../skill-migration.js";
import type {
  Artifact,
  ArtifactKind,
  AssetClassificationEvidence,
  AssetDecisionEvidence,
  DecisionStatus,
  MetadataValue,
} from "../types.js";

export type SuggestMetadataFormat = "prompt" | "json";

export interface SuggestMetadataOptions {
  format?: SuggestMetadataFormat;
  owner?: string;
}

export interface BlockedMetadata {
  field: string;
  reason: string;
}

export interface MetadataSuggestion {
  path: string;
  kind: ArtifactKind;
  suggestedMode:
    | "metadata-retrofit"
    | "agent-skills-migration"
    | "agent-skills-metadata-retrofit"
    | "no-proposal";
  decisionStatus: DecisionStatus;
  decision: AssetDecisionEvidence;
  classification: AssetClassificationEvidence;
  ownerProvided: boolean;
  instructions: string[];
  candidateMetadata: Record<string, string>;
  blockedMetadata: BlockedMetadata[];
  nextActions: Array<{ kind: string; command: string }>;
  agentSkills?: AgentSkillMigrationSuggestion;
}

type SkillSuggestionPromptState = "blocked" | "candidate" | "no-proposal";

export class SuggestMetadataTargetError extends Error {
  constructor(target: string, cause: unknown) {
    super(
      `Could not read metadata target ${target}: ${readErrorReason(cause)}`,
    );
    this.name = "SuggestMetadataTargetError";
  }
}

export async function runSuggestMetadataCommand(
  target: string,
  options: SuggestMetadataOptions = {},
): Promise<number> {
  const suggestion = await buildMetadataSuggestion(target, options);
  const format = options.format ?? "prompt";
  process.stdout.write(
    format === "json"
      ? `${JSON.stringify(suggestion, null, 2)}\n`
      : renderMetadataPrompt(suggestion),
  );
  return 0;
}

export async function buildMetadataSuggestion(
  target: string,
  options: SuggestMetadataOptions = {},
): Promise<MetadataSuggestion> {
  const absolutePath = path.resolve(target);
  let content: string;
  try {
    content = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new SuggestMetadataTargetError(target, error);
  }
  const outputPath = toPosix(target);
  const classificationPath =
    repositoryClassificationPath(target)?.relativePath ?? outputPath;
  const entrypoint = classifySuggestionSkillEntrypointPath(outputPath);
  const initialClassification = classifyAssetPath(classificationPath);
  const initialKind = initialClassification.kind;
  const document = parseDocument({
    path: outputPath,
    absolutePath,
    kind: initialKind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: /\.mdx?$/i.test(outputPath),
    content,
  } satisfies Artifact);
  const { metadata } = parseAssetMetadata(document);
  const classification = classifyAssetPath(classificationPath, {
    ...(metadata.type ? { metadataType: metadata.type } : {}),
  });
  const kind = classification.kind;
  const explicitOwner = optionalText(options.owner);
  if (kind === "skill") {
    const collisionBlock = entrypoint
      ? await pathMigrationCollision(entrypoint, absolutePath)
      : undefined;
    const agentSkills = buildAgentSkillMigrationSuggestion(document, {
      ...(explicitOwner ? { explicitOwner } : {}),
      ...(entrypoint ? { entrypoint } : {}),
      ...(collisionBlock ? { additionalBlocks: [collisionBlock] } : {}),
    });
    const metadataRetrofit =
      agentSkills.proposalKind === "canonical-metadata-retrofit";
    const noMigrationProposed =
      agentSkills.proposalKind === "none" &&
      agentSkills.sourceFormat === "agent-skills";
    const decision = skillDecision(agentSkills, metadataRetrofit);
    return {
      path: outputPath,
      kind,
      suggestedMode: noMigrationProposed
        ? "no-proposal"
        : metadataRetrofit
          ? "agent-skills-metadata-retrofit"
          : "agent-skills-migration",
      decisionStatus: decision.status,
      decision: decision.decision,
      classification,
      ownerProvided: Boolean(explicitOwner),
      instructions: noMigrationProposed
        ? [
            "Inspect the canonical Agent Skill without rewriting it.",
            "Preserve the Markdown body, standard Agent Skills fields, and metadata.renma.* extensions.",
            "Do not propose reverse migration or an unnecessary frontmatter rewrite.",
            "Only if a separate, intentional authoring change is made, run renma scan . --fail-on high, fix relevant diagnostics, and rerun the scan.",
          ]
        : metadataRetrofit
          ? [
              "Inspect the canonical Agent Skill before editing.",
              "Preserve the Markdown body and existing standard Agent Skills fields.",
              "Add only the explicitly provided owner as a flat metadata.renma.owner string entry.",
              "Preserve unknown renma.* and other-vendor metadata child keys.",
              "Do not apply a proposal with blocked ownership evidence.",
              "Do not perform reverse migration.",
              "Run renma scan . after human review and application.",
            ]
          : [
              "Inspect the existing Skill before editing.",
              "Preserve the Markdown body and existing standard Agent Skills fields.",
              "If present, move only recognized pre-0.16 Renma Skill fields to flat metadata.renma.* string entries.",
              "Preserve unknown renma.* and other-vendor metadata child keys.",
              "Do not discard or automatically relocate unknown top-level fields.",
              "Apply the entrypoint rename or move together with the frontmatter migration when required.",
              "Do not apply a proposal with blocked migration evidence.",
              "Keep selection boundaries in description and execution constraints in the body.",
              "Run renma scan . after human review and application.",
            ],
      candidateMetadata: {},
      blockedMetadata: agentSkills.blocked,
      nextActions: suggestionNextActions(outputPath, classification),
      agentSkills,
    };
  }
  const existingId = optionalText(metadataValueText(document.metadata.id));
  const existingTitle = optionalText(
    metadataValueText(document.metadata.title),
  );
  const existingOwner = optionalText(metadata.owner);
  const candidateMetadata: Record<string, string> = {};
  const candidateId = inferCandidateId(kind, classificationPath);
  const candidateTitle = mainHeadingTitle(document.headings);

  if (classification.scope === "skill-local") {
    const blockedMetadata = conflictingOwnerEvidence(
      existingOwner,
      explicitOwner,
    );
    if (!existingOwner && explicitOwner)
      candidateMetadata.owner = explicitOwner;
    const hasOverride = Object.keys(candidateMetadata).length > 0;
    return {
      path: outputPath,
      kind,
      suggestedMode: hasOverride ? "metadata-retrofit" : "no-proposal",
      decisionStatus:
        blockedMetadata.length > 0
          ? "blocked"
          : hasOverride
            ? "deterministic"
            : "no-change-recommended",
      decision:
        blockedMetadata.length > 0
          ? {
              reasonCode: "conflicting-ownership-evidence",
              summary:
                "Renma cannot safely construct a local metadata override while declared and provided ownership evidence conflict.",
            }
          : hasOverride
            ? {
                reasonCode: "explicit-human-provided-override",
                summary:
                  "The candidate is an explicit human-provided Skill-local metadata override; it is not required for ordinary local support.",
              }
            : {
                reasonCode: "skill-local-governance-inherited",
                summary:
                  "No independent metadata retrofit is required for this Skill-local support file.",
              },
      classification,
      ownerProvided: Boolean(explicitOwner),
      instructions: skillLocalInstructions(classification, hasOverride),
      candidateMetadata,
      blockedMetadata,
      nextActions: suggestionNextActions(outputPath, classification),
    };
  }

  if (
    classification.matchedRule === "repository-tool" ||
    classification.matchedRule === "unknown"
  ) {
    const unsafe =
      classification.reasonCode === "outside-recognized-asset-boundary" &&
      classificationPath === outputPath &&
      isAbsoluteLike(outputPath);
    return {
      path: outputPath,
      kind,
      suggestedMode: "no-proposal",
      decisionStatus: unsafe ? "blocked" : "no-change-recommended",
      decision: unsafe
        ? {
            reasonCode: "repository-boundary-unresolved",
            summary:
              "Renma could not infer one safe repository-relative boundary for this absolute path.",
          }
        : {
            reasonCode:
              classification.matchedRule === "repository-tool"
                ? "repository-tool-not-context"
                : "outside-recognized-asset-boundary",
            summary:
              "No metadata proposal is generated because the target is not an independently governed Renma asset.",
            question:
              "Is this file intended to have independent ownership and lifecycle under a recognized asset root?",
          },
      classification,
      ownerProvided: Boolean(explicitOwner),
      instructions: [
        "Preserve the existing file.",
        "Do not infer that the target should become a Context Asset from its content or filename.",
        "Do not move the file or add Renma metadata without a human repository-design decision.",
      ],
      candidateMetadata: {},
      blockedMetadata: [],
      nextActions: suggestionNextActions(outputPath, classification),
    };
  }

  if (!existingId && candidateId) {
    candidateMetadata.id = candidateId;
  }
  if (!existingTitle && candidateTitle) {
    candidateMetadata.title = candidateTitle;
  }
  if (!existingOwner && explicitOwner) {
    candidateMetadata.owner = explicitOwner;
  }

  const blockedMetadata: BlockedMetadata[] = conflictingOwnerEvidence(
    existingOwner,
    explicitOwner,
  );
  if (!existingOwner && !explicitOwner) {
    blockedMetadata.push({
      field: "owner",
      reason: "No owner was explicitly provided. Missing owner is allowed.",
    });
  }
  const hasCandidate = Object.keys(candidateMetadata).length > 0;
  const hasConflict = blockedMetadata.some((item) =>
    item.reason.includes("differs from explicitly provided owner"),
  );

  return {
    path: outputPath,
    kind,
    suggestedMode: hasCandidate ? "metadata-retrofit" : "no-proposal",
    decisionStatus: hasConflict
      ? "blocked"
      : hasCandidate
        ? classification.scope === "independent"
          ? "human-confirmation-required"
          : "deterministic"
        : "no-change-recommended",
    decision: hasConflict
      ? {
          reasonCode: "conflicting-ownership-evidence",
          summary: "Renma cannot safely construct a metadata proposal.",
        }
      : hasCandidate && classification.scope === "independent"
        ? {
            reasonCode: "independent-governance-intent-unconfirmed",
            summary:
              "Renma constructed only deterministic candidates; the intended owner, lifecycle, and source-of-truth evidence still require human confirmation.",
            question:
              "Confirm the intended owner, lifecycle, and source-of-truth evidence for this independent asset.",
          }
        : hasCandidate
          ? {
              reasonCode: "deterministic-metadata-candidate",
              summary:
                "The metadata candidate follows the classified repository boundary and explicit user evidence.",
            }
          : {
              reasonCode: "metadata-already-sufficient",
              summary: "Renma found no supported metadata change to propose.",
            },
    classification,
    ownerProvided: Boolean(explicitOwner),
    instructions: buildInstructions({ existingOwner, explicitOwner }),
    candidateMetadata,
    blockedMetadata,
    nextActions: suggestionNextActions(outputPath, classification),
  };
}

export function renderMetadataPrompt(suggestion: MetadataSuggestion): string {
  if (suggestion.agentSkills)
    return renderAgentSkillMigrationPrompt(suggestion);
  const noProposal = suggestion.suggestedMode === "no-proposal";
  const skillLocal = suggestion.classification.scope === "skill-local";
  return `${[
    noProposal
      ? "# Renma Result: No Metadata Proposal"
      : "# Renma Task: Safely Retrofit Renma Metadata",
    "",
    noProposal
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
    noProposal ? "Recommendation:" : "Remaining human decision:",
    suggestion.decision.summary,
    ...(suggestion.decision.question
      ? ["", "Remaining human decision:", suggestion.decision.question]
      : []),
    ...(skillLocal
      ? [
          "",
          `This file is Skill-local support governed by:`,
          suggestion.classification.parentAssetPath ??
            "(unresolved parent Skill)",
          "",
          "Its effective ownership and policy may be inherited from the parent Skill.",
          "Preserve existing metadata if present.",
          "Do not add an owner, move the file, or create a patch solely to manufacture work.",
        ]
      : []),
    "",
    "Rules:",
    ...suggestion.instructions.map((instruction) => `- ${instruction}`),
    "",
    "Candidate Metadata:",
    ...metadataLines(suggestion.candidateMetadata),
    "",
    "Blocked Metadata:",
    ...blockedMetadataLines(suggestion.blockedMetadata),
    "",
    "Verification:",
    ...(noProposal
      ? ["- No verification change is required when no file change is made."]
      : [
          "- Run `renma scan . --fail-on high --format json`.",
          "- Run `renma ownership .`.",
        ]),
    "",
    noProposal
      ? "Stop without manufacturing work. Preserve the existing source."
      : "Return a small reviewed patch. Do not rewrite the asset body.",
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
  const candidate = migration.canonicalFrontmatter
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
    suggestion.blockedMetadata.length > 0
      ? "blocked"
      : noMigrationProposed || !migration.canonicalFrontmatter
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
    migration.canonicalFrontmatter
      ? migration.entrypointMigration === "none"
        ? "Return a small reviewed frontmatter patch. Do not rewrite the Skill body."
        : "Return one small reviewed patch containing both the entrypoint path migration and frontmatter migration. Do not rewrite the Skill body."
      : migration.blocked.length > 0
        ? "Do not return or apply a frontmatter patch while migration is blocked. Preserve the existing source until every blocked item is resolved with human review."
        : "No frontmatter patch is proposed. Do not return or apply a frontmatter patch; preserve the existing source.",
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

function buildInstructions(input: {
  existingOwner?: string | undefined;
  explicitOwner?: string | undefined;
}): string[] {
  return [
    "Inspect the existing asset before editing.",
    "Preserve the existing markdown body content.",
    "Preserve existing frontmatter fields and values unless they are clearly invalid.",
    "Add missing metadata only when it is clearly supported by file content, established Renma path conventions, or user-provided options.",
    "Do not infer or invent owner.",
    "Do not infer owner from Git history, file path, prose, or author.",
    "Missing owner is allowed.",
    "Avoid placeholder metadata.",
    "Keep metadata compact.",
    ownerInstruction(input),
    "Run renma scan . and renma ownership . after editing.",
  ];
}

function ownerInstruction(input: {
  existingOwner?: string | undefined;
  explicitOwner?: string | undefined;
}): string {
  if (input.existingOwner) {
    if (input.explicitOwner && input.existingOwner !== input.explicitOwner) {
      return `Existing owner is ${input.existingOwner}. The explicitly provided owner ${input.explicitOwner} differs, so do not change ownership without human review.`;
    }
    return `Preserve existing owner: ${input.existingOwner}.`;
  }
  if (input.explicitOwner) {
    return `Use owner: ${input.explicitOwner} because the user explicitly provided it.`;
  }
  return "Do not add owner unless the existing asset already declares one or a maintainer provides one.";
}

function metadataLines(candidateMetadata: Record<string, string>): string[] {
  const entries = Object.entries(candidateMetadata);
  if (entries.length === 0) {
    return ["- (none)"];
  }
  return entries.map(([field, value]) => `- ${field}: \`${value}\``);
}

function blockedMetadataLines(blockedMetadata: BlockedMetadata[]): string[] {
  if (blockedMetadata.length === 0) {
    return ["- (none)"];
  }
  return blockedMetadata.map((item) => `- ${item.field}: ${item.reason}`);
}

function skillDecision(
  migration: AgentSkillMigrationSuggestion,
  metadataRetrofit: boolean,
): { status: DecisionStatus; decision: AssetDecisionEvidence } {
  if (migration.blocked.length > 0) {
    return {
      status: "blocked",
      decision: {
        reasonCode: "conflicting-or-incomplete-skill-evidence",
        summary:
          "Renma cannot safely construct the Agent Skills proposal until the blocked evidence is resolved by a human.",
      },
    };
  }
  if (
    migration.proposalKind === "none" &&
    migration.sourceFormat === "agent-skills"
  ) {
    return {
      status: "no-change-recommended",
      decision: {
        reasonCode: "canonical-agent-skill-no-change",
        summary:
          "The target is already a canonical Agent Skill and no metadata or migration change is recommended.",
      },
    };
  }
  if (metadataRetrofit) {
    return {
      status: "deterministic",
      decision: {
        reasonCode: "explicit-human-provided-override",
        summary:
          "The metadata candidate uses the owner explicitly supplied by the human; Renma inferred no owner.",
      },
    };
  }
  return {
    status: "human-confirmation-required",
    decision: {
      reasonCode: "agent-skills-migration-review-required",
      summary:
        "Renma constructed a deterministic migration candidate, but a human must confirm the intended Skill semantics before applying it.",
    },
  };
}

function conflictingOwnerEvidence(
  existingOwner: string | undefined,
  explicitOwner: string | undefined,
): BlockedMetadata[] {
  if (!existingOwner || !explicitOwner || existingOwner === explicitOwner) {
    return [];
  }
  return [
    {
      field: "owner",
      reason: `Existing owner "${existingOwner}" differs from explicitly provided owner "${explicitOwner}". Do not change ownership without human review.`,
    },
  ];
}

function skillLocalInstructions(
  classification: AssetClassificationEvidence,
  hasOverride: boolean,
): string[] {
  return [
    "Preserve the existing Skill-local file and any explicitly declared supported metadata.",
    `Treat ${classification.parentAssetPath ?? "the parent Skill"} as the default governance source.`,
    "Independent metadata is not required merely because this is a Skill-local file.",
    hasOverride
      ? "Apply only the explicit human-provided override; do not describe it as mandatory local metadata."
      : "Do not add metadata, move the file, or create a patch solely to manufacture work.",
    "Never infer owner from the path, prose, Git history, or author.",
  ];
}

function suggestionNextActions(
  targetPath: string,
  classification: AssetClassificationEvidence,
): Array<{ kind: string; command: string }> {
  const actions: Array<{ kind: string; command: string }> = [];
  if (classification.parentAssetPath) {
    actions.push({
      kind: "inspect-parent",
      command: `renma inspect ${shellArgument(classification.parentAssetPath)} --format json`,
    });
  } else {
    actions.push({
      kind: "inspect-target",
      command: `renma inspect ${shellArgument(targetPath)} --format json`,
    });
  }
  actions.push({
    kind: "verify",
    command: "renma scan . --fail-on high --format json",
  });
  return actions;
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function classificationPromptLines(
  classification: AssetClassificationEvidence,
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
  classification: AssetClassificationEvidence,
): string {
  if (classification.matchedRule === "skill-local-support") {
    return `The target is under the ${classification.supportDirectory}/ directory of a recognized Skill.`;
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
  classification: AssetClassificationEvidence,
): string {
  if (classification.scope === "skill-local") {
    return `The target is Skill-local support governed by ${classification.parentAssetPath ?? "its parent Skill"}.`;
  }
  if (classification.scope === "independent") {
    return `The target is an independently governed ${classification.kind} asset.`;
  }
  if (classification.scope === "repository-support") {
    return "The target is repository support, not an independently governed Context Asset.";
  }
  return "Renma does not classify the target as an independently governed asset.";
}

function classifySuggestionSkillEntrypointPath(
  filePath: string,
): SkillEntrypointPath | undefined {
  return isAbsoluteLike(filePath)
    ? classifyAbsoluteSkillEntrypointPath(filePath)
    : classifyRepositorySkillEntrypointPath(filePath);
}

async function pathMigrationCollision(
  entrypoint: SkillEntrypointPath,
  sourceAbsolutePath: string,
): Promise<BlockedMetadata | undefined> {
  if (entrypoint.kind === "canonical") return undefined;
  const targetAbsolutePath = path.resolve(entrypoint.targetPath);
  try {
    await lstat(targetAbsolutePath);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    return {
      field: "targetPath",
      reason: `Could not safely inspect migration target ${entrypoint.targetPath}: ${readErrorReason(error)} Human review is required before migration.`,
    };
  }

  try {
    const [sourceInfo, targetInfo, sourceRealPath, targetRealPath] =
      await Promise.all([
        stat(sourceAbsolutePath),
        stat(targetAbsolutePath),
        realpath(sourceAbsolutePath),
        realpath(targetAbsolutePath),
      ]);
    if (
      sourceRealPath === targetRealPath ||
      (sourceInfo.dev === targetInfo.dev && sourceInfo.ino === targetInfo.ino)
    ) {
      return undefined;
    }
    return {
      field: "targetPath",
      reason: `Target Agent Skills entrypoint already exists at ${entrypoint.targetPath}. Human review is required before migration.`,
    };
  } catch (error) {
    return {
      field: "targetPath",
      reason: `Could not safely verify migration target ${entrypoint.targetPath}: ${readErrorReason(error)} Human review is required before migration.`,
    };
  }
}

function isAbsoluteLike(filePath: string): boolean {
  return path.isAbsolute(filePath) || /^[A-Za-z]:\//.test(filePath);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function inferCandidateId(
  kind: ArtifactKind,
  filePath: string,
): string | undefined {
  if (kind === "skill") {
    return inferRootedId("skill", filePath, "skills", (parts) =>
      parts.filter((part) => part !== "SKILL"),
    );
  }
  if (kind === "context") {
    return inferRootedId("context", filePath, "contexts");
  }
  if (kind === "context_lens") {
    return inferRootedId("lens", filePath, "lenses");
  }
  return undefined;
}

function inferRootedId(
  prefix: string,
  filePath: string,
  rootSegment: string,
  transform: (parts: string[]) => string[] = (parts) => parts,
): string | undefined {
  const parts = pathParts(stripExtension(filePath));
  let rootIndex = lastIndexOf(parts, rootSegment);
  if (rootIndex < 0 && rootSegment === "contexts") {
    rootIndex = lastIndexOf(parts, "context");
  }
  if (rootIndex < 0) return undefined;

  const idParts = transform(parts.slice(rootIndex + 1))
    .map(slugify)
    .filter(Boolean);
  if (idParts.length === 0) return undefined;
  if (idParts[0] === prefix) return idParts.join(".");
  return [prefix, ...idParts].join(".");
}

function mainHeadingTitle(headings: Array<{ depth: number; text: string }>) {
  return headings.find((heading) => heading.depth === 1)?.text.trim();
}

function metadataValueText(
  value: MetadataValue | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stripExtension(value: string): string {
  return value.replace(/\.[^/.]+$/, "");
}

function pathParts(value: string): string[] {
  return toPosix(value).split("/").filter(Boolean);
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function lastIndexOf(values: string[], target: string): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] === target) return index;
  }
  return -1;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readErrorReason(error: unknown): string {
  const code = errorCode(error);
  if (code === "ENOENT") return "file does not exist";
  if (code === "EISDIR") return "target is a directory";
  if (code === "EACCES" || code === "EPERM") return "permission denied";
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
