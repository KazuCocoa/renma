import { catalog } from "./catalog.js";
import type { ConfigOverrides } from "../config.js";
import type {
  Asset,
  AssetKind,
  AssetStatus,
  Dependency,
  DependencyKind,
} from "../model.js";
import type { Diagnostic } from "../types.js";

export type GraphFormat = "json" | "markdown";

export interface GraphReport {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  nodeCount: number;
  edgeCount: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics?: Diagnostic[];
}

export interface GraphNode {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  owner?: string;
  status?: AssetStatus;
  tags: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: DependencyKind;
  sourcePath: string;
  resolved: boolean;
  targetId?: string;
  targetKind?: AssetKind;
  targetPath?: string;
}

export async function runGraphCommand(
  targetPath: string,
  options: { format: GraphFormat; overrides?: ConfigOverrides },
): Promise<number> {
  const report = await graph(targetPath, options.overrides ?? {});
  process.stdout.write(
    options.format === "json"
      ? formatGraphJson(report)
      : formatGraphMarkdown(report),
  );
  return report.diagnostics?.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
}

export async function graph(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<GraphReport> {
  const result = await catalog(targetPath, overrides);
  const nodes = stableAssets(result.catalog.assets).map(toNode);
  const edges = stableDependencies(result.catalog.dependencies).map(
    (dependency) => toEdge(dependency, result.catalog.assets),
  );

  return {
    root: result.root,
    ...(result.configPath ? { configPath: result.configPath } : {}),
    scannedFileCount: result.scannedFileCount,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    ...(result.diagnostics.length > 0
      ? { diagnostics: result.diagnostics }
      : {}),
  };
}

export function formatGraphJson(report: GraphReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatGraphMarkdown(report: GraphReport): string {
  const lines = [
    "# Renma Graph",
    "",
    `- Root: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    `- Scanned files: ${report.scannedFileCount}`,
    `- Nodes: ${report.nodeCount}`,
    `- Edges: ${report.edgeCount}`,
    "",
    "## Nodes",
    "",
    "| ID | Kind | Source | Owner | Status | Tags |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  if (report.nodes.length === 0) {
    lines.push("| (none) |  |  |  |  |  |");
  } else {
    for (const node of report.nodes) {
      lines.push(
        `| ${node.id} | ${node.kind} | ${node.sourcePath} | ${node.owner ?? ""} | ${node.status ?? ""} | ${node.tags.join(", ")} |`,
      );
    }
  }

  lines.push(
    "",
    "## Edges",
    "",
    "| From | Kind | To | Resolved | Target |",
    "| --- | --- | --- | --- | --- |",
  );

  if (report.edges.length === 0) {
    lines.push("| (none) |  |  |  |  |");
  } else {
    for (const edge of report.edges) {
      lines.push(
        `| ${edge.from} | ${edge.kind} | ${edge.to} | ${edge.resolved ? "yes" : "no"} | ${edgeTarget(edge)} |`,
      );
    }
  }

  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("", "## Diagnostics", "");
    for (const diagnostic of report.diagnostics) {
      const path = diagnostic.path ? `${diagnostic.path}: ` : "";
      lines.push(`- ${diagnostic.severity}: ${path}${diagnostic.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function toNode(asset: Asset): GraphNode {
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    ...(asset.metadata.owner ? { owner: asset.metadata.owner } : {}),
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    tags: asset.metadata.tags,
  };
}

function toEdge(dependency: Dependency, assets: Asset[]): GraphEdge {
  const target = resolveDependencyTarget(dependency, assets);
  return {
    from: dependency.from,
    to: dependency.to,
    kind: dependency.kind,
    sourcePath: dependency.sourcePath,
    resolved: target !== undefined,
    ...(target
      ? {
          targetId: target.id,
          targetKind: target.kind,
          targetPath: target.sourcePath,
        }
      : {}),
  };
}

function resolveDependencyTarget(
  dependency: Dependency,
  assets: Asset[],
): Asset | undefined {
  return assets.find(
    (asset) => asset.id === dependency.to || asset.sourcePath === dependency.to,
  );
}

function edgeTarget(edge: GraphEdge): string {
  if (!edge.resolved) return "";
  return [edge.targetId, edge.targetKind, edge.targetPath]
    .filter((value) => value !== undefined && value.length > 0)
    .join(" ");
}

function stableAssets(assets: Asset[]): Asset[] {
  return [...assets].sort((left, right) => {
    const byKind = left.kind.localeCompare(right.kind);
    if (byKind !== 0) return byKind;
    const byPath = left.sourcePath.localeCompare(right.sourcePath);
    if (byPath !== 0) return byPath;
    return left.id.localeCompare(right.id);
  });
}

function stableDependencies(dependencies: Dependency[]): Dependency[] {
  return [...dependencies].sort((left, right) => {
    const byFrom = left.from.localeCompare(right.from);
    if (byFrom !== 0) return byFrom;
    const byKind = left.kind.localeCompare(right.kind);
    if (byKind !== 0) return byKind;
    const byTo = left.to.localeCompare(right.to);
    if (byTo !== 0) return byTo;
    return left.sourcePath.localeCompare(right.sourcePath);
  });
}
