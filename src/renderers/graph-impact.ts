import type { GraphReport } from "../graph-report.js";
import {
  bindingLabel,
  evidenceLabel,
  tableText,
  yesNo,
  escapeMermaidLabel,
  escapeMermaidEdgeLabel,
} from "./graph-format.js";
import { normalizeDependencyReference } from "../dependency-resolution.js";
import { focusedProvenanceTarget } from "../graph-report.js";
import type {
  ImpactAsset,
  ImpactProvenanceEdge,
  DeclaredImpactReport,
} from "../declared-impact.js";

export function formatImpactMarkdown(report: GraphReport): string {
  const impact = requiredImpactReport(report);
  const lines = [
    "# Renma Declared Impact",
    "",
    `- Repository: ${report.root}`,
    `- Focus: ${impact.focus.id} (${impact.focus.kind}, ${impact.focus.sourcePath})`,
    `- Required declared dependents: ${impact.requiredDependents.length}`,
    `- Optional declared dependents: ${impact.optionalDependents.length}`,
    ...(impact.bindingSatisfaction
      ? [
          `- Required bindings satisfied: ${yesNo(impact.bindingSatisfaction.requiredSatisfied)}`,
          `- Optional bindings satisfied: ${yesNo(impact.bindingSatisfaction.optionalSatisfied)}`,
        ]
      : []),
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
        `| ${tableText(edge.from)} | ${tableText(edge.relationship + bindingLabel(edge))} | ${edge.dependentMembership} | ${tableText(edge.to)} | ${yesNo(edge.direct)} | ${tableText(edge.declaredTarget)} | ${tableText(evidenceLabel(edge.evidence, edge.sourcePath))} |`,
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
        `- Invalid ${mismatch.relationship}: ${mismatch.sourceId} -> ${mismatch.resolvedTargetId}${bindingLabel(mismatch)}; ${kindProblems.join("; ")} (${evidenceLabel(mismatch.evidence, mismatch.sourcePath)}).`,
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
      .filter(
        (edge) =>
          edge.from === asset.id &&
          normalizeDependencyReference(edge.sourcePath) ===
            normalizeDependencyReference(asset.sourcePath),
      )
      .map(
        (edge) =>
          `${edge.relationship} ${edge.to} (${edge.dependentMembership}; ${evidenceLabel(edge.evidence, edge.sourcePath)})`,
      );
    lines.push(
      `| ${tableText(asset.id + (asset.releaseVersion ? ` @${asset.releaseVersion}` : ""))} | ${asset.kind} | ${tableText(asset.sourcePath)} | ${yesNo(asset.direct)} | ${tableText(declarations.join("; "))} |`,
    );
  }
}

export function formatImpactMermaid(report: GraphReport): string {
  const impact = requiredImpactReport(report);
  const nodeIds = new Map<string, string>();
  const lines = ["graph TD"];
  report.nodes.forEach((node, index) => {
    const id = `node_${index}`;
    nodeIds.set(node.id, id);
    nodeIds.set(node.sourcePath, id);
    const focus = node.sourcePath === impact.focus.sourcePath ? "focus " : "";
    lines.push(
      `  ${id}["${escapeMermaidLabel(`${focus}${node.kind}: ${node.id}${node.releaseVersion ? ` @${node.releaseVersion}` : ""}`)}"]`,
    );
  });

  for (const edge of impact.provenanceEdges) {
    const source = nodeIds.get(edge.sourcePath);
    const target = nodeIds.get(
      focusedProvenanceTarget(edge, report.nodes)?.sourcePath ?? edge.to,
    );
    if (!source || !target) continue;
    const arrow = edge.dependentMembership === "required" ? "-->" : "-.->";
    lines.push(
      `  ${source} ${arrow}|${escapeMermaidEdgeLabel(`${edge.relationship} ${edge.dependentMembership}${bindingLabel(edge)}`)}| ${target}`,
    );
  }

  impact.invalidIncomingDeclarations.forEach((mismatch, index) => {
    let source = nodeIds.get(mismatch.sourcePath);
    if (!source) {
      source = `invalid_source_${index}`;
      nodeIds.set(mismatch.sourcePath, source);
      lines.push(
        `  ${source}["${escapeMermaidLabel(`invalid source: ${mismatch.sourceId}`)}"]`,
      );
    }
    const target = nodeIds.get(mismatch.resolvedTargetPath);
    if (target) {
      lines.push(
        `  ${source} -.->|${escapeMermaidEdgeLabel(`${mismatch.relationship} invalid kind${bindingLabel(mismatch)}`)}| ${target}`,
      );
    }
  });

  const focusNode = nodeIds.get(impact.focus.sourcePath);
  if (focusNode) {
    lines.push("  classDef impactFocus stroke-width:3px");
    lines.push(`  class ${focusNode} impactFocus`);
  }
  lines.push(
    "  %% Solid edges are required declared impact; dotted edges are optional declared impact. Invalid edges are explicitly labeled. This is not runtime usage or breakage prediction.",
  );
  return `${lines.join("\n")}\n`;
}

function requiredImpactReport(report: GraphReport): DeclaredImpactReport {
  if (!report.impact) {
    throw new Error(
      "Impact graph formatting requires a resolved declared impact report.",
    );
  }
  return report.impact;
}
