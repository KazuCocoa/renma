import path from "node:path";

import type { ConfigOverrides } from "../config.js";
import type {
  Asset,
  AssetKind,
  AssetStatus,
  Dependency,
  DependencyKind,
} from "../model.js";
import {
  collectRepositoryEvidence,
  type RepositoryEvidence,
  type RepositorySnapshot,
} from "../repository-evidence.js";
import type { Diagnostic } from "../types.js";

export type GraphFormat = "json" | "markdown" | "mermaid";
export type GraphView = "summary" | "workflow" | "full" | "layered";

export interface GraphReport {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  view: GraphView;
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
  groupedCount?: number;
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
  options: {
    format: GraphFormat;
    view?: GraphView;
    focus?: string;
    overrides?: ConfigOverrides;
  },
): Promise<number> {
  const report = focusGraph(
    await graph(targetPath, options.overrides ?? {}),
    options.focus,
  );
  const view = options.view ?? defaultGraphView(options.format);
  process.stdout.write(formatGraph(report, options.format, view));
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
  return graphFromRepositoryEvidence(
    await collectRepositoryEvidence(targetPath, overrides),
  );
}

export function graphFromRepositoryEvidence(
  evidence: RepositoryEvidence,
): GraphReport {
  const nodes = stableAssets(evidence.catalog.assets).map(toNode);
  const edges = stableDependencies(evidence.catalog.dependencies).map(
    (dependency) => toEdge(dependency, evidence.catalog.assets),
  );

  return {
    root: evidence.root,
    ...(evidence.configPath ? { configPath: evidence.configPath } : {}),
    scannedFileCount: evidence.scannedFileCount,
    view: "full",
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    ...(evidence.diagnostics.length > 0
      ? { diagnostics: evidence.diagnostics }
      : {}),
  };
}

export function graphFromRepositorySnapshot(
  snapshot: RepositorySnapshot,
): GraphReport {
  return graphFromRepositoryEvidence(snapshot);
}

export function formatGraphJson(report: GraphReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function focusGraph(report: GraphReport, focus?: string): GraphReport {
  if (!focus) {
    return report;
  }

  const node = report.nodes.find((candidate) =>
    matchesFocus(candidate, report.root, focus),
  );
  if (!node) {
    throw new Error(
      `graph --focus did not match any asset id or source path: ${focus}`,
    );
  }

  const edges = report.edges.filter(
    (edge) =>
      edge.from === node.id || edge.to === node.id || edge.targetId === node.id,
  );
  const nodeIds = new Set<string>([node.id]);
  for (const edge of edges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.targetId ?? edge.to);
  }
  const nodes = report.nodes.filter((candidate) => nodeIds.has(candidate.id));

  return {
    ...report,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
  };
}

function matchesFocus(node: GraphNode, root: string, focus: string): boolean {
  const normalizedFocus = normalizePath(focus);
  return (
    node.id === focus ||
    normalizePath(node.sourcePath) === normalizedFocus ||
    normalizePath(path.resolve(root, node.sourcePath)) === normalizedFocus
  );
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

export function formatGraphMermaid(
  report: GraphReport,
  view: GraphView = "summary",
): string {
  report = graphViewReport(report, view);
  if (view === "layered") return formatLayeredGraphMermaid(report);

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

function formatLayeredGraphMermaid(report: GraphReport): string {
  const nodeIds = new Map<string, string>();
  const missingIds = new Map<string, string>();
  const nodesById = new Map(report.nodes.map((node) => [node.id, node]));
  const lines = ["graph TD"];

  report.nodes.forEach((node, index) => {
    nodeIds.set(node.id, `node_${index}`);
  });

  for (const edge of report.edges) {
    if (edge.resolved) continue;
    if (!missingIds.has(edge.to)) {
      missingIds.set(edge.to, `missing_${missingIds.size}`);
    }
  }

  for (const layer of graphLayers) {
    const nodes = report.nodes.filter((node) => nodeLayerId(node) === layer.id);
    const missing = layer.id === "Unresolved" ? [...missingIds.entries()] : [];
    if (nodes.length === 0 && missing.length === 0) continue;

    lines.push(`  subgraph ${layer.id}["${layer.label}"]`);
    for (const node of nodes) {
      lines.push(
        `    ${nodeIds.get(node.id)}["${escapeMermaidLabel(layeredNodeLabel(node))}"]`,
      );
    }
    for (const [target, id] of missing) {
      lines.push(`    ${id}["${escapeMermaidLabel(`missing: ${target}`)}"]`);
    }
    lines.push("  end");
  }

  for (const edge of report.edges) {
    const source = nodeIds.get(edge.from);
    if (!source) continue;

    if (edge.resolved && edge.targetId) {
      const target = nodeIds.get(edge.targetId);
      if (target) {
        lines.push(
          `  ${source} -->|${escapeMermaidLabel(layeredEdgeLabel(edge, nodesById))}| ${target}`,
        );
      }
      continue;
    }

    const missing = missingIds.get(edge.to);
    if (missing) {
      lines.push(
        `  ${source} -.->|${escapeMermaidLabel(`${layeredEdgeLabel(edge, nodesById)} unresolved`)}| ${missing}`,
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

export function formatGraphMarkdown(
  report: GraphReport,
  view: GraphView = "summary",
): string {
  report = graphViewReport(report, view);
  const lines = [
    "# Renma Graph",
    "",
    `- Root: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    `- View: ${report.view}`,
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

function formatGraph(
  report: GraphReport,
  format: GraphFormat,
  view: GraphView = defaultGraphView(format),
): string {
  if (format === "json") return formatGraphJson(graphViewReport(report, view));
  if (format === "mermaid") return formatGraphMermaid(report, view);
  return formatGraphMarkdown(report, view);
}

function nodeLabel(node: GraphNode): string {
  if (node.groupedCount !== undefined) {
    return `${node.id} (${node.groupedCount})`;
  }
  const status = node.status ? ` (${node.status})` : "";
  return `${node.kind}: ${node.id}${status}`;
}

function defaultGraphView(format: GraphFormat): GraphView {
  return format === "json" ? "full" : "summary";
}

function graphViewReport(report: GraphReport, view: GraphView): GraphReport {
  if (report.view === view) return report;
  if (view === "full" || view === "layered") return { ...report, view };

  const nodeMap = new Map<string, GraphNode>();
  const groupMembers = new Map<string, Set<string>>();
  const nodeProjection = new Map<string, string>();

  for (const node of report.nodes) {
    const projection = projectedNode(node, view);
    nodeProjection.set(node.id, projection.id);
    nodeProjection.set(node.sourcePath, projection.id);
    if (!nodeMap.has(projection.id)) {
      nodeMap.set(projection.id, projection);
      if (projection.groupedCount !== undefined) {
        groupMembers.set(projection.id, new Set());
      }
    }
    if (projection.groupedCount !== undefined) {
      groupMembers.get(projection.id)?.add(node.id);
    }
  }

  for (const [id, members] of groupMembers) {
    const node = nodeMap.get(id);
    if (node) node.groupedCount = members.size;
  }

  const edgeMap = new Map<string, GraphEdge>();
  for (const edge of report.edges) {
    const from = nodeProjection.get(edge.from) ?? edge.from;
    const targetId = edge.targetId
      ? (nodeProjection.get(edge.targetId) ?? edge.targetId)
      : undefined;
    const targetPath = edge.targetPath
      ? (nodeProjection.get(edge.targetPath) ?? edge.targetPath)
      : undefined;
    const to = edge.resolved
      ? (targetId ?? edge.to)
      : unresolvedGroupId(edge.to, view);

    if (!edge.resolved && !nodeMap.has(to)) {
      nodeMap.set(to, {
        id: to,
        kind: "context",
        sourcePath: to,
        tags: [],
        groupedCount: 1,
      });
    }

    if (from === to) continue;
    const key = `${from}\0${edge.kind}\0${to}\0${edge.resolved ? "1" : "0"}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        from,
        to,
        kind: edge.kind,
        sourcePath: edge.sourcePath,
        resolved: edge.resolved,
        ...(targetId ? { targetId } : {}),
        ...(edge.targetKind ? { targetKind: edge.targetKind } : {}),
        ...(targetPath ? { targetPath } : {}),
      });
    }
  }

  const nodes = [...nodeMap.values()].sort(compareGraphNodes);
  const edges = [...edgeMap.values()].sort(compareGraphEdges);
  return {
    ...report,
    view,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
  };
}

function projectedNode(node: GraphNode, view: GraphView): GraphNode {
  if (view === "workflow" && keepWorkflowNode(node.sourcePath)) return node;
  const groupId = groupPath(node.sourcePath, view);
  if (!groupId) return node;
  return {
    id: groupId,
    kind: node.kind,
    sourcePath: groupId,
    tags: [],
    groupedCount: 0,
  };
}

const graphLayers = [
  { id: "Skills", label: "Skills" },
  { id: "Context_Lenses", label: "Context Lenses" },
  { id: "Contexts", label: "Contexts" },
  { id: "Support_Assets", label: "Support Assets" },
  { id: "Unresolved", label: "Unresolved" },
] as const;

type GraphLayerId = (typeof graphLayers)[number]["id"];

function nodeLayerId(node: GraphNode): GraphLayerId {
  if (node.kind === "skill") return "Skills";
  if (node.kind === "context_lens") return "Context_Lenses";
  if (node.kind === "context") return "Contexts";
  return "Support_Assets";
}

function layeredNodeLabel(node: GraphNode): string {
  const kind =
    node.kind === "context_lens"
      ? "lens"
      : node.kind === "context"
        ? "context"
        : node.kind;
  const status = node.status ? ` (${node.status})` : "";
  return `${kind}: ${node.id}${status}`;
}

function layeredEdgeLabel(
  edge: GraphEdge,
  nodesById: Map<string, GraphNode>,
): string {
  const sourceKind = nodesById.get(edge.from)?.kind;
  if (sourceKind !== "skill") return edge.kind;

  if (edge.kind === "requires") {
    if (edgeTargetsKind(edge, nodesById, "context_lens")) {
      return "requires_lens";
    }
    if (edgeTargetsKind(edge, nodesById, "context")) {
      return "requires_context";
    }
  }

  if (edge.kind === "optional") {
    if (edgeTargetsKind(edge, nodesById, "context_lens")) {
      return "optional_lens";
    }
    if (edgeTargetsKind(edge, nodesById, "context")) {
      return "optional_context";
    }
  }

  return edge.kind;
}

function edgeTargetsKind(
  edge: GraphEdge,
  nodesById: Map<string, GraphNode>,
  kind: AssetKind,
): boolean {
  const targetKind =
    edge.targetKind ??
    (edge.targetId ? nodesById.get(edge.targetId)?.kind : undefined);
  if (targetKind === kind) return true;

  const target = normalizeReference(edge.to);
  if (kind === "context_lens") {
    return target.startsWith("lens.") || target.startsWith("lenses/");
  }
  if (kind === "context") {
    return target.startsWith("context/") || target.startsWith("contexts/");
  }
  return false;
}

function groupPath(sourcePath: string, view: GraphView): string | undefined {
  const path = normalizeReference(sourcePath);
  const parts = path.split("/");
  const supportIndex = parts.findIndex((part) =>
    ["references", "profiles", "examples", "scripts"].includes(part),
  );
  if (supportIndex >= 0) {
    return `${parts.slice(0, supportIndex + 1).join("/")}/*`;
  }
  if (view === "summary" && parts[0] === "contexts" && parts.length > 2) {
    return `${parts.slice(0, -1).join("/")}/*`;
  }
  if (view === "summary" && parts[0] === "tools" && parts.length > 2) {
    return `${parts.slice(0, -1).join("/")}/*`;
  }
  return undefined;
}

function keepWorkflowNode(sourcePath: string): boolean {
  const path = normalizeReference(sourcePath);
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) return true;
  if (!path.startsWith("contexts/")) return false;
  const name = path.split("/").at(-1) ?? "";
  return (
    name === "routing.md" ||
    name === "triage.md" ||
    name === "index.md" ||
    name === "README.md" ||
    /-environment\.md$/.test(name) ||
    /-readiness\.md$/.test(name) ||
    directWorkflowContext(path, name)
  );
}

function directWorkflowContext(path: string, fileName: string): boolean {
  if (!fileName.endsWith(".md")) return false;
  const stem = fileName.slice(0, -3);
  return path.split("/").slice(1, -1).includes(stem);
}

function unresolvedGroupId(reference: string, view: GraphView): string {
  return groupPath(reference, view) ?? `unresolved/${reference}`;
}

function compareGraphNodes(a: GraphNode, b: GraphNode): number {
  return a.sourcePath.localeCompare(b.sourcePath) || a.id.localeCompare(b.id);
}

function compareGraphEdges(a: GraphEdge, b: GraphEdge): number {
  return (
    a.from.localeCompare(b.from) ||
    a.kind.localeCompare(b.kind) ||
    a.to.localeCompare(b.to)
  );
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
