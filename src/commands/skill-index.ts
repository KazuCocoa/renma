import type { ConfigOverrides } from "../config.js";
import type { AssetOwnership } from "../model.js";
import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";
import {
  collectRepositorySnapshot,
  repositoryDiagnosticsWithoutSkillDiscovery,
  type RepositorySnapshot,
} from "../repository-evidence.js";
import {
  focusSkillDiscoveryIndex,
  type DeclaredSkillRoute,
  type SkillDiscoveryAdoption,
  type SkillDiscoveryCoverage,
  type SkillDiscoveryDiagnostic,
  type SkillDiscoverySummary,
  type VisibleSkillIdentity,
} from "../skill-discovery.js";
import type { Diagnostic, Evidence } from "../types.js";

export type SkillIndexFormat = "json" | "markdown";

/** Canonical complete or exactly focused static Skill Index report. */
export interface SkillIndexReportV1 {
  schemaVersion: "renma.skill-index.v1";
  root: string;
  configPath?: string;
  scannedFileCount: number;
  focus?: {
    id: string;
    sourcePath: string;
  };
  adoption: SkillDiscoveryAdoption;
  coverage: SkillDiscoveryCoverage;
  summary: SkillDiscoverySummary;
  skills: VisibleSkillIdentity[];
  routes: DeclaredSkillRoute[];
  publishedEntrypointIds: string[];
  reachableDiscoveryEligibleSkillIds: string[];
  notReachedDiscoveryEligibleSkillIds: string[];
  structuralRootIds: string[];
  standaloneSkillIds: string[];
  unroutedSkillIds: string[];
  diagnostics: {
    repository: Diagnostic[];
    discovery: SkillDiscoveryDiagnostic[];
  };
}

export async function runSkillIndexCommand(
  targetPath: string,
  options: {
    format: SkillIndexFormat;
    focus?: string;
    overrides?: ConfigOverrides;
  },
): Promise<number> {
  const report = buildSkillIndexReport(
    await collectRepositorySnapshot(targetPath, options.overrides ?? {}),
    options.focus,
  );
  process.stdout.write(
    options.format === "json"
      ? formatSkillIndexJson(report)
      : formatSkillIndexMarkdown(report),
  );
  return [
    ...report.diagnostics.repository,
    ...report.diagnostics.discovery,
  ].some((diagnostic) => diagnostic.severity === "error")
    ? 1
    : 0;
}

/** Build the report from one already prepared repository snapshot. */
export function buildSkillIndexReport(
  snapshot: RepositorySnapshot,
  focus?: string,
): SkillIndexReportV1 {
  const discovery =
    focus !== undefined
      ? focusSkillDiscoveryIndex(snapshot.skillDiscovery, focus, "skill-index")
      : snapshot.skillDiscovery;
  const repositoryDiagnostics = [
    ...repositoryDiagnosticsWithoutSkillDiscovery(snapshot),
  ];

  return {
    schemaVersion: "renma.skill-index.v1",
    root: snapshot.root,
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    scannedFileCount: snapshot.scannedFileCount,
    ...(discovery.focus ? { focus: discovery.focus } : {}),
    adoption: discovery.adoption,
    coverage: discovery.coverage,
    summary: discovery.summary,
    skills: discovery.skills,
    routes: discovery.routes,
    publishedEntrypointIds: discovery.publishedEntrypointIds,
    reachableDiscoveryEligibleSkillIds:
      discovery.reachableDiscoveryEligibleSkillIds,
    notReachedDiscoveryEligibleSkillIds:
      discovery.notReachedDiscoveryEligibleSkillIds,
    structuralRootIds: discovery.structuralRootIds,
    standaloneSkillIds: discovery.standaloneSkillIds,
    unroutedSkillIds: discovery.unroutedSkillIds,
    diagnostics: {
      repository: repositoryDiagnostics,
      discovery: discovery.diagnostics,
    },
  };
}

export function formatSkillIndexJson(report: SkillIndexReportV1): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatSkillIndexMarkdown(report: SkillIndexReportV1): string {
  const lines = [
    "# Renma Skill Index",
    "",
    `- Schema: ${report.schemaVersion}`,
    `- Repository: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    `- Scanned files: ${report.scannedFileCount}`,
    "",
    "This is a static Skill index.",
    "",
    "Renma does not interpret the user request, select the best Skill, load Context, or execute a workflow.",
    "",
    "## Summary",
    "",
    "Summary counts and visible ID arrays are projection-scoped. Coverage is repository-scoped.",
    "",
    `- Visible Skills: ${report.summary.visibleSkillCount}`,
    `- Discovery-eligible Skills: ${report.summary.routeEligibleSkillCount}`,
    `- Published entrypoints: ${report.summary.publishedEntrypointCount}`,
    `- Declared routes: ${report.summary.declaredRouteCount}`,
    `- Usable routes: ${report.summary.usableRouteCount}`,
    `- Reachable eligible Skills: ${report.summary.reachableSkillCount}`,
    `- Not-reached eligible Skills: ${report.summary.notReachedSkillCount}`,
    `- Structural roots: ${report.summary.structuralRootCount}`,
    `- Standalone Skills: ${report.summary.standaloneSkillCount}`,
    `- Unrouted Skills: ${report.summary.unroutedSkillCount}`,
    `- Repository diagnostics: ${report.diagnostics.repository.length}`,
    `- Discovery diagnostics: ${report.diagnostics.discovery.length}`,
    "",
    "## Adoption and coverage",
    "",
    `- Adoption state: ${report.adoption.state}`,
    `- Adoption reason: ${report.adoption.reason}`,
    `- Discovery metadata present: ${yesNo(report.adoption.discoveryMetadataPresent)}`,
    `- Repository-wide adopted: ${yesNo(report.adoption.repositoryWideAdopted)}`,
    `- Effective published entrypoints repository-wide: ${report.adoption.publishedEntrypointCount}`,
    `- Coverage scope: ${report.coverage.scope}`,
    `- Coverage mode: ${report.coverage.mode}`,
    `- Coverage reason: ${report.coverage.reason}`,
    `- Source entrypoints: ${report.coverage.sourceEntrypointIds.join(", ") || "(none)"}`,
    `- Eligible Skills repository-wide: ${report.coverage.eligibleSkillCount}`,
    `- Reachable eligible Skills repository-wide: ${report.coverage.reachableSkillCount}`,
    `- Not-reached eligible Skills repository-wide: ${report.coverage.notReachedSkillCount}`,
    `- Authoritative completeness: ${report.coverage.complete === null ? "not applicable" : yesNo(report.coverage.complete)}`,
  ];

  if (report.coverage.mode === "descriptive") {
    lines.push(
      "",
      "Descriptive coverage is review evidence, not a repository-wide completeness claim.",
    );
  }
  if (report.coverage.mode === "authoritative") {
    lines.push(
      "",
      "Authoritative coverage is evaluated only because the repository explicitly declared skill_discovery.adopted: true.",
    );
  }

  if (report.focus) renderFocusedSkill(lines, report);
  renderPublishedEntrypoints(lines, report);
  renderAuthoritativeCoverageGaps(lines, report);
  renderStructuralCandidates(lines, report);
  renderDiagnostics(
    lines,
    "Discovery diagnostics",
    report.diagnostics.discovery,
  );
  renderDiagnostics(
    lines,
    "Repository diagnostics",
    report.diagnostics.repository,
  );
  lines.push(
    "",
    "## How to continue",
    "",
    "1. Open the referenced source `SKILL.md`.",
    "2. Apply its description and routing conditions to the current request.",
    "3. Follow only a continuation whose source Skill conditions support it.",
    "",
    "Renma reports possible declared paths; it does not choose or execute them.",
  );
  return `${lines.join("\n")}\n`;
}

const PRESENTATION_CAP = DEFAULT_QUALITY_PROFILE.presentation.topSummaryItemCap;

function renderFocusedSkill(lines: string[], report: SkillIndexReportV1): void {
  const focus = report.focus!;
  const skill = report.skills.find(
    (candidate) => candidate.sourcePath === focus.sourcePath,
  );
  lines.push(
    "",
    "## Focused Skill",
    "",
    "Focus is an exact static projection, not a recommendation or runtime selection.",
    "",
    `### ${focus.id}`,
    "",
    `- Source: ${focus.sourcePath}`,
  );
  if (!skill) return;
  lines.push(
    `- Description: ${singleLine(skill.description ?? "(unavailable)")}`,
    `- Owner: ${formatOwnership(skill.ownership)}`,
    `- Lifecycle: ${skill.lifecycle ?? "(unspecified)"}`,
    `- Publication: ${skill.publication.accepted ? "published" : skill.publication.requested ? `rejected (${skill.publication.rejectionReasons.join(", ")})` : "not published"}`,
    `- Reachability: ${reachabilityLabel(skill)}`,
    `- Structural root: ${yesNo(skill.structuralRoot)}`,
    `- Standalone: ${yesNo(skill.standalone)}`,
    `- Unrouted: ${yesNo(skill.unrouted)}`,
    "",
    "#### Direct incoming declarations",
    "",
  );
  const incoming = report.routes.filter(
    (route) =>
      route.resolvedTarget?.sourcePath === skill.sourcePath ||
      route.candidates.some(
        (candidate) => candidate.sourcePath === skill.sourcePath,
      ),
  );
  renderRoutes(lines, incoming);
  lines.push("", "#### Direct outgoing declarations", "");
  renderRoutes(
    lines,
    report.routes.filter((route) => route.sourcePath === skill.sourcePath),
  );
}

function renderPublishedEntrypoints(
  lines: string[],
  report: SkillIndexReportV1,
): void {
  lines.push(
    "",
    "## Published entrypoints",
    "",
    "Published entrypoints are explicit first-hop declarations. Structural roots are derived graph facts.",
    "",
  );
  if (report.publishedEntrypointIds.length === 0) {
    lines.push(
      report.focus && report.adoption.publishedEntrypointCount > 0
        ? "No effective published entrypoint is visible in this focused projection. Repository-wide adoption and coverage remain above."
        : `No effective published entrypoint is visible. Repository adoption is ${report.adoption.state}.`,
    );
    return;
  }

  const visibleIds = report.publishedEntrypointIds.slice(0, PRESENTATION_CAP);
  for (const id of visibleIds) {
    const skill = report.skills.find(
      (candidate) => candidate.id === id && candidate.publication.accepted,
    );
    if (!skill) continue;
    lines.push(
      `### ${skill.id}`,
      "",
      `- Description: ${singleLine(skill.description ?? "(unavailable)")}`,
      `- Source: ${skill.sourcePath}`,
      `- Owner: ${formatOwnership(skill.ownership)}`,
      `- Lifecycle: ${skill.lifecycle ?? "(unspecified)"}`,
      `- Structural root: ${yesNo(skill.structuralRoot)}`,
      `- Standalone: ${yesNo(skill.standalone)}`,
      `- Unrouted: ${yesNo(skill.unrouted)}`,
      `- Reachability: ${reachabilityLabel(skill)}`,
      "- Direct declared continuations:",
      "",
    );
    renderRoutes(
      lines,
      report.routes.filter((route) => route.sourcePath === skill.sourcePath),
    );
    lines.push("");
  }
  appendOmission(
    lines,
    report.publishedEntrypointIds.length,
    "published entrypoints",
  );
}

function renderAuthoritativeCoverageGaps(
  lines: string[],
  report: SkillIndexReportV1,
): void {
  if (report.coverage.mode !== "authoritative") return;
  lines.push("", "## Authoritative coverage gaps", "");
  if (report.coverage.complete) {
    lines.push(
      "None. Every Discovery-eligible Skill is reachable from an effective published entrypoint.",
    );
    return;
  }
  if (report.notReachedDiscoveryEligibleSkillIds.length === 0) {
    lines.push(
      "The focused projection does not contain the repository-wide gap. Coverage remains incomplete; use unfocused JSON for the complete list.",
    );
    return;
  }
  for (const id of report.notReachedDiscoveryEligibleSkillIds.slice(
    0,
    PRESENTATION_CAP,
  )) {
    const skill = report.skills.find((candidate) => candidate.id === id);
    lines.push(
      `- ${id}${skill ? ` — ${skill.sourcePath} (structural root: ${yesNo(skill.structuralRoot)}; standalone: ${yesNo(skill.standalone)}; unrouted: ${yesNo(skill.unrouted)})` : ""}`,
    );
  }
  appendOmission(
    lines,
    report.notReachedDiscoveryEligibleSkillIds.length,
    "coverage gaps",
  );
  lines.push(
    "",
    "This is static declared-graph coverage evidence, not a claim that a Skill is unused at runtime. The complete repository-wide list is available in unfocused JSON.",
  );
}

function renderStructuralCandidates(
  lines: string[],
  report: SkillIndexReportV1,
): void {
  lines.push(
    "",
    "## Structural candidates",
    "",
    "Structural roots are derived graph facts.",
    "",
    "Published entrypoints are explicit first-hop declarations.",
    "",
    "Unrouted Skills are eligible structural roots that are not published entrypoints.",
    "",
  );
  renderSkillIds(lines, "Structural roots", report.structuralRootIds, report);
  lines.push("");
  renderSkillIds(lines, "Standalone Skills", report.standaloneSkillIds, report);
  lines.push("");
  renderSkillIds(lines, "Unrouted Skills", report.unroutedSkillIds, report);
  lines.push(
    "",
    "These are review candidates, not recommendations. Complete projection-scoped arrays are available in JSON.",
  );
}

function renderSkillIds(
  lines: string[],
  heading: string,
  ids: string[],
  report: SkillIndexReportV1,
): void {
  lines.push(`### ${heading}`, "");
  if (ids.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const id of ids.slice(0, PRESENTATION_CAP)) {
    const skill = report.skills.find((candidate) => candidate.id === id);
    lines.push(`- ${id}${skill ? ` — ${skill.sourcePath}` : ""}`);
  }
  appendOmission(lines, ids.length, heading.toLowerCase());
}

function renderRoutes(lines: string[], routes: DeclaredSkillRoute[]): void {
  if (routes.length === 0) {
    lines.push("- None.");
    return;
  }
  lines.push(
    "| Source | Index | Declared target | Resolved target | Resolution | Usability | Evidence |",
    "| --- | ---: | --- | --- | --- | --- | --- |",
  );
  for (const route of routes.slice(0, PRESENTATION_CAP)) {
    lines.push(
      `| ${tableText(`${route.sourceId} (${route.sourcePath})`)} | ${route.declarationIndex} | ${tableText(route.rawTarget)} | ${tableText(resolvedTargetLabel(route))} | ${tableText(route.resolution)} | ${tableText(route.usable ? "usable" : `unusable: ${route.usabilityReasons.join(", ")}`)} | ${tableText(evidenceLabel(route.evidence, route.sourcePath))} |`,
    );
  }
  appendOmission(lines, routes.length, "declared continuations");
}

function renderDiagnostics(
  lines: string[],
  heading: string,
  diagnostics: Diagnostic[],
): void {
  lines.push("", `## ${heading}`, "");
  if (diagnostics.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const diagnostic of diagnostics.slice(0, PRESENTATION_CAP)) {
    const location = diagnostic.evidence
      ? evidenceLabel(diagnostic.evidence, diagnostic.path ?? "repository")
      : (diagnostic.path ?? "repository");
    lines.push(
      `- ${diagnostic.code ?? "RENMA-DIAGNOSTIC"} [${diagnostic.severity}] (${location}): ${singleLine(diagnostic.message)}`,
    );
  }
  appendOmission(lines, diagnostics.length, heading.toLowerCase());
}

function appendOmission(
  lines: string[],
  totalCount: number,
  label: string,
): void {
  const omittedCount = totalCount - PRESENTATION_CAP;
  if (omittedCount <= 0) return;
  lines.push(
    `- ... ${omittedCount} more ${label} omitted from Markdown output. Use JSON for complete evidence.`,
  );
}

function resolvedTargetLabel(route: DeclaredSkillRoute): string {
  if (!route.resolvedTarget) return "(none)";
  return `${route.resolvedTarget.id} (${route.resolvedTarget.sourcePath})`;
}

function reachabilityLabel(skill: VisibleSkillIdentity): string {
  const depth =
    skill.reachability.minimumDepth === undefined
      ? "n/a"
      : skill.reachability.minimumDepth.toString();
  return `${skill.reachability.state} (${skill.reachability.reason}; minimum depth ${depth}; sources ${skill.reachability.sourceEntrypointIds.join(", ") || "none"})`;
}

function formatOwnership(ownership: AssetOwnership): string {
  if (ownership.source === "unowned") return "(unowned)";
  const provenance =
    ownership.source === "inherited" && ownership.inheritedFrom
      ? ` from ${ownership.inheritedFrom.sourcePath}`
      : "";
  return `${ownership.effectiveOwner ?? "(unowned)"} (${ownership.source}${provenance})`;
}

function evidenceLabel(evidence: Evidence, fallbackPath: string): string {
  const lines =
    evidence.startLine === evidence.endLine
      ? `L${evidence.startLine}`
      : `L${evidence.startLine}-L${evidence.endLine}`;
  return `${evidence.path || fallbackPath}:${lines}`;
}

function tableText(value: string): string {
  return singleLine(value).replace(/\|/g, "\\|");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
