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

export interface OwnershipReport {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  totalAssets: number;
  ownedAssets: number;
  unownedAssets: number;
  coveragePercent: number;
  byKind: OwnershipKindSummary[];
  unownedAssetList: UnownedAsset[];
  ownedAssetList?: OwnedAsset[];
  diagnostics?: Diagnostic[];
}

export async function runOwnershipCommand(
  targetPath: string,
  options: {
    format: OwnershipFormat;
    includeOwned?: boolean;
    overrides?: ConfigOverrides;
  },
): Promise<number> {
  const report = await ownership(targetPath, options.overrides ?? {}, {
    includeOwned: options.includeOwned ?? false,
  });
  process.stdout.write(
    options.format === "json"
      ? formatOwnershipJson(report)
      : formatOwnershipMarkdown(report),
  );
  return report.diagnostics?.some((diagnostic) => diagnostic.severity === "error")
    ? 1
    : 0;
}

export async function ownership(
  targetPath: string,
  overrides: ConfigOverrides = {},
  options: { includeOwned?: boolean } = {},
): Promise<OwnershipReport> {
  const result = await catalog(targetPath, overrides);
  const assets = stableAssets(result.catalog.assets);
  const totalAssets = assets.length;
  const ownedAssets = assets.filter(hasOwner).length;
  const unownedAssetList = assets.filter((asset) => !hasOwner(asset)).map(toUnownedAsset);
  const ownedAssetList = assets.filter(hasOwner).map(toOwnedAsset);

  return {
    root: result.root,
    ...(result.configPath ? { configPath: result.configPath } : {}),
    scannedFileCount: result.scannedFileCount,
    totalAssets,
    ownedAssets,
    unownedAssets: totalAssets - ownedAssets,
    coveragePercent: percent(ownedAssets, totalAssets),
    byKind: summarizeByKind(assets),
    unownedAssetList,
    ...(options.includeOwned ? { ownedAssetList } : {}),
    ...(result.diagnostics.length > 0 ? { diagnostics: result.diagnostics } : {}),
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
    "## Unowned Assets",
    "",
  ];

  if (report.unownedAssetList.length === 0) {
    lines.push("(none)");
  } else {
    lines.push("| ID | Kind | Source | Status | Tags |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const asset of report.unownedAssetList) {
      lines.push(
        `| ${asset.id} | ${asset.kind} | ${asset.sourcePath} | ${asset.status ?? ""} | ${asset.tags.join(", ")} |`,
      );
    }
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

function summarizeByKind(assets: Asset[]): OwnershipKindSummary[] {
  const summaries = new Map<AssetKind, { totalAssets: number; ownedAssets: number }>();
  for (const asset of assets) {
    const summary = summaries.get(asset.kind) ?? { totalAssets: 0, ownedAssets: 0 };
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
  return asset.metadata.owner !== undefined && asset.metadata.owner.trim().length > 0;
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 100;
  return Number(((numerator / denominator) * 100).toFixed(2));
}
