import { formatOwnership } from "./graph-format.js";
import type { GraphReport } from "../graph-report.js";
import {
  evidenceLabel,
  tableText,
  yesNo,
  escapeMermaidLabel,
  singleLine,
} from "./graph-format.js";
import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";
import type {
  SkillDiscoveryIndex,
  DeclaredSkillRoute,
} from "../skill-discovery.js";

export function formatDiscoveryMarkdown(report: GraphReport): string {
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

export function formatDiscoveryMermaid(report: GraphReport): string {
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

function requiredDiscoveryReport(report: GraphReport): SkillDiscoveryIndex {
  if (!report.discovery) {
    throw new Error(
      "Discovery graph formatting requires a resolved Skill Discovery report.",
    );
  }
  return report.discovery;
}
