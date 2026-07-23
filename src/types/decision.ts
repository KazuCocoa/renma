/** Explicit outcome for commands that may recommend an authoring change. */
export type DecisionStatus =
  | "deterministic"
  | "human-confirmation-required"
  | "blocked"
  | "no-change-recommended";

/** Stable registry of suggestion decision reasons. */
export const ASSET_DECISION_REASON_CODES = [
  "conflicting-ownership-evidence",
  "explicit-human-provided-override",
  "skill-local-governance-inherited",
  "skill-local-existing-metadata-preserved",
  "skill-local-unowned",
  "skill-local-parent-unresolved",
  "repository-boundary-unresolved",
  "repository-boundary-ambiguous",
  "repository-tool-not-context",
  "outside-recognized-asset-boundary",
  "independent-governance-intent-unconfirmed",
  "deterministic-metadata-candidate",
  "metadata-already-sufficient",
  "conflicting-or-incomplete-skill-evidence",
  "canonical-agent-skill-no-change",
  "agent-skills-migration-review-required",
] as const;
export type AssetDecisionReasonCode =
  (typeof ASSET_DECISION_REASON_CODES)[number];

export interface AssetDecisionEvidence {
  reasonCode: AssetDecisionReasonCode;
  summary: string;
  question?: string;
}

/** Executable command data plus a shell-oriented human display string. */
export interface CommandInvocation<Args extends string[] = string[]> {
  command: "renma";
  args: Args;
  display: string;
}

export interface SuggestedNextAction {
  kind: "inspect-parent" | "inspect-target" | "review-layout" | "verify";
  invocation: CommandInvocation;
}
