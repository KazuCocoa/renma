import path from "node:path";
import { buildCatalog } from "../catalog.js";
import { loadConfig, type ConfigOverrides } from "../config.js";
import {
  summarizeContextLensGovernance,
  type ContextLensSummary,
} from "../context-lens.js";
import { discoverArtifacts } from "../discovery.js";
import { parseDocument } from "../markdown.js";
import type { Catalog, CatalogEntry, Dependency } from "../model.js";
import type { Diagnostic } from "../types.js";

export type CatalogFormat = "json" | "markdown";

/** Complete result emitted by the catalog command before formatting. */
export interface CatalogResult {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  catalog: Catalog;
  contextLens: ContextLensSummary;
  diagnostics: Diagnostic[];
}

/** Run catalog discovery, format output, and return a CLI-style exit code. */
export async function runCatalogCommand(
  targetPath: string,
  options: { format: CatalogFormat; overrides?: ConfigOverrides },
): Promise<number> {
  const result = await catalog(targetPath, options.overrides ?? {});
  process.stdout.write(
    options.format === "json"
      ? formatCatalogJson(result)
      : formatCatalogMarkdown(result),
  );
  return result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
}

/** Discover repository artifacts and build their normalized catalog model. */
export async function catalog(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<CatalogResult> {
  const root = path.resolve(targetPath);
  const { config, configPath } = await loadConfig(root, overrides);
  const { artifacts, diagnostics } = await discoverArtifacts(root, config);
  const documents = artifacts.map(parseDocument);
  const built = buildCatalog(documents);
  const contextLens = summarizeContextLensGovernance(documents, built.catalog);

  return {
    root,
    ...(configPath ? { configPath } : {}),
    scannedFileCount: artifacts.length,
    catalog: built.catalog,
    contextLens: contextLens.summary,
    diagnostics: [
      ...diagnostics,
      ...built.diagnostics,
      ...contextLens.diagnostics,
    ],
  };
}

/** Format the catalog command result as deterministic pretty JSON. */
export function formatCatalogJson(result: CatalogResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** Format a compact Markdown catalog intended for code review and generated docs. */
export function formatCatalogMarkdown(result: CatalogResult): string {
  const lines = [
    "# Renma Catalog",
    "",
    `Root: ${result.root}`,
    `Config: ${result.configPath ?? "(defaults)"}`,
    `Files scanned: ${result.scannedFileCount}`,
    `Assets: ${result.catalog.assets.length}`,
    `Dependencies: ${result.catalog.dependencies.length}`,
  ];

  if (result.diagnostics.length > 0) {
    lines.push("", "## Diagnostics");
    for (const diagnostic of result.diagnostics) {
      lines.push(
        `- ${diagnostic.severity}: ${diagnostic.path ? `${diagnostic.path}: ` : ""}${diagnostic.message}`,
      );
    }
  }

  lines.push("", "## Assets");
  for (const entry of result.catalog.entries) {
    lines.push("", `### ${entry.id}`, "");
    lines.push(`- Kind: ${entry.kind}`);
    lines.push(`- Path: ${entry.sourcePath}`);
    lines.push(`- Hash: ${entry.contentHash}`);
    lines.push(`- Owner: ${entry.metadata.owner ?? "(none)"}`);
    lines.push(`- Status: ${entry.metadata.status ?? "(unspecified)"}`);
    lines.push(
      `- Last reviewed: ${entry.metadata.lastReviewedAt ?? "(unspecified)"}`,
    );
    lines.push(
      `- Review cycle: ${entry.metadata.reviewCycle ?? "(unspecified)"}`,
    );
    lines.push(`- Expires: ${entry.metadata.expiresAt ?? "(unspecified)"}`);
    lines.push(`- Tags: ${list(entry.metadata.tags)}`);
    lines.push(
      `- Dependencies: ${dependencySummary(entry, result.catalog.dependencies)}`,
    );
    lines.push(
      `- Dependents: ${dependentSummary(entry, result.catalog.dependencies)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/** Summarize outgoing dependency edges for one asset. */
function dependencySummary(
  entry: CatalogEntry,
  dependencies: Dependency[],
): string {
  const outbound = dependencies.filter(
    (dependency) => dependency.from === entry.id,
  );
  if (outbound.length === 0) return "(none)";
  return outbound
    .map((dependency) => `${dependency.kind}:${dependency.to}`)
    .join(", ");
}

/** Summarize incoming dependency edges for one asset. */
function dependentSummary(
  entry: CatalogEntry,
  dependencies: Dependency[],
): string {
  const inbound = dependencies.filter(
    (dependency) => dependency.to === entry.id,
  );
  if (inbound.length === 0) return "(none)";
  return inbound
    .map((dependency) => `${dependency.kind}:${dependency.from}`)
    .join(", ");
}

/** Render an empty-aware comma-delimited list for Markdown output. */
function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}
