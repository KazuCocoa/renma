import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { SkillParentResolution } from "../catalog.js";
import { renmaCommand } from "../command-invocation.js";
import {
  buildSkillSuggestionDecision,
  evaluateOwnerConflict,
  type BlockedMetadata,
  type MetadataSuggestion,
} from "../decisions/metadata-suggestion.js";
import type { SkillEntrypointPath } from "../discovery.js";
import {
  collectTargetDocumentEvidence,
  collectTargetRepositoryEvidence,
  type TargetRepositoryEvidence,
} from "../evidence/target.js";
import { buildAgentSkillMigrationSuggestion } from "../skill-migration.js";
import { renderMetadataPrompt } from "../renderers/metadata-suggestion.js";
import type {
  ArtifactKind,
  AssetClassificationEvidence,
  MetadataValue,
  SuggestedNextAction,
} from "../types.js";

export type {
  BlockedMetadata,
  MetadataSuggestion,
} from "../decisions/metadata-suggestion.js";
export { renderMetadataPrompt };

export type SuggestMetadataFormat = "prompt" | "json";

export interface SuggestMetadataOptions {
  format?: SuggestMetadataFormat;
  owner?: string;
}

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
  let targetEvidence;
  try {
    targetEvidence = await collectTargetDocumentEvidence(target, {
      unresolvedArtifactPath: "input",
    });
  } catch (error) {
    throw new SuggestMetadataTargetError(target, error);
  }
  const {
    absolutePath,
    outputPath,
    repositoryBoundary: classificationContext,
    repositoryRelativePath: classificationPath,
    repositoryRoot,
    entrypoint,
    document,
    metadata,
  } = targetEvidence;
  let { classification } = targetEvidence;
  const kind = classification.kind;
  const explicitOwner = optionalText(options.owner);
  if (kind === "skill") {
    const collisionBlock =
      entrypoint && repositoryRoot
        ? await pathMigrationCollision(entrypoint, absolutePath, repositoryRoot)
        : undefined;
    const agentSkills = buildAgentSkillMigrationSuggestion(document, {
      ...(explicitOwner ? { explicitOwner } : {}),
      ...(entrypoint ? { entrypoint } : {}),
      ...(collisionBlock ? { additionalBlocks: [collisionBlock] } : {}),
    });
    const noMigrationProposed =
      agentSkills.proposalKind === "none" &&
      agentSkills.sourceFormat === "agent-skills";
    const metadataRetrofit =
      agentSkills.proposalKind === "canonical-metadata-retrofit";
    const decision = buildSkillSuggestionDecision(agentSkills);
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
      nextActions: suggestionNextActions(
        outputPath,
        classification,
        repositoryRoot,
      ),
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
    const localContext = resolveSkillLocalContext(
      await collectTargetRepositoryEvidence(targetEvidence),
    );
    classification = localContext.classification;
    if (localContext.parent.state !== "resolved") {
      const parentState =
        localContext.parent.state === "not-applicable"
          ? "structural-candidate"
          : localContext.parent.state;
      const blockedMetadata: BlockedMetadata[] = [
        {
          field: "parent_skill",
          reason: `The structural parent Skill is ${parentState}; inheritance is not established. Review the repository layout before adding local metadata.`,
        },
      ];
      return {
        path: outputPath,
        kind,
        suggestedMode: "no-proposal",
        decisionStatus: "blocked",
        decision: {
          reasonCode: "skill-local-parent-unresolved",
          summary:
            "Renma cannot confirm one parent Skill, so it cannot claim inherited governance or safely propose an independent local override.",
          question:
            "Resolve the missing or ambiguous parent Skill layout, then rerun this command.",
        },
        classification,
        ownerProvided: Boolean(explicitOwner),
        instructions: skillLocalInstructions(
          classification,
          false,
          true,
          false,
        ),
        candidateMetadata: {},
        blockedMetadata,
        nextActions: suggestionNextActions(
          outputPath,
          classification,
          repositoryRoot,
        ),
      };
    }
    const ownerConflict = evaluateOwnerConflict(existingOwner, explicitOwner);
    const blockedMetadata = ownerConflict.blockedMetadata;
    if (!existingOwner && explicitOwner)
      candidateMetadata.owner = explicitOwner;
    const hasOverride = Object.keys(candidateMetadata).length > 0;
    const hasLocalGovernance =
      Boolean(existingOwner) || localContext.hasLocalPolicyMetadata;
    const inherited = localContext.ownershipSource === "inherited";
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
            : hasLocalGovernance
              ? {
                  reasonCode: "skill-local-existing-metadata-preserved",
                  summary:
                    "Existing explicit local governance metadata is preserved; no inherited-governance claim or retrofit is needed.",
                }
              : inherited
                ? {
                    reasonCode: "skill-local-governance-inherited",
                    summary:
                      "One unambiguous parent Skill supplies effective governance, so no independent metadata retrofit is required.",
                  }
                : {
                    reasonCode: "skill-local-unowned",
                    summary:
                      "The parent Skill is resolved, but neither the local file nor its parent declares an owner; missing ownership remains allowed.",
                  },
      classification,
      ownerProvided: Boolean(explicitOwner),
      instructions: skillLocalInstructions(
        classification,
        hasOverride,
        false,
        hasLocalGovernance,
      ),
      candidateMetadata,
      blockedMetadata,
      nextActions: suggestionNextActions(
        outputPath,
        classification,
        repositoryRoot,
      ),
    };
  }

  if (
    classification.matchedRule === "repository-tool" ||
    classification.matchedRule === "unknown"
  ) {
    const unsafe = classificationContext.state === "unresolved";
    return {
      path: outputPath,
      kind,
      suggestedMode: "no-proposal",
      decisionStatus: unsafe ? "blocked" : "no-change-recommended",
      decision: unsafe
        ? {
            reasonCode: classificationContext.reasonCode,
            summary:
              "Renma could not infer one safe repository-relative boundary for this target path.",
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
      nextActions: suggestionNextActions(
        outputPath,
        classification,
        repositoryRoot,
      ),
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

  const ownerConflict = evaluateOwnerConflict(existingOwner, explicitOwner);
  const blockedMetadata: BlockedMetadata[] = ownerConflict.blockedMetadata;
  if (!existingOwner && !explicitOwner) {
    blockedMetadata.push({
      field: "owner",
      reason: "No owner was explicitly provided. Missing owner is allowed.",
    });
  }
  const hasCandidate = Object.keys(candidateMetadata).length > 0;
  const hasConflict = ownerConflict.hasConflict;

  return {
    path: outputPath,
    kind,
    suggestedMode:
      hasConflict || !hasCandidate ? "no-proposal" : "metadata-retrofit",
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
    candidateMetadata: hasConflict ? {} : candidateMetadata,
    blockedMetadata,
    nextActions: suggestionNextActions(
      outputPath,
      classification,
      repositoryRoot,
    ),
  };
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

function skillLocalInstructions(
  classification: AssetClassificationEvidence,
  hasOverride: boolean,
  parentBlocked: boolean,
  hasLocalGovernance: boolean,
): string[] {
  return [
    "Preserve the existing Skill-local file and any explicitly declared supported metadata.",
    parentBlocked
      ? "Do not claim inherited governance until exactly one parent Skill resolves."
      : hasLocalGovernance
        ? "Keep existing explicit local governance separate from parent inheritance."
        : `Treat ${classification.parentAssetPath ?? "the resolved parent Skill"} as the default governance source.`,
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
  repositoryRoot: string | undefined,
): SuggestedNextAction[] {
  // Do not manufacture an action relative to cwd when the repository root is
  // unresolved; a parent workspace may contain unrelated repositories.
  if (!repositoryRoot) return [];
  const actions: SuggestedNextAction[] = [];
  // Verification is anchored to the resolved root, never to `scan .` from the
  // caller's workspace or to a guessed parent directory.
  const scanTarget = repositoryRoot;
  if (
    classification.parentResolution === "resolved" &&
    classification.parentAssetPath
  ) {
    actions.push({
      kind: "inspect-parent",
      invocation: renmaCommand([
        "inspect",
        path.join(repositoryRoot, classification.parentAssetPath),
        "--format",
        "json",
      ]),
    });
  } else if (
    classification.scope === "skill-local" &&
    classification.parentResolution !== "resolved"
  ) {
    actions.push({
      kind: "review-layout",
      invocation: renmaCommand([
        "scan",
        scanTarget,
        "--fail-on",
        "high",
        "--format",
        "json",
      ]),
    });
    return actions;
  } else {
    actions.push({
      kind: "inspect-target",
      invocation: renmaCommand(["inspect", targetPath, "--format", "json"]),
    });
  }
  actions.push({
    kind: "verify",
    invocation: renmaCommand([
      "scan",
      scanTarget,
      "--fail-on",
      "high",
      "--format",
      "json",
    ]),
  });
  return actions;
}

interface SkillLocalContext {
  classification: AssetClassificationEvidence;
  parent: SkillParentResolution;
  ownershipSource: "declared" | "inherited" | "unowned";
  hasLocalPolicyMetadata: boolean;
}

function resolveSkillLocalContext(
  repository: TargetRepositoryEvidence,
): SkillLocalContext {
  if (repository.state === "unavailable") {
    // Snapshot failure is unresolved evidence. Keep the command fail-closed
    // instead of treating structural placement as inherited governance.
    return {
      classification: repository.classification,
      parent: { state: "not-applicable" },
      ownershipSource: "unowned",
      hasLocalPolicyMetadata: false,
    };
  }
  return {
    classification: repository.classification,
    parent: repository.parent,
    ownershipSource:
      repository.governance?.ownership.source ??
      (repository.parent.state === "resolved" && repository.parent.parent.owner
        ? "inherited"
        : "unowned"),
    hasLocalPolicyMetadata: repository.policy?.hasLocalPolicyMetadata ?? false,
  };
}

async function pathMigrationCollision(
  entrypoint: SkillEntrypointPath,
  sourceAbsolutePath: string,
  repositoryRoot: string,
): Promise<BlockedMetadata | undefined> {
  if (entrypoint.kind === "canonical") return undefined;
  // Public migration paths remain repository-relative. Collision I/O must be
  // rebased against the resolved repository root, not process.cwd().
  const targetAbsolutePath = path.resolve(
    repositoryRoot,
    entrypoint.targetPath,
  );
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
