import type { Asset, Dependency } from "./model.js";

/** Normalize the supported repository-relative form used by dependency targets. */
export function normalizeDependencyReference(reference: string): string {
  return reference.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Resolve a declared dependency by asset ID or normalized repository-relative path. */
export function resolveDependencyTarget(
  dependency: Dependency,
  assets: Asset[],
): Asset | undefined {
  const target = normalizeDependencyReference(dependency.to);
  return assets.find(
    (asset) =>
      asset.id === dependency.to ||
      normalizeDependencyReference(asset.sourcePath) === target,
  );
}

/**
 * Resolve only when exact ID/path evidence identifies one asset. This is used
 * by lifecycle gates, which must not select from duplicate or ambiguous input.
 */
export function resolveUniqueDependencyTarget(
  dependency: Dependency,
  assets: Asset[],
): Asset | undefined {
  const target = normalizeDependencyReference(dependency.to);
  const matches = assets.filter(
    (asset) =>
      asset.id === dependency.to ||
      normalizeDependencyReference(asset.sourcePath) === target,
  );
  const uniquePaths = new Map(
    matches.map((asset) => [
      normalizeDependencyReference(asset.sourcePath),
      asset,
    ]),
  );
  return uniquePaths.size === 1 ? [...uniquePaths.values()][0] : undefined;
}
