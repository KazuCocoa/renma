import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { graphFromRepositorySnapshot, type GraphReport } from "./graph.js";
import {
  readinessFromRepositorySnapshot,
  type ReadinessReport,
} from "./readiness.js";
import {
  buildSecurityDiffSummary,
  type SecurityDiffSummary,
} from "../security-diff.js";
import type {
  SecurityPolicyAssetChange,
  SecurityPolicyChangeProvenance,
  SecurityPolicyChangeSource,
  SecurityPolicyFieldChange,
  SharedSecurityPolicyChange,
} from "../security-policy-diff.js";
import type { ContextLensSummary } from "../context-lens.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import {
  buildExecutableSurfaceDiff,
  type ExecutableSurfaceDiff,
} from "../executable-surface-diff.js";
import {
  zeroExecutableSurfaceInventory,
  type ExecutableSurfaceInventory,
} from "../executable-surface-inventory.js";
import type { ConfigOverrides } from "../config.js";
import type { SkillDiscoveryCiPolicyMode } from "../types/configuration.js";
import type { SecurityCiPolicyMode } from "../types/configuration.js";
import type { SecurityConfig } from "../types/configuration.js";
import type { SecurityPolicyAssetEvidence } from "../security-policy-inventory.js";
import {
  collectRepositorySnapshot,
  type RepositoryCollectionInstrumentation,
} from "../repository-evidence.js";
import {
  buildSkillDiscoveryDiff,
  type SkillDiscoveryCycleDiff,
  type SkillDiscoveryDiff,
  type SkillDiscoveryDiffSkill,
  type SkillDiscoveryRouteChange,
  type SkillDiscoveryRouteDiffState,
} from "../skill-discovery-diff.js";
import type { SkillDiscoveryIndex } from "../skill-discovery.js";
import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";
import { formatJsonDocument } from "../report.js";
import { formatMarkdownInlineCode } from "../renderers/markdown-inline-code.js";
import { securityPolicyRelaxations } from "../security-policy-ci-policy.js";

const execFile = promisify(execFileCallback);

export type DiffFormat = "json" | "markdown";

export interface DiffReport {
  root: string;
  from: DiffEndpoint;
  to: DiffEndpoint;
  summary: {
    readinessScoreDelta: number;
    readinessLevelChanged: boolean;
    totalAssetsDelta: number;
    ownershipCoverageDelta: number;
    graphResolutionDelta: number;
    findingsDelta: number;
    highOrCriticalFindingsDelta: number;
  };
  catalog: {
    addedAssets: AssetDelta[];
    removedAssets: AssetDelta[];
    changedAssets: AssetChange[];
  };
  graph: {
    addedEdges: EdgeDelta[];
    removedEdges: EdgeDelta[];
    newUnresolvedEdges: EdgeDelta[];
    resolvedEdges: EdgeDelta[];
  };
  readiness: {
    checkChanges: ReadinessCheckChange[];
  };
  discovery: SkillDiscoveryDiff;
  executableSurface: ExecutableSurfaceDiff;
  security: SecurityDiffSummary;
  findings: {
    added: FindingDelta[];
    removed: FindingDelta[];
    countById: Array<{
      id: string;
      from: number;
      to: number;
      delta: number;
    }>;
  };
}

export type DiffReportWithoutSkillDiscovery = Omit<DiffReport, "discovery">;
export type DiffReportFormatInput =
  DiffReport | DiffReportWithoutSkillDiscovery;

export interface DiffOwnershipEndpoint {
  ownedAssets: number;
  eligibleAssets: number;
  coveragePercent: number;
}

export interface DiffEndpoint {
  ref: string;
  scannedFileCount: number;
  totalAssets: number;
  readinessScore: number;
  readinessLevel: string;
  ownership?: DiffOwnershipEndpoint | undefined;
  contextLens?: ContextLensSummary;
  securityPolicyInventory?: SecurityPolicyInventorySummary;
}

export interface AssetDelta {
  id: string;
  path?: string | undefined;
  kind?: string | undefined;
  declaredOwner: string | null;
  effectiveOwner: string | null;
  status?: string | undefined;
  statusReason?: string | undefined;
  statusChangedAt?: string | undefined;
}

const COMPARABLE_ASSET_FIELDS = [
  "path",
  "kind",
  "declaredOwner",
  "effectiveOwner",
  "status",
  "statusReason",
  "statusChangedAt",
] as const;

export type ComparableAssetField = (typeof COMPARABLE_ASSET_FIELDS)[number];

export interface AssetChange {
  id: string;
  path?: string | undefined;
  changedFields: ComparableAssetField[];
  from: AssetDelta;
  to: AssetDelta;
}

export interface EdgeDelta {
  source: string;
  target: string;
  kind: string;
  resolved: boolean;
  evidence?: EvidenceDelta | undefined;
}

interface ReadinessCheckChange {
  id: string;
  title: string;
  fromStatus: string;
  toStatus: string;
  fromSeverity: string;
  toSeverity: string;
  summaryChanged: boolean;
}

interface FindingDelta {
  id: string;
  severity: string;
  riskClass?: string | undefined;
  title: string;
  evidence?: EvidenceDelta | undefined;
}

interface EvidenceDelta {
  path?: string | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
  snippet?: string | undefined;
}

export interface DiffSnapshot {
  ref: string;
  root: string;
  readiness: ReadinessReport;
  graph: GraphReport;
  discovery?: SkillDiscoveryIndex;
  executableSurfaceInventory?: ExecutableSurfaceInventory;
  securityPolicies?: SecurityPolicyAssetEvidence[];
  securityConfig?: SecurityConfig;
  configPath?: string;
}

export interface DiffCollectionInstrumentation {
  from?: RepositoryCollectionInstrumentation;
  to?: RepositoryCollectionInstrumentation;
}

export interface DiffExecutionContext {
  report: DiffReport;
  skillDiscoveryCiPolicy: {
    from: SkillDiscoveryCiPolicyMode;
    to: SkillDiscoveryCiPolicyMode;
  };
  securityPolicyCiPolicy: {
    from: SecurityCiPolicyMode;
    to: SecurityCiPolicyMode;
  };
}

interface DiffOptions {
  fromRef: string;
  toRef: string;
  overrides?: ConfigOverrides;
  instrumentation?: DiffCollectionInstrumentation;
}

export async function runDiffCommand(
  targetPath: string,
  options: {
    fromRef: string;
    toRef: string;
    format: DiffFormat;
    overrides?: ConfigOverrides;
  },
): Promise<number> {
  const report = await diff(targetPath, options);
  process.stdout.write(formatDiff(report, options.format));
  return 0;
}

export async function diff(
  targetPath: string,
  options: DiffOptions,
): Promise<DiffReport> {
  return (await executeDiff(targetPath, options)).report;
}

/** @internal Execute one complete semantic diff while retaining CI-only ref evidence. */
export async function executeDiff(
  targetPath: string,
  options: DiffOptions,
): Promise<DiffExecutionContext> {
  return executeDiffWithProjection(targetPath, options, true);
}

/** @internal Build the Discovery-free projection for compatibility consumers. */
export async function diffWithoutSkillDiscovery(
  targetPath: string,
  options: DiffOptions,
): Promise<DiffReportWithoutSkillDiscovery> {
  return executeDiffWithProjection(targetPath, options, false);
}

function executeDiffWithProjection(
  targetPath: string,
  options: DiffOptions,
  includeSkillDiscovery: true,
): Promise<DiffExecutionContext>;
function executeDiffWithProjection(
  targetPath: string,
  options: DiffOptions,
  includeSkillDiscovery: false,
): Promise<DiffReportWithoutSkillDiscovery>;
async function executeDiffWithProjection(
  targetPath: string,
  options: DiffOptions,
  includeSkillDiscovery: boolean,
): Promise<DiffExecutionContext | DiffReportWithoutSkillDiscovery> {
  const absoluteTarget = await realpath(resolve(process.cwd(), targetPath));
  const repoRoot = await realpath(
    await gitOutput(absoluteTarget, ["rev-parse", "--show-toplevel"]),
  );
  const relativeTarget = pathWithinRepo(repoRoot, absoluteTarget);
  const tempRoot = await mkdtemp(join(tmpdir(), "renma-diff-"));
  let result:
    DiffExecutionContext | DiffReportWithoutSkillDiscovery | undefined;
  let primaryError: unknown;

  try {
    const [fromResult, toResult] = await Promise.allSettled([
      snapshot(
        repoRoot,
        relativeTarget,
        options.fromRef,
        tempRoot,
        "from",
        options.overrides,
        options.instrumentation?.from,
        includeSkillDiscovery,
      ),
      snapshot(
        repoRoot,
        relativeTarget,
        options.toRef,
        tempRoot,
        "to",
        options.overrides,
        options.instrumentation?.to,
        includeSkillDiscovery,
      ),
    ]);

    if (fromResult.status === "rejected") throw fromResult.reason;
    if (toResult.status === "rejected") throw toResult.reason;

    const fromCollected = fromResult.value;
    const toCollected = toResult.value;
    if (includeSkillDiscovery) {
      result = {
        report: buildDiffReport(
          repoRoot,
          fromCollected.snapshot,
          toCollected.snapshot,
        ),
        skillDiscoveryCiPolicy: {
          from: fromCollected.skillDiscoveryCiPolicy,
          to: toCollected.skillDiscoveryCiPolicy,
        },
        securityPolicyCiPolicy: {
          from: fromCollected.securityPolicyCiPolicy,
          to: toCollected.securityPolicyCiPolicy,
        },
      };
    } else {
      result = buildDiffReportWithoutSkillDiscovery(
        repoRoot,
        fromCollected.snapshot,
        toCollected.snapshot,
      );
    }
  } catch (error) {
    primaryError = error;
  }

  let cleanupError: unknown;
  try {
    await rm(tempRoot, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 50,
    });
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;
  if (result === undefined) throw new Error("Diff report was not generated.");
  return result;
}

export function buildDiffReport(
  root: string,
  fromSnapshot: DiffSnapshot,
  toSnapshot: DiffSnapshot,
): DiffReport {
  return buildDiffReportProjection(root, fromSnapshot, toSnapshot, true);
}

function buildDiffReportWithoutSkillDiscovery(
  root: string,
  fromSnapshot: DiffSnapshot,
  toSnapshot: DiffSnapshot,
): DiffReportWithoutSkillDiscovery {
  return buildDiffReportProjection(root, fromSnapshot, toSnapshot, false);
}

function buildDiffReportProjection(
  root: string,
  fromSnapshot: DiffSnapshot,
  toSnapshot: DiffSnapshot,
  includeSkillDiscovery: true,
): DiffReport;
function buildDiffReportProjection(
  root: string,
  fromSnapshot: DiffSnapshot,
  toSnapshot: DiffSnapshot,
  includeSkillDiscovery: false,
): DiffReportWithoutSkillDiscovery;
function buildDiffReportProjection(
  root: string,
  fromSnapshot: DiffSnapshot,
  toSnapshot: DiffSnapshot,
  includeSkillDiscovery: boolean,
): DiffReport | DiffReportWithoutSkillDiscovery {
  const fromReadiness = fromSnapshot.readiness;
  const toReadiness = toSnapshot.readiness;
  const fromFindings = findingMap(fromReadiness.findings ?? []);
  const toFindings = findingMap(toReadiness.findings ?? []);
  const fromAssets = assetMap(fromSnapshot.graph.nodes);
  const toAssets = assetMap(toSnapshot.graph.nodes);
  const fromEdges = edgeMap(fromSnapshot.graph.edges);
  const toEdges = edgeMap(toSnapshot.graph.edges);
  const fromEndpoint = endpoint(fromSnapshot);
  const toEndpoint = endpoint(toSnapshot);
  const addedFindings = [...toFindings]
    .filter(([key]) => !fromFindings.has(key))
    .map(([, finding]) => finding);
  const removedFindings = [...fromFindings]
    .filter(([key]) => !toFindings.has(key))
    .map(([, finding]) => finding);

  const shared = {
    root,
    from: fromEndpoint,
    to: toEndpoint,
    summary: {
      readinessScoreDelta: delta(toReadiness.score, fromReadiness.score),
      readinessLevelChanged: fromReadiness.level !== toReadiness.level,
      totalAssetsDelta: delta(
        toReadiness.summary.totalAssets,
        fromReadiness.summary.totalAssets,
      ),
      ownershipCoverageDelta: delta(
        toReadiness.summary.ownershipCoveragePercent,
        fromReadiness.summary.ownershipCoveragePercent,
      ),
      graphResolutionDelta: delta(
        toReadiness.summary.graphResolutionPercent,
        fromReadiness.summary.graphResolutionPercent,
      ),
      findingsDelta: delta(toFindings.size, fromFindings.size),
      highOrCriticalFindingsDelta: delta(
        highOrCriticalCount([...toFindings.values()]),
        highOrCriticalCount([...fromFindings.values()]),
      ),
    },
    catalog: {
      addedAssets: [...toAssets]
        .filter(([key]) => !fromAssets.has(key))
        .map(([, asset]) => asset),
      removedAssets: [...fromAssets]
        .filter(([key]) => !toAssets.has(key))
        .map(([, asset]) => asset),
      changedAssets: changedAssets(fromAssets, toAssets),
    },
    graph: {
      addedEdges: [...toEdges]
        .filter(([key]) => !fromEdges.has(key))
        .map(([, edge]) => edge),
      removedEdges: [...fromEdges]
        .filter(([key]) => !toEdges.has(key))
        .map(([, edge]) => edge),
      newUnresolvedEdges: [...toEdges]
        .filter(([key, edge]) => {
          const previous = fromEdges.get(key);
          return !edge.resolved && (!previous || previous.resolved);
        })
        .map(([, edge]) => edge),
      resolvedEdges: [...toEdges]
        .filter(([key, edge]) => {
          const previous = fromEdges.get(key);
          return previous ? !previous.resolved && edge.resolved : false;
        })
        .map(([, edge]) => edge),
    },
    readiness: {
      checkChanges: checkChanges(
        readinessChecksWithoutDiscovery(fromReadiness.checks),
        readinessChecksWithoutDiscovery(toReadiness.checks),
      ),
    },
  };
  const tail = {
    executableSurface: buildExecutableSurfaceDiff(
      fromSnapshot.executableSurfaceInventory ??
        zeroExecutableSurfaceInventory(),
      toSnapshot.executableSurfaceInventory ?? zeroExecutableSurfaceInventory(),
    ),
    security: buildSecurityDiffSummary({
      addedFindings,
      removedFindings,
      fromPolicyInventory: fromEndpoint.securityPolicyInventory,
      toPolicyInventory: toEndpoint.securityPolicyInventory,
      fromAssets: fromSnapshot.securityPolicies,
      toAssets: toSnapshot.securityPolicies,
      fromConfig: fromSnapshot.securityConfig,
      toConfig: toSnapshot.securityConfig,
      fromConfigPath: fromSnapshot.configPath,
      toConfigPath: toSnapshot.configPath,
      fromAssetIdsByPath: assetIdsByPath(fromSnapshot.graph),
      toAssetIdsByPath: assetIdsByPath(toSnapshot.graph),
    }),
    findings: {
      added: addedFindings,
      removed: removedFindings,
      countById: countById(
        fromReadiness.findings ?? [],
        toReadiness.findings ?? [],
      ),
    },
  };

  if (!includeSkillDiscovery) return { ...shared, ...tail };

  return {
    ...shared,
    discovery:
      fromSnapshot.discovery && toSnapshot.discovery
        ? buildSkillDiscoveryDiff(fromSnapshot.discovery, toSnapshot.discovery)
        : neutralSkillDiscoveryDiff(),
    ...tail,
  };
}

function readinessChecksWithoutDiscovery(checks: unknown[]): unknown[] {
  return checks.filter(
    (check) => !stringField(check, "id").startsWith("discovery."),
  );
}

export function formatDiff(
  report: DiffReportFormatInput,
  format: DiffFormat,
): string {
  if (format === "json") {
    return formatJsonDocument(report);
  }
  return formatDiffMarkdown(report);
}

function formatDiffMarkdown(report: DiffReportFormatInput): string {
  const discovery = "discovery" in report ? report.discovery : undefined;
  const discoveryLines = discovery
    ? ["", ...formatSkillDiscoveryChanges(discovery)]
    : [];
  const lines = [
    `# Renma semantic diff`,
    "",
    `Root: \`${report.root}\``,
    `Refs: \`${report.from.ref}\` -> \`${report.to.ref}\``,
    "",
    "## Summary",
    "",
    `- Readiness score: ${report.to.readinessScore} (${signed(report.summary.readinessScoreDelta)})`,
    `- Readiness level changed: ${report.summary.readinessLevelChanged ? "yes" : "no"}`,
    `- Scanned files: ${report.to.scannedFileCount} (${signed(report.to.scannedFileCount - report.from.scannedFileCount)})`,
    `- Total assets: ${report.to.totalAssets} (${signed(report.summary.totalAssetsDelta)})`,
    formatOwnershipDelta(
      report.from,
      report.to,
      report.summary.ownershipCoverageDelta,
    ),
    `- Graph resolution: ${signed(report.summary.graphResolutionDelta)}`,
    `- Findings: ${signed(report.summary.findingsDelta)}`,
    `- High/critical findings: ${signed(report.summary.highOrCriticalFindingsDelta)}`,
    ...discoveryLines,
    "",
    "## Catalog",
    "",
    `- Added assets: ${report.catalog.addedAssets.length}`,
    `- Removed assets: ${report.catalog.removedAssets.length}`,
    `- Changed assets: ${report.catalog.changedAssets.length}`,
    ...(report.catalog.changedAssets.length > 0
      ? [
          "",
          "### Changed asset fields",
          "",
          ...report.catalog.changedAssets.flatMap((change) => [
            `- \`${change.id}\` (${change.path ? `\`${change.path}\`` : "path unavailable"})`,
            ...change.changedFields.map(
              (field) =>
                `  - ${field}: ${markdownValue(change.from[field])} -> ${markdownValue(change.to[field])}`,
            ),
          ]),
        ]
      : []),
    "",
    "## Graph",
    "",
    `- Added edges: ${report.graph.addedEdges.length}`,
    `- Removed edges: ${report.graph.removedEdges.length}`,
    `- New unresolved edges: ${report.graph.newUnresolvedEdges.length}`,
    `- Resolved edges: ${report.graph.resolvedEdges.length}`,
    "",
    "## Readiness checks",
    "",
    ...markdownList(
      report.readiness.checkChanges,
      (check) =>
        `${check.id}: ${check.fromStatus}/${check.fromSeverity} -> ${check.toStatus}/${check.toSeverity}`,
    ),
    "",
    "## Findings",
    "",
    `- Added findings: ${report.findings.added.length}`,
    `- Removed findings: ${report.findings.removed.length}`,
  ];

  lines.push("", ...formatExecutableSurfaceChanges(report.executableSurface));

  if (report.graph.newUnresolvedEdges.length > 0) {
    lines.push("", "### New unresolved edges", "");
    lines.push(
      ...markdownList(
        report.graph.newUnresolvedEdges,
        (edge) => `${edge.source} --${edge.kind}--> ${edge.target}`,
      ),
    );
  }

  lines.push("", "## Security Changes", "");
  lines.push(...formatSecurityChanges(report.security));

  if (report.findings.added.length > 0) {
    lines.push("", "### Added findings", "");
    lines.push(...markdownList(report.findings.added, formatFindingDelta));
  }

  return `${lines.join("\n")}\n`;
}

function neutralSkillDiscoveryDiff(): SkillDiscoveryDiff {
  return {
    schemaVersion: "renma.skill-discovery-diff.v1",
    adoption: {
      from: "not-adopted",
      to: "not-adopted",
      changed: false,
    },
    coverage: {
      from: "not-evaluated",
      to: "not-evaluated",
      changed: false,
    },
    summary: {
      publishedEntrypointCountDelta: 0,
      routeEligibleSkillCountDelta: 0,
      reachableSkillCountDelta: 0,
      notReachedSkillCountDelta: 0,
      unroutedSkillCountDelta: 0,
      usableRouteCountDelta: 0,
      unusableRouteCountDelta: 0,
      unresolvedRouteCountDelta: 0,
      cycleComponentCountDelta: 0,
    },
    publishedEntrypoints: {
      added: [],
      removed: [],
    },
    reachability: {
      newlyReachable: [],
      newlyNotReached: [],
    },
    unroutedSkills: {
      newlyUnrouted: [],
      resolvedUnrouted: [],
    },
    routes: {
      added: [],
      removed: [],
      changed: [],
    },
    cycles: {
      added: [],
      resolved: [],
    },
  };
}

function formatExecutableSurfaceChanges(
  executableSurface: ExecutableSurfaceDiff,
): string[] {
  const invocationGovernanceChanges =
    executableSurface.invocationGovernanceChanges ?? [];
  const lines = [
    "## Executable Surface Changes",
    "",
    `- Total surfaces: ${executableSurface.toSummary.totalSurfaces} (${signed(executableSurface.summary.totalSurfacesDelta)})`,
    `- Added surfaces: ${executableSurface.addedSurfacePaths.length}`,
    `- Removed surfaces: ${executableSurface.removedSurfacePaths.length}`,
    `- Changed surfaces: ${executableSurface.changedSurfaces.length}`,
    `- Dependencies: ${executableSurface.fromSummary.totalDependencies} -> ${executableSurface.toSummary.totalDependencies} (${signed(executableSurface.summary.totalDependenciesDelta)})`,
    `- Resolved dependencies: ${executableSurface.fromSummary.resolvedDependencies} -> ${executableSurface.toSummary.resolvedDependencies} (${signed(executableSurface.summary.resolvedDependenciesDelta)})`,
    `- Dependency resolution changes: ${executableSurface.dependencyResolutionChanges.length}`,
    `- Static invocation reachability: ${executableSurface.toSummary.directlyInvokedSurfaces} direct, ${executableSurface.toSummary.transitivelyReachableSurfaces} transitive, ${executableSurface.toSummary.unreachedFromInvocationSurfaces} unreached`,
    `- Invocation resolution changes: ${executableSurface.invocationResolutionChanges.length}`,
    `- Invocation governance changes: ${invocationGovernanceChanges.length}`,
    `- Invocation-context policy evidence: ${executableSurface.toSummary.invocationsWithEffectivePolicyEvidence ?? 0} with (${signed(executableSurface.summary.invocationsWithEffectivePolicyEvidenceDelta ?? 0)}), ${executableSurface.toSummary.invocationsWithoutEffectivePolicyEvidence ?? 0} without (${signed(executableSurface.summary.invocationsWithoutEffectivePolicyEvidenceDelta ?? 0)})`,
    `- Resolved invocation policy evidence: ${executableSurface.toSummary.resolvedInvocationsWithEffectivePolicyEvidence ?? 0} with (${signed(executableSurface.summary.resolvedInvocationsWithEffectivePolicyEvidenceDelta ?? 0)}), ${executableSurface.toSummary.resolvedInvocationsWithoutEffectivePolicyEvidence ?? 0} without (${signed(executableSurface.summary.resolvedInvocationsWithoutEffectivePolicyEvidenceDelta ?? 0)})`,
    `- Surface policy evidence: ${executableSurface.toSummary.surfacesWithEffectivePolicy}/${executableSurface.toSummary.totalSurfaces} (${signed(executableSurface.summary.surfacesWithEffectivePolicyDelta)} surfaces with evidence)`,
  ];
  if (executableSurface.addedSurfacePaths.length > 0) {
    lines.push(
      "",
      "### Added executable surfaces",
      "",
      ...executableSurface.addedSurfacePaths.map(
        (surfacePath) => `- \`${surfacePath}\``,
      ),
    );
  }
  if (executableSurface.removedSurfacePaths.length > 0) {
    lines.push(
      "",
      "### Removed executable surfaces",
      "",
      ...executableSurface.removedSurfacePaths.map(
        (surfacePath) => `- \`${surfacePath}\``,
      ),
    );
  }
  if (executableSurface.changedSurfaces.length > 0) {
    lines.push(
      "",
      "### Changed executable surfaces",
      "",
      ...executableSurface.changedSurfaces.map(
        (surface) => `- \`${surface.path}\`: ${surface.reasons.join(", ")}`,
      ),
    );
  }
  if (executableSurface.invocationResolutionChanges.length > 0) {
    lines.push(
      "",
      "### Invocation resolution changes",
      "",
      ...executableSurface.invocationResolutionChanges.map(
        (invocation) =>
          `- \`${invocation.sourcePath}\` ${invocation.launcher} \`${invocation.target}\` #${invocation.occurrenceOrdinal}: ${invocation.fromResolution} -> ${invocation.toResolution}`,
      ),
    );
  }
  if (executableSurface.addedDependencies.length > 0) {
    lines.push(
      "",
      "### Added executable dependencies",
      "",
      ...executableSurface.addedDependencies.map(
        (dependency) =>
          `- \`${dependency.sourcePath}:L${dependency.line}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\` #${dependency.occurrenceOrdinal}: ${dependency.resolution}`,
      ),
    );
  }
  if (executableSurface.removedDependencies.length > 0) {
    lines.push(
      "",
      "### Removed executable dependencies",
      "",
      ...executableSurface.removedDependencies.map(
        (dependency) =>
          `- \`${dependency.sourcePath}:L${dependency.line}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\` #${dependency.occurrenceOrdinal}: ${dependency.resolution}`,
      ),
    );
  }
  if (executableSurface.dependencyResolutionChanges.length > 0) {
    lines.push(
      "",
      "### Executable dependency resolution changes",
      "",
      ...executableSurface.dependencyResolutionChanges.map(
        (dependency) =>
          `- \`${dependency.sourcePath}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\` #${dependency.occurrenceOrdinal}: ${dependency.fromResolution} -> ${dependency.toResolution}`,
      ),
    );
  }
  if (executableSurface.newProblematicDependencies.length > 0) {
    lines.push(
      "",
      "### New dependency evidence for review",
      "",
      ...executableSurface.newProblematicDependencies.map(
        (dependency) =>
          `- \`${dependency.sourcePath}:L${dependency.line}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\`: ${dependency.resolution}`,
      ),
    );
  }
  if (executableSurface.newlyTransitivelyReachableSurfacePaths.length > 0) {
    lines.push(
      "",
      "### Newly transitively reachable executable surfaces",
      "",
      ...executableSurface.newlyTransitivelyReachableSurfacePaths.map(
        (surfacePath) => `- \`${surfacePath}\``,
      ),
    );
  }
  if (executableSurface.surfacesLostStaticInvocationReachability.length > 0) {
    lines.push(
      "",
      "### Executable surfaces that lost static invocation reachability",
      "",
      ...executableSurface.surfacesLostStaticInvocationReachability.map(
        (surfacePath) => `- \`${surfacePath}\``,
      ),
    );
  }
  if (invocationGovernanceChanges.length > 0) {
    lines.push(
      "",
      "### Invocation governance changes",
      "",
      ...invocationGovernanceChanges.map(
        (invocation) =>
          `- \`${invocation.sourcePath}\` ${invocation.launcher} \`${invocation.target}\` #${invocation.occurrenceOrdinal}: policy evidence ${invocation.fromHasEffectivePolicyEvidence ? "with" : "without"} -> ${invocation.toHasEffectivePolicyEvidence ? "with" : "without"}; owning Skill ${invocation.fromOwningSkillResolution} -> ${invocation.toOwningSkillResolution}; effective fingerprints ${invocation.fromDistinctEffectivePolicyFingerprints.length} -> ${invocation.toDistinctEffectivePolicyFingerprints.length}`,
      ),
    );
  }
  return lines;
}

const DIFF_DETAIL_LIMIT =
  DEFAULT_QUALITY_PROFILE.presentation.topSummaryItemCap;

function formatSkillDiscoveryChanges(discovery: SkillDiscoveryDiff): string[] {
  const lines = [
    "## Skill Discovery Changes",
    "",
    `- Adoption: ${discovery.adoption.from} -> ${discovery.adoption.to}`,
    `- Coverage: ${discovery.coverage.from} -> ${discovery.coverage.to}`,
    `- Published entrypoints: +${discovery.publishedEntrypoints.added.length} / -${discovery.publishedEntrypoints.removed.length}`,
    `- Reachability: +${discovery.reachability.newlyReachable.length} reachable / +${discovery.reachability.newlyNotReached.length} not-reached`,
    `- Unrouted Skills: +${discovery.unroutedSkills.newlyUnrouted.length} / -${discovery.unroutedSkills.resolvedUnrouted.length}`,
    `- Routes: +${discovery.routes.added.length} / -${discovery.routes.removed.length} / ${discovery.routes.changed.length} changed`,
    `- Cyclic components: +${discovery.cycles.added.length} / -${discovery.cycles.resolved.length}`,
  ];
  appendDiscoveryDetails(
    lines,
    "Added published entrypoints",
    discovery.publishedEntrypoints.added,
    formatDiscoverySkill,
  );
  appendDiscoveryDetails(
    lines,
    "Removed published entrypoints",
    discovery.publishedEntrypoints.removed,
    formatDiscoverySkill,
  );
  appendDiscoveryDetails(
    lines,
    "Newly reachable Skills",
    discovery.reachability.newlyReachable,
    formatDiscoverySkill,
  );
  appendDiscoveryDetails(
    lines,
    "Newly not-reached Skills",
    discovery.reachability.newlyNotReached,
    formatDiscoverySkill,
  );
  appendDiscoveryDetails(
    lines,
    "Newly unrouted Skills",
    discovery.unroutedSkills.newlyUnrouted,
    formatDiscoverySkill,
  );
  appendDiscoveryDetails(
    lines,
    "Resolved unrouted Skills",
    discovery.unroutedSkills.resolvedUnrouted,
    formatDiscoverySkill,
  );
  appendDiscoveryDetails(
    lines,
    "Added routes",
    discovery.routes.added,
    formatDiscoveryRoute,
  );
  appendDiscoveryDetails(
    lines,
    "Removed routes",
    discovery.routes.removed,
    formatDiscoveryRoute,
  );
  appendDiscoveryDetails(
    lines,
    "Changed routes",
    discovery.routes.changed,
    formatDiscoveryRouteChange,
  );
  appendDiscoveryDetails(
    lines,
    "Added cyclic components",
    discovery.cycles.added,
    formatDiscoveryCycle,
  );
  appendDiscoveryDetails(
    lines,
    "Resolved cyclic components",
    discovery.cycles.resolved,
    formatDiscoveryCycle,
  );
  return lines;
}

function appendDiscoveryDetails<T>(
  lines: string[],
  heading: string,
  items: readonly T[],
  render: (item: T) => string,
): void {
  if (items.length === 0) return;
  lines.push("", `### ${heading}`, "");
  lines.push(
    ...items.slice(0, DIFF_DETAIL_LIMIT).map((item) => `- ${render(item)}`),
  );
  if (items.length > DIFF_DETAIL_LIMIT) {
    lines.push(
      `- ${items.length - DIFF_DETAIL_LIMIT} more not shown; see JSON for the full list.`,
    );
  }
}

function formatDiscoverySkill(skill: SkillDiscoveryDiffSkill): string {
  return `${skill.id} (\`${skill.path}\`)`;
}

function formatDiscoveryRoute(route: SkillDiscoveryRouteDiffState): string {
  return `\`${route.sourcePath}\` -> \`${route.normalizedTarget}\` (${route.resolution}, ${route.usable ? "usable" : "unusable"}, ${route.declarationCount} declaration${route.declarationCount === 1 ? "" : "s"})`;
}

function formatDiscoveryRouteChange(change: SkillDiscoveryRouteChange): string {
  return `\`${change.identity.sourcePath}\` -> \`${change.identity.normalizedTarget}\`: ${change.changedFields.join(", ")}`;
}

function formatDiscoveryCycle(cycle: SkillDiscoveryCycleDiff): string {
  return `${cycle.skillIds.join(", ")}${cycle.selfLoop ? " (self-loop)" : ""}`;
}

export function formatSecurityChanges(
  security: SecurityDiffSummary | undefined,
): string[] {
  const { posture, policyInventory } =
    security ??
    buildSecurityDiffSummary({
      addedFindings: [],
      removedFindings: [],
    });
  const relaxations = security ? securityPolicyRelaxations(security) : [];
  const lines = [
    ...(relaxations.length > 0
      ? [
          "### Security policy relaxations",
          "",
          ...relaxations
            .slice(0, DIFF_DETAIL_LIMIT)
            .map(formatSecurityPolicyRelaxation),
          ...formatPolicyOverflow(relaxations.length, 0),
          "",
          "### Aggregate security metrics",
          "",
        ]
      : []),
    `- Added security findings: ${posture.added.totalSecurityFindings}`,
    `- Resolved security findings: ${posture.resolved.totalSecurityFindings}`,
    `- Added violations: ${posture.added.riskClasses.violation}`,
    `- Added suspicious: ${posture.added.riskClasses.suspicious}`,
    `- Added advisory: ${posture.added.riskClasses.advisory}`,
    `- Resolved violations: ${posture.resolved.riskClasses.violation}`,
    `- Resolved suspicious: ${posture.resolved.riskClasses.suspicious}`,
    `- Resolved advisory: ${posture.resolved.riskClasses.advisory}`,
    `- Policy assets: ${formatSignedNumber(policyInventory.totalPolicyAssets)}`,
    `- Assets with local policy metadata: ${formatSignedNumber(policyInventory.assetsWithLocalPolicyMetadata)}`,
    `- Assets with inherited policy: ${formatSignedNumber(policyInventory.assetsWithInheritedPolicy)}`,
    `- Assets with effective policy: ${formatSignedNumber(policyInventory.assetsWithEffectivePolicy)}`,
    `- Assets without effective policy: ${formatSignedNumber(policyInventory.assetsWithoutEffectivePolicy)}`,
    `- Effective policy from local metadata: ${formatSignedNumber(policyInventory.policySources.local)}`,
    `- Effective policy from security profiles: ${formatSignedNumber(policyInventory.policySources.security_profile)}`,
    `- Effective policy from repository config: ${formatSignedNumber(policyInventory.policySources.repository_config)}`,
    `- Effective policy from owning Skills: ${formatSignedNumber(policyInventory.policySources.owning_skill)}`,
    `- Network allowed: ${formatSignedNumber(policyInventory.networkAllowed.true)}`,
    `- Network denied: ${formatSignedNumber(policyInventory.networkAllowed.false)}`,
    `- External upload allowed: ${formatSignedNumber(policyInventory.externalUploadAllowed.true)}`,
    `- External upload denied: ${formatSignedNumber(policyInventory.externalUploadAllowed.false)}`,
    `- Secrets allowed: ${formatSignedNumber(policyInventory.secretsAllowed.true)}`,
    `- Secrets denied: ${formatSignedNumber(policyInventory.secretsAllowed.false)}`,
    `- Human approval required: ${formatSignedNumber(policyInventory.humanApprovalRequired.true)}`,
    `- Approved network destinations: ${formatSignedNumber(policyInventory.approvedNetworkDestinationCount)}`,
    `- Approved upload destinations: ${formatSignedNumber(policyInventory.approvedUploadDestinationCount)}`,
    `- Forbidden inputs: ${formatSignedNumber(policyInventory.forbiddenInputCount)}`,
    `- Missing security profiles: ${formatSignedNumber(policyInventory.securityProfiles.missing)}`,
    `- Cyclic security profiles: ${formatSignedNumber(policyInventory.securityProfiles.cyclic)}`,
  ];
  const policyChanges = security?.policyChanges ?? [];
  const sharedPolicyChanges = security?.sharedPolicyChanges ?? [];
  if (policyChanges.length > 0) {
    lines.push(
      "",
      "### Effective security policy boundary changes",
      "",
      ...policyChanges
        .slice(0, DIFF_DETAIL_LIMIT)
        .flatMap(formatSecurityPolicyAssetChange),
      ...formatPolicyOverflow(policyChanges.length, 0),
    );
  }
  if (sharedPolicyChanges.length > 0) {
    lines.push("", "### Shared policy blast radius", "");
    lines.push(
      ...sharedPolicyChanges
        .slice(0, DIFF_DETAIL_LIMIT)
        .flatMap(formatSharedSecurityPolicyChange),
      ...formatPolicyOverflow(sharedPolicyChanges.length, 0),
    );
  }
  return lines;
}

function formatSecurityPolicyRelaxation(
  relaxation: ReturnType<typeof securityPolicyRelaxations>[number],
): string {
  const asset = `${formatMarkdownInlineCode(relaxation.asset.id)} (${formatMarkdownInlineCode(relaxation.asset.path)})`;
  if (relaxation.kind === "scalar") {
    return `- ${asset}: ${relaxation.property} ${relaxation.fromState} -> ${relaxation.toState}`;
  }
  const values =
    relaxation.direction === "allowed_value_added"
      ? relaxation.addedValues
      : relaxation.removedValues;
  const action =
    relaxation.direction === "allowed_value_added"
      ? "allowed value added"
      : "restricted value removed";
  const overflow =
    values.length > DIFF_DETAIL_LIMIT
      ? `; ${values.length - DIFF_DETAIL_LIMIT} more not shown`
      : "";
  return `- ${asset}: ${relaxation.property} — ${action}: ${formatPolicyValues(values)}${overflow}`;
}

function formatSecurityPolicyAssetChange(
  change: SecurityPolicyAssetChange,
): string[] {
  const lines = [
    `- ${formatMarkdownInlineCode(change.asset.id)} (${formatMarkdownInlineCode(change.asset.path)})`,
  ];
  for (const field of change.fields) {
    lines.push(...formatSecurityPolicyFieldChange(field));
    if (
      field.kind === "scalar" &&
      field.field === "networkAllowed" &&
      field.after === true
    ) {
      lines.push(
        ...formatEffectiveDestinationScope(
          "Effective approved network destinations after",
          change.after?.approvedNetworkDestinations ?? [],
        ),
      );
    }
    if (
      field.kind === "scalar" &&
      field.field === "externalUploadAllowed" &&
      field.after === true
    ) {
      lines.push(
        ...formatEffectiveDestinationScope(
          "Effective approved upload destinations after",
          change.after?.approvedUploadDestinations ?? [],
        ),
      );
    }
  }
  return lines;
}

function formatSecurityPolicyFieldChange(
  change: SecurityPolicyFieldChange,
): string[] {
  const label = securityPolicyFieldLabel(change.field);
  const provenance = formatPolicyProvenance(change.provenance);
  if (change.kind === "scalar") {
    return [
      `  - ${label} (${provenance}): ${formatPolicyScalar(change.before)} -> ${formatPolicyScalar(change.after)}`,
    ];
  }
  const lines = [`  - ${label} (${provenance}):`];
  if (change.added.length > 0) {
    lines.push(
      `    - Added: ${formatPolicyValues(change.added)}`,
      ...formatPolicyOverflow(change.added.length, 4),
    );
  }
  if (change.removed.length > 0) {
    lines.push(
      `    - Removed: ${formatPolicyValues(change.removed)}`,
      ...formatPolicyOverflow(change.removed.length, 4),
    );
  }
  return lines;
}

function formatSharedSecurityPolicyChange(
  change: SharedSecurityPolicyChange,
): string[] {
  const count = change.affectedAssets.length;
  const noun = count === 1 ? "asset receives" : "assets receive";
  const lines = [
    `- ${formatPolicySource(change.source)}: ${count} ${noun} an effective policy change; fields: ${change.changedFields.map(securityPolicyFieldLabel).join(", ")}`,
  ];
  lines.push(
    ...change.affectedAssets
      .slice(0, DIFF_DETAIL_LIMIT)
      .map(
        (asset) =>
          `  - ${formatMarkdownInlineCode(asset.id)} (${formatMarkdownInlineCode(asset.path)})`,
      ),
    ...formatPolicyOverflow(change.affectedAssets.length, 2),
  );
  return lines;
}

function formatPolicyProvenance(
  provenance: SecurityPolicyChangeProvenance,
): string {
  if (provenance.mode === "unresolved") {
    if (provenance.sources.length === 0) return "provenance unresolved";
    return `provenance unresolved; known source${provenance.sources.length === 1 ? "" : "s"}: ${provenance.sources.map(formatPolicySource).join(", ")}`;
  }
  const mode =
    provenance.mode === "direct"
      ? "direct"
      : provenance.mode === "inherited"
        ? "inherited"
        : "direct and inherited";
  return `${mode}; source${provenance.sources.length === 1 ? "" : "s"}: ${provenance.sources.map(formatPolicySource).join(", ")}`;
}

function formatPolicySource(source: SecurityPolicyChangeSource): string {
  const location = source.path
    ? ` at ${formatMarkdownInlineCode(source.path)}`
    : "";
  if (source.type === "asset") {
    return `asset ${formatMarkdownInlineCode(source.id)}${location}`;
  }
  if (source.type === "owning_skill") {
    return `owning Skill ${formatMarkdownInlineCode(source.id)}${location}`;
  }
  if (source.type === "security_profile") {
    return `security profile ${formatMarkdownInlineCode(source.id)}${location}`;
  }
  return `repository security configuration${location}`;
}

function securityPolicyFieldLabel(
  field: SecurityPolicyFieldChange["field"],
): string {
  switch (field) {
    case "networkAllowed":
      return "Network allowed";
    case "approvedNetworkDestinations":
      return "Approved network destinations";
    case "externalUploadAllowed":
      return "External upload allowed";
    case "approvedUploadDestinations":
      return "Approved upload destinations";
    case "allowedData":
      return "Allowed data";
    case "forbiddenInputs":
      return "Forbidden inputs";
    case "secretsAllowed":
      return "Secrets allowed";
    case "humanApprovalRequired":
      return "Human approval required";
    case "disallowedCommands":
      return "Disallowed commands";
  }
}

function formatPolicyScalar(value: boolean | null): string {
  return value === null ? "unspecified" : String(value);
}

function formatPolicyValues(values: readonly string[]): string {
  return values
    .slice(0, DIFF_DETAIL_LIMIT)
    .map(formatMarkdownInlineCode)
    .join(", ");
}

function formatEffectiveDestinationScope(
  label: string,
  values: readonly string[],
): string[] {
  if (values.length === 0) return [`  - ${label}: none declared`];
  return [
    `  - ${label}: ${formatPolicyValues(values)}`,
    ...formatPolicyOverflow(values.length, 4),
  ];
}

function formatPolicyOverflow(total: number, indent: number): string[] {
  if (total <= DIFF_DETAIL_LIMIT) return [];
  return [
    `${" ".repeat(indent)}- ${total - DIFF_DETAIL_LIMIT} more not shown; see JSON for the full list.`,
  ];
}

function formatFindingDelta(finding: FindingDelta): string {
  const location = finding.evidence?.path ? ` at ${finding.evidence.path}` : "";

  if (!finding.riskClass) {
    return `${finding.id} (${finding.severity})${location}`;
  }

  return `${finding.severity.toUpperCase()} [${finding.riskClass}] ${finding.id}${location}`;
}

async function snapshot(
  repoRoot: string,
  relativeTarget: string,
  ref: string,
  tempRoot: string,
  label: string,
  overrides: ConfigOverrides = {},
  instrumentation?: RepositoryCollectionInstrumentation,
  includeSkillDiscovery = true,
): Promise<{
  snapshot: DiffSnapshot;
  skillDiscoveryCiPolicy: SkillDiscoveryCiPolicyMode;
  securityPolicyCiPolicy: SecurityCiPolicyMode;
}> {
  const root = join(tempRoot, label);
  const archivePath = join(tempRoot, `${label}.tar`);
  await mkdir(root, { recursive: true });
  await gitOutput(repoRoot, [
    "archive",
    "--format=tar",
    "--output",
    archivePath,
    ref,
  ]);
  await execFile("tar", ["-xf", archivePath, "-C", root]);
  const target = relativeTarget === "." ? root : join(root, relativeTarget);
  const repositorySnapshot = await collectRepositorySnapshot(
    target,
    snapshotOverrides(repoRoot, root, overrides),
    instrumentation,
  );
  const graphReport = graphFromRepositorySnapshot(repositorySnapshot);
  const readinessReport = readinessFromRepositorySnapshot(repositorySnapshot, {
    includeSkillDiscovery: false,
  });
  return {
    snapshot: {
      ref,
      root: target,
      readiness: readinessReport,
      graph: graphReport,
      ...(includeSkillDiscovery
        ? { discovery: repositorySnapshot.skillDiscovery }
        : {}),
      executableSurfaceInventory: repositorySnapshot.executableSurfaceInventory,
      securityPolicies: repositorySnapshot.securityPolicies,
      securityConfig: repositorySnapshot.config.security,
      ...(repositorySnapshot.configPath
        ? { configPath: repositorySnapshot.configPath }
        : {}),
    },
    skillDiscoveryCiPolicy: repositorySnapshot.config.skillDiscovery.ciPolicy,
    securityPolicyCiPolicy:
      repositorySnapshot.config.security.ciPolicy ?? "fail",
  };
}

function endpoint(snapshot: DiffSnapshot): DiffEndpoint {
  return {
    ref: snapshot.ref,
    scannedFileCount: snapshot.readiness.scannedFileCount,
    totalAssets: snapshot.readiness.summary.totalAssets,
    readinessScore: snapshot.readiness.score,
    readinessLevel: snapshot.readiness.level,
    ownership: {
      ownedAssets: snapshot.readiness.summary.ownedAssets,
      eligibleAssets: snapshot.readiness.summary.totalAssets,
      coveragePercent: snapshot.readiness.summary.ownershipCoveragePercent,
    },
    contextLens: snapshot.readiness.summary.contextLens,
    securityPolicyInventory: snapshot.readiness.summary.securityPolicyInventory,
  };
}

function assetIdsByPath(graph: GraphReport): Map<string, string> {
  return new Map(graph.nodes.map((node) => [node.sourcePath, node.id]));
}

function changedAssets(
  fromAssets: Map<string, AssetDelta>,
  toAssets: Map<string, AssetDelta>,
): AssetChange[] {
  return [...toAssets]
    .flatMap(([key, toAsset]) => {
      const fromAsset = fromAssets.get(key);
      if (!fromAsset) return [];
      const changedFields = COMPARABLE_ASSET_FIELDS.filter(
        (field) => fromAsset[field] !== toAsset[field],
      );
      return changedFields.length === 0
        ? []
        : [
            {
              id: toAsset.id,
              path: toAsset.path,
              changedFields,
              from: fromAsset,
              to: toAsset,
            },
          ];
    })
    .sort(compareBy((change) => change.id));
}

function checkChanges(
  fromChecks: unknown[],
  toChecks: unknown[],
): ReadinessCheckChange[] {
  const fromById = new Map(
    fromChecks.map((check) => [stringField(check, "id"), check] as const),
  );
  return toChecks
    .flatMap((check) => {
      const id = stringField(check, "id");
      const previous = fromById.get(id);
      if (!previous) return [];
      const change = {
        id,
        title: stringField(check, "title"),
        fromStatus: stringField(previous, "status"),
        toStatus: stringField(check, "status"),
        fromSeverity: stringField(previous, "severity"),
        toSeverity: stringField(check, "severity"),
        summaryChanged:
          stringField(previous, "summary") !== stringField(check, "summary"),
      };
      return change.fromStatus === change.toStatus &&
        change.fromSeverity === change.toSeverity &&
        !change.summaryChanged
        ? []
        : [change];
    })
    .sort(compareBy((change) => change.id));
}

function assetMap(nodes: unknown[]): Map<string, AssetDelta> {
  return stableMap(
    nodes.map((node) => {
      const ownership = objectField(node, "ownership");
      const asset: AssetDelta = {
        id: firstString(node, ["id", "path", "sourcePath"]),
        path: firstOptionalString(node, ["sourcePath", "path"]),
        kind: firstOptionalString(node, ["kind"]),
        declaredOwner:
          optionalNullableStringField(ownership, "declaredOwner") ?? null,
        effectiveOwner:
          optionalNullableStringField(ownership, "effectiveOwner") ?? null,
        status: firstOptionalString(node, ["status"]),
        ...(firstOptionalString(node, ["statusReason"])
          ? { statusReason: firstOptionalString(node, ["statusReason"]) }
          : {}),
        ...(firstOptionalString(node, ["statusChangedAt"])
          ? {
              statusChangedAt: firstOptionalString(node, ["statusChangedAt"]),
            }
          : {}),
      };
      return [asset.id, asset] as const;
    }),
  );
}

function markdownValue(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? `\`${value.replaceAll("`", "\\`")}\``
    : "(none)";
}

function edgeMap(edges: unknown[]): Map<string, EdgeDelta> {
  return stableMap(
    edges.map((edge) => {
      const identitySource = firstString(edge, [
        "source",
        "sourceId",
        "from",
        "sourcePath",
      ]);
      const identityTarget = firstString(edge, [
        "declaredTarget",
        "to",
        "target",
        "targetId",
        "targetPath",
      ]);
      const resolved = booleanField(edge, "resolved");
      const normalized = {
        source: firstString(edge, ["source", "sourceId", "from", "sourcePath"]),
        target: resolved
          ? firstString(edge, [
              "targetId",
              "target",
              "to",
              "targetPath",
              "declaredTarget",
            ])
          : identityTarget,
        kind: firstString(edge, ["kind", "type"]),
        resolved,
        evidence: evidenceDelta(objectField(edge, "evidence")),
      };
      return [
        `${identitySource}\0${normalized.kind}\0${identityTarget}`,
        normalized,
      ] as const;
    }),
  );
}

function findingMap(findings: unknown[]): Map<string, FindingDelta> {
  return stableMap(
    findings.map((finding) => {
      const evidence = evidenceDelta(objectField(finding, "evidence"));
      const deltaFinding = {
        id: stringField(finding, "id"),
        severity: stringField(finding, "severity"),
        riskClass: optionalStringField(finding, "riskClass"),
        title: stringField(finding, "title"),
        evidence,
      };
      return [
        [
          deltaFinding.id,
          evidence?.path ?? "",
          evidence?.startLine ?? "",
          evidence?.endLine ?? "",
          evidence?.snippet ?? "",
        ].join("\0"),
        deltaFinding,
      ] as const;
    }),
  );
}

function countById(fromFindings: unknown[], toFindings: unknown[]) {
  const fromCounts = counts(
    fromFindings.map((finding) => stringField(finding, "id")),
  );
  const toCounts = counts(
    toFindings.map((finding) => stringField(finding, "id")),
  );
  return [...new Set([...fromCounts.keys(), ...toCounts.keys()])]
    .map((id) => ({
      id,
      from: fromCounts.get(id) ?? 0,
      to: toCounts.get(id) ?? 0,
      delta: delta(toCounts.get(id) ?? 0, fromCounts.get(id) ?? 0),
    }))
    .filter((item) => item.delta !== 0)
    .sort(compareBy((item) => item.id));
}

function evidenceDelta(evidence: unknown): EvidenceDelta | undefined {
  if (!evidence || typeof evidence !== "object") return undefined;
  const record = evidence as Record<string, unknown>;
  return {
    path: optionalStringField(record, "path"),
    startLine: optionalNumberField(record, "startLine"),
    endLine: optionalNumberField(record, "endLine"),
    snippet: optionalStringField(record, "snippet"),
  };
}

function highOrCriticalCount(findings: FindingDelta[]): number {
  return findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "critical",
  ).length;
}

function pathWithinRepo(repoRoot: string, absoluteTarget: string): string {
  const relativeTarget = relative(repoRoot, absoluteTarget);
  if (
    relativeTarget === "" ||
    relativeTarget === "." ||
    (!relativeTarget.startsWith("..") && !isAbsolute(relativeTarget))
  ) {
    return relativeTarget === "" ? "." : relativeTarget;
  }
  throw new Error(
    `Diff target must be inside the git repository: ${absoluteTarget}`,
  );
}

function snapshotOverrides(
  repoRoot: string,
  snapshotRoot: string,
  overrides: ConfigOverrides,
): ConfigOverrides {
  if (!overrides.configPath) return overrides;
  try {
    const configPath = pathWithinRepo(
      repoRoot,
      resolve(process.cwd(), overrides.configPath),
    );
    return {
      ...overrides,
      configPath: join(snapshotRoot, configPath),
    };
  } catch {
    return overrides;
  }
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["-C", cwd, ...args], {
      maxBuffer: 1024 * 1024 * 20,
    });
    return stdout.trim();
  } catch (error) {
    if (error instanceof Error) {
      const output = [
        error.message,
        stringErrorField(error, "stderr"),
        stringErrorField(error, "stdout"),
      ]
        .map((item) => item.trim())
        .filter(Boolean)
        .join("\n");
      throw new Error(`git ${args.join(" ")} failed: ${output}`, {
        cause: error,
      });
    }
    throw error;
  }
}

function stringErrorField(error: Error, field: "stdout" | "stderr"): string {
  const value = (error as Error & Record<typeof field, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function stableMap<T>(entries: Array<readonly [string, T]>): Map<string, T> {
  return new Map(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function counts(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) {
    result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

function delta(to: number, from: number): number {
  return Number((to - from).toFixed(2));
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatOwnershipDelta(
  from: DiffEndpoint,
  to: DiffEndpoint,
  coverageDelta: number,
): string {
  if (!from.ownership || !to.ownership) {
    return `- Ownership coverage: ${signed(coverageDelta)}`;
  }
  return `- Ownership: ${formatOwnershipEndpoint(from.ownership)} -> ${formatOwnershipEndpoint(to.ownership)} (${formatPercentagePointDelta(coverageDelta)})`;
}

function formatOwnershipEndpoint(ownership: DiffOwnershipEndpoint): string {
  return `${ownership.ownedAssets}/${ownership.eligibleAssets} (${ownership.coveragePercent}%)`;
}

function formatPercentagePointDelta(value: number): string {
  return `${formatSignedNumber(value)} pp`;
}

function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function markdownList<T>(items: T[], render: (item: T) => string): string[] {
  return items.length === 0
    ? ["- (none)"]
    : items.map((item) => `- ${render(item)}`);
}

function compareBy<T>(
  selector: (item: T) => string,
): (left: T, right: T) => number {
  return (left, right) => selector(left).localeCompare(selector(right));
}

function firstString(value: unknown, fields: string[]): string {
  return firstOptionalString(value, fields) ?? "";
}

function firstOptionalString(
  value: unknown,
  fields: string[],
): string | undefined {
  for (const field of fields) {
    const candidate = optionalStringField(value, field);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function stringField(value: unknown, field: string): string {
  return optionalStringField(value, field) ?? "";
}

function optionalStringField(
  value: unknown,
  field: string,
): string | undefined {
  const candidate = objectField(value, field);
  return typeof candidate === "string" ? candidate : undefined;
}

function optionalNullableStringField(
  value: unknown,
  field: string,
): string | null | undefined {
  const candidate = objectField(value, field);
  return typeof candidate === "string" || candidate === null
    ? candidate
    : undefined;
}

function optionalNumberField(
  value: unknown,
  field: string,
): number | undefined {
  const candidate = objectField(value, field);
  return typeof candidate === "number" ? candidate : undefined;
}

function booleanField(value: unknown, field: string): boolean {
  return objectField(value, field) === true;
}

function objectField(value: unknown, field: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[field];
}
