import path from "node:path";

import type { ConfigOverrides } from "../config.js";
import {
  prepareDeclaredCompositionIndex,
  resolveDeclaredCompositionFromIndex,
  type CompositionConflict,
  type CompositionProvenanceEdge,
  type CompositionResolutionIssue,
  type DeclaredCompositionReport,
} from "../declared-composition.js";
import {
  prepareDeclaredImpactIndex,
  resolveDeclaredImpactFromIndex,
  type DeclaredImpactReport,
  type ImpactAsset,
  type ImpactProvenanceEdge,
} from "../declared-impact.js";
import {
  normalizeDependencyReference,
  resolveDependencyTarget,
} from "../dependency-resolution.js";
import type {
  Asset,
  AssetKind,
  AssetOwnership,
  AssetStatus,
  Dependency,
  DependencyKind,
} from "../model.js";
import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";
import { classifyRepositorySkillEntrypointPath } from "../discovery.js";
import {
  collectRepositorySnapshot,
  prepareRepositorySnapshotProjections,
  repositoryDiagnosticsWithoutSkillDiscovery,
  type RepositoryEvidence,
  type RepositorySnapshot,
} from "../repository-evidence.js";
import {
  focusSkillDiscoveryIndex,
  type DeclaredSkillRoute,
  type SkillDiscoveryIndex,
} from "../skill-discovery.js";
import type { Diagnostic } from "../types/diagnostics.js";

export type GraphFormat = "json" | "markdown" | "mermaid";
export type GraphEdgeKind = DependencyKind | "continues_with";
export type GraphView =
  | "summary"
  | "workflow"
  | "full"
  | "layered"
  | "composition"
  | "impact"
  | "discovery";

export interface GraphReport {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  view: GraphView;
  nodeCount: number;
  edgeCount: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  composition?: DeclaredCompositionReport;
  impact?: DeclaredImpactReport;
  discovery?: SkillDiscoveryIndex;
  diagnostics?: Diagnostic[];
}

export interface GraphNode {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  contentHash?: string;
  sizeBytes?: number;
  contentClassification?: "text" | "binary";
  markdownParserEligible?: boolean;
  ownership: AssetOwnership;
  status?: AssetStatus;
  tags: string[];
  groupedCount?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  declaration?: string;
  declarationIndex?: number;
  sourcePath: string;
  evidence?: Diagnostic["evidence"];
  membership?: "required" | "optional";
  dependentMembership?: "required" | "optional";
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
  const view = options.view ?? defaultGraphView(options.format);
  const snapshot = await collectRepositorySnapshot(
    targetPath,
    options.overrides ?? {},
  );
  const fullReport = graphFromRepositorySnapshot(snapshot);
  let report: GraphReport;
  if (view === "discovery") {
    const discovery = options.focus
      ? focusSkillDiscoveryIndex(snapshot.skillDiscovery, options.focus)
      : snapshot.skillDiscovery;
    report = discoveryGraphReport(fullReport, discovery);
  } else if (view === "composition" || view === "impact") {
    if (!options.focus) {
      throw new Error(
        `graph --view ${view} requires --focus <asset-id-or-path>.`,
      );
    }
    const focusNode = resolveFocusNode(fullReport, options.focus);
    if (view === "composition") {
      const index = prepareDeclaredCompositionIndex(snapshot.catalog);
      const composition = resolveDeclaredCompositionFromIndex(
        index,
        focusNode.id,
      );
      report = compositionGraphReport(fullReport, composition);
    } else {
      const index = prepareDeclaredImpactIndex(snapshot.catalog);
      const impact = resolveDeclaredImpactFromIndex(index, focusNode.id);
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

export function formatGraphJson(report: GraphReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
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
    throw new Error(
      `graph --focus did not match any asset id or source path: ${focus}`,
    );
  }
  return node;
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
    .map(
      (route): GraphEdge => ({
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
      }),
    );
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
    composition.root.id,
    ...composition.requiredAssets.map((asset) => asset.id),
    ...composition.optionalAssets.map((asset) => asset.id),
  ]);
  const nodes = report.nodes.filter((node) => nodeIds.has(node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = composition.provenanceEdges.map((edge): GraphEdge => {
    const target = nodesById.get(edge.to);
    return {
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
    impact.focus.id,
    ...impact.requiredDependents.map((asset) => asset.id),
    ...impact.optionalDependents.map((asset) => asset.id),
  ]);
  const nodes = report.nodes.filter((node) => nodeIds.has(node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = impact.provenanceEdges.map((edge): GraphEdge => {
    const target = nodesById.get(edge.to);
    return {
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
  if (view === "discovery") return formatDiscoveryMermaid(report);
  if (view === "composition") return formatCompositionMermaid(report);
  if (view === "impact") return formatImpactMermaid(report);
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
        `| ${node.id} | ${node.kind} | ${node.sourcePath} | ${formatOwnership(node.ownership)} | ${node.status ?? ""} | ${node.tags.join(", ")} |`,
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

function formatDiscoveryMarkdown(report: GraphReport): string {
  const discovery = requiredDiscoveryReport(report);
  const skillsById = new Map(
    discovery.skills.map((skill) => [skill.id, skill]),
  );
  const lines = [
    "# Renma Skill Discovery Graph",
    "",
    `- Repository: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    ...(discovery.focus
      ? [`- Focus: ${discovery.focus.id} (${discovery.focus.sourcePath})`]
      : []),
    "- Boundary: this is a static declared Skill-to-Skill continuation projection. Renma does not select, load, invoke, rank, or execute Skills.",
    "",
    "Open each source `SKILL.md` and apply its routing conditions before continuing with another Skill.",
    "",
    "## Summary",
    "",
    `- Visible Skills: ${discovery.summary.visibleSkillCount}`,
    `- Declared routes: ${discovery.summary.declaredRouteCount}`,
    `- Usable routes: ${discovery.summary.usableRouteCount}`,
    `- Unresolved or ambiguous routes: ${discovery.summary.unresolvedOrAmbiguousRouteCount}`,
    `- Invalid routes: ${discovery.summary.invalidRouteCount}`,
    `- Published entrypoints in this projection: ${discovery.summary.publishedEntrypointCount}`,
    `- Structural roots: ${discovery.summary.structuralRootCount}`,
    `- Reachable eligible Skills: ${discovery.summary.reachableSkillCount}`,
    `- Not-reached eligible Skills: ${discovery.summary.notReachedSkillCount}`,
    `- Unrouted Skills: ${discovery.summary.unroutedSkillCount}`,
    "",
    "## Adoption",
    "",
    `- State: ${discovery.adoption.state}`,
    `- Discovery metadata present: ${yesNo(discovery.adoption.discoveryMetadataPresent)}`,
    `- Repository-wide adopted: ${yesNo(discovery.adoption.repositoryWideAdopted)}`,
    `- Effective published entrypoints repository-wide: ${discovery.adoption.publishedEntrypointCount}`,
    `- Reason: ${discovery.adoption.reason}`,
    ...(discovery.adoption.configPath
      ? [`- Config: ${discovery.adoption.configPath}`]
      : []),
    "",
    "## Coverage",
    "",
    `- Scope: ${discovery.coverage.scope}`,
    `- Mode: ${discovery.coverage.mode}`,
    `- Reason: ${discovery.coverage.reason}`,
    `- Source published entrypoints: ${discovery.coverage.sourceEntrypointIds.join(", ") || "(none)"}`,
    `- Eligible Skills: ${discovery.coverage.eligibleSkillCount}`,
    `- Reachable eligible Skills: ${discovery.coverage.reachableSkillCount}`,
    `- Not-reached eligible Skills: ${discovery.coverage.notReachedSkillCount}`,
    `- Authoritative completeness: ${discovery.coverage.complete === null ? "not applicable" : yesNo(discovery.coverage.complete)}`,
    ...(discovery.coverage.mode === "descriptive"
      ? [
          "",
          "Descriptive coverage is review evidence, not a repository-wide completeness claim.",
        ]
      : []),
    ...(discovery.coverage.mode === "authoritative"
      ? [
          "",
          "Authoritative coverage is evaluated only because the repository explicitly declared skill_discovery.adopted: true.",
        ]
      : []),
    "",
    "## Published entrypoints",
    "",
    "Published entrypoints are explicit first-hop declarations. Structural roots are derived graph facts. Neither causes Renma to select or execute a Skill.",
    "",
  ];

  if (discovery.publishedEntrypointIds.length === 0) {
    lines.push(
      discovery.focus && discovery.adoption.publishedEntrypointCount > 0
        ? "- No effective published entrypoint is visible in this focused projection. The repository-wide adoption state is retained."
        : `- No effective published entrypoint exists. Adoption state: ${discovery.adoption.state}.`,
    );
  } else {
    for (const id of discovery.publishedEntrypointIds) {
      const skill = skillsById.get(id);
      if (!skill) continue;
      const continuations = discovery.routes.filter(
        (route) => route.sourcePath === skill.sourcePath,
      );
      lines.push(
        `### ${skill.id}`,
        "",
        `- Description: ${skill.description ?? "(unavailable)"}`,
        `- Source: ${skill.sourcePath}`,
        `- Owner: ${formatOwnership(skill.ownership)}`,
        `- Lifecycle: ${skill.lifecycle ?? "(unspecified)"}`,
        `- Structural root: ${yesNo(skill.structuralRoot)}`,
        `- Standalone: ${yesNo(skill.standalone)}`,
        `- Unrouted: ${yesNo(skill.unrouted)}`,
        `- Reachability: ${skill.reachability.state} (${skill.reachability.reason}; minimum depth ${skill.reachability.minimumDepth ?? "n/a"}; sources ${skill.reachability.sourceEntrypointIds.join(", ") || "none"})`,
        "- Direct declared continuations:",
        "",
      );
      if (continuations.length === 0) {
        lines.push(
          "  - None. This Skill may itself be the complete first-hop workflow.",
        );
      } else {
        lines.push(
          "  | Index | Declared target | Resolution | Usability |",
          "  | ---: | --- | --- | --- |",
        );
        for (const route of continuations) {
          lines.push(
            `  | ${route.declarationIndex} | ${tableText(route.rawTarget)} | ${tableText(discoveryRouteResolutionLabel(route))} | ${route.usable ? "usable" : tableText(`unusable: ${route.usabilityReasons.join(", ")}`)} |`,
          );
        }
      }
      lines.push("");
    }
  }

  if (discovery.coverage.mode === "authoritative") {
    lines.push("## Authoritative coverage gaps", "");
    if (discovery.coverage.complete) {
      lines.push(
        "- None. Every Discovery-eligible Skill is reachable from an effective published entrypoint.",
      );
    } else if (discovery.notReachedDiscoveryEligibleSkillIds.length === 0) {
      lines.push(
        "- No authoritative coverage gap is visible in this focused projection. Repository-wide coverage remains incomplete; use unfocused JSON for the complete not-reached ID array.",
      );
    } else {
      for (const id of discovery.notReachedDiscoveryEligibleSkillIds.slice(
        0,
        DISCOVERY_PRESENTATION_CAP,
      )) {
        const skill = skillsById.get(id);
        lines.push(
          `- ${id}${skill ? ` — ${skill.sourcePath} (structural root: ${yesNo(skill.structuralRoot)}; standalone: ${yesNo(skill.standalone)}; unrouted: ${yesNo(skill.unrouted)})` : ""}`,
        );
      }
      appendDiscoveryOmission(
        lines,
        discovery.notReachedDiscoveryEligibleSkillIds.length,
      );
      lines.push(
        "",
        "These are static declared-graph coverage gaps, not claims that the Skills are unused at runtime.",
      );
    }
    lines.push("");
  }

  lines.push("## Structural roots", "");

  if (discovery.structuralRootIds.length === 0) {
    lines.push("- None.");
  } else {
    for (const id of discovery.structuralRootIds.slice(
      0,
      DISCOVERY_PRESENTATION_CAP,
    )) {
      const skill = skillsById.get(id);
      lines.push(`- ${id}${skill ? ` — ${skill.sourcePath}` : ""}`);
    }
    appendDiscoveryOmission(lines, discovery.structuralRootIds.length);
  }

  lines.push(
    "",
    "Structural roots are route-eligible Skills with no incoming usable Skill route. They are candidate graph facts, not recommendations or published entrypoints.",
    "",
    "## Unrouted Skills",
    "",
    "Unrouted Skills are eligible structural roots that are not explicitly published entrypoints.",
    "",
  );
  if (discovery.unroutedSkillIds.length === 0) {
    lines.push("- None.");
  } else {
    for (const id of discovery.unroutedSkillIds.slice(
      0,
      DISCOVERY_PRESENTATION_CAP,
    )) {
      const skill = skillsById.get(id);
      lines.push(
        `- ${id}${skill ? ` — ${skill.sourcePath} (standalone: ${yesNo(skill.standalone)})` : ""}`,
      );
    }
    appendDiscoveryOmission(lines, discovery.unroutedSkillIds.length);
  }

  lines.push(
    "",
    "Complete JSON contains the full projection-scoped ID arrays; coverage counts remain repository-scoped.",
    "",
    "## Declared routes",
    "",
    "| Source | Index | Declared target | Resolution | Usability | Evidence | Diagnostics |",
    "| --- | ---: | --- | --- | --- | --- | --- |",
  );
  if (discovery.routes.length === 0) {
    lines.push("| (none) |  |  |  |  |  |  |");
  } else {
    for (const route of discovery.routes) {
      const resolution = discoveryRouteResolutionLabel(route);
      const usability = route.usable
        ? "usable"
        : `unusable: ${route.usabilityReasons.join(", ")}`;
      lines.push(
        `| ${tableText(`${route.sourceId} (${route.sourcePath})`)} | ${route.declarationIndex} | ${tableText(`${route.rawTarget} → ${route.normalizedTarget}`)} | ${tableText(resolution)} | ${tableText(usability)} | ${tableText(evidenceLabel(route.evidence, route.sourcePath))} | ${tableText(route.linkedDiagnostics.map((item) => item.code).join(", "))} |`,
      );
    }
  }

  lines.push("", "## Discovery diagnostics", "");
  if (discovery.diagnostics.length === 0) {
    lines.push("- None.");
  } else {
    for (const diagnostic of discovery.diagnostics) {
      const location = diagnostic.evidence
        ? evidenceLabel(diagnostic.evidence, diagnostic.path ?? "")
        : (diagnostic.path ?? "repository");
      lines.push(
        `- ${diagnostic.code ?? "RENMA-DIAGNOSTIC"} (${location}): ${diagnostic.message}`,
      );
      if (diagnostic.llmHint) lines.push(`  - Repair: ${diagnostic.llmHint}`);
    }
  }

  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("", "## Repository diagnostics", "");
    for (const diagnostic of report.diagnostics) {
      const location = diagnostic.evidence
        ? evidenceLabel(diagnostic.evidence, diagnostic.path ?? "")
        : (diagnostic.path ?? "repository");
      lines.push(
        `- ${diagnostic.code ?? "RENMA-DIAGNOSTIC"} [${diagnostic.severity}] (${location}): ${diagnostic.message}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatDiscoveryMermaid(report: GraphReport): string {
  const discovery = requiredDiscoveryReport(report);
  const nodeIds = new Map<string, string>();
  const lines = [
    "graph TD",
    `  %% coverage mode: ${discovery.coverage.mode}`,
    `  %% source entrypoint IDs: ${discoveryCommentIds(discovery.coverage.sourceEntrypointIds)}`,
    `  %% reachable eligible Skill IDs: ${discoveryCommentIds(discovery.reachableDiscoveryEligibleSkillIds)}`,
    `  %% not-reached eligible Skill IDs: ${discoveryCommentIds(discovery.notReachedDiscoveryEligibleSkillIds)}`,
    `  %% unrouted Skill IDs: ${discoveryCommentIds(discovery.unroutedSkillIds)}`,
  ];
  discovery.skills.forEach((skill, index) => {
    const id = `skill_${index}`;
    nodeIds.set(skill.sourcePath, id);
    const state = skill.routeEligible ? "" : " [ineligible]";
    lines.push(
      `  ${id}["${escapeMermaidLabel(`skill: ${skill.id} (${skill.sourcePath})${state}`)}"]`,
    );
  });

  discovery.routes.forEach((route, index) => {
    const source = nodeIds.get(route.sourcePath);
    if (!source) return;
    if (
      route.usable &&
      route.representative &&
      route.resolvedTarget?.kind === "skill"
    ) {
      const target = nodeIds.get(route.resolvedTarget.sourcePath);
      if (target) {
        lines.push(`  ${source} -->|continues-with| ${target}`);
      }
    } else {
      const synthetic = `route_${index}`;
      const target = route.resolvedTarget
        ? `${route.resolvedTarget.kind}: ${route.resolvedTarget.id} (${route.resolvedTarget.sourcePath})`
        : `${route.resolution}: ${route.normalizedTarget}`;
      const reasons = route.usabilityReasons.join(", ") || route.resolution;
      lines.push(
        `  ${synthetic}["${escapeMermaidLabel(`${target} [${reasons}]`)}"]`,
      );
      lines.push(
        `  ${source} -.->|${escapeMermaidLabel(`continues-with ${route.resolution}`)}| ${synthetic}`,
      );
    }
    lines.push(
      `  %% declaration ${route.sourcePath} index ${route.declarationIndex} at ${evidenceLabel(route.evidence, route.sourcePath)}`,
    );
  });

  const rootNodes = discovery.structuralRootIds.flatMap((rootId) =>
    discovery.skills
      .filter((skill) => skill.id === rootId)
      .map((skill) => nodeIds.get(skill.sourcePath))
      .filter((id): id is string => id !== undefined),
  );
  if (rootNodes.length > 0) {
    lines.push("  classDef structuralRoot stroke-width:2px,stroke:#64748b");
    lines.push(`  class ${rootNodes.join(",")} structuralRoot`);
  }
  const publishedNodes = discovery.skills
    .filter((skill) => skill.publication.accepted)
    .map((skill) => nodeIds.get(skill.sourcePath))
    .filter((id): id is string => id !== undefined);
  if (publishedNodes.length > 0) {
    lines.push(
      "  classDef publishedEntrypoint fill:#dbeafe,stroke:#2563eb,stroke-width:3px",
    );
    lines.push(`  class ${publishedNodes.join(",")} publishedEntrypoint`);
  }
  if (discovery.diagnostics.length > 0) {
    lines.push("  %% Discovery diagnostics:");
    for (const diagnostic of discovery.diagnostics) {
      const location = diagnostic.evidence
        ? evidenceLabel(diagnostic.evidence, diagnostic.path ?? "")
        : (diagnostic.path ?? "repository");
      lines.push(
        `  %% ${singleLine(`${diagnostic.code ?? "RENMA-DIAGNOSTIC"} ${location}: ${diagnostic.message}`)}`,
      );
    }
  }
  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("  %% Repository diagnostics:");
    for (const diagnostic of report.diagnostics) {
      const location = diagnostic.evidence
        ? evidenceLabel(diagnostic.evidence, diagnostic.path ?? "")
        : (diagnostic.path ?? "repository");
      lines.push(
        `  %% ${singleLine(`${diagnostic.code ?? "RENMA-DIAGNOSTIC"} [${diagnostic.severity}] ${location}: ${diagnostic.message}`)}`,
      );
    }
  }
  lines.push(
    "  %% Solid edges are usable declared Skill continuations. Dotted edges end at synthetic review nodes. Published entrypoints are explicit first-hop declarations; structural roots are derived graph facts. Neither causes Renma to select or execute a Skill. Renma does not execute Skills.",
  );
  return `${lines.join("\n")}\n`;
}

const DISCOVERY_PRESENTATION_CAP =
  DEFAULT_QUALITY_PROFILE.presentation.topSummaryItemCap;

function appendDiscoveryOmission(lines: string[], totalCount: number): void {
  const omittedCount = totalCount - DISCOVERY_PRESENTATION_CAP;
  if (omittedCount <= 0) return;
  lines.push(
    `- ... ${omittedCount} more omitted from Markdown output. Use JSON for the complete ID array.`,
  );
}

function discoveryCommentIds(ids: string[]): string {
  if (ids.length === 0) return "(none)";
  const visible = ids.slice(0, DISCOVERY_PRESENTATION_CAP).join(", ");
  return ids.length > DISCOVERY_PRESENTATION_CAP
    ? `${visible} (${DISCOVERY_PRESENTATION_CAP} of ${ids.length} shown; total ${ids.length})`
    : visible;
}

function discoveryRouteResolutionLabel(route: DeclaredSkillRoute): string {
  if (!route.resolvedTarget) {
    return route.normalizationRejection
      ? `${route.resolution} (${route.normalizationRejection})`
      : route.resolution;
  }
  return `${route.resolution}: ${route.resolvedTarget.id} (${route.resolvedTarget.kind}, ${route.resolvedTarget.sourcePath}${route.resolvedTarget.lifecycle ? `, ${route.resolvedTarget.lifecycle}` : ""})`;
}

function formatCompositionMarkdown(report: GraphReport): string {
  const composition = requiredCompositionReport(report);
  const lines = [
    "# Renma Declared Composition",
    "",
    `- Repository: ${report.root}`,
    `- Root: ${composition.root.id} (${composition.root.kind}, ${composition.root.sourcePath})`,
    `- Required assets: ${composition.requiredAssets.length}`,
    `- Optional assets: ${composition.optionalAssets.length}`,
    `- Required complete: ${yesNo(composition.requiredComplete)}`,
    `- Optional complete: ${yesNo(composition.optionalComplete)}`,
    `- Cycle free: ${yesNo(composition.cycleFree)}`,
    "",
    "Declaration order does not define precedence or overriding. Optional membership records declared optional composition; Renma does not make a runtime selection.",
  ];

  lines.push("", "## Required assets", "");
  renderCompositionAssetTable(
    lines,
    composition.requiredAssets,
    composition.provenanceEdges,
  );
  lines.push("", "## Optional assets", "");
  renderCompositionAssetTable(
    lines,
    composition.optionalAssets,
    composition.provenanceEdges,
  );

  lines.push(
    "",
    "## Declaration provenance",
    "",
    "| From | Relationship | Membership | To | Declaration | Evidence |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  if (composition.provenanceEdges.length === 0) {
    lines.push("| (none) |  |  |  |  |  |");
  } else {
    for (const edge of composition.provenanceEdges) {
      lines.push(
        `| ${tableText(edge.from)} | ${edge.relationship} | ${edge.membership} | ${tableText(edge.to)} | ${tableText(edge.declaredTarget)} | ${tableText(evidenceLabel(edge.evidence, edge.sourcePath))} |`,
      );
    }
  }

  const multipleParents = [
    ...composition.requiredAssets,
    ...composition.optionalAssets,
  ]
    .map((asset) => ({
      asset,
      parents: composition.provenanceEdges.filter(
        (edge) => edge.to === asset.id,
      ),
    }))
    .filter(({ parents }) => parents.length > 1);
  lines.push("", "## Multiple declarations", "");
  if (multipleParents.length === 0) {
    lines.push("- None.");
  } else {
    for (const { asset, parents } of multipleParents) {
      lines.push(
        `- ${asset.id}: ${parents.length} retained declaration routes from ${[...new Set(parents.map((edge) => edge.from))].sort().join(", ")}.`,
      );
    }
  }

  lines.push("", "## Resolution problems", "");
  renderResolutionIssues(
    lines,
    "Unresolved required",
    composition.unresolvedRequired,
  );
  renderResolutionIssues(
    lines,
    "Unresolved optional",
    composition.unresolvedOptional,
  );
  lines.push("", "### Invalid source or target kinds", "");
  if (composition.kindMismatches.length === 0) {
    lines.push("- None.");
  } else {
    for (const mismatch of composition.kindMismatches) {
      const kindProblems = [
        ...(mismatch.expectedSourceKind
          ? [
              `source kind ${mismatch.actualSourceKind}, expected ${mismatch.expectedSourceKind}`,
            ]
          : []),
        ...(mismatch.expectedTargetKind && mismatch.actualTargetKind
          ? [
              `target ${mismatch.targetId ?? mismatch.declaredTarget} kind ${mismatch.actualTargetKind}, expected ${mismatch.expectedTargetKind}`,
            ]
          : []),
      ];
      lines.push(
        `- ${mismatch.membership}: ${mismatch.sourceId} ${mismatch.relationship} ${mismatch.declaredTarget}; ${kindProblems.join("; ")} (${evidenceLabel(mismatch.evidence, mismatch.sourcePath)}).`,
      );
    }
  }

  lines.push("", "## Cycles", "");
  renderCycles(lines, "Required", composition.requiredCycles);
  renderCycles(lines, "Optional", composition.optionalCycles);
  lines.push("", "## Declared conflicts", "");
  renderConflicts(lines, "Required", composition.requiredConflicts);
  renderConflicts(
    lines,
    "Optional candidates",
    composition.optionalConflictCandidates,
  );

  lines.push("", "## Lifecycle and freshness", "");
  if (
    composition.lifecycleFindings.length === 0 &&
    composition.freshnessFindings.length === 0
  ) {
    lines.push("- None.");
  } else {
    for (const finding of composition.lifecycleFindings) {
      lines.push(
        `- ${finding.membership}: ${finding.assetId} is ${finding.status}${finding.isRoot ? " (root)" : ""}.`,
      );
    }
    for (const finding of composition.freshnessFindings) {
      lines.push(
        `- ${finding.membership}: ${finding.assetId} is ${finding.kind.replace("_", " ")} at ${finding.date}${finding.isRoot ? " (root)" : ""} (${evidenceLabel(finding.evidence, finding.sourcePath)}).`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderCompositionAssetTable(
  lines: string[],
  assets: DeclaredCompositionReport["requiredAssets"],
  provenance: CompositionProvenanceEdge[],
): void {
  lines.push(
    "| ID | Kind | Source | Direct | Parent relationships |",
    "| --- | --- | --- | --- | --- |",
  );
  if (assets.length === 0) {
    lines.push("| (none) |  |  |  |  |");
    return;
  }
  for (const asset of assets) {
    const parents = provenance
      .filter((edge) => edge.to === asset.id)
      .map(
        (edge) =>
          `${edge.from} (${edge.relationship}, ${edge.membership}, ${evidenceLabel(edge.evidence, edge.sourcePath)})`,
      );
    lines.push(
      `| ${tableText(asset.id)} | ${asset.kind} | ${tableText(asset.sourcePath)} | ${yesNo(asset.direct === true)} | ${tableText(parents.join("; "))} |`,
    );
  }
}

function renderResolutionIssues(
  lines: string[],
  heading: string,
  issues: CompositionResolutionIssue[],
): void {
  lines.push("", `### ${heading}`, "");
  if (issues.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const issue of issues) {
    lines.push(
      `- ${issue.sourceId} ${issue.relationship} ${issue.declaredTarget} (${evidenceLabel(issue.evidence, issue.sourcePath)}).`,
    );
  }
}

function renderCycles(
  lines: string[],
  label: string,
  cycles: DeclaredCompositionReport["requiredCycles"],
): void {
  lines.push("", `### ${label}`, "");
  if (cycles.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const cycle of cycles) {
    lines.push(`- Strongly connected assets: ${cycle.assetIds.join(", ")}.`);
    for (const edge of cycle.edges) {
      lines.push(
        `  - ${edge.from} ${edge.relationship} ${edge.to} (${edge.membership}; ${evidenceLabel(edge.evidence, edge.sourcePath)}).`,
      );
    }
  }
}

function renderConflicts(
  lines: string[],
  label: string,
  conflicts: CompositionConflict[],
): void {
  lines.push("", `### ${label}`, "");
  if (conflicts.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const conflict of conflicts) {
    const declarations = conflict.declarations
      .map((item) => evidenceLabel(item.evidence, item.sourcePath))
      .join(", ");
    lines.push(
      `- ${conflict.left} conflicts with ${conflict.right}; no winner selected (${declarations}).`,
    );
  }
}

function formatImpactMarkdown(report: GraphReport): string {
  const impact = requiredImpactReport(report);
  const lines = [
    "# Renma Declared Impact",
    "",
    `- Repository: ${report.root}`,
    `- Focus: ${impact.focus.id} (${impact.focus.kind}, ${impact.focus.sourcePath})`,
    `- Required declared dependents: ${impact.requiredDependents.length}`,
    `- Optional declared dependents: ${impact.optionalDependents.length}`,
    "",
    "This is declared repository impact, not runtime usage or breakage prediction.",
  ];

  lines.push("", "## Skills with required declared impact", "");
  renderImpactAssetTable(lines, impact.requiredSkills, impact.provenanceEdges);
  lines.push("", "## Skills with optional declared impact", "");
  renderImpactAssetTable(lines, impact.optionalSkills, impact.provenanceEdges);
  lines.push("", "## Other required dependents", "");
  renderImpactAssetTable(
    lines,
    impact.requiredDependents.filter((asset) => asset.kind !== "skill"),
    impact.provenanceEdges,
  );
  lines.push("", "## Other optional dependents", "");
  renderImpactAssetTable(
    lines,
    impact.optionalDependents.filter((asset) => asset.kind !== "skill"),
    impact.provenanceEdges,
  );

  lines.push(
    "",
    "## Declaration provenance",
    "",
    "| From | Relationship | Dependent membership | To | Direct | Declaration | Evidence |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  if (impact.provenanceEdges.length === 0) {
    lines.push("| (none) |  |  |  |  |  |  |");
  } else {
    for (const edge of impact.provenanceEdges) {
      lines.push(
        `| ${tableText(edge.from)} | ${edge.relationship} | ${edge.dependentMembership} | ${tableText(edge.to)} | ${yesNo(edge.direct)} | ${tableText(edge.declaredTarget)} | ${tableText(evidenceLabel(edge.evidence, edge.sourcePath))} |`,
      );
    }
  }

  lines.push("", "## Invalid incoming declarations", "");
  if (impact.invalidIncomingDeclarations.length === 0) {
    lines.push("- None.");
  } else {
    for (const mismatch of impact.invalidIncomingDeclarations) {
      const kindProblems = [
        ...(mismatch.expectedSourceKind
          ? [
              `source kind ${mismatch.actualSourceKind}, expected ${mismatch.expectedSourceKind}`,
            ]
          : []),
        ...(mismatch.expectedTargetKind && mismatch.actualTargetKind
          ? [
              `target kind ${mismatch.actualTargetKind}, expected ${mismatch.expectedTargetKind}`,
            ]
          : []),
      ];
      lines.push(
        `- Invalid ${mismatch.relationship}: ${mismatch.sourceId} -> ${mismatch.resolvedTargetId}; ${kindProblems.join("; ")} (${evidenceLabel(mismatch.evidence, mismatch.sourcePath)}).`,
      );
    }
  }

  lines.push(
    "",
    "## Boundary",
    "",
    "Required and optional describe explicit dependent-to-focus declaration routes. They do not state that an asset is broken, loaded at runtime, selected, or required to change.",
  );
  return `${lines.join("\n")}\n`;
}

function renderImpactAssetTable(
  lines: string[],
  assets: ImpactAsset[],
  provenance: ImpactProvenanceEdge[],
): void {
  lines.push(
    "| ID | Kind | Source | Direct | Immediate declarations toward focus |",
    "| --- | --- | --- | --- | --- |",
  );
  if (assets.length === 0) {
    lines.push("| (none) |  |  |  |  |");
    return;
  }
  for (const asset of assets) {
    const declarations = provenance
      .filter((edge) => edge.from === asset.id)
      .map(
        (edge) =>
          `${edge.relationship} ${edge.to} (${edge.dependentMembership}; ${evidenceLabel(edge.evidence, edge.sourcePath)})`,
      );
    lines.push(
      `| ${tableText(asset.id)} | ${asset.kind} | ${tableText(asset.sourcePath)} | ${yesNo(asset.direct)} | ${tableText(declarations.join("; "))} |`,
    );
  }
}

function formatImpactMermaid(report: GraphReport): string {
  const impact = requiredImpactReport(report);
  const nodeIds = new Map<string, string>();
  const lines = ["graph TD"];
  report.nodes.forEach((node, index) => {
    const id = `node_${index}`;
    nodeIds.set(node.id, id);
    const focus = node.id === impact.focus.id ? "focus " : "";
    lines.push(
      `  ${id}["${escapeMermaidLabel(`${focus}${node.kind}: ${node.id}`)}"]`,
    );
  });

  for (const edge of impact.provenanceEdges) {
    const source = nodeIds.get(edge.from);
    const target = nodeIds.get(edge.to);
    if (!source || !target) continue;
    const arrow = edge.dependentMembership === "required" ? "-->" : "-.->";
    lines.push(
      `  ${source} ${arrow}|${escapeMermaidLabel(`${edge.relationship} ${edge.dependentMembership}`)}| ${target}`,
    );
  }

  impact.invalidIncomingDeclarations.forEach((mismatch, index) => {
    let source = nodeIds.get(mismatch.sourceId);
    if (!source) {
      source = `invalid_source_${index}`;
      nodeIds.set(mismatch.sourceId, source);
      lines.push(
        `  ${source}["${escapeMermaidLabel(`invalid source: ${mismatch.sourceId}`)}"]`,
      );
    }
    const target = nodeIds.get(mismatch.resolvedTargetId);
    if (target) {
      lines.push(
        `  ${source} -.->|${escapeMermaidLabel(`${mismatch.relationship} invalid kind`)}| ${target}`,
      );
    }
  });

  const focusNode = nodeIds.get(impact.focus.id);
  if (focusNode) {
    lines.push("  classDef impactFocus stroke-width:3px");
    lines.push(`  class ${focusNode} impactFocus`);
  }
  lines.push(
    "  %% Solid edges are required declared impact; dotted edges are optional declared impact. Invalid edges are explicitly labeled. This is not runtime usage or breakage prediction.",
  );
  return `${lines.join("\n")}\n`;
}

function formatCompositionMermaid(report: GraphReport): string {
  const composition = requiredCompositionReport(report);
  const nodeIds = new Map<string, string>();
  const lines = ["graph TD"];
  report.nodes.forEach((node, index) => {
    const id = `node_${index}`;
    nodeIds.set(node.id, id);
    const root = node.id === composition.root.id ? "root " : "";
    lines.push(
      `  ${id}["${escapeMermaidLabel(`${root}${node.kind}: ${node.id}`)}"]`,
    );
  });

  const cycleEdges = new Set(
    [...composition.requiredCycles, ...composition.optionalCycles].flatMap(
      (cycle) => cycle.edges.map(compositionEdgeKey),
    ),
  );
  for (const edge of composition.provenanceEdges) {
    const source = nodeIds.get(edge.from);
    const target = nodeIds.get(edge.to);
    if (!source || !target) continue;
    const arrow = edge.membership === "required" ? "-->" : "-.->";
    const cycle = cycleEdges.has(compositionEdgeKey(edge)) ? " cycle" : "";
    lines.push(
      `  ${source} ${arrow}|${escapeMermaidLabel(`${edge.relationship} ${edge.membership}${cycle}`)}| ${target}`,
    );
  }

  const unresolved = [
    ...composition.unresolvedRequired,
    ...composition.unresolvedOptional,
  ];
  unresolved.forEach((issue, index) => {
    const missing = `missing_${index}`;
    lines.push(
      `  ${missing}["${escapeMermaidLabel(`unresolved: ${issue.declaredTarget}`)}"]`,
    );
    const source = nodeIds.get(issue.sourceId);
    if (source) {
      const arrow = issue.membership === "required" ? "-->" : "-.->";
      lines.push(
        `  ${source} ${arrow}|${escapeMermaidLabel(`${issue.relationship} ${issue.membership} unresolved`)}| ${missing}`,
      );
    }
  });

  composition.kindMismatches.forEach((mismatch, index) => {
    const wrong = `wrong_kind_${index}`;
    const label =
      mismatch.expectedTargetKind && mismatch.actualTargetKind
        ? `wrong target kind: ${mismatch.targetId ?? mismatch.declaredTarget} (${mismatch.actualTargetKind}, expected ${mismatch.expectedTargetKind})`
        : `wrong source kind: ${mismatch.sourceId} (${mismatch.actualSourceKind}, expected ${mismatch.expectedSourceKind})`;
    lines.push(`  ${wrong}["${escapeMermaidLabel(label)}"]`);
    const source = nodeIds.get(mismatch.sourceId);
    if (source) {
      const arrow = mismatch.membership === "required" ? "-->" : "-.->";
      lines.push(
        `  ${source} ${arrow}|${escapeMermaidLabel(`${mismatch.relationship} invalid kind`)}| ${wrong}`,
      );
    }
  });

  for (const conflict of [
    ...composition.requiredConflicts,
    ...composition.optionalConflictCandidates,
  ]) {
    const left = nodeIds.get(conflict.left);
    const right = nodeIds.get(conflict.right);
    if (left && right) {
      lines.push(
        `  ${left} <-.->|${escapeMermaidLabel(`declared conflict ${conflict.membership}`)}| ${right}`,
      );
    }
  }

  const rootNode = nodeIds.get(composition.root.id);
  if (rootNode) {
    lines.push("  classDef compositionRoot stroke-width:3px");
    lines.push(`  class ${rootNode} compositionRoot`);
  }
  lines.push(
    "  %% Solid edges are required; dotted edges are optional. This is declared composition, not runtime execution.",
  );
  return `${lines.join("\n")}\n`;
}

function compositionEdgeKey(edge: CompositionProvenanceEdge): string {
  return [edge.from, edge.to, edge.relationship, edge.membership].join("\0");
}

function requiredCompositionReport(
  report: GraphReport,
): DeclaredCompositionReport {
  if (!report.composition) {
    throw new Error(
      "Composition graph formatting requires a resolved composition report.",
    );
  }
  return report.composition;
}

function requiredDiscoveryReport(report: GraphReport): SkillDiscoveryIndex {
  if (!report.discovery) {
    throw new Error(
      "Discovery graph formatting requires a resolved Skill Discovery report.",
    );
  }
  return report.discovery;
}

function requiredImpactReport(report: GraphReport): DeclaredImpactReport {
  if (!report.impact) {
    throw new Error(
      "Impact graph formatting requires a resolved declared impact report.",
    );
  }
  return report.impact;
}

function evidenceLabel(
  evidence: Diagnostic["evidence"],
  fallbackPath: string,
): string {
  if (!evidence) return fallbackPath;
  const lines =
    evidence.startLine === evidence.endLine
      ? `L${evidence.startLine}`
      : `L${evidence.startLine}-L${evidence.endLine}`;
  return `${evidence.path}:${lines}`;
}

function tableText(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
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
  if (view === "composition" || view === "impact" || view === "discovery") {
    throw new Error(
      `${view === "composition" ? "Composition" : view === "impact" ? "Impact" : "Discovery"} graph formatting requires a resolved ${view === "composition" ? "composition" : view === "impact" ? "declared impact" : "Skill Discovery"} report.`,
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

    if (from === to) continue;
    const key = `${from}\0${edge.kind}\0${to}\0${edge.resolved ? "1" : "0"}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
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
  view: Exclude<GraphView, "composition" | "impact" | "discovery">,
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

  const target = normalizeDependencyReference(edge.to);
  if (kind === "context_lens") {
    return target.startsWith("lens.") || target.startsWith("lenses/");
  }
  if (kind === "context") {
    return target.startsWith("context/") || target.startsWith("contexts/");
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
    contentHash: asset.contentHash,
    sizeBytes: asset.sizeBytes,
    contentClassification: asset.contentClassification,
    markdownParserEligible: asset.markdownParserEligible,
    ownership: asset.ownership,
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
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

function formatOwnership(ownership: AssetOwnership): string {
  if (ownership.source === "unowned") return "(unowned)";
  const provenance =
    ownership.source === "inherited" && ownership.inheritedFrom
      ? ` from ${ownership.inheritedFrom.sourcePath}`
      : "";
  return `${ownership.effectiveOwner ?? "(unowned)"} (${ownership.source}${provenance})`;
}

function toEdge(dependency: Dependency, assets: Asset[]): GraphEdge {
  const target = resolveDependencyTarget(dependency, assets);
  return {
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
    const byPath = left.sourcePath.localeCompare(right.sourcePath);
    if (byPath !== 0) return byPath;
    return (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1);
  });
}
