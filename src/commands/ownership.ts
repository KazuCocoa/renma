import { catalog } from "./catalog.js";
import type { ConfigOverrides } from "../config.js";
import type { Asset, AssetKind, AssetStatus } from "../model.js";
import type { Diagnostic } from "../types.js";

export type OwnershipFormat = "json" | "markdown";

export interface OwnershipKindSummary {
  kind: AssetKind;
  totalAssets: number;
  ownedAssets: number;
  unownedAssets: number;
  coveragePercent: number;
}

export interface UnownedAsset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  status?: AssetStatus;
  tags: string[];
}

export interface OwnedAsset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  owner: string;
  status: AssetStatus | null;
  tags: string[];
}

export interface OwnershipOwnerKindSummary {
  kind: AssetKind;
  totalAssets: number;
}

export interface OwnershipOwnerSummary {
  owner: string;
  totalAssets: number;
  byKind: OwnershipOwnerKindSummary[];
  assets: Omit<OwnedAsset, "owner">[];
}

export interface OwnershipReport {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  ownerFilter?: string;
  totalAssets: number;
  matchedAssets?: number;
  ownedAssets: number;
  unownedAssets: number;
  coveragePercent: number;
  byKind: OwnershipKindSummary[];
  owners: OwnershipOwnerSummary[];
  unownedAssetList: UnownedAsset[];
  ownedAssetList?: OwnedAsset[];
  diagnostics?: Diagnostic[];
}

export async function runOwnershipCommand(
  targetPath: string,
  options: {
    format: OwnershipFormat;
    includeOwned?: boolean;
    owner?: string;
    overrides?: ConfigOverrides;
  },
): Promise<number> {
  const owner = options.owner?.trim();
  const report = await ownership(targetPath, options.overrides ?? {}, {
    includeOwned: options.includeOwned ?? false,
    ...(owner ? { owner } : {}),
  });
  process.stdout.write(
    options.format === "json"
      ? formatOwnershipJson(report)
      : formatOwnershipMarkdown(report),
  );
  return report.diagnostics?.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
}

export async function ownership(
  targetPath: string,
  overrides: ConfigOverrides = {},
  options: { includeOwned?: boolean; owner?: string } = {},
): Promise<OwnershipReport> {
  const result = await catalog(targetPath, overrides);
  const assets = stableAssets(result.catalog.assets);
  const ownerFilter = options.owner?.trim();
  const totalAssets = assets.length;
  const ownedAssets = assets.filter(hasOwner).length;
  const unownedAssetList = assets
    .filter((asset) => !hasOwner(asset))
    .map(toUnownedAsset);
  const ownedAssetList = assets.filter(hasOwner).map(toOwnedAsset);
  const filteredOwnedAssetList = ownerFilter
    ? ownedAssetList.filter((asset) => asset.owner === ownerFilter)
    : ownedAssetList;

  return {
    root: result.root,
    ...(result.configPath ? { configPath: result.configPath } : {}),
    scannedFileCount: result.scannedFileCount,
    ...(ownerFilter ? { ownerFilter } : {}),
    totalAssets,
    ...(ownerFilter ? { matchedAssets: filteredOwnedAssetList.length } : {}),
    ownedAssets,
    unownedAssets: totalAssets - ownedAssets,
    coveragePercent: percent(ownedAssets, totalAssets),
    byKind: summarizeByKind(assets),
    owners: summarizeByOwner(filteredOwnedAssetList),
    unownedAssetList: ownerFilter ? [] : unownedAssetList,
    ...(options.includeOwned || ownerFilter
      ? { ownedAssetList: filteredOwnedAssetList }
      : {}),
    ...(result.diagnostics.length > 0
      ? { diagnostics: result.diagnostics }
      : {}),
  };
}

export function formatOwnershipJson(report: OwnershipReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatOwnershipMarkdown(report: OwnershipReport): string {
  const lines = [
    "# Ownership Coverage",
    "",
    `- Root: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    `- Scanned files: ${report.scannedFileCount}`,
    `- Total assets: ${report.totalAssets}`,
    `- Owned assets: ${report.ownedAssets}`,
    `- Unowned assets: ${report.unownedAssets}`,
    `- Coverage: ${report.coveragePercent}%`,
    ...(report.ownerFilter
      ? [
          `- Owner filter: ${report.ownerFilter}`,
          `- Matched assets: ${report.matchedAssets ?? 0}`,
        ]
      : []),
    "",
    "## By Kind",
    "",
    "| Kind | Total | Owned | Unowned | Coverage |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...report.byKind.map(
      (summary) =>
        `| ${summary.kind} | ${summary.totalAssets} | ${summary.ownedAssets} | ${summary.unownedAssets} | ${summary.coveragePercent}% |`,
    ),
    "",
  ];

  if (report.ownerFilter) {
    lines.push(`## Owner: ${report.ownerFilter}`, "");
    const owner = report.owners.find(
      (summary) => summary.owner === report.ownerFilter,
    );
    if (!owner) {
      lines.push("(none)");
    } else {
      appendOwnerAssets(lines, owner.assets);
    }
  } else {
    lines.push("## Owners", "");
    appendOwners(lines, report.owners);
    lines.push("", "## Unowned Assets", "");
    appendUnownedAssets(lines, report.unownedAssetList);
  }

  if (report.ownedAssetList) {
    lines.push("", "## Owned Assets", "");
    if (report.ownedAssetList.length === 0) {
      lines.push("(none)");
    } else {
      lines.push("| ID | Kind | Source | Owner | Status | Tags |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      for (const asset of report.ownedAssetList) {
        lines.push(
          `| ${asset.id} | ${asset.kind} | ${asset.sourcePath} | ${asset.owner} | ${asset.status ?? ""} | ${asset.tags.join(", ")} |`,
        );
      }
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

function appendOwners(lines: string[], owners: OwnershipOwnerSummary[]): void {
  if (owners.length === 0) {
    lines.push("(none)");
    return;
  }

  for (const [index, owner] of owners.entries()) {
    if (index > 0) lines.push("");
    lines.push(`### ${owner.owner}`, "");
    lines.push(`- Total assets: ${owner.totalAssets}`);
    lines.push("");
    lines.push("| Kind | Total |");
    lines.push("| --- | ---: |");
    for (const summary of owner.byKind) {
      lines.push(`| ${summary.kind} | ${summary.totalAssets} |`);
    }
    lines.push("");
    appendOwnerAssets(lines, owner.assets);
  }
}

function appendOwnerAssets(
  lines: string[],
  assets: Omit<OwnedAsset, "owner">[],
): void {
  if (assets.length === 0) {
    lines.push("(none)");
    return;
  }

  lines.push("| ID | Kind | Source | Status | Tags |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const asset of assets) {
    lines.push(
      `| ${asset.id} | ${asset.kind} | ${asset.sourcePath} | ${asset.status ?? ""} | ${asset.tags.join(", ")} |`,
    );
  }
}

function appendUnownedAssets(lines: string[], assets: UnownedAsset[]): void {
  if (assets.length === 0) {
    lines.push("(none)");
    return;
  }

  lines.push("| ID | Kind | Source | Status | Tags |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const asset of assets) {
    lines.push(
      `| ${asset.id} | ${asset.kind} | ${asset.sourcePath} | ${asset.status ?? ""} | ${asset.tags.join(", ")} |`,
    );
  }
}

function summarizeByKind(assets: Asset[]): OwnershipKindSummary[] {
  const summaries = new Map<
    AssetKind,
    { totalAssets: number; ownedAssets: number }
  >();
  for (const asset of assets) {
    const summary = summaries.get(asset.kind) ?? {
      totalAssets: 0,
      ownedAssets: 0,
    };
    summary.totalAssets += 1;
    if (hasOwner(asset)) summary.ownedAssets += 1;
    summaries.set(asset.kind, summary);
  }

  return [...summaries.entries()]
    .map(([kind, summary]) => ({
      kind,
      totalAssets: summary.totalAssets,
      ownedAssets: summary.ownedAssets,
      unownedAssets: summary.totalAssets - summary.ownedAssets,
      coveragePercent: percent(summary.ownedAssets, summary.totalAssets),
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

function summarizeByOwner(assets: OwnedAsset[]): OwnershipOwnerSummary[] {
  const summaries = new Map<string, OwnedAsset[]>();
  for (const asset of assets) {
    const ownerAssets = summaries.get(asset.owner) ?? [];
    ownerAssets.push(asset);
    summaries.set(asset.owner, ownerAssets);
  }

  return [...summaries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, ownerAssets]) => ({
      owner,
      totalAssets: ownerAssets.length,
      byKind: summarizeOwnerByKind(ownerAssets),
      assets: ownerAssets.map(toOwnerAsset),
    }));
}

function toOwnerAsset(asset: OwnedAsset): Omit<OwnedAsset, "owner"> {
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    status: asset.status,
    tags: asset.tags,
  };
}

function summarizeOwnerByKind(
  assets: OwnedAsset[],
): OwnershipOwnerKindSummary[] {
  const summaries = new Map<AssetKind, number>();
  for (const asset of assets) {
    summaries.set(asset.kind, (summaries.get(asset.kind) ?? 0) + 1);
  }
  return [...summaries.entries()]
    .map(([kind, totalAssets]) => ({ kind, totalAssets }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
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

function toUnownedAsset(asset: Asset): UnownedAsset {
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    tags: asset.metadata.tags,
  };
}

function toOwnedAsset(asset: Asset): OwnedAsset {
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    owner: asset.metadata.owner?.trim() ?? "",
    status: asset.metadata.status ?? null,
    tags: asset.metadata.tags,
  };
}

function hasOwner(asset: Asset): boolean {
  return (
    asset.metadata.owner !== undefined && asset.metadata.owner.trim().length > 0
  );
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 100;
  return Number(((numerator / denominator) * 100).toFixed(2));
}
