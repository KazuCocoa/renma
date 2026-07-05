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

const FRONTMATTER_MAX_LINES = 24;
const FRONTMATTER_MAX_CHARS = 1200;
const METADATA_LIST_ITEM_MAX_CHARS = 140;
const PLACEHOLDER_USAGE_BOUNDARY_PATTERN =
  /^(?:todo|tbd|tba|unknown|n\/?a|none|placeholder|to be defined)(?:[\s:-].*)?$/i;
const DATED_OR_VERSIONED_CONTEXT_LINE_PATTERN =
  /\b(?:\d{4}-\d{2}-\d{2}|v?\d+\.\d+(?:\.\d+)?)\b/i;
const CONTEXT_VAGUE_WORDING_PATTERNS: ContextLinePattern[] = [
  { pattern: /\busually\b/i, label: "usually" },
  { pattern: /\boften\b/i, label: "often" },
  { pattern: /\bquickly\b/i, label: "quickly" },
  { pattern: /\bsoon\b/i, label: "soon" },
  { pattern: /\bas needed\b/i, label: "as needed" },
  { pattern: /\bwhere appropriate\b/i, label: "where appropriate" },
  { pattern: /\bmajor\b/i, label: "major" },
  { pattern: /\bserious\b/i, label: "serious" },
  { pattern: /\blarge customers?\b/i, label: "large customer" },
];
const CONTEXT_CURRENTNESS_PATTERNS: ContextLinePattern[] = [
  { pattern: /\brecently\b/i, label: "recently" },
  { pattern: /\blatest\b/i, label: "latest" },
  { pattern: /\bcurrently\b/i, label: "currently" },
  { pattern: /\bas of now\b/i, label: "as of now" },
  { pattern: /\btoday\b/i, label: "today" },
  { pattern: /\btomorrow\b/i, label: "tomorrow" },
  {
    pattern: /\bthis (?:week|month|quarter|year)\b/i,
    label: "this period",
  },
  {
    pattern: /\blast (?:week|month|quarter|year)\b/i,
    label: "last period",
  },
  {
    pattern: /\bnext (?:week|month|quarter|year)\b/i,
    label: "next period",
  },
];

type ContextLinePattern = {
  pattern: RegExp;
  label: string;
};

type ContextLineMatch = {
  label: string;
  line: number;
  text: string;
};

/** Build a deterministic catalog of skill and context entries from parsed documents. */
export function buildCatalog(documents: ParsedDocument[]): {
  catalog: Catalog;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const entries = documents
    .map((document): CatalogEntry | undefined => {
      const result = parseAssetMetadata(document);
      diagnostics.push(...metadataBudgetDiagnostics(document));
      diagnostics.push(...result.diagnostics);
      diagnostics.push(
        ...sharedContextMetadataDiagnostics(document, result.metadata),
      );

      const base = {
        id: result.metadata.id ?? document.artifact.path,
        sourcePath: document.artifact.path,
        contentHash: contentHash(document.artifact.content),
        metadata: result.metadata,
        metadataFields: document.metadataFields,
        metadataListItems: document.metadataListItems,
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
  diagnostics.push(...dependencyDiagnostics(entries, dependencies));

  return {
    catalog: {
      entries,
      assets: entries,
      dependencies,
    },
    diagnostics,
  };
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
    if (!dependency.to.startsWith("context.")) continue;

    const target = entriesById.get(dependency.to);
    if (!target) {
      diagnostics.push({
        severity: "warning",
        path: dependency.sourcePath,
        message: `Metadata dependency "${dependency.to}" from "${dependency.from}" does not match a catalog entry.`,
        ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
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
      });
    }
  }

  return diagnostics;
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

  if (isCanonicalSharedContext(metadata) && isActiveContext(metadata)) {
    diagnostics.push(
      ...usageBoundaryDiagnostics(document, metadata),
      ...contextBodyLanguageDiagnostics(document),
    );
  }

  return diagnostics;
}

function isCanonicalSharedContext(metadata: AssetMetadata): boolean {
  return Boolean(metadata.id?.startsWith("context.") && metadata.owner);
}

function isActiveContext(metadata: AssetMetadata): boolean {
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

function contextBodyLanguageDiagnostics(
  document: ParsedDocument,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const vagueMatch = firstBodyLinePatternMatch(
    document,
    CONTEXT_VAGUE_WORDING_PATTERNS,
  );
  if (vagueMatch) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: `Shared context asset contains vague wording "${vagueMatch.label}".`,
      evidence: evidence(document, vagueMatch.line, vagueMatch.text),
    });
  }

  const currentnessMatch = firstBodyLinePatternMatch(
    document,
    CONTEXT_CURRENTNESS_PATTERNS,
    (line) => !DATED_OR_VERSIONED_CONTEXT_LINE_PATTERN.test(line),
  );
  if (currentnessMatch) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: `Shared context asset contains currentness wording "${currentnessMatch.label}" without an explicit date or version.`,
      evidence: evidence(document, currentnessMatch.line, currentnessMatch.text),
    });
  }

  return diagnostics;
}

function firstBodyLinePatternMatch(
  document: ParsedDocument,
  patterns: ContextLinePattern[],
  shouldInspectLine: (line: string) => boolean = () => true,
): ContextLineMatch | undefined {
  for (const index of markdownBodyLineIndexes(document)) {
    const line = document.lines[index] ?? "";
    if (!line.trim()) continue;
    if (!shouldInspectLine(line)) continue;

    for (const { pattern, label } of patterns) {
      if (!pattern.test(line)) continue;
      return { label, line: index + 1, text: line };
    }
  }

  return undefined;
}

function markdownBodyLineIndexes(document: ParsedDocument): number[] {
  const frontmatter = frontmatterRange(document);
  const bodyStart = frontmatter ? frontmatter.endLine : 0;
  return document.lines
    .map((_, index) => index)
    .filter((index) => index >= bodyStart);
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

function evidence(
  document: ParsedDocument,
  line: number,
  snippet: string,
): Evidence {
  return {
    path: document.artifact.path,
    startLine: line,
    endLine: line,
    snippet: snippet.trim().slice(0, 240),
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
      "optional",
      entry.metadata.optionalContext,
      "optional_context",
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
  if (kind === "references") return 4;
  return 5;
}
