import path from "node:path";
import type { Catalog, CatalogEntry } from "./model.js";
import type { Diagnostic, Evidence, ParsedDocument } from "./types.js";

export const CONTEXT_LENS_DIAGNOSTIC_CODES = {
  DEPRECATED_FIELD: "CONTEXT-LENS-DEPRECATED-FIELD",
  DUPLICATE_ID: "CONTEXT-LENS-DUPLICATE-ID",
  EMPTY_DEFINITION: "CONTEXT-LENS-EMPTY-DEFINITION",
  GOVERNANCE_MEANINGLESS: "CONTEXT-LENS-GOVERNANCE-MEANINGLESS",
  MISSING_REQUIRED_FIELD: "CONTEXT-LENS-MISSING-REQUIRED-FIELD",
  PATH_NORMALIZATION_MISMATCH: "CONTEXT-LENS-PATH-NORMALIZATION-MISMATCH",
  TARGET_NOT_CONTEXT: "CONTEXT-LENS-TARGET-NOT-CONTEXT",
  TARGET_NOT_FOUND: "CONTEXT-LENS-TARGET-NOT-FOUND",
  UNPARSEABLE_FRONTMATTER: "CONTEXT-LENS-UNPARSEABLE-FRONTMATTER",
  UNSUPPORTED_KIND: "CONTEXT-LENS-UNSUPPORTED-KIND",
  UNSUPPORTED_SCOPE: "CONTEXT-LENS-UNSUPPORTED-SCOPE",
  UNSUPPORTED_VERSION: "CONTEXT-LENS-UNSUPPORTED-VERSION",
} as const;

const SUPPORTED_LENS_SCOPES = new Set(["context"]);
const SUPPORTED_LENS_VERSIONS = new Set(["1"]);
const DEPRECATED_LENS_FIELDS = new Map([
  ["target", "applies_to"],
  ["targets", "applies_to"],
  ["output", "expected_outputs"],
  ["outputs", "expected_outputs"],
]);
const REQUIRED_LENS_FIELDS = ["id", "owner", "purpose", "applies_to"];

export interface ContextLensDiagnosticCounts {
  error: number;
  warning: number;
  info: number;
}

export interface ContextLensItemSummary {
  id: string;
  path: string;
  valid: boolean;
  scope: string;
  targets: string[];
  targetPaths: string[];
  diagnosticCounts: ContextLensDiagnosticCounts;
  diagnosticCodes: string[];
}

export interface ContextLensSummary {
  enabled: boolean;
  detected: boolean;
  totalLensCount: number;
  validLensCount: number;
  invalidLensCount: number;
  diagnosticCounts: ContextLensDiagnosticCounts;
  representativeDiagnosticCode?: string;
  definitionPaths: string[];
  targetReferences: string[];
  targetPaths: string[];
  unresolvedTargetReferences: string[];
  scopeSummary: Array<{ scope: string; count: number }>;
  lenses: ContextLensItemSummary[];
}

export interface ContextLensReport {
  summary: ContextLensSummary;
  diagnostics: Diagnostic[];
}

interface LensDocument {
  document: ParsedDocument;
  entry?: CatalogEntry;
  id: string;
  scope: string;
  targets: string[];
  targetPaths: string[];
}

/** Deterministically summarize and validate Context Lens governance state. */
export function summarizeContextLensGovernance(
  documents: ParsedDocument[],
  catalog: Catalog,
): ContextLensReport {
  const diagnostics: Diagnostic[] = [];
  const resolver = createCatalogReferenceResolver(catalog.entries);
  const lensDocuments = documents
    .flatMap((document): LensDocument[] => {
      diagnostics.push(...unsupportedKindDiagnostics(document));
      if (!isLensDocument(document)) return [];

      const entry = catalog.entries.find(
        (candidate) => candidate.sourcePath === document.artifact.path,
      );
      const id = textMetadata(document, "id") ?? document.artifact.path;
      const scope = textMetadata(document, "scope") ?? "context";
      const targets = listMetadata(document, "applies_to");
      const targetPaths = targets
        .map((target) => resolver.resolve(target)?.sourcePath)
        .filter((targetPath): targetPath is string => targetPath !== undefined)
        .sort((a, b) => a.localeCompare(b));

      return [
        {
          document,
          ...(entry ? { entry } : {}),
          id,
          scope,
          targets,
          targetPaths,
        },
      ];
    })
    .sort((a, b) =>
      a.document.artifact.path.localeCompare(b.document.artifact.path),
    );

  for (const lens of lensDocuments) {
    diagnostics.push(
      ...frontmatterDiagnostics(lens.document),
      ...requiredFieldDiagnostics(lens.document),
      ...unsupportedValueDiagnostics(lens.document),
      ...deprecatedFieldDiagnostics(lens.document),
      ...targetDiagnostics(lens.document, resolver),
      ...definitionBodyDiagnostics(lens.document),
    );
  }
  diagnostics.push(...duplicateIdDiagnostics(lensDocuments));

  const sortedDiagnostics = stableDiagnostics(diagnostics);
  const diagnosticCounts = countDiagnostics(sortedDiagnostics);
  const diagnosticsByPath = diagnosticsByLensPath(sortedDiagnostics);
  const lenses = lensDocuments.map((lens) => {
    const lensDiagnostics =
      diagnosticsByPath.get(lens.document.artifact.path) ?? [];
    const lensCounts = countDiagnostics(lensDiagnostics);
    return {
      id: lens.id,
      path: lens.document.artifact.path,
      valid: lensCounts.error === 0,
      scope: lens.scope,
      targets: stableUnique(lens.targets.map(normalizeReference)),
      targetPaths: stableUnique(lens.targetPaths),
      diagnosticCounts: lensCounts,
      diagnosticCodes: stableUnique(
        lensDiagnostics
          .map((diagnostic) => diagnostic.code)
          .filter((code): code is string => code !== undefined),
      ),
    };
  });
  const invalidLensCount = lenses.filter((lens) => !lens.valid).length;

  return {
    summary: {
      enabled: true,
      detected: lenses.length > 0,
      totalLensCount: lenses.length,
      validLensCount: lenses.length - invalidLensCount,
      invalidLensCount,
      diagnosticCounts,
      ...(sortedDiagnostics[0]?.code
        ? { representativeDiagnosticCode: sortedDiagnostics[0].code }
        : {}),
      definitionPaths: lenses.map((lens) => lens.path),
      targetReferences: stableUnique(
        lenses.flatMap((lens) => lens.targets.map(normalizeReference)),
      ),
      targetPaths: stableUnique(lenses.flatMap((lens) => lens.targetPaths)),
      unresolvedTargetReferences: stableUnique(
        sortedDiagnostics
          .filter(
            (diagnostic) =>
              diagnostic.code ===
              CONTEXT_LENS_DIAGNOSTIC_CODES.TARGET_NOT_FOUND,
          )
          .map(unresolvedReferenceFromDiagnostic)
          .filter((reference): reference is string => reference !== undefined),
      ),
      scopeSummary: summarizeScopes(lenses),
      lenses,
    },
    diagnostics: sortedDiagnostics,
  };
}

export function zeroContextLensSummary(): ContextLensSummary {
  return {
    enabled: true,
    detected: false,
    totalLensCount: 0,
    validLensCount: 0,
    invalidLensCount: 0,
    diagnosticCounts: zeroDiagnosticCounts(),
    definitionPaths: [],
    targetReferences: [],
    targetPaths: [],
    unresolvedTargetReferences: [],
    scopeSummary: [],
    lenses: [],
  };
}

function isLensDocument(document: ParsedDocument): boolean {
  if (document.artifact.kind === "context_lens") return true;
  return (
    document.artifact.kind === "context" &&
    textMetadata(document, "type") === "context_lens"
  );
}

function unsupportedKindDiagnostics(document: ParsedDocument): Diagnostic[] {
  if (textMetadata(document, "type") !== "context_lens") return [];
  if (
    document.artifact.kind === "context_lens" ||
    document.artifact.kind === "context"
  ) {
    return [];
  }

  return [
    {
      code: CONTEXT_LENS_DIAGNOSTIC_CODES.UNSUPPORTED_KIND,
      severity: "warning",
      path: document.artifact.path,
      message:
        "Context lens type metadata is only supported under lenses/**, context/**, or contexts/**.",
      evidence: fieldEvidence(document, "type"),
    },
  ];
}

function frontmatterDiagnostics(document: ParsedDocument): Diagnostic[] {
  if (document.lines[0]?.trim() !== "---") return [];
  const closingIndex = document.lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closingIndex >= 0) return [];

  return [
    {
      code: CONTEXT_LENS_DIAGNOSTIC_CODES.UNPARSEABLE_FRONTMATTER,
      severity: "error",
      path: document.artifact.path,
      message:
        "Context lens frontmatter starts with --- but does not include a closing --- delimiter.",
      evidence: {
        path: document.artifact.path,
        startLine: 1,
        endLine: document.lines.length,
        snippet: "unclosed frontmatter",
      },
    },
  ];
}

function requiredFieldDiagnostics(document: ParsedDocument): Diagnostic[] {
  return REQUIRED_LENS_FIELDS.flatMap((field) => {
    const present =
      field === "applies_to"
        ? listMetadata(document, field).length > 0
        : Boolean(textMetadata(document, field));
    if (present) return [];

    return [
      {
        code: CONTEXT_LENS_DIAGNOSTIC_CODES.MISSING_REQUIRED_FIELD,
        severity: "error",
        path: document.artifact.path,
        message: `Context lens definition is missing required field "${field}".`,
        evidence: missingFieldEvidence(document, field),
        details: {
          sourcePath: document.artifact.path,
          field,
        },
      },
    ];
  });
}

function unsupportedValueDiagnostics(document: ParsedDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const type = textMetadata(document, "type");
  if (type !== undefined && type !== "context_lens") {
    diagnostics.push({
      code: CONTEXT_LENS_DIAGNOSTIC_CODES.UNSUPPORTED_KIND,
      severity: "error",
      path: document.artifact.path,
      message: `Context lens definition uses unsupported type "${type}". Expected context_lens.`,
      evidence: fieldEvidence(document, "type"),
    });
  }

  const scope = textMetadata(document, "scope");
  if (scope !== undefined && !SUPPORTED_LENS_SCOPES.has(scope)) {
    diagnostics.push({
      code: CONTEXT_LENS_DIAGNOSTIC_CODES.UNSUPPORTED_SCOPE,
      severity: "error",
      path: document.artifact.path,
      message: `Context lens definition uses unsupported scope "${scope}". Expected one of: ${[
        ...SUPPORTED_LENS_SCOPES,
      ].join(", ")}.`,
      evidence: fieldEvidence(document, "scope"),
    });
  }

  const version = textMetadata(document, "version");
  if (version !== undefined && !SUPPORTED_LENS_VERSIONS.has(version)) {
    diagnostics.push({
      code: CONTEXT_LENS_DIAGNOSTIC_CODES.UNSUPPORTED_VERSION,
      severity: "error",
      path: document.artifact.path,
      message: `Context lens definition uses unsupported version "${version}". Expected one of: ${[
        ...SUPPORTED_LENS_VERSIONS,
      ].join(", ")}.`,
      evidence: fieldEvidence(document, "version"),
    });
  }

  return diagnostics;
}

function deprecatedFieldDiagnostics(document: ParsedDocument): Diagnostic[] {
  return [...DEPRECATED_LENS_FIELDS.entries()].flatMap(
    ([field, replacement]) => {
      if (document.metadata[field] === undefined) return [];
      return [
        {
          code: CONTEXT_LENS_DIAGNOSTIC_CODES.DEPRECATED_FIELD,
          severity: "warning",
          path: document.artifact.path,
          message: `Context lens field "${field}" is deprecated. Use "${replacement}" instead.`,
          evidence: fieldEvidence(document, field),
        },
      ];
    },
  );
}

function targetDiagnostics(
  document: ParsedDocument,
  resolver: CatalogReferenceResolver,
): Diagnostic[] {
  return listMetadata(document, "applies_to").flatMap((target, index) => {
    const diagnostics: Diagnostic[] = [];
    const normalized = normalizeReference(target);
    if (isPathReference(target) && normalized !== target) {
      diagnostics.push({
        code: CONTEXT_LENS_DIAGNOSTIC_CODES.PATH_NORMALIZATION_MISMATCH,
        severity: "warning",
        path: document.artifact.path,
        message: `Context lens target path "${target}" normalizes to "${normalized}".`,
        evidence: listItemEvidence(document, "applies_to", index),
        details: {
          sourcePath: document.artifact.path,
          target,
          normalizedTarget: normalized,
          field: "applies_to",
        },
      });
    }

    const resolvedTarget = resolver.resolve(target);
    if (!resolvedTarget) {
      diagnostics.push({
        code: CONTEXT_LENS_DIAGNOSTIC_CODES.TARGET_NOT_FOUND,
        severity: "error",
        path: document.artifact.path,
        message: `Context lens target "${target}" does not resolve to a cataloged asset.`,
        evidence: listItemEvidence(document, "applies_to", index),
        details: {
          sourcePath: document.artifact.path,
          target,
          field: "applies_to",
        },
      });
    } else if (resolvedTarget.kind !== "context") {
      diagnostics.push({
        code: CONTEXT_LENS_DIAGNOSTIC_CODES.TARGET_NOT_CONTEXT,
        severity: "error",
        path: document.artifact.path,
        message: `Context lens target "${target}" resolves to ${resolvedTarget.kind} asset "${resolvedTarget.sourcePath}", but applies_to must reference a Context Asset. Update applies_to to use a Context Asset ID or path.`,
        evidence: listItemEvidence(document, "applies_to", index),
        details: {
          sourcePath: document.artifact.path,
          target,
          resolvedTargetPath: resolvedTarget.sourcePath,
          resolvedTargetKind: resolvedTarget.kind,
          field: "applies_to",
        },
      });
    }

    return diagnostics;
  });
}

function definitionBodyDiagnostics(document: ParsedDocument): Diagnostic[] {
  if (document.artifact.content.trim().length === 0) {
    return [
      {
        code: CONTEXT_LENS_DIAGNOSTIC_CODES.EMPTY_DEFINITION,
        severity: "error",
        path: document.artifact.path,
        message: "Context lens definition is empty.",
        evidence: {
          path: document.artifact.path,
          startLine: 1,
          endLine: 1,
          snippet: "empty context lens definition",
        },
      },
    ];
  }

  const meaningfulMetadata = [
    "purpose",
    "applies_to",
    "focus",
    "expected_outputs",
  ].some((field) =>
    field === "purpose"
      ? Boolean(textMetadata(document, field))
      : listMetadata(document, field).length > 0,
  );
  const meaningfulBody = bodyLines(document).some(
    (line) => line.trim().length > 0 && !line.trimStart().startsWith("#"),
  );
  if (meaningfulMetadata || meaningfulBody) return [];

  return [
    {
      code: CONTEXT_LENS_DIAGNOSTIC_CODES.GOVERNANCE_MEANINGLESS,
      severity: "warning",
      path: document.artifact.path,
      message:
        "Context lens definition has no governance-meaningful purpose, target, focus, expected output, or body guidance.",
      evidence: missingFieldEvidence(document, "purpose"),
    },
  ];
}

function duplicateIdDiagnostics(lenses: LensDocument[]): Diagnostic[] {
  const byId = new Map<string, LensDocument[]>();
  for (const lens of lenses) {
    if (!textMetadata(lens.document, "id")) continue;
    byId.set(lens.id, [...(byId.get(lens.id) ?? []), lens]);
  }

  return [...byId.entries()].flatMap(([id, duplicates]) => {
    if (duplicates.length < 2) return [];
    const paths = duplicates
      .map((lens) => lens.document.artifact.path)
      .sort((a, b) => a.localeCompare(b));
    return duplicates.map((lens) => ({
      code: CONTEXT_LENS_DIAGNOSTIC_CODES.DUPLICATE_ID,
      severity: "error" as const,
      path: lens.document.artifact.path,
      message: `Context lens id "${id}" is duplicated by ${paths.join(", ")}.`,
      evidence: fieldEvidence(lens.document, "id"),
      details: {
        lensId: id,
        duplicatePaths: paths,
        sourcePath: lens.document.artifact.path,
      },
    }));
  });
}

interface CatalogReferenceResolver {
  resolve(reference: string): CatalogEntry | undefined;
}

function createCatalogReferenceResolver(
  entries: CatalogEntry[],
): CatalogReferenceResolver {
  const byId = new Map<string, CatalogEntry>();
  const byPath = new Map<string, CatalogEntry>();

  for (const entry of entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
    for (const reference of [
      entry.sourcePath,
      normalizeReference(entry.sourcePath),
      `./${entry.sourcePath}`,
    ]) {
      const normalized = normalizeReference(reference);
      if (!byPath.has(normalized)) byPath.set(normalized, entry);
    }
  }

  return {
    resolve(reference: string): CatalogEntry | undefined {
      return byId.get(reference) ?? byPath.get(normalizeReference(reference));
    },
  };
}

function diagnosticsByLensPath(
  diagnostics: Diagnostic[],
): Map<string, Diagnostic[]> {
  const result = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.path) continue;
    result.set(diagnostic.path, [
      ...(result.get(diagnostic.path) ?? []),
      diagnostic,
    ]);
  }
  return result;
}

function countDiagnostics(
  diagnostics: Diagnostic[],
): ContextLensDiagnosticCounts {
  const counts = zeroDiagnosticCounts();
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
  }
  return counts;
}

function zeroDiagnosticCounts(): ContextLensDiagnosticCounts {
  return {
    error: 0,
    warning: 0,
    info: 0,
  };
}

function summarizeScopes(
  lenses: ContextLensItemSummary[],
): Array<{ scope: string; count: number }> {
  const counts = new Map<string, number>();
  for (const lens of lenses) {
    counts.set(lens.scope, (counts.get(lens.scope) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([scope, count]) => ({ scope, count }))
    .sort((a, b) => a.scope.localeCompare(b.scope));
}

function stableDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const byPath = (a.path ?? "").localeCompare(b.path ?? "");
    if (byPath !== 0) return byPath;
    const byCode = (a.code ?? "").localeCompare(b.code ?? "");
    if (byCode !== 0) return byCode;
    const byLine = (a.evidence?.startLine ?? 0) - (b.evidence?.startLine ?? 0);
    if (byLine !== 0) return byLine;
    return a.message.localeCompare(b.message);
  });
}

function stableUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function unresolvedReferenceFromDiagnostic(
  diagnostic: Diagnostic,
): string | undefined {
  if (typeof diagnostic.details?.target === "string") {
    return diagnostic.details.target;
  }
  return diagnostic.message.match(/"([^"]+)"/)?.[1];
}

function textMetadata(
  document: ParsedDocument,
  field: string,
): string | undefined {
  const value = document.metadata[field];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function listMetadata(document: ParsedDocument, field: string): string[] {
  const value = document.metadata[field];
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function fieldEvidence(document: ParsedDocument, field: string): Evidence {
  const metadata = document.metadataFields[field];
  if (metadata) {
    return {
      path: metadata.path,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      snippet: metadata.raw,
    };
  }
  return missingFieldEvidence(document, field);
}

function listItemEvidence(
  document: ParsedDocument,
  field: string,
  index: number,
): Evidence {
  const item = document.metadataListItems[field]?.[index];
  if (item) {
    return {
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      snippet: item.raw,
    };
  }
  return fieldEvidence(document, field);
}

function missingFieldEvidence(
  document: ParsedDocument,
  field: string,
): Evidence {
  const frontmatter = frontmatterRange(document);
  if (frontmatter) {
    return {
      path: document.artifact.path,
      startLine: frontmatter.startLine,
      endLine: frontmatter.endLine,
      snippet: `frontmatter missing ${field}`,
    };
  }
  return {
    path: document.artifact.path,
    startLine: 1,
    endLine: 1,
    snippet: `missing ${field}`,
  };
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

function bodyLines(document: ParsedDocument): string[] {
  const frontmatter = frontmatterRange(document);
  return document.lines.slice(frontmatter ? frontmatter.endLine : 0);
}

function isPathReference(reference: string): boolean {
  return (
    reference.includes("/") ||
    reference.includes("\\") ||
    reference.startsWith(".") ||
    reference.endsWith(".md") ||
    path.isAbsolute(reference)
  );
}

function normalizeReference(reference: string): string {
  return reference
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");
}
