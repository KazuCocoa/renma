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
