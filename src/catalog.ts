import { createHash } from "node:crypto";
import type {
  AssetMetadata,
  Catalog,
  CatalogEntry,
  Dependency,
  DependencyKind,
} from "./model.js";
import { parseAssetMetadata } from "./metadata.js";
import type { Diagnostic, Evidence, ParsedDocument } from "./types.js";

/** Build a deterministic catalog of skill and context entries from parsed documents. */
export function buildCatalog(documents: ParsedDocument[]): {
  catalog: Catalog;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const entries = documents
    .map((document): CatalogEntry | undefined => {
      const result = parseAssetMetadata(document);
      diagnostics.push(...result.diagnostics);
      diagnostics.push(
        ...sharedContextMetadataDiagnostics(document, result.metadata),
      );

      const base = {
        id: result.metadata.id ?? document.artifact.path,
        sourcePath: document.artifact.path,
        contentHash: contentHash(document.artifact.content),
        metadata: result.metadata,
      };

      if (document.artifact.kind === "skill") {
        return {
          ...base,
          kind: "skill",
          requiredContext: result.metadata.requiresContext,
          optionalContext: result.metadata.optionalContext,
          conflicts: result.metadata.conflicts,
        };
      }

      if (
        document.artifact.kind === "context" ||
        document.artifact.kind === "profile" ||
        document.artifact.kind === "reference" ||
        document.artifact.kind === "example"
      ) {
        return {
          ...base,
          kind: document.artifact.kind,
        };
      }

      return undefined;
    })
    .filter((entry): entry is CatalogEntry => entry !== undefined)
    .sort((a, b) => {
      const byKind = kindOrder(a.kind) - kindOrder(b.kind);
      if (byKind !== 0) return byKind;
      return a.sourcePath.localeCompare(b.sourcePath);
    });

  const dependencies = entries
    .flatMap((entry) => dependenciesForEntry(entry))
    .sort((a, b) => {
      const byFrom = a.from.localeCompare(b.from);
      if (byFrom !== 0) return byFrom;
      const byKind = dependencyKindOrder(a.kind) - dependencyKindOrder(b.kind);
      if (byKind !== 0) return byKind;
      return a.to.localeCompare(b.to);
    });

  return {
    catalog: {
      entries,
      assets: entries,
      dependencies,
    },
    diagnostics,
  };
}

function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function sharedContextMetadataDiagnostics(
  document: ParsedDocument,
  metadata: AssetMetadata,
): Diagnostic[] {
  if (document.artifact.kind !== "context") return [];

  const diagnostics: Diagnostic[] = [];
  if (!metadata.id) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Shared context asset is missing an id.",
    });
  }

  if (!metadata.owner) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Shared context asset is missing an owner.",
    });
  }

  return diagnostics;
}

/** Convert metadata relationship lists into graph edges for a catalog entry. */
function dependenciesForEntry(entry: CatalogEntry): Dependency[] {
  return [
    ...metadataDependencies(entry, "requires", entry.metadata.requiresContext),
    ...metadataDependencies(entry, "optional", entry.metadata.optionalContext),
    ...metadataDependencies(entry, "conflicts", entry.metadata.conflicts),
  ];
}

function metadataDependencies(
  entry: CatalogEntry,
  kind: DependencyKind,
  targets: string[],
): Dependency[] {
  return targets.map((target) => ({
    from: entry.id,
    to: target,
    kind,
    sourcePath: entry.sourcePath,
    evidence: metadataEvidence(entry.sourcePath),
  }));
}

/** Evidence points at frontmatter until metadata parsing preserves field line ranges. */
function metadataEvidence(path: string): Evidence {
  return {
    path,
    startLine: 1,
    endLine: 1,
    snippet: "frontmatter dependency metadata",
  };
}

/** Keep catalog output stable across filesystems and Node versions. */
function kindOrder(kind: CatalogEntry["kind"]): number {
  if (kind === "skill") return 0;
  if (kind === "context") return 1;
  if (kind === "profile") return 2;
  if (kind === "reference") return 3;
  return 4;
}

/** Keep dependency output stable while grouping the most important edges first. */
function dependencyKindOrder(kind: DependencyKind): number {
  if (kind === "requires") return 0;
  if (kind === "optional") return 1;
  if (kind === "conflicts") return 2;
  if (kind === "extends") return 3;
  if (kind === "routes_to") return 4;
  return 5;
}
