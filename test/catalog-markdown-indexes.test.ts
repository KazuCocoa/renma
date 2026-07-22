import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import {
  formatCatalogMarkdown,
  prepareCatalogDependencyIndexes,
  type CatalogResult,
} from "../src/commands/catalog.js";
import { resolveDependencyTarget } from "../src/dependency-resolution.js";
import type { Catalog, CatalogEntry, Dependency } from "../src/model.js";

test("catalog dependency indexes preserve direct filtering and resolution", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 40 }),
      fc.array(
        fc.tuple(fc.nat({ max: 39 }), fc.nat({ max: 39 }), fc.boolean()),
        { maxLength: 120 },
      ),
      (assetCount, declarations) => {
        const entries = Array.from({ length: assetCount }, (_, index) =>
          catalogEntry(index),
        );
        const dependencies = declarations.map(
          ([fromIndex, targetIndex, byPath], declarationIndex): Dependency => {
            const from = entries[fromIndex % entries.length];
            const target = entries[targetIndex % entries.length];
            assert.ok(from);
            assert.ok(target);
            return {
              from: from.id,
              to: byPath ? `./${target.sourcePath}` : target.id,
              kind: declarationIndex % 2 === 0 ? "requires" : "optional",
              declarationIndex,
              sourcePath: from.sourcePath,
            };
          },
        );
        const catalog = catalogFrom(entries, dependencies);
        const indexes = prepareCatalogDependencyIndexes(catalog);

        for (const entry of entries) {
          assert.deepEqual(
            indexes.outboundBySourceId.get(entry.id) ?? [],
            dependencies.filter((dependency) => dependency.from === entry.id),
          );
          assert.deepEqual(
            indexes.inboundByResolvedTargetId.get(entry.id) ?? [],
            dependencies.filter(
              (dependency) =>
                resolveDependencyTarget(dependency, entries)?.id === entry.id,
            ),
          );
        }
      },
    ),
    { seed: 22_051, numRuns: 100 },
  );
});

test("dependency indexes preserve first asset match across ID and path candidates", () => {
  const pathMatch = {
    ...catalogEntry(0),
    id: "path-match",
    sourcePath: "id-match",
  };
  const idMatch = {
    ...catalogEntry(1),
    id: "id-match",
    sourcePath: "contexts/id-match.md",
  };
  const dependency: Dependency = {
    from: "source",
    to: "id-match",
    kind: "requires",
    sourcePath: "skills/source/SKILL.md",
  };
  const catalog = catalogFrom([pathMatch, idMatch], [dependency]);

  assert.equal(resolveDependencyTarget(dependency, catalog.assets), pathMatch);
  const indexes = prepareCatalogDependencyIndexes(catalog);
  assert.deepEqual(indexes.inboundByResolvedTargetId.get(pathMatch.id), [
    dependency,
  ]);
  assert.equal(indexes.inboundByResolvedTargetId.has(idMatch.id), false);
});

test("large catalog Markdown prepares and looks up dependency buckets once", () => {
  const assetCount = 2_000;
  const entries = Array.from({ length: assetCount }, (_, index) =>
    catalogEntry(index),
  );
  const dependencies = entries.map((entry, index): Dependency => {
    const target = entries[(index + 1) % entries.length];
    assert.ok(target);
    return {
      from: entry.id,
      to: index % 2 === 0 ? target.id : `./${target.sourcePath}`,
      kind: index % 3 === 0 ? "optional" : "requires",
      sourcePath: entry.sourcePath,
    };
  });
  const counts = {
    assetsIndexed: 0,
    dependenciesIndexed: 0,
    targetsResolved: 0,
    outboundLookups: 0,
    inboundLookups: 0,
  };

  const markdown = formatCatalogMarkdown(
    catalogResult(catalogFrom(entries, dependencies)),
    {
      onAssetIndexed: () => counts.assetsIndexed++,
      onDependencyIndexed: () => counts.dependenciesIndexed++,
      onDependencyTargetResolved: () => counts.targetsResolved++,
      onOutboundLookup: () => counts.outboundLookups++,
      onInboundLookup: () => counts.inboundLookups++,
    },
  );

  assert.deepEqual(counts, {
    assetsIndexed: assetCount,
    dependenciesIndexed: dependencies.length,
    targetsResolved: dependencies.length,
    outboundLookups: assetCount,
    inboundLookups: assetCount,
  });
  assert.match(
    markdown,
    /### asset-0[\s\S]*- Dependencies: optional:asset-1[\s\S]*- Dependents: requires:asset-1999/,
  );
});

function catalogEntry(index: number): CatalogEntry {
  return {
    id: `asset-${index}`,
    kind: "context",
    sourcePath: `contexts/asset-${index}.md`,
    contentHash: `sha256:${index.toString(16).padStart(64, "0")}`,
    sizeBytes: index,
    contentClassification: "text",
    markdownParserEligible: true,
    ownership: {
      declaredOwner: "test",
      effectiveOwner: "test",
      source: "declared",
    },
    metadata: {
      id: `asset-${index}`,
      owner: "test",
      tags: [],
      whenToUse: [],
      whenNotToUse: [],
      requiresContext: [],
      optionalContext: [],
      conflicts: [],
      supersededBy: [],
    },
    metadataFields: {},
    metadataListItems: {},
  };
}

function catalogFrom(
  entries: CatalogEntry[],
  dependencies: Dependency[],
): Catalog {
  return { entries, assets: entries, dependencies };
}

function catalogResult(catalog: Catalog): CatalogResult {
  return {
    root: "/repository",
    scannedFileCount: catalog.assets.length,
    catalog,
    contextLens: {
      enabled: true,
      detected: false,
      totalLensCount: 0,
      validLensCount: 0,
      invalidLensCount: 0,
      diagnosticCounts: { error: 0, warning: 0, info: 0 },
      definitionPaths: [],
      targetReferences: [],
      targetPaths: [],
      unresolvedTargetReferences: [],
      scopeSummary: [],
      lenses: [],
    },
    diagnostics: [],
  };
}
