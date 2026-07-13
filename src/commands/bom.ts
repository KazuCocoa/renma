import packageJson from "../../package.json" with { type: "json" };
import { graphFromRepositorySnapshot, type GraphEdge } from "./graph.js";
import {
  buildReadinessReport,
  type ReadinessLevel,
  type ReadinessReport,
} from "./readiness.js";
import { scanFromRepositorySnapshot } from "../scanner.js";
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
  type RepositorySnapshot,
} from "../repository-evidence.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import type { SecurityPostureSummary } from "../security-posture.js";
import type { Diagnostic } from "../types.js";

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
  schemaVersion: "renma.repository-context-bom.v2";
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
    summary: ReadinessReport["summary"];
  };
  securityPosture: SecurityPostureSummary;
  securityPolicyInventory: SecurityPolicyInventorySummary;
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
  version?: string;
  tags: string[];
  lifecycle?: BomAssetLifecycle;
  dependencies: BomAssetDependency[];
  dependents: BomAssetDependent[];
  diagnostics: Diagnostic[];
}

export interface BomAssetLifecycle {
  status?: AssetStatus;
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
      ? {}
      : { evaluationDate: options.evaluationDate },
  );
  const readinessReport = buildReadinessReport(
    graphReport,
    scanResult.findings,
    scanResult.diagnostics,
    scanResult.contextLens,
    scanResult.securityPolicyInventory,
    scanResult.agentSkills,
  );
  const dependencies = stableEdges(graphReport.edges).map(toBomDependency);
  const diagnostics = stableDiagnostics(
    dedupeDiagnostics([
      ...snapshot.diagnostics,
      ...(graphReport.diagnostics ?? []),
      ...(readinessReport.diagnostics ?? []),
    ]),
  );
  const diagnosticCounts = countDiagnostics(diagnostics);
  const omitGeneratedAt = options.omitGeneratedAt === true;

  return {
    schemaVersion: "renma.repository-context-bom.v2",
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
      toBomAsset(asset, dependencies, diagnostics),
    ),
    dependencies,
    readiness: {
      score: readinessReport.score,
      level: readinessReport.level,
      checks: readinessReport.checks,
      summary: readinessReport.summary,
    },
    securityPosture: readinessReport.summary.securityPosture,
    securityPolicyInventory: readinessReport.summary.securityPolicyInventory,
    diagnostics,
  };
}

function generatedAtIso(options: BomBuildOptions): string {
  if (options.generatedAt instanceof Date)
    return options.generatedAt.toISOString();
  if (typeof options.generatedAt === "string") return options.generatedAt;
  return new Date().toISOString();
}

export function formatBomJson(report: BomReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatBomMarkdown(report: BomReport): string {
  const diagnostics = report.summary.diagnosticCounts;
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
    "| ID | Kind | Source | Hash | Owner | Status | Dependencies |",
    "| --- | --- | --- | --- | --- | --- | ---: |",
  ];

  if (report.assets.length === 0) {
    lines.push("| (none) |  |  |  |  |  | 0 |");
  } else {
    for (const asset of report.assets) {
      lines.push(
        `| ${escapeTableCell(asset.id)} | ${escapeTableCell(asset.kind)} | ${escapeTableCell(
          asset.sourcePath,
        )} | ${shortHash(asset.contentHash)} | ${escapeTableCell(
          bomAssetOwner(asset),
        )} | ${escapeTableCell(asset.status ?? "")} | ${asset.dependencies.length} |`,
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

function toBomAsset(
  asset: Asset,
  dependencies: BomDependency[],
  diagnostics: Diagnostic[],
): BomAsset {
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
    ...(asset.metadata.version ? { version: asset.metadata.version } : {}),
    tags: [...asset.metadata.tags].sort((left, right) =>
      left.localeCompare(right),
    ),
    ...(lifecycle ? { lifecycle } : {}),
    dependencies: dependencies
      .filter((dependency) => dependency.from === asset.id)
      .map(toAssetDependency),
    dependents: dependencies
      .filter((dependency) => dependency.targetId === asset.id)
      .map(toAssetDependent),
    diagnostics: diagnosticsForPath(diagnostics, asset.sourcePath),
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
      left.kind.localeCompare(right.kind) ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.id.localeCompare(right.id),
  );
}

function stableEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...edges].sort(compareEdges);
}

function compareEdges(left: GraphEdge, right: GraphEdge): number {
  return (
    left.from.localeCompare(right.from) ||
    left.kind.localeCompare(right.kind) ||
    left.to.localeCompare(right.to) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

function stableDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareDiagnostics);
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
      .sort(([left], [right]) => left.localeCompare(right))
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

function diagnosticsForPath(
  diagnostics: Diagnostic[],
  sourcePath: string,
): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.path === sourcePath);
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    (left.path ?? "").localeCompare(right.path ?? "") ||
    diagnosticSeverityOrder(left.severity) -
      diagnosticSeverityOrder(right.severity) ||
    left.message.localeCompare(right.message)
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
    `| Network allowed | ${inventory.networkAllowed.true} |`,
    `| Network denied | ${inventory.networkAllowed.false} |`,
    `| Network unspecified | ${inventory.networkAllowed.unspecified} |`,
    `| Upload allowed | ${inventory.externalUploadAllowed.true} |`,
    `| Upload denied | ${inventory.externalUploadAllowed.false} |`,
    `| Upload unspecified | ${inventory.externalUploadAllowed.unspecified} |`,
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
