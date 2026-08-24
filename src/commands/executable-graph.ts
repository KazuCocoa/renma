import { compareUtf16CodeUnits } from "../canonical-json.js";
import path from "node:path";

import { CliUserError } from "../cli-errors.js";
import type { SkillParentIndex } from "../catalog.js";
import { logicalSkillDirectory } from "../discovery.js";
import { canonicalExecutableDependencyGraphEdges } from "../executable-dependency-resolution.js";
import {
  canonicalExecutableInvocationGraphEdges,
  type ExecutableSurfaceEntry,
  type ExecutableSurfaceInventory,
  type ExecutableSurfaceInvocation,
} from "../executable-surface-inventory.js";
import type { AssetOwnership } from "../types/governance.js";
import type {
  ExecutableGraphNodeRole,
  ExecutableGraphProjection,
  GraphEdge,
  GraphNode,
  GraphReport,
} from "./graph.js";

interface ResolvedExecutableEvidence {
  sourcePath: string;
  normalizedTarget?: string;
  resolution: string;
}

/** Project repository evidence into the executable-specific graph view. */
export function executableGraphReport(
  report: GraphReport,
  inventory: ExecutableSurfaceInventory,
  skillParents: SkillParentIndex,
  focus?: string,
): GraphReport {
  const skillNodes = report.nodes
    .filter((node) => node.kind === "skill")
    .map((node): GraphNode => ({ ...node, executableRole: "skill" }));
  const skillsBySourcePath = new Map(
    skillNodes.map((node) => [node.sourcePath, node]),
  );
  const catalogNodesBySourcePath = new Map(
    report.nodes.map((node) => [node.sourcePath, node]),
  );
  const surfacesByPath = new Map(
    inventory.surfaces.map((surface) => [surface.path, surface]),
  );
  const surfaceNodesByPath = new Map(
    inventory.surfaces.map((surface) => [
      surface.path,
      surfaceNode(surface, catalogNodesBySourcePath),
    ]),
  );
  const invocationEvidenceCounts = resolvedEvidenceCounts(
    inventory.invocations,
  );
  const dependencyEvidenceCounts = resolvedEvidenceCounts(
    inventory.dependencies,
  );

  const sourceNode = (sourcePath: string): GraphNode | undefined => {
    const surface = surfaceNodesByPath.get(sourcePath);
    if (surface) return surface;
    const skillDirectory = logicalSkillDirectory(sourcePath);
    if (!skillDirectory) return skillsBySourcePath.get(sourcePath);
    const parents = skillParents.get(skillDirectory) ?? [];
    if (parents.length !== 1) return undefined;
    return skillsBySourcePath.get(parents[0]!.sourcePath);
  };

  const invocationEdges = canonicalExecutableInvocationGraphEdges(
    inventory.invocations,
  ).flatMap((edge): GraphEdge[] => {
    const source = sourceNode(edge.sourcePath);
    const target = surfacesByPath.get(edge.normalizedTarget);
    if (!source || !target) return [];
    return [
      {
        from: source.id,
        to: target.path,
        kind: "invokes",
        declaration: "executable-invocation",
        sourcePath: edge.sourcePath,
        resolved: true,
        targetId: target.path,
        targetKind: "script",
        targetPath: target.path,
        evidenceCount:
          invocationEvidenceCounts.get(
            executableEvidenceKey(edge.sourcePath, edge.normalizedTarget),
          ) ?? 0,
      },
    ];
  });

  const dependencyEdges = canonicalExecutableDependencyGraphEdges(
    inventory.dependencies,
  ).flatMap((edge): GraphEdge[] => {
    const source = surfacesByPath.get(edge.sourcePath);
    const target = surfacesByPath.get(edge.normalizedTarget);
    if (!source || !target) return [];
    return [
      {
        from: source.path,
        to: target.path,
        kind: "invokes",
        declaration: "executable-dependency",
        sourcePath: source.path,
        resolved: true,
        targetId: target.path,
        targetKind: "script",
        targetPath: target.path,
        evidenceCount:
          dependencyEvidenceCounts.get(
            executableEvidenceKey(edge.sourcePath, edge.normalizedTarget),
          ) ?? 0,
      },
    ];
  });

  // Structural placement is independent of invocation evidence. The inventory's
  // owningSkill field is a previously resolved path boundary, not ownership.
  const containmentEdges = inventory.surfaces.flatMap(
    (surface): GraphEdge[] => {
      const entrypointPath = surface.owningSkill?.entrypointPath;
      const skill = entrypointPath
        ? skillsBySourcePath.get(entrypointPath)
        : undefined;
      if (!skill || surface.scope !== "skill-local") return [];
      return [
        {
          from: skill.id,
          to: surface.path,
          kind: "contains",
          declaration: "structural-skill-boundary",
          sourcePath: skill.sourcePath,
          resolved: true,
          targetId: surface.path,
          targetKind: "script",
          targetPath: surface.path,
        },
      ];
    },
  );

  const externalNodesById = new Map<string, GraphNode>();
  const externalInvocationEdges = new Map<string, GraphEdge>();
  for (const invocation of inventory.invocations) {
    const externalTarget = normalizedExternalExecutableTarget(invocation);
    if (!externalTarget) continue;
    const source = sourceNode(invocation.sourcePath);
    if (!source) continue;
    const targetId = externalExecutableNodeId(externalTarget);
    if (!externalNodesById.has(targetId)) {
      externalNodesById.set(targetId, {
        id: targetId,
        kind: "script",
        sourcePath: externalTarget,
        ownership: unownedOwnership(),
        tags: [],
        executableRole: "external-executable",
        interpreterHints: [invocation.launcher],
      });
    }
    const key = [source.id, externalTarget].join("\0");
    const current = externalInvocationEdges.get(key);
    externalInvocationEdges.set(key, {
      from: source.id,
      to: externalTarget,
      kind: "invokes",
      declaration: "executable-invocation",
      sourcePath: invocation.sourcePath,
      // The graph node classifies an observed external target; it does not
      // claim repository resolution. Exact unsafe evidence remains below.
      resolved: false,
      targetId,
      targetPath: externalTarget,
      evidenceCount: (current?.evidenceCount ?? 0) + 1,
    });
  }

  const edges = uniqueExecutableEdges([
    ...containmentEdges,
    ...invocationEdges,
    ...dependencyEdges,
    ...externalInvocationEdges.values(),
  ]);
  const invokedBySkills = new Map<string, Set<string>>();
  const skillIds = new Set(skillNodes.map((node) => node.id));
  for (const edge of edges) {
    if (edge.kind !== "invokes" || !skillIds.has(edge.from)) continue;
    const target = edge.targetId ?? edge.to;
    const sources = invokedBySkills.get(target) ?? new Set<string>();
    sources.add(edge.from);
    invokedBySkills.set(target, sources);
  }

  const surfaceNodes = inventory.surfaces.map((surface) => ({
    ...surfaceNodesByPath.get(surface.path)!,
    invokedBySkillCount: invokedBySkills.get(surface.path)?.size ?? 0,
  }));
  const externalNodes = [...externalNodesById.values()].map((node) => ({
    ...node,
    invokedBySkillCount: invokedBySkills.get(node.id)?.size ?? 0,
  }));
  const candidateNodes = [
    ...skillNodes,
    ...surfaceNodes,
    ...externalNodes,
  ].sort(compareGraphNodes);

  let selected: GraphNode | undefined;
  if (focus) {
    selected = candidateNodes.find((node) =>
      matchesFocus(node, report.root, focus),
    );
    if (!selected) {
      throw new CliUserError(
        `graph --view executable --focus did not match any known Skill or executable surface: ${focus}. Run renma scan . --format json and inspect executableSurfaceInventory for unresolved evidence.`,
      );
    }
  }

  const visibleEdges = selected
    ? edges.filter(
        (edge) => edge.from === selected!.id || edge.targetId === selected!.id,
      )
    : edges;
  const visibleNodeIds = new Set(
    selected
      ? [
          selected.id,
          ...visibleEdges.flatMap((edge) => [
            edge.from,
            edge.targetId ?? edge.to,
          ]),
        ]
      : visibleEdges.flatMap((edge) => [edge.from, edge.targetId ?? edge.to]),
  );
  const nodes = candidateNodes.filter((node) => visibleNodeIds.has(node.id));
  const invocationEvidence = selected
    ? inventory.invocations.filter((invocation) => {
        const source = sourceNode(invocation.sourcePath);
        const externalTarget = normalizedExternalExecutableTarget(invocation);
        return (
          source?.id === selected!.id ||
          invocation.normalizedTarget === selected!.id ||
          (externalTarget !== undefined &&
            externalExecutableNodeId(externalTarget) === selected!.id)
        );
      })
    : [...inventory.invocations];
  const dependencyEvidence = selected
    ? inventory.dependencies.filter(
        (dependency) =>
          dependency.sourcePath === selected!.id ||
          dependency.normalizedTarget === selected!.id,
      )
    : [...inventory.dependencies];

  return {
    ...report,
    view: "executable",
    nodeCount: nodes.length,
    edgeCount: visibleEdges.length,
    nodes,
    edges: visibleEdges,
    executable: {
      ...(selected
        ? {
            focus: {
              id: selected.id,
              role: selected.executableRole!,
              sourcePath: selected.sourcePath,
            },
          }
        : {}),
      invocationEvidence,
      dependencyEvidence,
    },
  };
}

/** Render the executable graph and its retained repository diagnostics. */
export function formatExecutableGraphMarkdown(report: GraphReport): string {
  const executable = requiredExecutableProjection(report);
  const nodesById = new Map(report.nodes.map((node) => [node.id, node]));
  const lines = [
    "# Renma Executable Relationships",
    "",
    `- Repository: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    ...(executable.focus
      ? [
          `- Focus: ${executable.focus.id} (${executableRoleLabel(executable.focus.role)}, ${executable.focus.sourcePath})`,
        ]
      : []),
    `- Nodes: ${report.nodeCount}`,
    `- Canonical edges: ${report.edgeCount}`,
    "- Invocation and structural containment are independent. Containment means deterministic repository placement, not ownership or exclusive use.",
    "",
    "## Relationships",
    "",
  ];

  if (report.edges.length === 0) {
    lines.push(
      "No canonical executable relationships were found for this projection.",
      "",
      "Renma renders normalized resolved or non-canonical invocation/dependency targets whose sources map to a Skill or repository script, plus deterministic Skill-local structural placement. Evidence from other source asset kinds stays auditable below without becoming topology. Run `renma scan . --format json` and inspect `executableSurfaceInventory` for missing, unsafe, unavailable, or otherwise unresolved evidence.",
    );
  } else if (executable.focus) {
    const focusNode = nodesById.get(executable.focus.id);
    if (focusNode)
      renderExecutableRelationships(lines, focusNode, report, true);
  } else {
    const visibleSources = report.nodes.filter((node) =>
      report.edges.some((edge) => edge.from === node.id),
    );
    for (const node of visibleSources) {
      renderExecutableRelationships(lines, node, report, false);
    }
    renderSharedExecutableTargets(lines, report, nodesById);
  }

  lines.push(
    "",
    "## Invocation evidence",
    "",
    "| Source | Line | Launcher | Target | Resolution | Occurrence |",
    "| --- | ---: | --- | --- | --- | ---: |",
  );
  if (executable.invocationEvidence.length === 0) {
    lines.push("| (none) |  |  |  |  |  |");
  } else {
    for (const invocation of executable.invocationEvidence) {
      lines.push(
        `| ${tableText(invocation.sourcePath)} | ${invocation.line} | ${invocation.launcher} | ${tableText(invocation.normalizedTarget ?? invocation.rawTarget)} | ${invocation.resolution} | ${invocation.occurrenceOrdinal} |`,
      );
    }
  }

  lines.push(
    "",
    "## Script dependency evidence",
    "",
    "| Source | Line | Analyzer | Relationship | Target | Resolution | Occurrence |",
    "| --- | ---: | --- | --- | --- | --- | ---: |",
  );
  if (executable.dependencyEvidence.length === 0) {
    lines.push("| (none) |  |  |  |  |  |  |");
  } else {
    for (const dependency of executable.dependencyEvidence) {
      lines.push(
        `| ${tableText(dependency.sourcePath)} | ${dependency.line} | ${dependency.analyzer} | ${dependency.relation} | ${tableText(dependency.normalizedTarget ?? (dependency.normalizedTargetCandidates.join(", ") || dependency.rawSpecifier))} | ${dependency.resolution} | ${dependency.occurrenceOrdinal} |`,
      );
    }
  }

  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("", "## Diagnostics", "");
    for (const diagnostic of report.diagnostics) {
      const diagnosticPath = diagnostic.path ? `${diagnostic.path}: ` : "";
      lines.push(
        `- ${diagnostic.severity}: ${diagnosticPath}${diagnostic.message}`,
      );
    }
  }

  lines.push(
    "",
    "Invocation does not imply ownership. Structural containment does not imply exclusive use. Shared scripts can therefore be invoked by Skills other than the Skill whose directory contains them.",
  );
  return `${lines.join("\n")}\n`;
}

/** Render the executable graph and diagnostics as deterministic Mermaid text. */
export function formatExecutableGraphMermaid(report: GraphReport): string {
  requiredExecutableProjection(report);
  const nodeIds = new Map<string, string>();
  const lines = ["graph TD"];
  report.nodes.forEach((node, index) => {
    const id = `executable_${index}`;
    nodeIds.set(node.id, id);
    lines.push(
      `  ${id}["${escapeMermaidLabel(`${executableNodeDescription(node)}: ${node.id}`)}"]`,
    );
  });
  for (const edge of report.edges) {
    const source = nodeIds.get(edge.from);
    const target = nodeIds.get(edge.targetId ?? edge.to);
    if (!source || !target) continue;
    const arrow = edge.kind === "contains" ? "-.->" : "-->";
    lines.push(`  ${source} ${arrow}|${edge.kind}| ${target}`);
  }
  for (const role of [
    "skill",
    "repository-script",
    "external-executable",
  ] as const) {
    const members = report.nodes
      .filter((node) => node.executableRole === role)
      .map((node) => nodeIds.get(node.id))
      .filter((id): id is string => id !== undefined);
    if (members.length === 0) continue;
    const className = role.replace(/-([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
    lines.push(`  classDef ${className} stroke-width:2px`);
    lines.push(`  class ${members.join(",")} ${className}`);
  }
  if (report.edges.length === 0) {
    lines.push(
      "  %% No canonical executable relationships were found. Inspect executableSurfaceInventory in scan JSON for unresolved evidence.",
    );
  }
  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("  %% Diagnostics:");
    for (const diagnostic of report.diagnostics) {
      const diagnosticPath = diagnostic.path ? `${diagnostic.path}: ` : "";
      lines.push(
        `  %% ${singleLine(`${diagnostic.severity}: ${diagnosticPath}${diagnostic.message}`)}`,
      );
    }
  }
  lines.push(
    "  %% Solid edges are normalized invocation relationships. Dotted contains edges are deterministic structural placement only; neither relationship states ownership or exclusive use.",
  );
  return `${lines.join("\n")}\n`;
}

function resolvedEvidenceCounts(
  evidenceRows: readonly ResolvedExecutableEvidence[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const evidence of evidenceRows) {
    if (
      (evidence.resolution !== "resolved" &&
        evidence.resolution !== "noncanonical") ||
      evidence.normalizedTarget === undefined
    ) {
      continue;
    }
    const key = executableEvidenceKey(
      evidence.sourcePath,
      evidence.normalizedTarget,
    );
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function executableEvidenceKey(
  sourcePath: string,
  normalizedTarget: string,
): string {
  return JSON.stringify([sourcePath, normalizedTarget]);
}

function normalizedExternalExecutableTarget(
  invocation: ExecutableSurfaceInvocation,
): string | undefined {
  const target = invocation.rawTarget.replaceAll("\\", "/");
  if (
    invocation.resolution !== "unsafe" ||
    (!path.posix.isAbsolute(target) && !/^[A-Za-z]:\//u.test(target))
  ) {
    return undefined;
  }
  return path.posix.normalize(target);
}

function externalExecutableNodeId(rawTarget: string): string {
  return `external:${rawTarget.replaceAll("\\", "/")}`;
}

function surfaceNode(
  surface: ExecutableSurfaceEntry,
  catalogNodesBySourcePath: ReadonlyMap<string, GraphNode>,
): GraphNode {
  const catalogNode = catalogNodesBySourcePath.get(surface.path);
  return {
    ...(catalogNode ?? {
      id: surface.path,
      kind: "script" as const,
      sourcePath: surface.path,
      ownership: unownedOwnership(),
      tags: [],
    }),
    id: surface.path,
    kind: "script",
    sourcePath: surface.path,
    executableRole: "repository-script",
    executableScope: surface.scope,
    interpreterHints: [...surface.interpreterHints],
  };
}

function uniqueExecutableEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  const unique = new Map<string, GraphEdge>();
  for (const edge of edges) {
    const key = [edge.from, edge.kind, edge.to].join("\0");
    const current = unique.get(key);
    if (!current) {
      unique.set(key, edge);
      continue;
    }
    unique.set(key, {
      ...current,
      ...(current.evidenceCount === undefined &&
      edge.evidenceCount === undefined
        ? {}
        : {
            evidenceCount:
              (current.evidenceCount ?? 0) + (edge.evidenceCount ?? 0),
          }),
    });
  }
  return [...unique.values()].sort(compareGraphEdges);
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

function renderExecutableRelationships(
  lines: string[],
  node: GraphNode,
  report: GraphReport,
  includeIncoming: boolean,
): void {
  const nodesById = new Map(
    report.nodes.map((candidate) => [candidate.id, candidate]),
  );
  lines.push(`### ${node.id} (${executableNodeDescription(node)})`, "");
  const relationships: string[] = [];
  for (const edge of report.edges.filter(
    (candidate) => candidate.from === node.id,
  )) {
    const target = nodesById.get(edge.targetId ?? edge.to);
    const shared =
      edge.kind === "invokes" && (target?.invokedBySkillCount ?? 0) > 1
        ? `; shared by ${target!.invokedBySkillCount} Skills`
        : "";
    relationships.push(
      `- ${edge.kind} → ${edge.to}${target ? ` (${executableNodeDescription(target)}${shared})` : ""}`,
    );
  }
  if (includeIncoming) {
    for (const edge of report.edges.filter(
      (candidate) =>
        candidate.from !== node.id &&
        (candidate.targetId ?? candidate.to) === node.id,
    )) {
      const source = nodesById.get(edge.from);
      const reverse =
        edge.kind === "contains"
          ? "belongs to"
          : source?.executableRole === "skill"
            ? "used by"
            : "invoked by";
      relationships.push(
        `- ${reverse} → ${edge.from}${source ? ` (${executableNodeDescription(source)})` : ""}`,
      );
    }
  }
  lines.push(...(relationships.length > 0 ? relationships : ["- (none)"]), "");
}

function renderSharedExecutableTargets(
  lines: string[],
  report: GraphReport,
  nodesById: ReadonlyMap<string, GraphNode>,
): void {
  const shared = report.nodes.filter(
    (node) =>
      node.executableRole === "repository-script" &&
      (node.invokedBySkillCount ?? 0) > 1,
  );
  if (shared.length === 0) return;
  lines.push("## Shared scripts", "");
  for (const node of shared) {
    const skills = report.edges
      .filter(
        (edge) =>
          edge.kind === "invokes" &&
          edge.targetId === node.id &&
          nodesById.get(edge.from)?.executableRole === "skill",
      )
      .map((edge) => edge.from)
      .sort((left, right) => compareUtf16CodeUnits(left, right));
    lines.push(`- ${node.sourcePath}: used by → ${skills.join(", ")}`);
  }
}

function executableNodeDescription(node: GraphNode): string {
  const label = executableRoleLabel(node.executableRole ?? "repository-script");
  if (node.executableRole !== "repository-script") return label;
  return node.executableScope ? `${label}; ${node.executableScope}` : label;
}

function executableRoleLabel(role: ExecutableGraphNodeRole): string {
  switch (role) {
    case "skill":
      return "Skill";
    case "repository-script":
      return "repository script";
    case "external-executable":
      return "external executable";
  }
}

function requiredExecutableProjection(
  report: GraphReport,
): ExecutableGraphProjection {
  if (!report.executable) {
    throw new Error(
      "Executable graph formatting requires a resolved executable projection.",
    );
  }
  return report.executable;
}

function tableText(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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

function escapeMermaidLabel(label: string): string {
  return singleLine(label).replace(/"/g, '\\"');
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
}

function unownedOwnership(): AssetOwnership {
  return {
    declaredOwner: null,
    effectiveOwner: null,
    source: "unowned",
  };
}
