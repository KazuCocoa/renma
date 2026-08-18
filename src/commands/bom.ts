import { compareUtf16CodeUnits } from "../canonical-json.js";
import packageJson from "../../package.json" with { type: "json" };
import { graphFromRepositorySnapshot, type GraphEdge } from "./graph.js";
import {
  buildReadinessReport,
  readinessDiagnosticsFromRepositorySnapshot,
  type ReadinessLevel,
  type ReadinessReport,
} from "./readiness.js";
import { scanFromRepositorySnapshot } from "../scanner.js";
import {
  zeroExecutableSurfaceInventory,
  type ExecutableSurfaceInventory,
} from "../executable-surface-inventory.js";
import type { ConfigOverrides } from "../config.js";
import type {
  Asset,
  AssetKind,
  AssetOwnership,
  AssetStatus,
  DependencyKind,
} from "../model.js";
import {
  collectRepositorySnapshot,
  repositoryDiagnosticsWithoutSkillDiscovery,
  type RepositorySnapshot,
} from "../repository-evidence.js";
import { formatJsonDocument } from "../report.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import type { SecurityPostureSummary } from "../security-posture.js";
import type { Diagnostic } from "../types/diagnostics.js";

export const REPOSITORY_CONTEXT_BOM_SCHEMA_VERSION =
  "renma.repository-context-bom.v3" as const;

export type BomFormat = "json" | "markdown";
export type BomOutputMode = "default" | "omit_generated_at";

export interface BomOptions {
  omitGeneratedAt?: boolean;
}

interface BomBuildOptions extends BomOptions {
  generatedAt?: Date | string;
  evaluationDate?: Date | string;
}

export interface BomReport {
  schemaVersion: typeof REPOSITORY_CONTEXT_BOM_SCHEMA_VERSION;
  generatedAt?: string;
  outputMode: BomOutputMode;
  generator: {
    name: "renma";
    version: string;
  };
  root: string;
  configPath?: string;
  scope: {
    type: "declared_repository_manifest";
    runtimeUsage: false;
    telemetryCollected: false;
  };
  summary: {
    scannedFileCount: number;
    assetCount: number;
    dependencyCount: number;
    resolvedDependencyCount: number;
    unresolvedDependencyCount: number;
    ownedAssetCount: number;
    unownedAssetCount: number;
    readinessScore: number;
    readinessLevel: ReadinessLevel;
    diagnosticCounts: {
      error: number;
      warning: number;
      info: number;
    };
  };
  assets: BomAsset[];
  dependencies: BomDependency[];
  readiness: {
    score: number;
    level: ReadinessLevel;
    checks: ReadinessReport["checks"];
    summary: Omit<ReadinessReport["summary"], "skillDiscovery">;
  };
  securityPosture: SecurityPostureSummary;
  securityPolicyInventory: SecurityPolicyInventorySummary;
  executableSurfaceInventory: ExecutableSurfaceInventory;
  diagnostics: Diagnostic[];
}

export interface BomAsset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  contentHash: string;
  sizeBytes: number;
  contentClassification: "text" | "binary";
  markdownParserEligible: boolean;
  ownership: AssetOwnership;
  status?: AssetStatus;
  statusReason?: string;
  statusChangedAt?: string;
  version?: string;
  tags: string[];
  lifecycle?: BomAssetLifecycle;
  dependencies: BomAssetDependency[];
  dependents: BomAssetDependent[];
  diagnostics: Diagnostic[];
}

export interface BomAssetLifecycle {
  status?: AssetStatus;
  statusReason?: string;
  statusChangedAt?: string;
  lastReviewedAt?: string;
  reviewCycle?: string;
  expiresAt?: string;
}

export interface BomAssetDependency {
  kind: DependencyKind;
  to: string;
  resolved: boolean;
  targetId?: string;
  targetKind?: AssetKind;
  targetPath?: string;
}

export interface BomAssetDependent {
  kind: DependencyKind;
  from: string;
  sourcePath: string;
}

export interface BomDependency {
  from: string;
  to: string;
  kind: DependencyKind;
  sourcePath: string;
  resolved: boolean;
  targetId?: string;
  targetKind?: AssetKind;
  targetPath?: string;
}

interface BomAssociationIndex {
  readonly dependenciesBySource: ReadonlyMap<string, readonly BomDependency[]>;
  readonly dependentsByTarget: ReadonlyMap<string, readonly BomDependency[]>;
  readonly diagnosticsByPath: ReadonlyMap<string, readonly Diagnostic[]>;
}

export async function runBomCommand(
  targetPath: string,
  options: {
    format: BomFormat;
    overrides?: ConfigOverrides;
    omitGeneratedAt?: boolean;
  },
): Promise<number> {
  const report = await bom(targetPath, options.overrides ?? {}, {
    omitGeneratedAt: options.omitGeneratedAt === true,
  });
  process.stdout.write(
    options.format === "json"
      ? formatBomJson(report)
      : formatBomMarkdown(report),
  );
  return report.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
}

export async function bom(
  targetPath: string,
  overrides: ConfigOverrides = {},
  options: BomOptions = {},
): Promise<BomReport> {
  return buildBomReport(
    await collectRepositorySnapshot(targetPath, overrides),
    options,
  );
}

export function buildBomReport(
  snapshot: RepositorySnapshot,
  options: BomBuildOptions = {},
): BomReport {
  const graphReport = graphFromRepositorySnapshot(snapshot);
  const scanResult = scanFromRepositorySnapshot(
    snapshot,
    options.evaluationDate === undefined
      ? { includeSkillDiscoveryDiagnostics: false }
      : {
          evaluationDate: options.evaluationDate,
          includeSkillDiscoveryDiagnostics: false,
        },
  );
  const readinessReport = buildReadinessReport(
    graphReport,
    scanResult.findings,
    readinessDiagnosticsFromRepositorySnapshot(
      snapshot,
      scanResult.diagnostics,
      { includeSkillDiscovery: false },
    ),
    scanResult.contextLens,
    scanResult.securityPolicyInventory,
    scanResult.agentSkills,
    undefined,
    {
      inspectionCoverage: scanResult.inspectionCoverage,
      suppressedFindings: scanResult.suppressedFindings,
    },
  );
  const dependencies = stableEdges(graphReport.edges).map(toBomDependency);
  const diagnostics = stableDiagnostics(
    dedupeDiagnostics([
      ...repositoryDiagnosticsWithoutSkillDiscovery(snapshot),
      ...(graphReport.diagnostics ?? []),
      ...(readinessReport.diagnostics ?? []),
    ]),
  );
  const associations = buildBomAssociationIndex(dependencies, diagnostics);
  const diagnosticCounts = countDiagnostics(diagnostics);
  const omitGeneratedAt = options.omitGeneratedAt === true;
  const bomReadinessChecks = readinessReport.checks.filter(
    (check) => !check.id.startsWith("discovery."),
  );
  const bomReadinessSummary = withoutSkillDiscoveryReadiness(
    readinessReport.summary,
  );

  return {
    schemaVersion: REPOSITORY_CONTEXT_BOM_SCHEMA_VERSION,
    outputMode: omitGeneratedAt ? "omit_generated_at" : "default",
    ...(omitGeneratedAt ? {} : { generatedAt: generatedAtIso(options) }),
    generator: {
      name: "renma",
      version: packageJson.version,
    },
    root: snapshot.root,
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    scope: {
      type: "declared_repository_manifest",
      runtimeUsage: false,
      telemetryCollected: false,
    },
    summary: {
      scannedFileCount: snapshot.scannedFileCount,
      assetCount: graphReport.nodes.length,
      dependencyCount: dependencies.length,
      resolvedDependencyCount: dependencies.filter(
        (dependency) => dependency.resolved,
      ).length,
      unresolvedDependencyCount: dependencies.filter(
        (dependency) => !dependency.resolved,
      ).length,
      ownedAssetCount: readinessReport.summary.ownedAssets,
      unownedAssetCount: readinessReport.summary.unownedAssets,
      readinessScore: readinessReport.score,
      readinessLevel: readinessReport.level,
      diagnosticCounts,
    },
    assets: stableAssets(snapshot.catalog.assets).map((asset) =>
      toBomAsset(asset, associations),
    ),
    dependencies,
    readiness: {
      score: readinessReport.score,
      level: readinessReport.level,
      checks: bomReadinessChecks,
      summary: bomReadinessSummary,
    },
    securityPosture: readinessReport.summary.securityPosture,
    securityPolicyInventory: readinessReport.summary.securityPolicyInventory,
    executableSurfaceInventory:
      scanResult.executableSurfaceInventory ?? zeroExecutableSurfaceInventory(),
    diagnostics,
  };
}

function withoutSkillDiscoveryReadiness(
  summary: ReadinessReport["summary"],
): Omit<ReadinessReport["summary"], "skillDiscovery"> {
  const { skillDiscovery, ...existingSummary } = summary;
  void skillDiscovery;
  return existingSummary;
}

function generatedAtIso(options: BomBuildOptions): string {
  if (options.generatedAt instanceof Date)
    return options.generatedAt.toISOString();
  if (typeof options.generatedAt === "string") return options.generatedAt;
  return new Date().toISOString();
}

export function formatBomJson(report: BomReport): string {
  return formatJsonDocument(report);
}

export function formatBomMarkdown(report: BomReport): string {
  const diagnostics = report.summary.diagnosticCounts;
  const hasStatusTransitionEvidence = report.assets.some(
    (asset) => asset.statusReason || asset.statusChangedAt,
  );
  const lines = [
    "# Repository Context BOM",
    "",
    `- Schema: ${report.schemaVersion}`,
    `- Root: ${report.root}`,
    `- Config: ${report.configPath ?? "(defaults)"}`,
    `- Output mode: ${report.outputMode}`,
    report.generatedAt
      ? `- Generated at: ${report.generatedAt}`
      : "- Generated at: (omitted)",
    "- Runtime usage: no",
    "- Telemetry collected: no",
    `- Assets: ${report.summary.assetCount}`,
    `- Dependencies: ${report.summary.dependencyCount}`,
    `- Resolved dependencies: ${report.summary.resolvedDependencyCount}`,
    `- Unresolved dependencies: ${report.summary.unresolvedDependencyCount}`,
    `- Readiness: ${report.summary.readinessLevel} (${report.summary.readinessScore})`,
    `- Ownership coverage: ${report.readiness.summary.ownershipCoveragePercent}%`,
    `- Diagnostics: ${diagnostics.error} errors, ${diagnostics.warning} warnings, ${diagnostics.info} info`,
    "",
    "## Assets",
    "",
    hasStatusTransitionEvidence
      ? "| ID | Kind | Source | Hash | Owner | Status | Status reason | Status changed at | Dependencies |"
      : "| ID | Kind | Source | Hash | Owner | Status | Dependencies |",
    hasStatusTransitionEvidence
      ? "| --- | --- | --- | --- | --- | --- | --- | --- | ---: |"
      : "| --- | --- | --- | --- | --- | --- | ---: |",
  ];

  if (report.assets.length === 0) {
    lines.push(
      hasStatusTransitionEvidence
        ? "| (none) |  |  |  |  |  |  |  | 0 |"
        : "| (none) |  |  |  |  |  | 0 |",
    );
  } else {
    for (const asset of report.assets) {
      const prefix = `| ${escapeTableCell(asset.id)} | ${escapeTableCell(asset.kind)} | ${escapeTableCell(
        asset.sourcePath,
      )} | ${shortHash(asset.contentHash)} | ${escapeTableCell(
        bomAssetOwner(asset),
      )} | ${escapeTableCell(asset.status ?? "")} |`;
      lines.push(
        hasStatusTransitionEvidence
          ? `${prefix} ${escapeTableCell(asset.statusReason ?? "")} | ${escapeTableCell(asset.statusChangedAt ?? "")} | ${asset.dependencies.length} |`
          : `${prefix} ${asset.dependencies.length} |`,
      );
    }
  }

  lines.push("", "## Unresolved Dependencies", "");
  const unresolved = report.dependencies.filter(
    (dependency) => !dependency.resolved,
  );
  if (unresolved.length === 0) {
    lines.push("(none)");
  } else {
    lines.push(
      "| From | Kind | To | Source |",
      "| --- | --- | --- | --- |",
      ...unresolved.map(
        (dependency) =>
          `| ${escapeTableCell(dependency.from)} | ${escapeTableCell(
            dependency.kind,
          )} | ${escapeTableCell(
            dependency.to,
          )} | ${escapeTableCell(dependency.sourcePath)} |`,
      ),
    );
  }

  lines.push(
    "",
    "## Readiness Evidence",
    "",
    `- Level: ${report.readiness.level}`,
    `- Score: ${report.readiness.score}`,
    `- Workflow readiness: ${report.readiness.summary.workflow.readinessPercent}% (${report.readiness.summary.workflow.pass}/${report.readiness.summary.workflow.checks} checks passing)`,
    `- Graph resolution: ${report.readiness.summary.graphResolutionPercent}% (${report.readiness.summary.resolvedEdges}/${report.readiness.summary.edgeCount} dependencies resolved)`,
    `- Ownership coverage: ${report.readiness.summary.ownershipCoveragePercent}% (${report.readiness.summary.ownedAssets}/${report.readiness.summary.totalAssets} assets owned)`,
    "",
    "| Check | Status | Severity | Summary |",
    "| --- | --- | --- | --- |",
    ...report.readiness.checks.map(
      (check) =>
        `| ${escapeTableCell(check.id)} | ${escapeTableCell(
          check.status,
        )} | ${escapeTableCell(check.severity)} | ${escapeTableCell(check.summary)} |`,
    ),
    "",
    "## Security Posture",
    "",
    ...formatSecurityPostureMarkdown(report.securityPosture),
    "",
    "## Security Policy Inventory",
    "",
    ...formatSecurityPolicyInventoryMarkdown(report.securityPolicyInventory),
    "",
    "## Executable Surface Inventory",
    "",
    ...formatExecutableSurfaceInventoryMarkdown(
      report.executableSurfaceInventory,
    ),
    "",
    "## Diagnostics",
    "",
  );

  if (report.diagnostics.length === 0) {
    lines.push("(none)");
  } else {
    lines.push(
      ...report.diagnostics.map((diagnostic) => {
        const path = diagnostic.path ? `${diagnostic.path}: ` : "";
        return `- ${diagnostic.severity}: ${path}${singleLine(
          diagnostic.message,
        )}`;
      }),
    );
  }

  return `${lines.join("\n")}\n`;
}

function toBomAsset(asset: Asset, associations: BomAssociationIndex): BomAsset {
  const lifecycle = assetLifecycle(asset);
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    contentHash: asset.contentHash,
    sizeBytes: asset.sizeBytes,
    contentClassification: asset.contentClassification,
    markdownParserEligible: asset.markdownParserEligible,
    ownership: asset.ownership,
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    ...(asset.metadata.statusReason
      ? { statusReason: asset.metadata.statusReason }
      : {}),
    ...(asset.metadata.statusChangedAt
      ? { statusChangedAt: asset.metadata.statusChangedAt }
      : {}),
    ...(asset.metadata.version ? { version: asset.metadata.version } : {}),
    tags: [...asset.metadata.tags].sort((left, right) =>
      compareUtf16CodeUnits(left, right),
    ),
    ...(lifecycle ? { lifecycle } : {}),
    dependencies: (associations.dependenciesBySource.get(asset.id) ?? []).map(
      toAssetDependency,
    ),
    dependents: (associations.dependentsByTarget.get(asset.id) ?? []).map(
      toAssetDependent,
    ),
    diagnostics: [
      ...(associations.diagnosticsByPath.get(asset.sourcePath) ?? []),
    ],
  };
}

function formatOwnership(ownership: AssetOwnership): string {
  if (ownership.source === "unowned") return "(unowned)";
  const provenance =
    ownership.source === "inherited" && ownership.inheritedFrom
      ? ` from ${ownership.inheritedFrom.sourcePath}`
      : "";
  return `${ownership.effectiveOwner ?? "(unowned)"} (${ownership.source}${provenance})`;
}

function bomAssetOwner(asset: BomAsset): string {
  return formatOwnership(asset.ownership);
}

function assetLifecycle(asset: Asset): BomAssetLifecycle | undefined {
  const lifecycle: BomAssetLifecycle = {
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    ...(asset.metadata.statusReason
      ? { statusReason: asset.metadata.statusReason }
      : {}),
    ...(asset.metadata.statusChangedAt
      ? { statusChangedAt: asset.metadata.statusChangedAt }
      : {}),
    ...(asset.metadata.lastReviewedAt
      ? { lastReviewedAt: asset.metadata.lastReviewedAt }
      : {}),
    ...(asset.metadata.reviewCycle
      ? { reviewCycle: asset.metadata.reviewCycle }
      : {}),
    ...(asset.metadata.expiresAt
      ? { expiresAt: asset.metadata.expiresAt }
      : {}),
  };
  return Object.keys(lifecycle).length > 0 ? lifecycle : undefined;
}

function toBomDependency(edge: GraphEdge): BomDependency {
  if (
    edge.kind === "continues_with" ||
    edge.kind === "invokes" ||
    edge.kind === "contains"
  ) {
    throw new Error(
      "Repository Context BOM dependencies cannot include projection-only graph edges.",
    );
  }
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    sourcePath: edge.sourcePath,
    resolved: edge.resolved,
    ...(edge.targetId ? { targetId: edge.targetId } : {}),
    ...(edge.targetKind ? { targetKind: edge.targetKind } : {}),
    ...(edge.targetPath ? { targetPath: edge.targetPath } : {}),
  };
}

function toAssetDependency(dependency: BomDependency): BomAssetDependency {
  return {
    kind: dependency.kind,
    to: dependency.to,
    resolved: dependency.resolved,
    ...(dependency.targetId ? { targetId: dependency.targetId } : {}),
    ...(dependency.targetKind ? { targetKind: dependency.targetKind } : {}),
    ...(dependency.targetPath ? { targetPath: dependency.targetPath } : {}),
  };
}

function toAssetDependent(dependency: BomDependency): BomAssetDependent {
  return {
    kind: dependency.kind,
    from: dependency.from,
    sourcePath: dependency.sourcePath,
  };
}

function stableAssets(assets: Asset[]): Asset[] {
  return [...assets].sort(
    (left, right) =>
      compareUtf16CodeUnits(left.kind, right.kind) ||
      compareUtf16CodeUnits(left.sourcePath, right.sourcePath) ||
      compareUtf16CodeUnits(left.id, right.id),
  );
}

function stableEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...edges].sort(compareEdges);
}

function compareEdges(left: GraphEdge, right: GraphEdge): number {
  return (
    compareUtf16CodeUnits(left.from, right.from) ||
    compareUtf16CodeUnits(left.kind, right.kind) ||
    compareUtf16CodeUnits(left.to, right.to) ||
    compareUtf16CodeUnits(left.sourcePath, right.sourcePath)
  );
}

function stableDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareDiagnostics);
}

function buildBomAssociationIndex(
  dependencies: readonly BomDependency[],
  diagnostics: readonly Diagnostic[],
): BomAssociationIndex {
  const dependenciesBySource = new Map<string, BomDependency[]>();
  const dependentsByTarget = new Map<string, BomDependency[]>();
  const diagnosticsByPath = new Map<string, Diagnostic[]>();

  for (const dependency of dependencies) {
    addAssociation(dependenciesBySource, dependency.from, dependency);
    if (dependency.targetId) {
      addAssociation(dependentsByTarget, dependency.targetId, dependency);
    }
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.path) {
      addAssociation(diagnosticsByPath, diagnostic.path, diagnostic);
    }
  }

  return {
    dependenciesBySource,
    dependentsByTarget,
    diagnosticsByPath,
  };
}

function addAssociation<Value>(
  associations: Map<string, Value[]>,
  key: string,
  value: Value,
): void {
  const values = associations.get(key);
  if (values) {
    values.push(value);
  } else {
    associations.set(key, [value]);
  }
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const deduped: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(diagnostic);
  }
  return deduped;
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return stableStringify({
    severity: diagnostic.severity,
    code: diagnostic.code,
    path: diagnostic.path,
    message: diagnostic.message,
    evidence: diagnostic.evidence
      ? {
          path: diagnostic.evidence.path,
          startLine: diagnostic.evidence.startLine,
          endLine: diagnostic.evidence.endLine,
          snippet: diagnostic.evidence.snippet,
        }
      : undefined,
    details: diagnostic.details,
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareUtf16CodeUnits(left, right))
      .map(([key, item]) => [key, stableJsonValue(item)]),
  );
}

function countDiagnostics(
  diagnostics: Diagnostic[],
): BomReport["summary"]["diagnosticCounts"] {
  return {
    error: diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      .length,
    warning: diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length,
    info: diagnostics.filter((diagnostic) => diagnostic.severity === "info")
      .length,
  };
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    compareUtf16CodeUnits(left.path ?? "", right.path ?? "") ||
    diagnosticSeverityOrder(left.severity) -
      diagnosticSeverityOrder(right.severity) ||
    compareUtf16CodeUnits(left.message, right.message)
  );
}

function diagnosticSeverityOrder(severity: Diagnostic["severity"]): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function formatSecurityPostureMarkdown(
  securityPosture: SecurityPostureSummary,
): string[] {
  const lines = [
    "| Metric | Value |",
    "| --- | ---: |",
    `| Security findings | ${securityPosture.totalSecurityFindings} |`,
    `| Violations | ${securityPosture.riskClasses.violation} |`,
    `| Suspicious | ${securityPosture.riskClasses.suspicious} |`,
    `| Advisory | ${securityPosture.riskClasses.advisory} |`,
    `| Unclassified security findings | ${securityPosture.riskClasses.unclassified} |`,
    `| High/critical security findings | ${securityPosture.highOrCritical} |`,
  ];

  if (securityPosture.totalSecurityFindings === 0) {
    lines.push("", "No security findings were reported by readiness evidence.");
    return lines;
  }

  if (securityPosture.topFindingIds.length > 0) {
    lines.push(
      "",
      "### Top security findings",
      "",
      ...securityPosture.topFindingIds.map(
        (finding) =>
          `- ${finding.id}: ${finding.count} [${finding.riskClass ?? "unclassified"}, ${finding.maxSeverity}]`,
      ),
    );
  }

  return lines;
}

function formatSecurityPolicyInventoryMarkdown(
  inventory: SecurityPolicyInventorySummary,
): string[] {
  return [
    "| Metric | Value |",
    "| --- | ---: |",
    `| Policy assets | ${inventory.totalPolicyAssets} |`,
    `| Assets with local policy metadata | ${inventory.assetsWithLocalPolicyMetadata} |`,
    `| Assets with inherited policy | ${inventory.assetsWithInheritedPolicy} |`,
    `| Assets with effective policy | ${inventory.assetsWithEffectivePolicy} |`,
    `| Assets without effective policy | ${inventory.assetsWithoutEffectivePolicy} |`,
    `| Effective policy from local metadata | ${inventory.policySources.local} |`,
    `| Effective policy from security profiles | ${inventory.policySources.security_profile} |`,
    `| Effective policy from repository config | ${inventory.policySources.repository_config} |`,
    `| Effective policy from owning Skills | ${inventory.policySources.owning_skill} |`,
    `| Network allowed | ${inventory.networkAllowed.true} |`,
    `| Network denied | ${inventory.networkAllowed.false} |`,
    `| Network unspecified | ${inventory.networkAllowed.unspecified} |`,
    ...(inventory.externalUploadGovernance
      ? [
          `| Upload denied | ${inventory.externalUploadGovernance.denied} |`,
          `| Upload allowed; approval required | ${inventory.externalUploadGovernance.allowedApprovalRequired} |`,
          `| Upload allowed; approval not required | ${inventory.externalUploadGovernance.allowedNoApprovalRequired} |`,
          `| Upload allowed; approval requirement unspecified | ${inventory.externalUploadGovernance.allowedApprovalUnspecified} |`,
          `| Upload permission unspecified | ${inventory.externalUploadGovernance.unspecified} |`,
        ]
      : [
          `| Upload allowed | ${inventory.externalUploadAllowed.true} |`,
          `| Upload denied | ${inventory.externalUploadAllowed.false} |`,
          `| Upload unspecified | ${inventory.externalUploadAllowed.unspecified} |`,
        ]),
    `| Secrets allowed | ${inventory.secretsAllowed.true} |`,
    `| Secrets denied | ${inventory.secretsAllowed.false} |`,
    `| Secrets unspecified | ${inventory.secretsAllowed.unspecified} |`,
    `| Human approval required | ${inventory.humanApprovalRequired.true} |`,
    `| Referenced security profiles | ${inventory.securityProfiles.referenced} |`,
    `| Missing security profiles | ${inventory.securityProfiles.missing} |`,
    `| Cyclic security profiles | ${inventory.securityProfiles.cyclic} |`,
    `| Approved network destinations | ${inventory.approvedNetworkDestinationCount} |`,
    `| Approved upload destinations | ${inventory.approvedUploadDestinationCount} |`,
    `| Forbidden inputs | ${inventory.forbiddenInputCount} |`,
  ];
}

function formatExecutableSurfaceInventoryMarkdown(
  inventory: ExecutableSurfaceInventory,
): string[] {
  const summary = inventory.summary;
  const lines = [
    `- Schema: ${inventory.schema}`,
    `- Surfaces: ${summary.totalSurfaces}`,
    `- Scope: ${summary.skillLocalSurfaces} Skill-local, ${summary.repositoryToolSurfaces} repository tools, ${summary.noncanonicalSurfaces} non-canonical`,
    `- Skill-local reachability: ${summary.reachableSkillLocalSurfaces} reachable, ${summary.unreachableSkillLocalSurfaces} unreachable`,
    `- Referenced/invoked: ${summary.referencedSurfaces}/${summary.invokedSurfaces}`,
    `- Surface policy evidence: ${summary.surfacesWithEffectivePolicy} with, ${summary.surfacesWithoutEffectivePolicy} without`,
    `- Invocation-context policy evidence: ${summary.invocationsWithEffectivePolicyEvidence} with, ${summary.invocationsWithoutEffectivePolicyEvidence} without`,
    `- Invocations with multiple policy variants: ${summary.invocationsWithMultipleEffectivePolicyFingerprints}`,
    `- Invocations: ${summary.totalInvocations} total, ${summary.resolvedInvocations} resolved, ${summary.missingInvocations} missing, ${summary.unsafeInvocations} unsafe, ${summary.unscopedInvocations} unscoped, ${summary.noncanonicalInvocations} non-canonical, ${summary.unavailableInvocations} unavailable`,
    `- Dependencies: ${summary.totalDependencies} total; ${summary.dependencyAnalyzers.map(({ analyzer, count }) => `${analyzer} ${count}`).join(", ") || "no analyzer evidence"}`,
    `- Dependency resolutions: ${dependencyResolutionSummary(inventory)}`,
    `- Static invocation reachability: ${summary.directlyInvokedSurfaces} direct, ${summary.transitivelyReachableSurfaces} transitive, ${summary.unreachedFromInvocationSurfaces} unreached`,
    "",
    "| Path | Scope | Interpreters | Skill reachability | Static reachability | Dependencies in/out | Invocations | Surface policy | Invocation policy | Policy variants |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | ---: | ---: |",
  ];
  if (inventory.surfaces.length === 0) {
    lines.push("| (none) |  |  |  |  | 0/0 | 0 |  | 0/0 | 0 |");
  } else {
    for (const surface of inventory.surfaces) {
      const reachability =
        surface.scope !== "skill-local"
          ? "n/a"
          : surface.reachableFromOwningSkill
            ? `reachable (${surface.reachabilityDepth})`
            : "unreachable";
      const dependencyReachability =
        surface.dependencyEvidence.staticInvocationReachability === "unreached"
          ? "unreached"
          : `${surface.dependencyEvidence.staticInvocationReachability} (${surface.dependencyEvidence.minimumInvocationDependencyDepth})`;
      lines.push(
        `| ${escapeTableCell(surface.path)} | ${surface.scope} | ${escapeTableCell(surface.interpreterHints.join(", "))} | ${reachability} | ${dependencyReachability} | ${surface.dependencyEvidence.incomingResolvedDependencyCount}/${surface.dependencyEvidence.outgoingResolvedDependencyCount} | ${surface.invocationCount} | ${surface.securityPolicy.hasEffectivePolicy ? "yes" : "no"} | ${surface.invocationGovernance.invocationsWithEffectivePolicyEvidence}/${surface.invocationCount} | ${surface.invocationGovernance.distinctEffectivePolicyFingerprints.length} |`,
      );
    }
  }
  lines.push(
    "",
    "### Executable dependencies",
    "",
    "| Source | Analyzer | Relation | Target candidates | Resolution |",
    "| --- | --- | --- | --- | --- |",
  );
  if (inventory.dependencies.length === 0) {
    lines.push("| (none) |  |  |  |  |");
  } else {
    for (const dependency of inventory.dependencies) {
      const candidates = dependency.normalizedTargetCandidates.join(", ");
      const target =
        dependency.normalizedTarget ?? (candidates || dependency.rawSpecifier);
      lines.push(
        `| ${escapeTableCell(`${dependency.sourcePath}:L${dependency.line}`)} | ${dependency.analyzer} | ${dependency.relation} | ${escapeTableCell(target)} | ${dependency.resolution} |`,
      );
    }
  }
  return lines;
}

function dependencyResolutionSummary(
  inventory: ExecutableSurfaceInventory,
): string {
  const counts = new Map<string, number>();
  for (const dependency of inventory.dependencies) {
    counts.set(
      dependency.resolution,
      (counts.get(dependency.resolution) ?? 0) + 1,
    );
  }
  return (
    [...counts]
      .sort(
        ([leftName, leftCount], [rightName, rightCount]) =>
          rightCount - leftCount || compareUtf16CodeUnits(leftName, rightName),
      )
      .map(([resolution, count]) => `${resolution} ${count}`)
      .join(", ") || "none"
  );
}

function shortHash(hash: string): string {
  if (!hash.startsWith("sha256:")) return hash;
  return `sha256:${hash.slice("sha256:".length, "sha256:".length + 12)}`;
}

function escapeTableCell(value: string): string {
  return singleLine(value).replace(/\|/g, "\\|");
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
}
