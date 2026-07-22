import type { ConfigOverrides } from "../config.js";
import type { ContextLensSummary } from "../context-lens.js";
import { normalizeDependencyReference } from "../dependency-resolution.js";
import {
  effectiveAssetOwner,
  type Asset,
  type Catalog,
  type CatalogEntry,
  type Dependency,
} from "../model.js";
import { collectRepositoryEvidence } from "../repository-evidence.js";
import type { Diagnostic } from "../types/diagnostics.js";

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

export interface CatalogDependencyIndexes {
  outboundBySourceId: ReadonlyMap<string, readonly Dependency[]>;
  inboundByResolvedTargetId: ReadonlyMap<string, readonly Dependency[]>;
}

export interface CatalogMarkdownInstrumentation {
  onAssetIndexed?(entry: Asset): void;
  onDependencyIndexed?(dependency: Dependency): void;
  onDependencyTargetResolved?(
    dependency: Dependency,
    target: Asset | undefined,
  ): void;
  onOutboundLookup?(entry: CatalogEntry): void;
  onInboundLookup?(entry: CatalogEntry): void;
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
  return collectRepositoryEvidence(targetPath, overrides);
}

/** Format the catalog command result as deterministic pretty JSON. */
export function formatCatalogJson(result: CatalogResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** Format a compact Markdown catalog intended for code review and generated docs. */
export function formatCatalogMarkdown(
  result: CatalogResult,
  instrumentation: CatalogMarkdownInstrumentation = {},
): string {
  const dependencyIndexes = prepareCatalogDependencyIndexes(
    result.catalog,
    instrumentation,
  );
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
    const owner = effectiveAssetOwner(entry);
    lines.push(
      `- Owner: ${owner ?? "(none)"}${
        entry.ownership.source === "inherited" && entry.ownership.inheritedFrom
          ? ` (inherited from ${entry.ownership.inheritedFrom.sourcePath})`
          : ""
      }`,
    );
    lines.push(
      `- Declared owner: ${entry.ownership.declaredOwner ?? "(none)"}`,
    );
    lines.push(`- Ownership source: ${entry.ownership.source}`);
    lines.push(`- Status: ${entry.metadata.status ?? "(unspecified)"}`);
    lines.push(
      `- Last reviewed: ${entry.metadata.lastReviewedAt ?? "(unspecified)"}`,
    );
    lines.push(
      `- Review cycle: ${entry.metadata.reviewCycle ?? "(unspecified)"}`,
    );
    lines.push(`- Expires: ${entry.metadata.expiresAt ?? "(unspecified)"}`);
    lines.push(`- Tags: ${list(entry.metadata.tags)}`);
    instrumentation.onOutboundLookup?.(entry);
    lines.push(
      `- Dependencies: ${dependencySummary(entry, dependencyIndexes.outboundBySourceId)}`,
    );
    instrumentation.onInboundLookup?.(entry);
    lines.push(
      `- Dependents: ${dependentSummary(entry, dependencyIndexes.inboundByResolvedTargetId)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/** Prepare stable dependency buckets and target resolution once per catalog render. */
export function prepareCatalogDependencyIndexes(
  catalog: Catalog,
  instrumentation: CatalogMarkdownInstrumentation = {},
): CatalogDependencyIndexes {
  const outboundBySourceId = new Map<string, Dependency[]>();
  const inboundByResolvedTargetId = new Map<string, Dependency[]>();
  const targetResolver = prepareDependencyTargetResolver(
    catalog.assets,
    instrumentation,
  );

  for (const dependency of catalog.dependencies) {
    instrumentation.onDependencyIndexed?.(dependency);
    appendDependency(outboundBySourceId, dependency.from, dependency);

    const target = targetResolver(dependency);
    instrumentation.onDependencyTargetResolved?.(dependency, target);
    if (target) {
      appendDependency(inboundByResolvedTargetId, target.id, dependency);
    }
  }

  return {
    outboundBySourceId: readonlyDependencyBuckets(outboundBySourceId),
    inboundByResolvedTargetId: readonlyDependencyBuckets(
      inboundByResolvedTargetId,
    ),
  };
}

/** Summarize outgoing dependency edges for one asset. */
function dependencySummary(
  entry: CatalogEntry,
  outboundBySourceId: ReadonlyMap<string, readonly Dependency[]>,
): string {
  const outbound = outboundBySourceId.get(entry.id) ?? [];
  if (outbound.length === 0) return "(none)";
  return outbound
    .map((dependency) => `${dependency.kind}:${dependency.to}`)
    .join(", ");
}

/** Summarize incoming dependency edges for one asset. */
function dependentSummary(
  entry: CatalogEntry,
  inboundByResolvedTargetId: ReadonlyMap<string, readonly Dependency[]>,
): string {
  const inbound = inboundByResolvedTargetId.get(entry.id) ?? [];
  if (inbound.length === 0) return "(none)";
  return inbound
    .map((dependency) => `${dependency.kind}:${dependency.from}`)
    .join(", ");
}

interface IndexedAsset {
  entry: Asset;
  index: number;
}

function prepareDependencyTargetResolver(
  assets: Catalog["assets"],
  instrumentation: CatalogMarkdownInstrumentation,
): (dependency: Dependency) => Asset | undefined {
  const byId = new Map<string, IndexedAsset>();
  const byNormalizedPath = new Map<string, IndexedAsset>();

  assets.forEach((entry, index) => {
    instrumentation.onAssetIndexed?.(entry);
    const indexed = { entry, index };
    if (!byId.has(entry.id)) byId.set(entry.id, indexed);
    const normalizedPath = normalizeDependencyReference(entry.sourcePath);
    if (!byNormalizedPath.has(normalizedPath)) {
      byNormalizedPath.set(normalizedPath, indexed);
    }
  });

  return (dependency) => {
    const idMatch = byId.get(dependency.to);
    const pathMatch = byNormalizedPath.get(
      normalizeDependencyReference(dependency.to),
    );
    if (!idMatch) return pathMatch?.entry;
    if (!pathMatch) return idMatch.entry;
    return idMatch.index <= pathMatch.index ? idMatch.entry : pathMatch.entry;
  };
}

function appendDependency(
  buckets: Map<string, Dependency[]>,
  key: string,
  dependency: Dependency,
): void {
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.push(dependency);
  } else {
    buckets.set(key, [dependency]);
  }
}

function readonlyDependencyBuckets(
  buckets: Map<string, Dependency[]>,
): ReadonlyMap<string, readonly Dependency[]> {
  return new Map(
    [...buckets].map(([key, dependencies]) => [
      key,
      Object.freeze([...dependencies]),
    ]),
  );
}

/** Render an empty-aware comma-delimited list for Markdown output. */
function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}
