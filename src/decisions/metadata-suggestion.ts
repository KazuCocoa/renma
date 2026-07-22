import type { AgentSkillMigrationSuggestion } from "../skill-migration.js";
import type { ArtifactKind } from "../types/artifact.js";
import type { AssetClassificationEvidence } from "../types/classification.js";
import type {
  AssetDecisionEvidence,
  DecisionStatus,
  SuggestedNextAction,
} from "../types/decision.js";

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

export interface SkillLocalSuggestionDecisionInput {
  hasOwnerConflict: boolean;
  hasOverride: boolean;
  hasLocalGovernance: boolean;
  inheritsGovernance: boolean;
}

export interface UnsupportedTargetSuggestionDecisionInput {
  matchedRule: "repository-tool" | "unknown";
  boundaryReasonCode?:
    | "repository-boundary-unresolved"
    | "repository-boundary-ambiguous";
}

export interface MetadataCandidateSuggestionDecisionInput {
  hasOwnerConflict: boolean;
  hasCandidate: boolean;
  scope: AssetClassificationEvidence["scope"];
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

export function buildSkillLocalParentUnresolvedDecision(): SuggestionDecision {
  return {
    status: "blocked",
    decision: {
      reasonCode: "skill-local-parent-unresolved",
      summary:
        "Renma cannot confirm one parent Skill, so it cannot claim inherited governance or safely propose an independent local override.",
      question:
        "Resolve the missing or ambiguous parent Skill layout, then rerun this command.",
    },
  };
}

export function buildSkillLocalSuggestionDecision(
  input: SkillLocalSuggestionDecisionInput,
): SuggestionDecision {
  if (input.hasOwnerConflict) {
    return {
      status: "blocked",
      decision: {
        reasonCode: "conflicting-ownership-evidence",
        summary:
          "Renma cannot safely construct a local metadata override while declared and provided ownership evidence conflict.",
      },
    };
  }
  if (input.hasOverride) {
    return {
      status: "deterministic",
      decision: {
        reasonCode: "explicit-human-provided-override",
        summary:
          "The candidate is an explicit human-provided Skill-local metadata override; it is not required for ordinary local support.",
      },
    };
  }
  if (input.hasLocalGovernance) {
    return {
      status: "no-change-recommended",
      decision: {
        reasonCode: "skill-local-existing-metadata-preserved",
        summary:
          "Existing explicit local governance metadata is preserved; no inherited-governance claim or retrofit is needed.",
      },
    };
  }
  if (input.inheritsGovernance) {
    return {
      status: "no-change-recommended",
      decision: {
        reasonCode: "skill-local-governance-inherited",
        summary:
          "One unambiguous parent Skill supplies effective governance, so no independent metadata retrofit is required.",
      },
    };
  }
  return {
    status: "no-change-recommended",
    decision: {
      reasonCode: "skill-local-unowned",
      summary:
        "The parent Skill is resolved, but neither the local file nor its parent declares an owner; missing ownership remains allowed.",
    },
  };
}

export function buildUnsupportedTargetSuggestionDecision(
  input: UnsupportedTargetSuggestionDecisionInput,
): SuggestionDecision {
  if (input.boundaryReasonCode) {
    return {
      status: "blocked",
      decision: {
        reasonCode: input.boundaryReasonCode,
        summary:
          "Renma could not infer one safe repository-relative boundary for this target path.",
      },
    };
  }
  return {
    status: "no-change-recommended",
    decision: {
      reasonCode:
        input.matchedRule === "repository-tool"
          ? "repository-tool-not-context"
          : "outside-recognized-asset-boundary",
      summary:
        "No metadata proposal is generated because the target is not an independently governed Renma asset.",
      question:
        "Is this file intended to have independent ownership and lifecycle under a recognized asset root?",
    },
  };
}

export function buildMetadataCandidateSuggestionDecision(
  input: MetadataCandidateSuggestionDecisionInput,
): SuggestionDecision {
  if (input.hasOwnerConflict) {
    return {
      status: "blocked",
      decision: {
        reasonCode: "conflicting-ownership-evidence",
        summary: "Renma cannot safely construct a metadata proposal.",
      },
    };
  }
  if (!input.hasCandidate) {
    return {
      status: "no-change-recommended",
      decision: {
        reasonCode: "metadata-already-sufficient",
        summary: "Renma found no supported metadata change to propose.",
      },
    };
  }
  if (input.scope === "independent") {
    return {
      status: "human-confirmation-required",
      decision: {
        reasonCode: "independent-governance-intent-unconfirmed",
        summary:
          "Renma constructed only deterministic candidates; the intended owner, lifecycle, and source-of-truth evidence still require human confirmation.",
        question:
          "Confirm the intended owner, lifecycle, and source-of-truth evidence for this independent asset.",
      },
    };
  }
  return {
    status: "deterministic",
    decision: {
      reasonCode: "deterministic-metadata-candidate",
      summary:
        "The metadata candidate follows the classified repository boundary and explicit user evidence.",
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
