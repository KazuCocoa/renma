import packageJson from "../../package.json" with { type: "json" };
import { catalog } from "./catalog.js";
import { graph, type GraphEdge } from "./graph.js";
import {
  readiness,
  type ReadinessLevel,
  type ReadinessReport,
} from "./readiness.js";
import type { ConfigOverrides } from "../config.js";
import type {
  Asset,
  AssetKind,
  AssetStatus,
  DependencyKind,
} from "../model.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import type { SecurityPostureSummary } from "../security-posture.js";
import type { Diagnostic } from "../types.js";

export type BomFormat = "json" | "markdown";

export interface BomReport {
  schemaVersion: "renma.repository-context-bom.v1";
  generatedAt: string;
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
  owner?: string;
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
  options: { format: BomFormat; overrides?: ConfigOverrides },
): Promise<number> {
  const report = await bom(targetPath, options.overrides ?? {});
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
): Promise<BomReport> {
  const [catalogResult, graphReport, readinessReport] = await Promise.all([
    catalog(targetPath, overrides),
    graph(targetPath, overrides),
    readiness(targetPath, overrides),
  ]);
  const dependencies = stableEdges(graphReport.edges).map(toBomDependency);
  const diagnostics = stableDiagnostics(readinessReport.diagnostics ?? []);

  return {
    schemaVersion: "renma.repository-context-bom.v1",
    generatedAt: new Date().toISOString(),
    generator: {
      name: "renma",
      version: packageJson.version,
    },
    root: catalogResult.root,
    ...(catalogResult.configPath ? { configPath: catalogResult.configPath } : {}),
    scope: {
      type: "declared_repository_manifest",
      runtimeUsage: false,
      telemetryCollected: false,
    },
    summary: {
      scannedFileCount: catalogResult.scannedFileCount,
      assetCount: catalogResult.catalog.assets.length,
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
      diagnosticCounts: readinessReport.summary.diagnosticCounts,
    },
    assets: stableAssets(catalogResult.catalog.assets).map((asset) =>
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
    `- Generated at: ${report.generatedAt}`,
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
        `| ${escapeTableCell(asset.id)} | ${asset.kind} | ${asset.sourcePath} | ${shortHash(
          asset.contentHash,
        )} | ${escapeTableCell(asset.owner ?? "")} | ${asset.status ?? ""} | ${asset.dependencies.length} |`,
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
          `| ${escapeTableCell(dependency.from)} | ${dependency.kind} | ${escapeTableCell(
            dependency.to,
          )} | ${dependency.sourcePath} |`,
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
        `| ${check.id} | ${check.status} | ${check.severity} | ${escapeTableCell(
          check.summary,
        )} |`,
    ),
    "",
    "## Security Posture",
    "",
    ...formatSecurityPostureMarkdown(report.securityPosture),
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
    ...(asset.metadata.owner ? { owner: asset.metadata.owner } : {}),
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

function assetLifecycle(asset: Asset): BomAssetLifecycle | undefined {
  const lifecycle: BomAssetLifecycle = {
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    ...(asset.metadata.lastReviewedAt
      ? { lastReviewedAt: asset.metadata.lastReviewedAt }
      : {}),
    ...(asset.metadata.reviewCycle
      ? { reviewCycle: asset.metadata.reviewCycle }
      : {}),
    ...(asset.metadata.expiresAt ? { expiresAt: asset.metadata.expiresAt } : {}),
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
