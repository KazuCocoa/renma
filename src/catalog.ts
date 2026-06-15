import type { Catalog, CatalogEntry } from "./model.js";
import { parseAssetMetadata } from "./metadata.js";
import type { Diagnostic, ParsedDocument } from "./types.js";

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

      if (document.artifact.kind === "skill") {
        return {
          id: result.metadata.id ?? document.artifact.path,
          kind: "skill",
          sourcePath: document.artifact.path,
          metadata: result.metadata,
          requiredContext: result.metadata.requiresContext,
          optionalContext: result.metadata.optionalContext,
        };
      }

      if (
        document.artifact.kind === "profile" ||
        document.artifact.kind === "reference" ||
        document.artifact.kind === "example"
      ) {
        return {
          id: result.metadata.id ?? document.artifact.path,
          kind: document.artifact.kind,
          sourcePath: document.artifact.path,
          metadata: result.metadata,
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

  return { catalog: { entries }, diagnostics };
}

function kindOrder(kind: CatalogEntry["kind"]): number {
  if (kind === "skill") return 0;
  if (kind === "profile") return 1;
  if (kind === "reference") return 2;
  return 3;
}
