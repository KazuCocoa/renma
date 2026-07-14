import type { AgentSkillMigrationSuggestion } from "../skill-migration.js";
import type {
  ArtifactKind,
  AssetClassificationEvidence,
  AssetDecisionEvidence,
  DecisionStatus,
  SuggestedNextAction,
} from "../types.js";

export interface BlockedMetadata {
  field: string;
  reason: string;
}

/** Public suggestion DTO consumed by both JSON and human renderers. */
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
  nextActions: SuggestedNextAction[];
  agentSkills?: AgentSkillMigrationSuggestion;
}

export interface SuggestionDecision {
  status: DecisionStatus;
  decision: AssetDecisionEvidence;
}

export interface OwnerConflictEvidence {
  hasConflict: boolean;
  blockedMetadata: BlockedMetadata[];
}

/**
 * Decide Skill migration applicability before rendering any candidate text.
 *
 * Blocked migrations intentionally retain partial diagnostic candidate fields
 * for 0.18.2 JSON compatibility. `canonicalFrontmatter` and renderer patch
 * instructions remain gated by the decision status, so those fields are not
 * an independently applicable patch.
 */
export function buildSkillSuggestionDecision(
  migration: AgentSkillMigrationSuggestion,
): SuggestionDecision {
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
  if (
    migration.proposalKind === "canonical-metadata-retrofit" &&
    migration.canonicalFrontmatter !== undefined &&
    Object.keys(migration.candidateRenmaMetadata).length > 0
  ) {
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

/** Build typed conflict evidence; command branching must not parse prose. */
export function evaluateOwnerConflict(
  existingOwner: string | undefined,
  explicitOwner: string | undefined,
): OwnerConflictEvidence {
  const hasConflict = Boolean(
    existingOwner && explicitOwner && existingOwner !== explicitOwner,
  );
  return {
    hasConflict,
    blockedMetadata: hasConflict
      ? [
          {
            field: "owner",
            reason: `Existing owner "${existingOwner}" differs from explicitly provided owner "${explicitOwner}". Do not change ownership without human review.`,
          },
        ]
      : [],
  };
}
