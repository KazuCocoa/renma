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
import type { ContextLensSummary } from "../context-lens.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import type { ConfigOverrides } from "../config.js";
import type { SkillDiscoveryCiPolicyMode } from "../types/configuration.js";
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
  | DiffReport
  | DiffReportWithoutSkillDiscovery;

interface DiffEndpoint {
  ref: string;
  scannedFileCount: number;
  totalAssets: number;
  readinessScore: number;
  readinessLevel: string;
  contextLens?: ContextLensSummary;
  securityPolicyInventory?: SecurityPolicyInventorySummary;
}

interface AssetDelta {
  id: string;
  path?: string | undefined;
  kind?: string | undefined;
  owner?: string | undefined;
  status?: string | undefined;
}

interface AssetChange {
  id: string;
  path?: string | undefined;
  changedFields: string[];
  from: AssetDelta;
  to: AssetDelta;
}

interface EdgeDelta {
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

/** @internal Build the pre-0.23.1 projection for compatibility consumers. */
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
    | DiffExecutionContext
    | DiffReportWithoutSkillDiscovery
    | undefined;
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
    security: buildSecurityDiffSummary({
      addedFindings,
      removedFindings,
      fromPolicyInventory: fromEndpoint.securityPolicyInventory,
      toPolicyInventory: toEndpoint.securityPolicyInventory,
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
    return `${JSON.stringify(report, null, 2)}\n`;
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
    `- Ownership coverage: ${signed(report.summary.ownershipCoverageDelta)}`,
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

function formatSecurityChanges(
  security: SecurityDiffSummary | undefined,
): string[] {
  const { posture, policyInventory } =
    security ??
    buildSecurityDiffSummary({
      addedFindings: [],
      removedFindings: [],
    });
  return [
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
    `- Upload allowed: ${formatSignedNumber(policyInventory.externalUploadAllowed.true)}`,
    `- Upload denied: ${formatSignedNumber(policyInventory.externalUploadAllowed.false)}`,
    `- Secrets allowed: ${formatSignedNumber(policyInventory.secretsAllowed.true)}`,
    `- Secrets denied: ${formatSignedNumber(policyInventory.secretsAllowed.false)}`,
    `- Human approval required: ${formatSignedNumber(policyInventory.humanApprovalRequired.true)}`,
    `- Approved network destinations: ${formatSignedNumber(policyInventory.approvedNetworkDestinationCount)}`,
    `- Approved upload destinations: ${formatSignedNumber(policyInventory.approvedUploadDestinationCount)}`,
    `- Forbidden inputs: ${formatSignedNumber(policyInventory.forbiddenInputCount)}`,
    `- Missing security profiles: ${formatSignedNumber(policyInventory.securityProfiles.missing)}`,
    `- Cyclic security profiles: ${formatSignedNumber(policyInventory.securityProfiles.cyclic)}`,
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
    },
    skillDiscoveryCiPolicy: repositorySnapshot.config.skillDiscovery.ciPolicy,
  };
}

function endpoint(snapshot: DiffSnapshot): DiffEndpoint {
  return {
    ref: snapshot.ref,
    scannedFileCount: snapshot.readiness.scannedFileCount,
    totalAssets: snapshot.readiness.summary.totalAssets,
    readinessScore: snapshot.readiness.score,
    readinessLevel: snapshot.readiness.level,
    contextLens: snapshot.readiness.summary.contextLens,
    securityPolicyInventory: snapshot.readiness.summary.securityPolicyInventory,
  };
}

function changedAssets(
  fromAssets: Map<string, AssetDelta>,
  toAssets: Map<string, AssetDelta>,
): AssetChange[] {
  return [...toAssets]
    .flatMap(([key, toAsset]) => {
      const fromAsset = fromAssets.get(key);
      if (!fromAsset) return [];
      const changedFields = ["path", "kind", "owner", "status"].filter(
        (field) =>
          fromAsset[field as keyof AssetDelta] !==
          toAsset[field as keyof AssetDelta],
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
      const asset = {
        id: firstString(node, ["id", "path", "sourcePath"]),
        path: firstOptionalString(node, ["sourcePath", "path"]),
        kind: firstOptionalString(node, ["kind"]),
        owner: firstOptionalString(node, ["owner"]),
        status: firstOptionalString(node, ["status"]),
      };
      return [asset.id, asset] as const;
    }),
  );
}

function edgeMap(edges: unknown[]): Map<string, EdgeDelta> {
  return stableMap(
    edges.map((edge) => {
      const normalized = {
        source: firstString(edge, ["source", "sourceId", "sourcePath", "from"]),
        target: firstString(edge, ["target", "targetId", "targetPath", "to"]),
        kind: firstString(edge, ["kind", "type"]),
        resolved: booleanField(edge, "resolved"),
        evidence: evidenceDelta(objectField(edge, "evidence")),
      };
      return [
        `${normalized.source}\0${normalized.kind}\0${normalized.target}`,
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
