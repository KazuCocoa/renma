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
  if (
    dependency.declaration === "requires_skill" ||
    dependency.declaration === "optional_skill"
  ) {
    return resolveUniqueDependencyTarget(dependency, assets);
  }
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

interface IndexedAssetMatch {
  first: { asset: Asset; position: number };
  last: { asset: Asset; position: number };
  normalizedPath: string;
  ambiguous: boolean;
}

/** Prepare repeated lookups over one fixed asset list, preserving source order. */
export function prepareDependencyTargetResolver(
  assets: readonly Asset[],
): (dependency: Dependency) => Asset | undefined {
  const byId = new Map<string, IndexedAssetMatch>();
  const byPath = new Map<string, IndexedAssetMatch>();
  assets.forEach((asset, position) => {
    const normalizedPath = normalizeDependencyReference(asset.sourcePath);
    addIndexedAssetMatch(byId, asset.id, asset, position, normalizedPath);
    addIndexedAssetMatch(
      byPath,
      normalizedPath,
      asset,
      position,
      normalizedPath,
    );
  });

  return (dependency) => {
    const idMatch = byId.get(dependency.to);
    const pathMatch = byPath.get(normalizeDependencyReference(dependency.to));
    if (
      dependency.declaration === "requires_skill" ||
      dependency.declaration === "optional_skill"
    ) {
      if (
        idMatch?.ambiguous ||
        (idMatch &&
          pathMatch &&
          idMatch.normalizedPath !== pathMatch.normalizedPath)
      )
        return undefined;

      // Unique resolution keeps the last matching asset for the one path.
      const latest =
        !idMatch ||
        (pathMatch && pathMatch.last.position > idMatch.last.position)
          ? pathMatch
          : idMatch;
      return latest?.last.asset;
    }

    // Ordinary resolution keeps the first match across both ID and path.
    const earliest =
      !idMatch ||
      (pathMatch && pathMatch.first.position < idMatch.first.position)
        ? pathMatch
        : idMatch;
    return earliest?.first.asset;
  };
}

function addIndexedAssetMatch(
  index: Map<string, IndexedAssetMatch>,
  key: string,
  asset: Asset,
  position: number,
  normalizedPath: string,
): void {
  const match = index.get(key);
  if (match) {
    match.last = { asset, position };
    match.ambiguous ||= match.normalizedPath !== normalizedPath;
  } else {
    const entry = { asset, position };
    index.set(key, {
      first: entry,
      last: entry,
      normalizedPath,
      ambiguous: false,
    });
  }
}
