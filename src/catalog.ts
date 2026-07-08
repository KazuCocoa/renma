import { createHash } from "node:crypto";
import { conflictDiagnostics } from "./catalog-conflicts.js";
import { lifecycleDiagnostics } from "./catalog-lifecycle.js";
import { contextBodyLanguageDiagnostics } from "./context-language-diagnostics.js";
import type {
  AssetMetadata,
  Catalog,
  CatalogEntry,
  Dependency,
  DependencyKind,
} from "./model.js";
import { parseAssetMetadata } from "./metadata.js";
import type { Diagnostic, Evidence, ParsedDocument } from "./types.js";

const FRONTMATTER_MAX_LINES = 24;
const FRONTMATTER_MAX_CHARS = 1200;
const METADATA_LIST_ITEM_MAX_CHARS = 140;
const PLACEHOLDER_USAGE_BOUNDARY_PATTERN =
  /^(?:todo|tbd|tba|unknown|n\/?a|none|placeholder|to be defined)(?:[\s:-].*)?$/i;

type CatalogedKind = CatalogEntry["kind"];

/** Build a deterministic catalog of skill and context entries from parsed documents. */
export function buildCatalog(documents: ParsedDocument[]): {
  catalog: Catalog;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const entries = documents
    .map((document): CatalogEntry | undefined => {
      const result = parseAssetMetadata(document);
      const kind = catalogedKind(document, result.metadata);
      diagnostics.push(...metadataBudgetDiagnostics(document));
      diagnostics.push(...result.diagnostics);
      if (kind) {
        diagnostics.push(
          ...assetMetadataDiagnostics(document, result.metadata, kind),
        );
      }

      if (!kind) return undefined;

      const base = {
        id: result.metadata.id ?? document.artifact.path,
        sourcePath: document.artifact.path,
        contentHash: contentHash(document.artifact.content),
        metadata: result.metadata,
        metadataFields: document.metadataFields,
        metadataListItems: document.metadataListItems,
      };

      if (kind === "skill") {
        return {
          ...base,
          kind: "skill",
          requiredContext: result.metadata.requiresContext,
          optionalContext: result.metadata.optionalContext,
          requiredLens: result.metadata.requiresLens ?? [],
          optionalLens: result.metadata.optionalLens ?? [],
          conflicts: result.metadata.conflicts,
        };
      }

      return {
        ...base,
        kind,
      };
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
  diagnostics.push(...dependencyDiagnostics(entries, dependencies));
  diagnostics.push(...lifecycleDiagnostics(entries));
  diagnostics.push(...conflictDiagnostics(entries));

  return {
    catalog: {
      entries,
      assets: entries,
      dependencies,
    },
    diagnostics,
  };
}

function catalogedKind(
  document: ParsedDocument,
  metadata: AssetMetadata,
): CatalogedKind | undefined {
  if (document.artifact.kind === "skill") return "skill";
  if (document.artifact.kind === "context_lens") return "context_lens";
  if (
    document.artifact.kind === "context" &&
    metadata.type === "context_lens"
  ) {
    return "context_lens";
  }
  if (
    document.artifact.kind === "context" ||
    document.artifact.kind === "profile" ||
    document.artifact.kind === "reference" ||
    document.artifact.kind === "example"
  ) {
    return document.artifact.kind;
  }
  return undefined;
}

function metadataBudgetDiagnostics(document: ParsedDocument): Diagnostic[] {
  const frontmatter = frontmatterRange(document);
  if (!frontmatter) return [];

  const diagnostics: Diagnostic[] = [];
  const frontmatterLines = document.lines.slice(
    frontmatter.startLine - 1,
    frontmatter.endLine,
  );
  const lineCount = frontmatterLines.length;
  const charCount = frontmatterLines.join("\n").length;
  if (lineCount > FRONTMATTER_MAX_LINES || charCount > FRONTMATTER_MAX_CHARS) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: `Frontmatter metadata is too large. Frontmatter has ${lineCount} lines and ${charCount} characters; keep metadata as a compact index and move detailed guidance into the markdown body or referenced context assets.`,
      evidence: {
        path: document.artifact.path,
        startLine: frontmatter.startLine,
        endLine: frontmatter.endLine,
        snippet: `frontmatter: ${lineCount} lines, ${charCount} characters`,
      },
    });
  }

  for (const [key, items] of Object.entries(document.metadataListItems)) {
    for (const item of items) {
      const itemText = metadataListItemText(item.raw);
      if (itemText.length <= METADATA_LIST_ITEM_MAX_CHARS) continue;

      diagnostics.push({
        severity: "warning",
        path: document.artifact.path,
        message: `Metadata list item is too long in ${key}. Item has ${itemText.length} characters; keep list items short and move routing prose into the markdown body or referenced context assets.`,
        evidence: {
          path: item.path,
          startLine: item.startLine,
          endLine: item.endLine,
          snippet: item.raw,
        },
      });
    }
  }

  return diagnostics;
}

function frontmatterRange(
  document: ParsedDocument,
): { startLine: number; endLine: number } | undefined {
  if (document.lines[0]?.trim() !== "---") return undefined;
  const endIndex = document.lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (endIndex < 0) return undefined;
  return { startLine: 1, endLine: endIndex + 1 };
}

function metadataListItemText(raw: string): string {
  return raw.replace(/^\s*-\s*/, "").trim();
}

function dependencyDiagnostics(
  entries: CatalogEntry[],
  dependencies: Dependency[],
): Diagnostic[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const diagnostics: Diagnostic[] = [];

  for (const dependency of dependencies) {
    if (dependency.to.includes("*")) continue;
    if (!shouldValidateDependencyTarget(dependency)) continue;

    const target = entriesById.get(dependency.to);
    if (!target) {
      if (dependency.kind === "conflicts") continue;

      diagnostics.push({
        severity: "warning",
        path: dependency.sourcePath,
        message: `Metadata dependency "${dependency.to}" from "${dependency.from}" does not match a catalog entry.`,
        ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
        details: {
          source: dependency.from,
          target: dependency.to,
          referenceKind: dependency.kind,
          sourcePath: dependency.sourcePath,
        },
      });
      continue;
    }

    if (
      dependency.kind === "optional" &&
      (target.metadata.status === "deprecated" ||
        target.metadata.status === "archived")
    ) {
      diagnostics.push({
        severity: "warning",
        path: dependency.sourcePath,
        message: `Metadata dependency "${dependency.to}" from "${dependency.from}" targets a ${target.metadata.status} asset.`,
        ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
        details: {
          source: dependency.from,
          target: dependency.to,
          referenceKind: dependency.kind,
          sourcePath: dependency.sourcePath,
          targetPath: target.sourcePath,
          targetStatus: target.metadata.status,
        },
      });
    }
  }

  return diagnostics;
}

function shouldValidateDependencyTarget(dependency: Dependency): boolean {
  return (
    dependency.to.startsWith("context.") || dependency.to.startsWith("lens.")
  );
}

function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function assetMetadataDiagnostics(
  document: ParsedDocument,
  metadata: AssetMetadata,
  kind: CatalogedKind,
): Diagnostic[] {
  if (kind === "context") {
    return sharedContextMetadataDiagnostics(document, metadata);
  }
  if (kind === "context_lens") {
    return contextLensMetadataDiagnostics(document, metadata);
  }
  return [];
}

function sharedContextMetadataDiagnostics(
  document: ParsedDocument,
  metadata: AssetMetadata,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!metadata.id) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Asset is missing an id.",
    });
  }

  if (!metadata.owner) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Asset is missing an owner.",
    });
  }

  if (isCanonicalSharedContext(metadata) && isActiveAsset(metadata)) {
    diagnostics.push(
      ...usageBoundaryDiagnostics(document, metadata),
      ...contextBodyLanguageDiagnostics(document),
    );
  }

  return diagnostics;
}

function contextLensMetadataDiagnostics(
  document: ParsedDocument,
  metadata: AssetMetadata,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!metadata.id) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Asset is missing an id.",
    });
  }

  if (!metadata.owner) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Asset is missing an owner.",
    });
  }

  if (!isCanonicalContextLens(metadata) || !isActiveAsset(metadata)) {
    return diagnostics;
  }

  if (!metadata.purpose) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Context lens asset is missing purpose metadata.",
      evidence: missingMetadataEvidence(document, "purpose"),
    });
  }

  if ((metadata.appliesTo ?? []).length === 0) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Context lens asset is missing applies_to metadata.",
      evidence: missingMetadataEvidence(document, "applies_to"),
    });
  }

  return diagnostics;
}

function isCanonicalSharedContext(metadata: AssetMetadata): boolean {
  return Boolean(metadata.id?.startsWith("context.") && metadata.owner);
}

function isCanonicalContextLens(metadata: AssetMetadata): boolean {
  return Boolean(metadata.id?.startsWith("lens.") && metadata.owner);
}

function isActiveAsset(metadata: AssetMetadata): boolean {
  return metadata.status !== "deprecated" && metadata.status !== "archived";
}

function usageBoundaryDiagnostics(
  document: ParsedDocument,
  metadata: AssetMetadata,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (metadata.whenToUse.length === 0) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Shared context asset is missing when_to_use metadata.",
      evidence: missingMetadataEvidence(document, "when_to_use"),
    });
  }

  if (metadata.whenNotToUse.length === 0) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: "Shared context asset is missing when_not_to_use metadata.",
      evidence: missingMetadataEvidence(document, "when_not_to_use"),
    });
  }

  diagnostics.push(
    ...placeholderUsageBoundaryDiagnostics(
      document,
      "when_to_use",
      metadata.whenToUse,
    ),
    ...placeholderUsageBoundaryDiagnostics(
      document,
      "when_not_to_use",
      metadata.whenNotToUse,
    ),
  );

  return diagnostics;
}

function placeholderUsageBoundaryDiagnostics(
  document: ParsedDocument,
  fieldKey: "when_to_use" | "when_not_to_use",
  values: string[],
): Diagnostic[] {
  return values
    .map((value, index): Diagnostic | undefined => {
      if (!PLACEHOLDER_USAGE_BOUNDARY_PATTERN.test(value.trim())) {
        return undefined;
      }

      return {
        severity: "warning",
        path: document.artifact.path,
        message: `Shared context asset usage-boundary metadata contains placeholder values in ${fieldKey}.`,
        evidence: metadataValueEvidence(document, fieldKey, index),
      };
    })
    .filter((diagnostic): diagnostic is Diagnostic => diagnostic !== undefined);
}

function metadataValueEvidence(
  document: ParsedDocument,
  fieldKey: string,
  index: number,
): Evidence {
  const item = document.metadataListItems[fieldKey]?.[index];
  if (item) {
    return {
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      snippet: item.raw,
    };
  }

  const field = document.metadataFields[fieldKey];
  if (field) {
    return {
      path: field.path,
      startLine: field.startLine,
      endLine: field.endLine,
      snippet: field.raw,
    };
  }

  return missingMetadataEvidence(document, fieldKey);
}

function missingMetadataEvidence(
  document: ParsedDocument,
  fieldKey: string,
): Evidence {
  const frontmatter = frontmatterRange(document);
  if (frontmatter) {
    return {
      path: document.artifact.path,
      startLine: frontmatter.startLine,
      endLine: frontmatter.endLine,
      snippet: `frontmatter missing ${fieldKey}`,
    };
  }

  return {
    path: document.artifact.path,
    startLine: 1,
    endLine: 1,
    snippet: `missing ${fieldKey} metadata`,
  };
}

/** Convert metadata relationship lists into graph edges for a catalog entry. */
function dependenciesForEntry(entry: CatalogEntry): Dependency[] {
  return [
    ...metadataDependencies(
      entry,
      "requires",
      entry.metadata.requiresContext,
      "requires_context",
    ),
    ...metadataDependencies(
      entry,
      "requires",
      entry.metadata.requiresLens ?? [],
      "requires_lens",
    ),
    ...metadataDependencies(
      entry,
      "optional",
      entry.metadata.optionalContext,
      "optional_context",
    ),
    ...metadataDependencies(
      entry,
      "optional",
      entry.metadata.optionalLens ?? [],
      "optional_lens",
    ),
    ...metadataDependencies(
      entry,
      "applies_to",
      entry.metadata.appliesTo ?? [],
      "applies_to",
    ),
    ...metadataDependencies(
      entry,
      "conflicts",
      entry.metadata.conflicts,
      "conflicts",
    ),
    ...metadataDependencies(
      entry,
      "references",
      entry.metadata.supersededBy,
      "superseded_by",
    ),
  ];
}

function metadataDependencies(
  entry: CatalogEntry,
  kind: DependencyKind,
  targets: string[],
  fieldKey: string,
): Dependency[] {
  return targets.map((target, index) => {
    const field =
      entry.metadataListItems[fieldKey]?.[index] ??
      entry.metadataFields[fieldKey];
    return {
      from: entry.id,
      to: target,
      kind,
      sourcePath: entry.sourcePath,
      evidence: metadataEvidence(entry.sourcePath, field),
    };
  });
}

function metadataEvidence(
  path: string,
  field: CatalogEntry["metadataFields"][string] | undefined,
): Evidence {
  if (field) {
    return {
      path: field.path,
      startLine: field.startLine,
      endLine: field.endLine,
      snippet: field.raw,
    };
  }

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
  if (kind === "context_lens") return 2;
  if (kind === "profile") return 3;
  if (kind === "reference") return 4;
  return 5;
}

/** Keep dependency output stable while grouping the most important edges first. */
function dependencyKindOrder(kind: DependencyKind): number {
  if (kind === "requires") return 0;
  if (kind === "optional") return 1;
  if (kind === "applies_to") return 2;
  if (kind === "conflicts") return 3;
  if (kind === "extends") return 4;
  if (kind === "references") return 5;
  return 6;
}
