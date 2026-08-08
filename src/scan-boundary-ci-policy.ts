import type { EffectiveCiScanBoundaryEvidence } from "./scan-boundary.js";
import type {
  ScanBoundaryChange,
  ScanBoundaryDiff,
} from "./scan-boundary-diff.js";
import type { ScanBoundaryCiPolicyMode } from "./types/configuration.js";

export const SCAN_BOUNDARY_CI_POLICY_SCHEMA_VERSION =
  "renma.scan-boundary-ci-policy.v1" as const;

export const SCAN_BOUNDARY_CI_MATCH_IDS = {
  GLOB_REMOVED: "scan_boundary_ci.glob_removed",
  EXCLUSION_ADDED: "scan_boundary_ci.exclusion_added",
  MAX_DEPTH_REDUCED: "scan_boundary_ci.max_depth_reduced",
  MAX_FILE_SIZE_REDUCED: "scan_boundary_ci.max_file_size_reduced",
  SUPPRESSION_ADDED: "scan_boundary_ci.suppression_added",
  SUPPRESSION_LIFETIME_EXTENDED:
    "scan_boundary_ci.suppression_lifetime_extended",
} as const;

export type ScanBoundaryCiMatchId =
  (typeof SCAN_BOUNDARY_CI_MATCH_IDS)[keyof typeof SCAN_BOUNDARY_CI_MATCH_IDS];

export interface ScanBoundaryCiConfiguration {
  from: ScanBoundaryCiPolicyMode;
  to: ScanBoundaryCiPolicyMode;
}

export interface ScanBoundaryCiMatch {
  id: ScanBoundaryCiMatchId;
  summary: string;
  change: ScanBoundaryChange;
}

export interface ScanBoundaryCiEvaluation {
  schemaVersion: typeof SCAN_BOUNDARY_CI_POLICY_SCHEMA_VERSION;
  configured: ScanBoundaryCiConfiguration & {
    effective: ScanBoundaryCiPolicyMode;
  };
  outcome: "pass" | "warn" | "fail";
  matchCount: number;
  matches: ScanBoundaryCiMatch[];
  effectiveBoundary?: EffectiveCiScanBoundaryEvidence;
}

const MODE_RANK: Record<ScanBoundaryCiPolicyMode, number> = {
  off: 0,
  warn: 1,
  fail: 2,
};

export function effectiveScanBoundaryCiPolicy(
  configured: ScanBoundaryCiConfiguration,
): ScanBoundaryCiPolicyMode {
  return MODE_RANK[configured.from] >= MODE_RANK[configured.to]
    ? configured.from
    : configured.to;
}

export function evaluateScanBoundaryCiPolicy(
  diff: Pick<ScanBoundaryDiff, "changes">,
  configured: ScanBoundaryCiConfiguration,
  effectiveBoundary?: EffectiveCiScanBoundaryEvidence,
): ScanBoundaryCiEvaluation {
  const effective = effectiveScanBoundaryCiPolicy(configured);
  const matches = diff.changes
    .filter((change) => change.direction === "weakening")
    .map((change) => toMatch(change))
    .sort((left, right) => matchKey(left).localeCompare(matchKey(right)));
  return {
    schemaVersion: SCAN_BOUNDARY_CI_POLICY_SCHEMA_VERSION,
    configured: { ...configured, effective },
    outcome:
      effective === "off" || matches.length === 0
        ? "pass"
        : effective === "fail"
          ? "fail"
          : "warn",
    matchCount: matches.length,
    matches,
    ...(effectiveBoundary ? { effectiveBoundary } : {}),
  };
}

function toMatch(change: ScanBoundaryChange): ScanBoundaryCiMatch {
  if (change.kind === "glob") {
    return {
      id: SCAN_BOUNDARY_CI_MATCH_IDS.GLOB_REMOVED,
      summary: "A configured include glob was removed.",
      change,
    };
  }
  if (change.kind === "exclusion") {
    return {
      id: SCAN_BOUNDARY_CI_MATCH_IDS.EXCLUSION_ADDED,
      summary: "A scan exclusion was added.",
      change,
    };
  }
  if (change.kind === "limit") {
    return {
      id:
        change.property === "maxDepth"
          ? SCAN_BOUNDARY_CI_MATCH_IDS.MAX_DEPTH_REDUCED
          : SCAN_BOUNDARY_CI_MATCH_IDS.MAX_FILE_SIZE_REDUCED,
      summary:
        change.property === "maxDepth"
          ? "The maximum scan depth was reduced."
          : "The maximum inspected file size was reduced.",
      change,
    };
  }
  return {
    id:
      change.change === "lifetime_extended"
        ? SCAN_BOUNDARY_CI_MATCH_IDS.SUPPRESSION_LIFETIME_EXTENDED
        : SCAN_BOUNDARY_CI_MATCH_IDS.SUPPRESSION_ADDED,
    summary:
      change.change === "lifetime_extended"
        ? "A suppression lifetime was extended."
        : "A finding suppression was introduced or expanded.",
    change,
  };
}

function matchKey(match: ScanBoundaryCiMatch): string {
  return `${match.id}\0${JSON.stringify(match.change)}`;
}
