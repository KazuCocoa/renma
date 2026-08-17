import path from "node:path";

import {
  classifyAssetPath,
  classifyRepositorySkillPath,
  isExcluded,
  isOpaqueArtifactPath,
  repositoryPathDepth,
  RESERVED_SKILL_SUPPORT_DIRS,
} from "./discovery.js";
import type { RepositoryPathState } from "./repository-paths.js";
import type {
  StaticSupportBoundaryReachabilityEvidence,
  StaticSupportReachabilityEvidence,
} from "./static-support.js";
import type { Artifact } from "./types/artifact.js";
import type { AssetClassificationEvidence } from "./types/classification.js";
import type { ScanConfig } from "./types/configuration.js";

export const INSPECTION_COVERAGE_SCHEMA_VERSION =
  "renma.inspection-coverage.v1" as const;
export const INSPECTION_COVERAGE_DIFF_SCHEMA_VERSION =
  "renma.inspection-coverage-diff.v1" as const;

export type InspectionCoverageState =
  | "parsed"
  | "excluded"
  | "symlink"
  | "unreadable"
  | "oversize"
  | "deep"
  | "unsupported";

export type InspectionCoverageScope = "exact" | "subtree";

export type InspectionCoverageBoundary =
  "skills" | ".agents/skills" | "contexts" | "context" | "lenses" | ".agents";

export type SupportInspectionKind =
  | "semantic-plain-text"
  | "semantic-markdown"
  | "executable-surface"
  | "opaque-resource"
  | "repository-resource";

export interface StaticSupportInspectionDetails {
  expectationSource: "static-support-reference";
  owningSkillPath: string;
  sourcePath: string;
  sourceLine: number;
  reachabilityDepth: number;
  inspectionKind: SupportInspectionKind;
  scanBoundaryDisposition?: "explicitly-excluded";
}

export interface InspectionCoveragePathEvidence {
  path: string;
  state: InspectionCoverageState;
  scope: InspectionCoverageScope;
  affectedBoundary?: InspectionCoverageBoundary;
  reason: string;
  classification: AssetClassificationEvidence;
  strictBlocking: boolean;
  details?: StaticSupportInspectionDetails;
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
  scope: InspectionCoverageScope;
  affectedBoundary?: InspectionCoverageBoundary;
  previouslyInspectedPaths: string[];
  classification: AssetClassificationEvidence;
  strictBlocking: boolean;
  details?: StaticSupportInspectionDetails;
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
>(["skill-entrypoint", "context-root", "lens-root", "agent-root"]);

const BLOCKING_STATES = new Set<RepositoryPathState>([
  "excluded",
  "symlink",
  "unreadable",
  "oversize",
  "deep",
  "unsupported",
]);

const BLOCKED_TRAVERSAL_STATES = new Set<RepositoryPathState>([
  "symlink",
  "unreadable",
  "deep",
]);

/** Build coverage only from canonical discovery and repository-path evidence. */
export function buildInspectionCoverage(
  pathStates: ReadonlyMap<string, RepositoryPathState>,
  config: Pick<ScanConfig, "globs" | "exclude">,
  blockedTraversalPaths: ReadonlySet<string> = new Set(),
  expectedSupportPaths: readonly StaticSupportReachabilityEvidence[] = [],
  incompleteSupportBoundaries: readonly StaticSupportBoundaryReachabilityEvidence[] = [],
  artifacts: readonly Artifact[] = [],
  supportBoundaryConfig?: Pick<
    ScanConfig,
    "globs" | "exclude" | "maxDepth" | "maxFileSizeBytes"
  >,
): InspectionCoverage {
  const firstClassPathEvidence = [...pathStates].flatMap(
    ([candidate, state]): InspectionCoveragePathEvidence[] => {
      if (state !== "parsed" && !BLOCKING_STATES.has(state)) return [];
      if (isExcluded(candidate, config.exclude)) return [];
      const classification = classifyAssetPath(candidate);
      const coverageState = state as InspectionCoverageState;
      const isConfiguredExactPath = config.globs.some((pattern) =>
        path.matchesGlob(candidate, pattern),
      );
      if (
        isConfiguredExactPath &&
        EXPECTED_AGENT_FACING_RULES.has(classification.matchedRule)
      ) {
        return [
          {
            path: candidate,
            state: coverageState,
            scope: "exact",
            reason: inspectionCoverageReason(coverageState, "exact"),
            classification,
            strictBlocking: coverageState !== "parsed",
          },
        ];
      }
      if (
        state === "parsed" ||
        !blockedTraversalPaths.has(candidate) ||
        !BLOCKED_TRAVERSAL_STATES.has(state)
      ) {
        return [];
      }
      const affectedBoundary = agentFacingSubtreeBoundary(candidate);
      if (
        !affectedBoundary ||
        !configuredBoundaryCanSelectDescendant(
          candidate,
          affectedBoundary,
          config,
        )
      ) {
        return [];
      }
      return [
        {
          path: candidate,
          state: coverageState,
          scope: "subtree",
          affectedBoundary,
          reason: inspectionCoverageReason(
            coverageState,
            "subtree",
            affectedBoundary,
          ),
          classification,
          strictBlocking: true,
        },
      ];
    },
  );
  const artifactsByPath = new Map(
    artifacts.map((artifact) => [artifact.path, artifact]),
  );
  const supportPathEvidence = expectedSupportPaths.flatMap(
    (expectation): InspectionCoveragePathEvidence[] => {
      const observedRepositoryState = pathStates.get(expectation.targetPath);
      if (
        observedRepositoryState === undefined ||
        observedRepositoryState === "absent"
      ) {
        return [];
      }
      const artifact = artifactsByPath.get(expectation.targetPath);
      const repositoryState = expectedSupportRepositoryState(
        expectation.targetPath,
        observedRepositoryState,
        artifact,
        supportBoundaryConfig,
      );
      const inspectionKind = supportInspectionKind(expectation.targetPath);
      const coverageState = supportCoverageState(
        repositoryState,
        inspectionKind,
        artifact,
      );
      const details: StaticSupportInspectionDetails = {
        expectationSource: "static-support-reference",
        owningSkillPath: expectation.owningSkillPath,
        sourcePath: expectation.sourcePath,
        sourceLine: expectation.sourceLine,
        reachabilityDepth: expectation.depth,
        inspectionKind,
        ...(repositoryState === "excluded"
          ? { scanBoundaryDisposition: "explicitly-excluded" as const }
          : {}),
      };
      return [
        {
          path: expectation.targetPath,
          state: coverageState,
          scope: "exact",
          reason: supportInspectionCoverageReason(
            coverageState,
            inspectionKind,
          ),
          classification: classifyAssetPath(expectation.targetPath),
          strictBlocking: coverageState !== "parsed",
          details,
        },
      ];
    },
  );
  const incompleteSupportBoundaryEvidence = incompleteSupportBoundaries.map(
    (expectation): InspectionCoveragePathEvidence => ({
      path: expectation.boundaryPath,
      state: "excluded",
      scope: "subtree",
      reason:
        "A parsed basename-only Skill support reference may resolve inside this explicitly excluded subtree, so Renma cannot establish a complete candidate set without crossing the scan boundary.",
      classification: classifyAssetPath(expectation.boundaryPath),
      strictBlocking: true,
      details: {
        expectationSource: "static-support-reference",
        owningSkillPath: expectation.owningSkillPath,
        sourcePath: expectation.sourcePath,
        sourceLine: expectation.sourceLine,
        reachabilityDepth: expectation.depth,
        inspectionKind: "repository-resource",
        scanBoundaryDisposition: "explicitly-excluded",
      },
    }),
  );
  const pathEvidence = dedupeCoverageEvidence([
    ...firstClassPathEvidence,
    ...supportPathEvidence,
    ...incompleteSupportBoundaryEvidence,
  ]).sort((left, right) => left.path.localeCompare(right.path));
  const blockingIssues = pathEvidence.filter(
    (evidence): evidence is InspectionCoverageIssue =>
      evidence.strictBlocking && evidence.state !== "parsed",
  );
  const inspectedPathCount = pathEvidence.filter(
    (evidence) => evidence.state === "parsed",
  ).length;
  return {
    schemaVersion: INSPECTION_COVERAGE_SCHEMA_VERSION,
    expectedPathCount: pathEvidence.filter(
      (evidence) => evidence.scope === "exact",
    ).length,
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
    .filter(
      (issue) =>
        !from.blockingIssues.some((baselineIssue) =>
          coverageIssueCoversPath(baselineIssue, issue.path),
        ),
    )
    .map((issue) => {
      const previouslyInspectedPaths =
        issue.scope === "subtree"
          ? from.inspectedPaths.filter((inspectedPath) =>
              isPathAtOrBelow(inspectedPath, issue.path),
            )
          : fromPaths.get(issue.path)?.state === "parsed"
            ? [issue.path]
            : [];
      return coverageChange(
        previouslyInspectedPaths.length > 0
          ? parsedCoverageEvidence(previouslyInspectedPaths[0]!)
          : fromPaths.get(issue.path),
        issue,
        previouslyInspectedPaths,
      );
    });
  const resolvedIssues = from.blockingIssues
    .filter(
      (issue) =>
        !to.blockingIssues.some((targetIssue) =>
          coverageIssueCoversPath(targetIssue, issue.path),
        ),
    )
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
  previouslyInspectedPaths: string[] = [],
): InspectionCoverageChange {
  const evidence = to ?? from;
  if (!evidence) {
    throw new Error("Inspection coverage change requires path evidence.");
  }
  return {
    path: evidence.path,
    fromState: from?.state ?? "not_expected",
    toState: to?.state ?? "not_expected",
    scope: evidence.scope,
    ...(evidence.affectedBoundary
      ? { affectedBoundary: evidence.affectedBoundary }
      : {}),
    previouslyInspectedPaths: [...previouslyInspectedPaths].sort(
      (left, right) => left.localeCompare(right),
    ),
    classification: evidence.classification,
    strictBlocking: to?.strictBlocking ?? false,
    ...(evidence.details ? { details: evidence.details } : {}),
  };
}

function coveragePathMap(
  coverage: InspectionCoverage,
): Map<string, InspectionCoveragePathEvidence> {
  const paths = new Map<string, InspectionCoveragePathEvidence>();
  for (const inspectedPath of coverage.inspectedPaths) {
    paths.set(inspectedPath, parsedCoverageEvidence(inspectedPath));
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

function dedupeCoverageEvidence(
  evidence: InspectionCoveragePathEvidence[],
): InspectionCoveragePathEvidence[] {
  const byPathAndScope = new Map<string, InspectionCoveragePathEvidence>();
  for (const item of evidence) {
    byPathAndScope.set(`${item.scope}\0${item.path}`, item);
  }
  return [...byPathAndScope.values()];
}

function supportInspectionKind(candidate: string): SupportInspectionKind {
  const classified = classifyRepositorySkillPath(candidate);
  if (
    classified?.kind === "support" &&
    classified.supportDirectory === "scripts"
  ) {
    return "executable-surface";
  }
  const extension = path.posix.extname(candidate).toLowerCase();
  if (extension === ".txt") return "semantic-plain-text";
  if (extension === ".md" || extension === ".mdx") {
    return "semantic-markdown";
  }
  if (isOpaqueArtifactPath(candidate)) return "opaque-resource";
  return "repository-resource";
}

function expectedSupportRepositoryState(
  candidate: string,
  observedState: Exclude<RepositoryPathState, "absent">,
  artifact: Artifact | undefined,
  config:
    | Pick<ScanConfig, "globs" | "exclude" | "maxDepth" | "maxFileSizeBytes">
    | undefined,
): Exclude<RepositoryPathState, "absent"> {
  if (
    observedState === "symlink" ||
    observedState === "unreadable" ||
    config === undefined
  ) {
    return observedState;
  }
  if (isExcluded(candidate, config.exclude)) return "excluded";
  if (repositoryPathDepth(candidate) > config.maxDepth) return "deep";
  if (artifact && artifact.sizeBytes > config.maxFileSizeBytes) {
    return "oversize";
  }
  if (!config.globs.some((pattern) => path.matchesGlob(candidate, pattern))) {
    return "unsupported";
  }
  return observedState;
}

function supportCoverageState(
  repositoryState: Exclude<RepositoryPathState, "absent">,
  inspectionKind: SupportInspectionKind,
  artifact: Artifact | undefined,
): InspectionCoverageState {
  if (repositoryState !== "parsed") return repositoryState;
  if (
    (inspectionKind === "semantic-plain-text" ||
      inspectionKind === "semantic-markdown") &&
    artifact?.contentClassification !== "text"
  ) {
    return "unsupported";
  }
  return "parsed";
}

function supportInspectionCoverageReason(
  state: InspectionCoverageState,
  inspectionKind: SupportInspectionKind,
): string {
  const expectedSurface = supportInspectionSurfaceName(inspectionKind);
  switch (state) {
    case "parsed":
      return `The statically expected Skill support resource was read and represented as ${expectedSurface}.`;
    case "excluded":
      return `The statically expected Skill support resource is explicitly excluded by the scan boundary, so Renma could not inspect it as ${expectedSurface}.`;
    case "symlink":
      return `The statically expected Skill support resource is a symbolic link; Renma does not follow repository symlinks and could not inspect it as ${expectedSurface}.`;
    case "unreadable":
      return `The statically expected Skill support resource could not be read safely as ${expectedSurface}.`;
    case "oversize":
      return `The statically expected Skill support resource exceeds max_file_size_bytes and was skipped before inspection as ${expectedSurface}.`;
    case "deep":
      return `The statically expected Skill support resource exceeds max_depth and was skipped before inspection as ${expectedSurface}.`;
    case "unsupported":
      return `The statically expected Skill support resource was present but could not be represented as ${expectedSurface}.`;
  }
}

function supportInspectionSurfaceName(
  inspectionKind: SupportInspectionKind,
): string {
  switch (inspectionKind) {
    case "semantic-plain-text":
      return "UTF-8 plain-text semantic evidence";
    case "semantic-markdown":
      return "Markdown semantic evidence";
    case "executable-surface":
      return "executable-surface inventory evidence";
    case "opaque-resource":
      return "opaque repository-resource evidence";
    case "repository-resource":
      return "repository-resource evidence";
  }
}

function inspectionCoverageReason(
  state: InspectionCoverageState,
  scope: InspectionCoverageScope,
  affectedBoundary?: InspectionCoverageBoundary,
): string {
  if (scope === "subtree") {
    return `Renma could not traverse this ${affectedBoundary ?? "agent-facing"} subtree and therefore cannot establish whether configured first-class agent-facing artifacts exist below it.`;
  }
  switch (state) {
    case "parsed":
      return "The expected agent-facing artifact was read and represented in semantic scan evidence.";
    case "excluded":
      return "The expected agent-facing artifact was explicitly excluded from semantic inspection.";
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

function parsedCoverageEvidence(
  pathValue: string,
): InspectionCoveragePathEvidence {
  return {
    path: pathValue,
    state: "parsed",
    scope: "exact",
    reason: inspectionCoverageReason("parsed", "exact"),
    classification: classifyAssetPath(pathValue),
    strictBlocking: false,
  };
}

function coverageIssueCoversPath(
  issue: InspectionCoverageIssue,
  candidate: string,
): boolean {
  return issue.scope === "subtree"
    ? isPathAtOrBelow(candidate, issue.path)
    : candidate === issue.path;
}

function isPathAtOrBelow(candidate: string, boundary: string): boolean {
  return candidate === boundary || candidate.startsWith(`${boundary}/`);
}

function agentFacingSubtreeBoundary(
  candidate: string,
): InspectionCoverageBoundary | undefined {
  const segments = candidate.split("/").filter(Boolean);
  if (segments[0] === ".agents" && segments[1] === "skills") {
    if (
      segments
        .slice(2)
        .some((segment) =>
          RESERVED_SKILL_SUPPORT_DIRS.includes(
            segment as (typeof RESERVED_SKILL_SUPPORT_DIRS)[number],
          ),
        )
    ) {
      return undefined;
    }
    return ".agents/skills";
  }
  if (segments[0] === "skills") {
    if (
      segments
        .slice(1)
        .some((segment) =>
          RESERVED_SKILL_SUPPORT_DIRS.includes(
            segment as (typeof RESERVED_SKILL_SUPPORT_DIRS)[number],
          ),
        )
    ) {
      return undefined;
    }
    return "skills";
  }
  if (segments[0] === "contexts") return "contexts";
  if (segments[0] === "context") return "context";
  if (segments[0] === "lenses") return "lenses";
  if (segments[0] === ".agents") return ".agents";
  return undefined;
}

function configuredBoundaryCanSelectDescendant(
  blockedPath: string,
  boundary: InspectionCoverageBoundary,
  config: Pick<ScanConfig, "globs" | "exclude">,
): boolean {
  return config.globs.some((pattern) =>
    configuredGlobMaySelectDescendant(
      blockedPath,
      boundary,
      pattern,
      config.exclude,
    ),
  );
}

function configuredGlobMaySelectDescendant(
  blockedPath: string,
  boundary: InspectionCoverageBoundary,
  pattern: string,
  excludes: string[],
): boolean {
  const normalized = runtimeGlobPath(pattern);
  const segments = normalized.split("/");
  const firstMagicIndex = segments.findIndex(hasGlobMagic);
  if (firstMagicIndex < 0) {
    return exactConfiguredPathIsRelevant(
      normalized,
      pattern,
      blockedPath,
      excludes,
    );
  }

  const literalPrefix = segments.slice(0, firstMagicIndex).join("/");
  if (!literalPrefix) return true;
  const boundaryRoot = boundary;
  return (
    pathsOverlapByPrefix(literalPrefix, boundaryRoot) &&
    pathsOverlapByPrefix(literalPrefix, blockedPath)
  );
}

function exactConfiguredPathIsRelevant(
  candidate: string,
  pattern: string,
  blockedPath: string,
  excludes: string[],
): boolean {
  if (
    !candidate ||
    candidate.startsWith("/") ||
    candidate
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..") ||
    !isPathAtOrBelow(candidate, blockedPath) ||
    isExcluded(candidate, excludes) ||
    !path.matchesGlob(candidate, pattern)
  ) {
    return false;
  }
  return EXPECTED_AGENT_FACING_RULES.has(
    classifyAssetPath(candidate).matchedRule,
  );
}

function pathsOverlapByPrefix(left: string, right: string): boolean {
  return isPathAtOrBelow(left, right) || isPathAtOrBelow(right, left);
}

function runtimeGlobPath(pattern: string): string {
  return path.sep === "\\" ? pattern.replaceAll("\\", "/") : pattern;
}

function hasGlobMagic(segment: string): boolean {
  return /[*?\[\]{}()!+@|]/.test(segment);
}
