import path from "node:path";

import { classifyAssetPath, isExcluded } from "./discovery.js";
import type { RepositoryPathState } from "./repository-paths.js";
import type { AssetClassificationEvidence } from "./types/classification.js";
import type { ScanConfig } from "./types/configuration.js";

export const INSPECTION_COVERAGE_SCHEMA_VERSION =
  "renma.inspection-coverage.v1" as const;
export const INSPECTION_COVERAGE_DIFF_SCHEMA_VERSION =
  "renma.inspection-coverage-diff.v1" as const;

export type InspectionCoverageState =
  "parsed" | "symlink" | "unreadable" | "oversize" | "deep" | "unsupported";

export interface InspectionCoveragePathEvidence {
  path: string;
  state: InspectionCoverageState;
  reason: string;
  classification: AssetClassificationEvidence;
  strictBlocking: boolean;
}

export type InspectionCoverageIssue = InspectionCoveragePathEvidence & {
  state: Exclude<InspectionCoverageState, "parsed">;
  strictBlocking: true;
};

/** Canonical evidence for expected first-class agent-facing paths. */
export interface InspectionCoverage {
  schemaVersion: typeof INSPECTION_COVERAGE_SCHEMA_VERSION;
  expectedPathCount: number;
  inspectedPathCount: number;
  complete: boolean;
  inspectedPaths: string[];
  blockingIssues: InspectionCoverageIssue[];
}

export type InspectionCoverageDiffState =
  InspectionCoverageState | "not_expected";

export interface InspectionCoverageChange {
  path: string;
  fromState: InspectionCoverageDiffState;
  toState: InspectionCoverageDiffState;
  classification: AssetClassificationEvidence;
  strictBlocking: boolean;
}

export interface InspectionCoverageDiff {
  schemaVersion: typeof INSPECTION_COVERAGE_DIFF_SCHEMA_VERSION;
  from: {
    expectedPathCount: number;
    inspectedPathCount: number;
    blockingIssueCount: number;
  };
  to: {
    expectedPathCount: number;
    inspectedPathCount: number;
    blockingIssueCount: number;
  };
  regressions: InspectionCoverageChange[];
  resolvedIssues: InspectionCoverageChange[];
}

const EXPECTED_AGENT_FACING_RULES = new Set<
  AssetClassificationEvidence["matchedRule"]
>([
  "skill-entrypoint",
  "context-root",
  "context-root-legacy",
  "lens-root",
  "agent-root",
]);

const BLOCKING_STATES = new Set<RepositoryPathState>([
  "symlink",
  "unreadable",
  "oversize",
  "deep",
  "unsupported",
]);

/** Build coverage only from canonical discovery and repository-path evidence. */
export function buildInspectionCoverage(
  pathStates: ReadonlyMap<string, RepositoryPathState>,
  config: Pick<ScanConfig, "globs" | "exclude">,
): InspectionCoverage {
  const pathEvidence = [...pathStates]
    .flatMap(([candidate, state]): InspectionCoveragePathEvidence[] => {
      if (state !== "parsed" && !BLOCKING_STATES.has(state)) return [];
      if (isExcluded(candidate, config.exclude)) return [];
      if (
        !config.globs.some((pattern) => path.matchesGlob(candidate, pattern))
      ) {
        return [];
      }
      const classification = classifyAssetPath(candidate);
      if (!EXPECTED_AGENT_FACING_RULES.has(classification.matchedRule)) {
        return [];
      }
      const coverageState = state as InspectionCoverageState;
      return [
        {
          path: candidate,
          state: coverageState,
          reason: inspectionCoverageReason(coverageState),
          classification,
          strictBlocking: coverageState !== "parsed",
        },
      ];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const blockingIssues = pathEvidence.filter(
    (evidence): evidence is InspectionCoverageIssue =>
      evidence.strictBlocking && evidence.state !== "parsed",
  );
  const inspectedPathCount = pathEvidence.filter(
    (evidence) => evidence.state === "parsed",
  ).length;
  return {
    schemaVersion: INSPECTION_COVERAGE_SCHEMA_VERSION,
    expectedPathCount: pathEvidence.length,
    inspectedPathCount,
    complete: blockingIssues.length === 0,
    inspectedPaths: pathEvidence
      .filter((evidence) => evidence.state === "parsed")
      .map((evidence) => evidence.path),
    blockingIssues,
  };
}

/** Compare target coverage with its baseline without treating baseline issues as new. */
export function buildInspectionCoverageDiff(
  from: InspectionCoverage,
  to: InspectionCoverage,
): InspectionCoverageDiff {
  const fromPaths = coveragePathMap(from);
  const toPaths = coveragePathMap(to);
  const regressions = to.blockingIssues
    .filter((issue) => !fromPaths.get(issue.path)?.strictBlocking)
    .map((issue) => coverageChange(fromPaths.get(issue.path), issue));
  const resolvedIssues = from.blockingIssues
    .filter((issue) => !toPaths.get(issue.path)?.strictBlocking)
    .map((issue) => coverageChange(issue, toPaths.get(issue.path)));
  return {
    schemaVersion: INSPECTION_COVERAGE_DIFF_SCHEMA_VERSION,
    from: coverageCounts(from),
    to: coverageCounts(to),
    regressions,
    resolvedIssues,
  };
}

export function zeroInspectionCoverage(): InspectionCoverage {
  return {
    schemaVersion: INSPECTION_COVERAGE_SCHEMA_VERSION,
    expectedPathCount: 0,
    inspectedPathCount: 0,
    complete: true,
    inspectedPaths: [],
    blockingIssues: [],
  };
}

export function zeroInspectionCoverageDiff(): InspectionCoverageDiff {
  return buildInspectionCoverageDiff(
    zeroInspectionCoverage(),
    zeroInspectionCoverage(),
  );
}

function coverageChange(
  from: InspectionCoveragePathEvidence | undefined,
  to: InspectionCoveragePathEvidence | undefined,
): InspectionCoverageChange {
  const evidence = to ?? from;
  if (!evidence) {
    throw new Error("Inspection coverage change requires path evidence.");
  }
  return {
    path: evidence.path,
    fromState: from?.state ?? "not_expected",
    toState: to?.state ?? "not_expected",
    classification: evidence.classification,
    strictBlocking: to?.strictBlocking ?? false,
  };
}

function coveragePathMap(
  coverage: InspectionCoverage,
): Map<string, InspectionCoveragePathEvidence> {
  const paths = new Map<string, InspectionCoveragePathEvidence>();
  for (const inspectedPath of coverage.inspectedPaths) {
    paths.set(inspectedPath, {
      path: inspectedPath,
      state: "parsed",
      reason: inspectionCoverageReason("parsed"),
      classification: classifyAssetPath(inspectedPath),
      strictBlocking: false,
    });
  }
  for (const issue of coverage.blockingIssues) {
    paths.set(issue.path, issue);
  }
  return paths;
}

function coverageCounts(coverage: InspectionCoverage): {
  expectedPathCount: number;
  inspectedPathCount: number;
  blockingIssueCount: number;
} {
  return {
    expectedPathCount: coverage.expectedPathCount,
    inspectedPathCount: coverage.inspectedPathCount,
    blockingIssueCount: coverage.blockingIssues.length,
  };
}

function inspectionCoverageReason(state: InspectionCoverageState): string {
  switch (state) {
    case "parsed":
      return "The expected agent-facing artifact was read and represented in semantic scan evidence.";
    case "symlink":
      return "The expected agent-facing artifact is a symbolic link; Renma does not follow repository symlinks.";
    case "unreadable":
      return "The expected agent-facing artifact could not be read safely.";
    case "oversize":
      return "The expected agent-facing artifact exceeds max_file_size_bytes and was skipped before semantic inspection.";
    case "deep":
      return "The expected agent-facing artifact exceeds max_depth and was skipped before semantic inspection.";
    case "unsupported":
      return "The expected agent-facing artifact was present but was not represented in parsed semantic evidence.";
  }
}
