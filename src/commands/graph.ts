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

export type GraphFormat = "json" | "markdown" | "mermaid";

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
  process.stdout.write(formatGraph(report, options.format));
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

export function formatGraphMermaid(report: GraphReport): string {
  const nodeIds = new Map<string, string>();
  const missingIds = new Map<string, string>();
  const lines = ["graph TD"];

  report.nodes.forEach((node, index) => {
    const id = `node_${index}`;
    nodeIds.set(node.id, id);
    lines.push(`  ${id}["${escapeMermaidLabel(nodeLabel(node))}"]`);
  });

  for (const edge of report.edges) {
    if (edge.resolved) continue;
    if (!missingIds.has(edge.to)) {
      const id = `missing_${missingIds.size}`;
      missingIds.set(edge.to, id);
      lines.push(`  ${id}["${escapeMermaidLabel(`missing: ${edge.to}`)}"]`);
    }
  }

  for (const edge of report.edges) {
    const source = nodeIds.get(edge.from);
    if (!source) continue;

    if (edge.resolved && edge.targetId) {
      const target = nodeIds.get(edge.targetId);
      if (target) {
        lines.push(
          `  ${source} -->|${escapeMermaidLabel(edge.kind)}| ${target}`,
        );
      }
      continue;
    }

    const missing = missingIds.get(edge.to);
    if (missing) {
      lines.push(
        `  ${source} -.->|${escapeMermaidLabel(`${edge.kind} unresolved`)}| ${missing}`,
      );
    }
  }

  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("  %% Diagnostics:");
    for (const diagnostic of report.diagnostics) {
      const path = diagnostic.path ? `${diagnostic.path}: ` : "";
      lines.push(
        `  %% ${singleLine(`${diagnostic.severity}: ${path}${diagnostic.message}`)}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
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

function formatGraph(report: GraphReport, format: GraphFormat): string {
  if (format === "json") return formatGraphJson(report);
  if (format === "mermaid") return formatGraphMermaid(report);
  return formatGraphMarkdown(report);
}

function nodeLabel(node: GraphNode): string {
  const status = node.status ? ` (${node.status})` : "";
  return `${node.kind}: ${node.id}${status}`;
}

function escapeMermaidLabel(label: string): string {
  return singleLine(label).replace(/"/g, '\\"');
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
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
  const target = normalizeReference(dependency.to);
  return assets.find(
    (asset) =>
      asset.id === dependency.to ||
      normalizeReference(asset.sourcePath) === target,
  );
}

function normalizeReference(reference: string): string {
  return reference.replace(/\\/g, "/").replace(/^\.\//, "");
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
