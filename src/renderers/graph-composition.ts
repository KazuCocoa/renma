import { compareUtf16CodeUnits } from "../canonical-json.js";
import type { GraphReport } from "../graph-report.js";
import {
  bindingLabel,
  evidenceLabel,
  tableText,
  yesNo,
  escapeMermaidLabel,
  escapeMermaidEdgeLabel,
} from "./graph-format.js";
import { focusedProvenanceTarget } from "../graph-report.js";
import type {
  CompositionProvenanceEdge,
  DeclaredCompositionReport,
  CompositionResolutionIssue,
  CompositionConflict,
} from "../declared-composition.js";

export function formatCompositionMarkdown(report: GraphReport): string {
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
    ...(composition.bindingSatisfaction
      ? [
          `- Required bindings satisfied: ${yesNo(composition.bindingSatisfaction.requiredSatisfied)}`,
          `- Optional bindings satisfied: ${yesNo(composition.bindingSatisfaction.optionalSatisfied)}`,
        ]
      : []),
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
        `| ${tableText(edge.from)} | ${tableText(edge.relationship + bindingLabel(edge))} | ${edge.membership} | ${tableText(edge.to)} | ${tableText(edge.declaredTarget)} | ${tableText(evidenceLabel(edge.evidence, edge.sourcePath))} |`,
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
        (edge) =>
          focusedProvenanceTarget(edge, report.nodes)?.sourcePath ===
          asset.sourcePath,
      ),
    }))
    .filter(({ parents }) => parents.length > 1);
  lines.push("", "## Multiple declarations", "");
  if (multipleParents.length === 0) {
    lines.push("- None.");
  } else {
    for (const { asset, parents } of multipleParents) {
      lines.push(
        `- ${asset.id}: ${parents.length} retained declaration routes from ${[...new Set(parents.map((edge) => edge.from))].sort(compareUtf16CodeUnits).join(", ")}.`,
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
        `- ${mismatch.membership}: ${mismatch.sourceId} ${mismatch.relationship} ${mismatch.declaredTarget}${bindingLabel(mismatch)}; ${kindProblems.join("; ")} (${evidenceLabel(mismatch.evidence, mismatch.sourcePath)}).`,
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
      .filter(
        (edge) =>
          focusedProvenanceTarget(edge, assets)?.sourcePath ===
          asset.sourcePath,
      )
      .map(
        (edge) =>
          `${edge.from} (${edge.relationship}, ${edge.membership}, ${evidenceLabel(edge.evidence, edge.sourcePath)})`,
      );
    lines.push(
      `| ${tableText(asset.id + (asset.releaseVersion ? ` @${asset.releaseVersion}` : ""))} | ${asset.kind} | ${tableText(asset.sourcePath)} | ${yesNo(asset.direct === true)} | ${tableText(parents.join("; "))} |`,
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
      `- ${issue.sourceId} ${issue.relationship} ${issue.declaredTarget}${bindingLabel(issue)}${issue.resolutionReason ? ` [${issue.resolutionReason}${issue.candidatePaths ? `: ${issue.candidatePaths.join(", ")}` : ""}]` : ""} (${evidenceLabel(issue.evidence, issue.sourcePath)}).`,
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

export function formatCompositionMermaid(report: GraphReport): string {
  const composition = requiredCompositionReport(report);
  const nodeIds = new Map<string, string>();
  const lines = ["graph TD"];
  report.nodes.forEach((node, index) => {
    const id = `node_${index}`;
    nodeIds.set(node.id, id);
    nodeIds.set(node.sourcePath, id);
    const root = node.sourcePath === composition.root.sourcePath ? "root " : "";
    lines.push(
      `  ${id}["${escapeMermaidLabel(`${root}${node.kind}: ${node.id}${node.releaseVersion ? ` @${node.releaseVersion}` : ""}`)}"]`,
    );
  });

  const cycleEdges = new Set(
    [...composition.requiredCycles, ...composition.optionalCycles].flatMap(
      (cycle) => cycle.edges.map(compositionEdgeKey),
    ),
  );
  for (const edge of composition.provenanceEdges) {
    const source = nodeIds.get(edge.sourcePath);
    const target = nodeIds.get(
      focusedProvenanceTarget(edge, report.nodes)?.sourcePath ?? edge.to,
    );
    if (!source || !target) continue;
    const arrow = edge.membership === "required" ? "-->" : "-.->";
    const cycle = cycleEdges.has(compositionEdgeKey(edge)) ? " cycle" : "";
    lines.push(
      `  ${source} ${arrow}|${escapeMermaidEdgeLabel(`${edge.relationship} ${edge.membership}${cycle}${bindingLabel(edge)}`)}| ${target}`,
    );
  }

  const unresolved = [
    ...composition.unresolvedRequired,
    ...composition.unresolvedOptional,
  ];
  unresolved.forEach((issue, index) => {
    const missing = `missing_${index}`;
    lines.push(
      `  ${missing}["${escapeMermaidLabel(`${issue.resolutionReason ?? "unresolved"}: ${issue.declaredTarget}`)}"]`,
    );
    const source = nodeIds.get(issue.sourcePath);
    if (source) {
      const arrow = issue.membership === "required" ? "-->" : "-.->";
      lines.push(
        `  ${source} ${arrow}|${escapeMermaidEdgeLabel(`${issue.relationship} ${issue.membership} unresolved${bindingLabel(issue)}`)}| ${missing}`,
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
    const source = nodeIds.get(mismatch.sourcePath);
    if (source) {
      const arrow = mismatch.membership === "required" ? "-->" : "-.->";
      lines.push(
        `  ${source} ${arrow}|${escapeMermaidEdgeLabel(`${mismatch.relationship} invalid kind${bindingLabel(mismatch)}`)}| ${wrong}`,
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

  const rootNode = nodeIds.get(composition.root.sourcePath);
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
  return [
    edge.from,
    edge.to,
    edge.sourcePath,
    edge.declaredTarget,
    edge.relationship,
    edge.membership,
  ].join("\0");
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
