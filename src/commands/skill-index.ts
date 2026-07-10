import { parseArgs } from "node:util";

import { ConfigError, type ConfigOverrides } from "../config.js";
import { collectRepositorySnapshot } from "../repository-evidence.js";
import {
  buildSkillIndex,
  type SkillIndexEntry,
  type SkillIndexReport,
  type SkillRoute,
} from "../skill-discovery.js";

export type SkillIndexFormat = "json" | "markdown" | "mermaid";
export type SkillIndexView = "entrypoints" | "routes" | "full";

export interface SkillIndexProjection extends SkillIndexReport {
  view: SkillIndexView;
  focus?: string;
}

/** Run the experimental skill-index CLI entrypoint. */
export async function runSkillIndexCli(
  argv: string[],
  version: string,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c" },
        focus: { type: "string" },
        format: { type: "string" },
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        view: { type: "string" },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run `renma skill-index --help` for usage.");
    return 2;
  }

  if (parsed.values.help) {
    console.log(skillIndexHelp(version));
    return 0;
  }

  if (parsed.positionals.length > 1) {
    console.error("skill-index accepts at most one repository path.");
    console.error("Run `renma skill-index --help` for usage.");
    return 2;
  }

  const targetPath = parsed.positionals[0] ?? ".";
  const formatValue = parsed.values.json
    ? "json"
    : (stringValue(parsed.values.format) ?? "markdown");
  if (!isSkillIndexFormat(formatValue)) {
    console.error("--format must be one of: json, markdown, mermaid.");
    console.error("Run `renma skill-index --help` for usage.");
    return 2;
  }

  const viewValue = stringValue(parsed.values.view) ?? "entrypoints";
  if (!isSkillIndexView(viewValue)) {
    console.error("--view must be one of: entrypoints, routes, full.");
    console.error("Run `renma skill-index --help` for usage.");
    return 2;
  }

  const configPath = stringValue(parsed.values.config);
  const focus = stringValue(parsed.values.focus)?.trim();
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runSkillIndexCommand(targetPath, {
      format: formatValue,
      view: viewValue,
      ...(focus ? { focus } : {}),
      overrides,
    });
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

/** Collect, project, format, and print a skill discovery index. */
export async function runSkillIndexCommand(
  targetPath: string,
  options: {
    format: SkillIndexFormat;
    view?: SkillIndexView;
    focus?: string;
    overrides?: ConfigOverrides;
  },
): Promise<number> {
  const report = await skillIndex(targetPath, options.overrides ?? {});
  const projection = projectSkillIndex(
    report,
    options.view ?? "entrypoints",
    options.focus,
  );
  process.stdout.write(formatSkillIndex(projection, options.format));
  return projection.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
}

/** Build the canonical full skill-index report. */
export async function skillIndex(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<SkillIndexReport> {
  return buildSkillIndex(
    await collectRepositorySnapshot(targetPath, overrides),
  );
}

/** Produce a bounded view without changing the canonical full report. */
export function projectSkillIndex(
  report: SkillIndexReport,
  view: SkillIndexView,
  focus?: string,
): SkillIndexProjection {
  if (focus) return focusProjection(report, view, focus);

  if (view === "entrypoints") {
    const entrypointIds = new Set(report.entrypointIds);
    const skills = report.skills.filter((skill) => entrypointIds.has(skill.id));
    const routes = report.routes.filter((route) =>
      entrypointIds.has(route.from),
    );
    return { ...report, view, skills, routes };
  }

  return { ...report, view };
}

/** Format deterministic JSON for downstream tools. */
export function formatSkillIndexJson(report: SkillIndexProjection): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Format a compact agent- and reviewer-facing Markdown index. */
export function formatSkillIndexMarkdown(report: SkillIndexProjection): string {
  const lines = [
    "# Renma Skill Index",
    "",
    "> Static repository discovery evidence. Open the source `SKILL.md` and treat source skills, lenses, and contexts as authoritative. Renma does not select a skill for a live task.",
    "",
    `- Root: ${report.root}`,
    `- Config: ${report.configPath ?? "(defaults)"}`,
    `- View: ${report.view}`,
    ...(report.focus ? [`- Focus: ${report.focus}`] : []),
    `- Scanned files: ${report.scannedFileCount}`,
    `- Skills: ${report.skillCount}`,
    `- Routes: ${report.routeCount}`,
    `- Entrypoints: ${report.entrypointCount}`,
    `- Reachable active skills: ${report.reachableSkillCount}`,
    "",
    "## How To Use This Index",
    "",
    "1. Match the repository task to a broad entrypoint's usage boundaries.",
    "2. Open the source `SKILL.md`.",
    "3. Follow its declared or observed routes only when their conditions apply.",
    "4. Read the selected skill's required lenses and contexts.",
    "5. Do not guess when no route is clear.",
  ];

  if (report.view === "routes") {
    renderRoutes(lines, report.routes);
  } else if (report.view === "full") {
    renderSkillTable(lines, report.skills);
    renderRoutes(lines, report.routes);
  } else {
    renderEntrypoints(lines, report.skills, report.routes);
  }

  renderDiagnostics(lines, report);
  return `${lines.join("\n")}\n`;
}

/** Format a review-only Mermaid route graph. */
export function formatSkillIndexMermaid(report: SkillIndexProjection): string {
  const lines = ["graph TD"];
  const ids = new Map<string, string>();
  const entries = [...report.skills].sort(compareSkillEntries);
  entries.forEach((skill, index) => {
    const nodeId = `skill_${index}`;
    ids.set(skill.id, nodeId);
    const label = escapeMermaid(`${skill.title}\n${skill.id}`);
    lines.push(
      skill.entrypointReason
        ? `  ${nodeId}(["${label}"])`
        : `  ${nodeId}["${label}"]`,
    );
  });

  const missing = new Map<string, string>();
  for (const route of report.routes) {
    if (route.targetId && ids.has(route.targetId)) continue;
    const key = route.targetId ?? route.to;
    if (!missing.has(key)) {
      const nodeId = `target_${missing.size}`;
      missing.set(key, nodeId);
      const prefix = route.resolved
        ? `${route.targetKind ?? "asset"}: `
        : "missing: ";
      lines.push(`  ${nodeId}["${escapeMermaid(`${prefix}${key}`)}"]`);
    }
  }

  for (const route of [...report.routes].sort(compareRoutes)) {
    const source = ids.get(route.from);
    if (!source) continue;
    const target = route.targetId ? ids.get(route.targetId) : undefined;
    const fallback = missing.get(route.targetId ?? route.to);
    const destination = target ?? fallback;
    if (!destination) continue;
    const evidenceKinds = [...new Set(route.evidence.map((item) => item.kind))]
      .sort()
      .join("+");
    const arrow =
      route.resolved && route.targetKind === "skill" ? "-->" : "-.->";
    lines.push(
      `  ${source} ${arrow}|${escapeMermaid(evidenceKinds)}| ${destination}`,
    );
  }

  if (report.diagnostics.length > 0) {
    lines.push("  %% Diagnostics:");
    for (const diagnostic of report.diagnostics) {
      lines.push(
        `  %% ${singleLine(`${diagnostic.severity}: ${diagnostic.code ?? "DISCOVERY"}: ${diagnostic.message}`)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function skillIndexHelp(version: string): string {
  return [
    `renma ${version}`,
    "",
    "Usage",
    "  renma skill-index [path] [options]",
    "",
    "Purpose",
    "  The experimental skill-index command builds a static, deterministic index of layered SKILL.md routing for large repositories.",
    "",
    "Use when",
    "- A repository has enough skills that an agent needs a bounded first hop.",
    "- You want to review entrypoints, routes, cycles, unreachable skills, or aliases.",
    "- You are introducing discovery without moving existing skills.",
    "",
    "Boundary",
    "  This experimental command does not select a skill for a live task. Source SKILL.md files remain authoritative.",
    "",
    "Do not use for",
    "- Selecting a skill from live task text.",
    "- Ranking skills with embeddings, fuzzy search, or an LLM.",
    "- Prompt assembly, context injection, or agent execution.",
    "",
    "Examples",
    "  renma skill-index .",
    "  renma skill-index . --view routes --format json",
    "  renma skill-index . --focus test-case-generation --format mermaid",
    "",
    "Options",
    "  -c, --config <path>          Read Renma JSON config from path.",
    "      --focus <id-or-path>     Keep one skill and its one-hop route neighborhood.",
    "      --format <format>        json, markdown, or mermaid. Defaults to markdown.",
    "      --json                   Shortcut for --format json.",
    "      --view <view>            entrypoints, routes, or full. Defaults to entrypoints.",
    "  -h, --help                   Show this help page.",
  ].join("\n");
}

function focusProjection(
  report: SkillIndexReport,
  view: SkillIndexView,
  focus: string,
): SkillIndexProjection {
  const normalized = normalizeFocus(focus);
  const matches = report.skills.filter(
    (skill) =>
      skill.id === focus ||
      normalizeFocus(skill.sourcePath) === normalized ||
      skill.aliases.some((alias) => normalizeFocus(alias) === normalized),
  );
  if (matches.length === 0) {
    throw new Error(
      `skill-index --focus did not match a skill id, source path, or alias: ${focus}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `skill-index --focus is ambiguous for alias "${focus}": ${matches
        .map((skill) => skill.id)
        .sort()
        .join(", ")}`,
    );
  }

  const selected = matches[0];
  if (!selected) throw new Error(`skill-index --focus did not match: ${focus}`);
  const routes = report.routes.filter(
    (route) => route.from === selected.id || route.targetId === selected.id,
  );
  const skillIds = new Set<string>([selected.id]);
  for (const route of routes) {
    skillIds.add(route.from);
    if (route.targetKind === "skill" && route.targetId)
      skillIds.add(route.targetId);
  }
  return {
    ...report,
    view,
    focus,
    skills: report.skills.filter((skill) => skillIds.has(skill.id)),
    routes,
  };
}

function renderEntrypoints(
  lines: string[],
  entrypoints: SkillIndexEntry[],
  routes: SkillRoute[],
): void {
  lines.push("", "## Entrypoints", "");
  if (entrypoints.length === 0) {
    lines.push("No active discovery entrypoints were found.");
    return;
  }

  for (const skill of [...entrypoints].sort(compareSkillEntries)) {
    const outgoing = routes.filter((route) => route.from === skill.id);
    lines.push(`### ${skill.title}`, "");
    lines.push(`- ID: \`${skill.id}\``);
    lines.push(`- Source: \`${skill.sourcePath}\``);
    lines.push(`- Entrypoint: ${skill.entrypointReason ?? "no"}`);
    lines.push(`- Owner: ${skill.owner ?? "(none)"}`);
    lines.push(`- Status: ${skill.status ?? "(unspecified)"}`);
    lines.push(`- Products: ${inlineList(skill.products)}`);
    lines.push(`- Use when: ${compactList(skill.whenToUse)}`);
    lines.push(`- Do not use when: ${compactList(skill.whenNotToUse)}`);
    lines.push(
      `- Routes to: ${outgoing.length > 0 ? outgoing.map(routeTargetLabel).join(", ") : "(none)"}`,
    );
    lines.push("");
  }
}

function renderSkillTable(lines: string[], skills: SkillIndexEntry[]): void {
  lines.push(
    "",
    "## Skills",
    "",
    "| ID | Source | Entrypoint | Owner | Status | Products | Reachable |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  if (skills.length === 0) {
    lines.push("| (none) |  |  |  |  |  |  |");
    return;
  }
  for (const skill of [...skills].sort(compareSkillEntries)) {
    lines.push(
      `| ${escapeTable(skill.id)} | ${escapeTable(skill.sourcePath)} | ${skill.entrypointReason ?? ""} | ${escapeTable(skill.owner ?? "")} | ${skill.status ?? ""} | ${escapeTable(skill.products.join(", "))} | ${skill.reachable ? "yes" : "no"} |`,
    );
  }
}

function renderRoutes(lines: string[], routes: SkillRoute[]): void {
  lines.push(
    "",
    "## Routes",
    "",
    "| From | To | Resolved | Target | Evidence |",
    "| --- | --- | --- | --- | --- |",
  );
  if (routes.length === 0) {
    lines.push("| (none) |  |  |  |  |");
    return;
  }
  for (const route of [...routes].sort(compareRoutes)) {
    lines.push(
      `| ${escapeTable(route.from)} | ${escapeTable(route.to)} | ${route.resolved ? "yes" : "no"} | ${escapeTable(routeTargetLabel(route))} | ${escapeTable([...new Set(route.evidence.map((item) => item.kind))].sort().join(", "))} |`,
    );
  }
}

function renderDiagnostics(
  lines: string[],
  report: SkillIndexProjection,
): void {
  lines.push("", "## Discovery Diagnostics", "");
  if (report.diagnostics.length === 0) {
    lines.push("- None.");
    return;
  }
  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.path ? `${diagnostic.path}: ` : "";
    lines.push(
      `- ${diagnostic.severity}: ${diagnostic.code ?? "DISCOVERY"}: ${location}${diagnostic.message}`,
    );
  }
}

function formatSkillIndex(
  report: SkillIndexProjection,
  format: SkillIndexFormat,
): string {
  if (format === "json") return formatSkillIndexJson(report);
  if (format === "mermaid") return formatSkillIndexMermaid(report);
  return formatSkillIndexMarkdown(report);
}

function routeTargetLabel(route: SkillRoute): string {
  if (route.targetId && route.targetPath) {
    return `\`${route.targetId}\` (${route.targetPath})`;
  }
  if (route.targetId) return `\`${route.targetId}\``;
  return `\`${route.to}\``;
}

function compactList(values: string[], limit = 3): string {
  if (values.length === 0) return "(not declared)";
  if (values.length <= limit) return values.join("; ");
  return `${values.slice(0, limit).join("; ")} (+${values.length - limit} more)`;
}

function inlineList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function normalizeFocus(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim().toLowerCase();
}

function escapeTable(value: string): string {
  return singleLine(value).replace(/\|/g, "\\|");
}

function escapeMermaid(value: string): string {
  return singleLine(value).replace(/"/g, '\\"');
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
}

function compareSkillEntries(a: SkillIndexEntry, b: SkillIndexEntry): number {
  return a.sourcePath.localeCompare(b.sourcePath) || a.id.localeCompare(b.id);
}

function compareRoutes(a: SkillRoute, b: SkillRoute): number {
  return (
    a.from.localeCompare(b.from) ||
    (a.targetId ?? a.to).localeCompare(b.targetId ?? b.to) ||
    a.to.localeCompare(b.to)
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isSkillIndexFormat(value: string): value is SkillIndexFormat {
  return value === "json" || value === "markdown" || value === "mermaid";
}

function isSkillIndexView(value: string): value is SkillIndexView {
  return value === "entrypoints" || value === "routes" || value === "full";
}
