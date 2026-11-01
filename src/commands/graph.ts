import path from "node:path";

import {
  focusedProvenanceTarget,
  type GraphView,
  type GraphReport,
  type GraphNode,
  type GraphEdge,
} from "../graph-report.js";
import {
  bindingLabel,
  formatOwnership,
  tableText,
  escapeMermaidLabel,
  escapeMermaidEdgeLabel,
  singleLine,
} from "../renderers/graph-format.js";
import {
  formatDiscoveryMarkdown,
  formatDiscoveryMermaid,
} from "../renderers/graph-discovery.js";
import {
  formatCompositionMarkdown,
  formatCompositionMermaid,
} from "../renderers/graph-composition.js";
import {
  formatImpactMarkdown,
  formatImpactMermaid,
} from "../renderers/graph-impact.js";

import { compareUtf16CodeUnits } from "../canonical-json.js";

import { CliUserError } from "../cli-errors.js";
import type { ConfigOverrides } from "../config.js";
import {
  prepareDeclaredCompositionIndex,
  resolveDeclaredCompositionFromIndex,
  resolveCompositionDeclaration,
  type DeclaredCompositionReport,
} from "../declared-composition.js";
import {
  prepareDeclaredImpactIndex,
  resolveDeclaredImpactFromIndex,
  type DeclaredImpactReport,
} from "../declared-impact.js";
import {
  normalizeDependencyReference,
  prepareDependencyTargetResolver,
  resolveUniqueDependencyTarget,
} from "../dependency-resolution.js";

import type { Asset, AssetKind, Dependency, Catalog } from "../model.js";

import { formatVersionedJsonDocument } from "../report.js";
import { classifyRepositorySkillEntrypointPath } from "../discovery.js";
import {
  collectRepositorySnapshot,
  prepareRepositorySnapshotProjections,
  repositoryDiagnosticsWithoutSkillDiscovery,
  type RepositoryEvidence,
  type RepositorySnapshot,
} from "../repository-evidence.js";
import type { AssetOwnership } from "../types/governance.js";
import {
  focusSkillDiscoveryIndex,
  type SkillDiscoveryIndex,
} from "../skill-discovery.js";

import {
  executableGraphReport,
  formatExecutableGraphMarkdown,
  formatExecutableGraphMermaid,
} from "./executable-graph.js";

export type GraphFormat = "json" | "markdown" | "mermaid";
export const GRAPH_JSON_SCHEMA_VERSION = "renma.graph.v1" as const;

export async function runGraphCommand(
  targetPath: string,
  options: {
    format: GraphFormat;
    view?: GraphView;
    focus?: string;
    overrides?: ConfigOverrides;
  },
): Promise<number> {
  const view = options.view ?? defaultGraphView(options.format);
  const snapshot = await collectRepositorySnapshot(
    targetPath,
    options.overrides ?? {},
  );
  const fullReport = graphFromRepositorySnapshot(snapshot);
  let report: GraphReport;
  if (view === "executable") {
    report = executableGraphReport(
      fullReport,
      snapshot.executableSurfaceInventory,
      snapshot.skillParents,
      options.focus,
    );
  } else if (view === "discovery") {
    const discovery = options.focus
      ? focusSkillDiscoveryIndex(snapshot.skillDiscovery, options.focus)
      : snapshot.skillDiscovery;
    report = discoveryGraphReport(fullReport, discovery);
  } else if (view === "dependencies" || view === "asset-impact") {
    if (!options.focus) {
      throw new CliUserError(
        `graph --view ${view} requires --focus <asset-id-or-path>.`,
      );
    }
    report = staticDependencyGraphReport(
      fullReport,
      snapshot.catalog,
      options.focus,
      view,
    );
  } else if (view === "composition" || view === "impact") {
    if (!options.focus) {
      throw new CliUserError(
        `graph --view ${view} requires --focus <asset-id-or-path>.`,
      );
    }
    const focusNode = resolveFocusNode(fullReport, options.focus);
    if (view === "composition") {
      const index = prepareDeclaredCompositionIndex(snapshot.catalog);
      const composition = resolveDeclaredCompositionFromIndex(
        index,
        focusNode.sourcePath,
      );
      report = compositionGraphReport(fullReport, composition);
    } else {
      const index = prepareDeclaredImpactIndex(snapshot.catalog);
      const impact = resolveDeclaredImpactFromIndex(
        index,
        focusNode.sourcePath,
      );
      report = impactGraphReport(fullReport, impact);
    }
  } else {
    report = focusGraph(fullReport, options.focus);
  }
  process.stdout.write(formatGraph(report, options.format, view));
  return [
    ...(report.diagnostics ?? []),
    ...(report.discovery?.diagnostics ?? []),
  ].some((diagnostic) => diagnostic.severity === "error")
    ? 1
    : 0;
}

export async function graph(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<GraphReport> {
  return graphFromRepositorySnapshot(
    await collectRepositorySnapshot(targetPath, overrides),
  );
}

export function graphFromRepositoryEvidence(
  evidence: RepositoryEvidence,
): GraphReport {
  const nodes = stableAssets(evidence.catalog.assets).map(toNode);
  const resolveTarget = prepareDependencyTargetResolver(
    evidence.catalog.assets,
  );
  const edges = stableDependencies(evidence.catalog.dependencies).map(
    (dependency) => toEdge(dependency, resolveTarget(dependency)),
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
  prepareRepositorySnapshotProjections(snapshot, ["catalog", "context-lens"]);
  return graphFromRepositoryEvidence({
    root: snapshot.root,
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    scannedFileCount: snapshot.scannedFileCount,
    catalog: snapshot.catalog,
    contextLens: snapshot.contextLens,
    diagnostics: repositoryDiagnosticsWithoutSkillDiscovery(snapshot),
  });
}

function formatGraphJson(report: GraphReport): string {
  return formatVersionedJsonDocument(GRAPH_JSON_SCHEMA_VERSION, report);
}

function focusGraph(report: GraphReport, focus?: string): GraphReport {
  if (!focus) {
    return report;
  }

  const node = resolveFocusNode(report, focus);

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

function resolveFocusNode(report: GraphReport, focus: string): GraphNode {
  const node = report.nodes.find((candidate) =>
    matchesFocus(candidate, report.root, focus),
  );
  if (!node) {
    throw new CliUserError(
      `graph --focus did not match any asset id or source path: ${focus}`,
    );
  }
  return node;
}

/** Traverse composition plus exact support references, excluding containment and governance. */
function staticDependencyGraphReport(
  report: GraphReport,
  catalog: Catalog,
  focus: string,
  view: "dependencies" | "asset-impact",
): GraphReport {
  const pathMatches = report.nodes.filter(
    (node) =>
      normalizePath(node.sourcePath) === normalizePath(focus) ||
      normalizePath(path.resolve(report.root, node.sourcePath)) ===
        normalizePath(focus),
  );
  const focusMatches = pathMatches.length
    ? pathMatches
    : report.nodes.filter((node) => node.id === focus);
  if (focusMatches.length !== 1) {
    if (focusMatches.length === 0) resolveFocusNode(report, focus);
    throw new CliUserError(
      `graph --focus is ambiguous; use an exact source path: ${focus}`,
    );
  }
  const focusNode = focusMatches[0]!;
  const index = prepareDeclaredCompositionIndex(catalog);
  const arcs = catalog.dependencies.flatMap((dependency) => {
    const source = index.assetsByPath.get(
      normalizeDependencyReference(dependency.sourcePath),
    );
    if (!source || source.id !== dependency.from) return [];
    let target: Asset | undefined;
    if (dependency.kind === "statically_references") {
      target = resolveUniqueDependencyTarget(dependency, catalog.assets);
    } else if (
      ["requires", "optional", "applies_to"].includes(dependency.kind)
    ) {
      const declaration = resolveCompositionDeclaration(index, dependency);
      if (declaration?.kindMismatch) return [];
      target = declaration?.target;
    } else {
      return [];
    }
    return [{ source, target, edge: toEdge(dependency, target) }];
  });
  const adjacency = new Map<string, typeof arcs>();
  for (const arc of arcs) {
    const key =
      view === "dependencies" ? arc.source.sourcePath : arc.target?.sourcePath;
    if (!key) continue;
    const adjacent = adjacency.get(key) ?? [];
    adjacent.push(arc);
    adjacency.set(key, adjacent);
  }
  const paths = new Set([focusNode.sourcePath]);
  const queue = [focusNode.sourcePath];
  const edges: GraphEdge[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const arc of adjacency.get(queue[cursor]!) ?? []) {
      edges.push(arc.edge);
      const next =
        view === "dependencies"
          ? arc.target?.sourcePath
          : arc.source.sourcePath;
      if (next && !paths.has(next)) {
        paths.add(next);
        queue.push(next);
      }
    }
  }
  const nodes = report.nodes.filter((node) => paths.has(node.sourcePath));
  return {
    ...report,
    view,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges: edges.sort(
      (left, right) =>
        compareUtf16CodeUnits(left.sourcePath, right.sourcePath) ||
        compareUtf16CodeUnits(left.kind, right.kind) ||
        compareUtf16CodeUnits(left.to, right.to) ||
        (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
        (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1),
    ),
    dependencyTraversal: {
      focusPath: focusNode.sourcePath,
      direction: view === "dependencies" ? "forward" : "reverse",
    },
  };
}

function discoveryGraphReport(
  report: GraphReport,
  discovery: SkillDiscoveryIndex,
): GraphReport {
  const visiblePaths = new Set(
    discovery.skills.map((skill) => skill.sourcePath),
  );
  const nodes = report.nodes.filter((node) =>
    visiblePaths.has(node.sourcePath),
  );
  // Only authoritative usable representatives become graph edges. Every
  // declaration, including unresolved evidence, remains in discovery.routes.
  const edges = discovery.routes
    .filter(
      (route) =>
        route.usable &&
        route.representative &&
        route.resolvedTarget?.kind === "skill",
    )
    .map((route): GraphEdge => ({
      from: route.sourceId,
      to: route.normalizedTarget,
      kind: "continues_with",
      declaration: "metadata.renma.continues-with",
      declarationIndex: route.declarationIndex,
      sourcePath: route.sourcePath,
      evidence: route.evidence,
      resolved: true,
      targetId: route.resolvedTarget!.id,
      targetKind: "skill",
      targetPath: route.resolvedTarget!.sourcePath,
    }));
  return {
    ...report,
    view: "discovery",
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    discovery,
  };
}

function compositionGraphReport(
  report: GraphReport,
  composition: DeclaredCompositionReport,
): GraphReport {
  const nodeIds = new Set([
    composition.root.sourcePath,
    ...composition.requiredAssets.map((asset) => asset.sourcePath),
    ...composition.optionalAssets.map((asset) => asset.sourcePath),
  ]);
  const nodes = report.nodes.filter((node) => nodeIds.has(node.sourcePath));
  const edges = composition.provenanceEdges.map((edge): GraphEdge => {
    const target = focusedProvenanceTarget(edge, nodes);
    return {
      ...(edge.bindings ? { bindings: edge.bindings } : {}),
      ...(edge.bindingDiagnostics
        ? { bindingDiagnostics: edge.bindingDiagnostics }
        : {}),
      from: edge.from,
      to: edge.declaredTarget,
      kind: edge.kind,
      declaration: edge.relationship,
      ...(edge.declarationIndex !== undefined
        ? { declarationIndex: edge.declarationIndex }
        : {}),
      sourcePath: edge.sourcePath,
      ...(edge.evidence ? { evidence: edge.evidence } : {}),
      membership: edge.membership,
      resolved: true,
      targetId: edge.to,
      ...(target
        ? { targetKind: target.kind, targetPath: target.sourcePath }
        : {}),
    };
  });
  return {
    ...report,
    view: "composition",
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    composition,
  };
}

function impactGraphReport(
  report: GraphReport,
  impact: DeclaredImpactReport,
): GraphReport {
  const nodeIds = new Set([
    impact.focus.sourcePath,
    ...impact.requiredDependents.map((asset) => asset.sourcePath),
    ...impact.optionalDependents.map((asset) => asset.sourcePath),
  ]);
  const nodes = report.nodes.filter((node) => nodeIds.has(node.sourcePath));
  const edges = impact.provenanceEdges.map((edge): GraphEdge => {
    const target = focusedProvenanceTarget(edge, nodes);
    return {
      ...(edge.bindings ? { bindings: edge.bindings } : {}),
      ...(edge.bindingDiagnostics
        ? { bindingDiagnostics: edge.bindingDiagnostics }
        : {}),
      from: edge.from,
      to: edge.declaredTarget,
      kind: edge.kind,
      declaration: edge.relationship,
      ...(edge.declarationIndex !== undefined
        ? { declarationIndex: edge.declarationIndex }
        : {}),
      sourcePath: edge.sourcePath,
      ...(edge.evidence ? { evidence: edge.evidence } : {}),
      dependentMembership: edge.dependentMembership,
      resolved: true,
      targetId: edge.to,
      ...(target
        ? { targetKind: target.kind, targetPath: target.sourcePath }
        : {}),
    };
  });
  return {
    ...report,
    view: "impact",
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    impact,
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
  if (view === "executable") return formatExecutableGraphMermaid(report);
  if (view === "discovery") return formatDiscoveryMermaid(report);
  if (view === "composition") return formatCompositionMermaid(report);
  if (view === "impact") return formatImpactMermaid(report);
  report = graphViewReport(report, view);
  if (view === "layered") return formatLayeredGraphMermaid(report);

  const nodeIds = new Map<string, string>();
  const nodeIdsByPath = new Map<string, string>();
  const missingIds = new Map<string, string>();
  const lines = ["graph TD"];

  report.nodes.forEach((node, index) => {
    const id = `node_${index}`;
    nodeIds.set(node.id, id);
    nodeIdsByPath.set(node.sourcePath, id);
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
    const source = nodeIdsByPath.get(edge.sourcePath) ?? nodeIds.get(edge.from);
    if (!source) continue;

    if (edge.resolved && edge.targetId) {
      const target =
        (edge.targetPath ? nodeIdsByPath.get(edge.targetPath) : undefined) ??
        nodeIds.get(edge.targetId);
      if (target) {
        lines.push(
          `  ${source} -->|${escapeMermaidEdgeLabel(edge.kind + bindingLabel(edge))}| ${target}`,
        );
      }
      continue;
    }

    const missing = missingIds.get(edge.to);
    if (missing) {
      lines.push(
        `  ${source} -.->|${escapeMermaidEdgeLabel(`${edge.kind} unresolved${bindingLabel(edge)}`)}| ${missing}`,
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
          `  ${source} -->|${escapeMermaidEdgeLabel(layeredEdgeLabel(edge, nodesById) + bindingLabel(edge))}| ${target}`,
        );
      }
      continue;
    }

    const missing = missingIds.get(edge.to);
    if (missing) {
      lines.push(
        `  ${source} -.->|${escapeMermaidEdgeLabel(`${layeredEdgeLabel(edge, nodesById)} unresolved${bindingLabel(edge)}`)}| ${missing}`,
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
  if (view === "executable") return formatExecutableGraphMarkdown(report);
  if (view === "discovery") return formatDiscoveryMarkdown(report);
  if (view === "composition") return formatCompositionMarkdown(report);
  if (view === "impact") return formatImpactMarkdown(report);
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
    ...(report.dependencyTraversal
      ? [
          `- Static ${report.dependencyTraversal.direction} closure from: ${report.dependencyTraversal.focusPath}`,
          "- Includes optional composition and resolved support references; no runtime use or completeness claim.",
        ]
      : []),
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
        `| ${tableText(node.id + (node.releaseVersion ? ` @${node.releaseVersion}` : ""))} | ${node.kind} | ${node.sourcePath} | ${formatOwnership(node.ownership)} | ${node.status ?? ""} | ${node.tags.join(", ")} |`,
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
        `| ${edge.from} | ${tableText(edge.kind + bindingLabel(edge))} | ${edge.to} | ${edge.resolved ? "yes" : "no"} | ${edgeTarget(edge)} |`,
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
  return `${node.kind}: ${node.id}${node.releaseVersion ? ` @${node.releaseVersion}` : ""}${status}`;
}

function defaultGraphView(format: GraphFormat): GraphView {
  return format === "json" ? "full" : "summary";
}

function graphViewReport(report: GraphReport, view: GraphView): GraphReport {
  if (report.view === view) return report;
  if (
    view === "composition" ||
    view === "impact" ||
    view === "dependencies" ||
    view === "asset-impact" ||
    view === "discovery" ||
    view === "executable"
  ) {
    throw new Error(
      `${view} graph formatting requires a resolved ${view} report.`,
    );
  }
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
        ownership: unownedOwnership(),
        tags: [],
        groupedCount: 1,
      });
    }

    if (
      from === to &&
      !edge.bindings?.length &&
      !edge.bindingDiagnostics?.length
    )
      continue;
    const key = `${from}\0${edge.kind}\0${to}\0${edge.resolved ? "1" : "0"}${edge.bindings?.length || edge.bindingDiagnostics?.length ? JSON.stringify([edge.sourcePath, edge.declaration, edge.declarationIndex, edge.to]) : ""}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        ...(edge.bindings ? { bindings: edge.bindings } : {}),
        ...(edge.bindingDiagnostics
          ? { bindingDiagnostics: edge.bindingDiagnostics }
          : {}),
        from,
        to,
        kind: edge.kind,
        ...(edge.declaration ? { declaration: edge.declaration } : {}),
        ...(edge.declarationIndex !== undefined
          ? { declarationIndex: edge.declarationIndex }
          : {}),
        sourcePath: edge.sourcePath,
        ...(edge.evidence ? { evidence: edge.evidence } : {}),
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

function projectedNode(
  node: GraphNode,
  view: Exclude<
    GraphView,
    "composition" | "impact" | "discovery" | "executable"
  >,
): GraphNode {
  if (view === "workflow" && keepWorkflowNode(node.sourcePath)) return node;
  const groupId = groupPath(node.sourcePath, view);
  if (!groupId) return node;
  return {
    id: groupId,
    kind: node.kind,
    sourcePath: groupId,
    ownership: unownedOwnership(),
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
  return `${kind}: ${node.id}${node.releaseVersion ? ` @${node.releaseVersion}` : ""}${status}`;
}

function layeredEdgeLabel(
  edge: GraphEdge,
  nodesById: Map<string, GraphNode>,
): string {
  if (
    edge.declaration === "requires_skill" ||
    edge.declaration === "optional_skill"
  )
    return edge.declaration;
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

  const target = normalizeDependencyReference(edge.to);
  if (kind === "context_lens") {
    return target.startsWith("lens.") || target.startsWith("lenses/");
  }
  if (kind === "context") {
    return target.startsWith("contexts/");
  }
  return false;
}

function groupPath(sourcePath: string, view: GraphView): string | undefined {
  const path = normalizeDependencyReference(sourcePath);
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
  const path = normalizeDependencyReference(sourcePath);
  if (classifyRepositorySkillEntrypointPath(path)?.kind === "canonical") {
    return true;
  }
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
  return (
    compareUtf16CodeUnits(a.sourcePath, b.sourcePath) ||
    compareUtf16CodeUnits(a.id, b.id)
  );
}

function compareGraphEdges(a: GraphEdge, b: GraphEdge): number {
  return (
    compareUtf16CodeUnits(a.from, b.from) ||
    compareUtf16CodeUnits(a.kind, b.kind) ||
    compareUtf16CodeUnits(a.to, b.to)
  );
}

function toNode(asset: Asset): GraphNode {
  return {
    ...(asset.releaseVersion ? { releaseVersion: asset.releaseVersion } : {}),
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    contentHash: asset.contentHash,
    sizeBytes: asset.sizeBytes,
    contentClassification: asset.contentClassification,
    markdownParserEligible: asset.markdownParserEligible,
    ownership: asset.ownership,
    ...(asset.metadata.writableBy
      ? { writableBy: asset.metadata.writableBy }
      : {}),
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    ...(asset.metadata.statusReason
      ? { statusReason: asset.metadata.statusReason }
      : {}),
    ...(asset.metadata.statusChangedAt
      ? { statusChangedAt: asset.metadata.statusChangedAt }
      : {}),
    tags: asset.metadata.tags,
  };
}

function unownedOwnership(): AssetOwnership {
  return {
    declaredOwner: null,
    effectiveOwner: null,
    source: "unowned",
  };
}

function toEdge(dependency: Dependency, target: Asset | undefined): GraphEdge {
  return {
    ...(dependency.bindings ? { bindings: dependency.bindings } : {}),
    ...(dependency.bindingDiagnostics
      ? { bindingDiagnostics: dependency.bindingDiagnostics }
      : {}),
    from: dependency.from,
    to: dependency.to,
    kind: dependency.kind,
    ...(dependency.declaration ? { declaration: dependency.declaration } : {}),
    ...(dependency.declarationIndex !== undefined
      ? { declarationIndex: dependency.declarationIndex }
      : {}),
    sourcePath: dependency.sourcePath,
    ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
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

function edgeTarget(edge: GraphEdge): string {
  if (!edge.resolved) return "";
  return [edge.targetId, edge.targetKind, edge.targetPath]
    .filter((value) => value !== undefined && value.length > 0)
    .join(" ");
}

function stableAssets(assets: Asset[]): Asset[] {
  return [...assets].sort((left, right) => {
    const byKind = compareUtf16CodeUnits(left.kind, right.kind);
    if (byKind !== 0) return byKind;
    const byPath = compareUtf16CodeUnits(left.sourcePath, right.sourcePath);
    if (byPath !== 0) return byPath;
    return compareUtf16CodeUnits(left.id, right.id);
  });
}

function stableDependencies(dependencies: Dependency[]): Dependency[] {
  return [...dependencies].sort((left, right) => {
    const byFrom = compareUtf16CodeUnits(left.from, right.from);
    if (byFrom !== 0) return byFrom;
    const byKind = compareUtf16CodeUnits(left.kind, right.kind);
    if (byKind !== 0) return byKind;
    const byTo = compareUtf16CodeUnits(left.to, right.to);
    if (byTo !== 0) return byTo;
    const byPath = compareUtf16CodeUnits(left.sourcePath, right.sourcePath);
    if (byPath !== 0) return byPath;
    return (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1);
  });
}
