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
import {
  classifyRepositorySkillPath,
  logicalSkillDirectory,
} from "./discovery.js";
import { parseAssetMetadata } from "./metadata.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import type {
  AssetClassificationEvidence,
  AssetOwnership,
  Diagnostic,
  Evidence,
  ParsedDocument,
} from "./types.js";
import { buildStaticSupportDependencies } from "./static-support.js";

const QUALITY = DEFAULT_QUALITY_PROFILE;
const PLACEHOLDER_USAGE_BOUNDARY_PATTERN =
  /^(?:todo|tbd|tba|unknown|n\/?a|none|placeholder|to be defined)(?:[\s:-].*)?$/i;

type CatalogedKind = CatalogEntry["kind"];

export interface SkillParentCandidate {
  owner: string | null;
  id: string;
  sourcePath: string;
}

export type SkillParentIndex = ReadonlyMap<
  string,
  readonly SkillParentCandidate[]
>;

export type SkillParentResolution =
  | { state: "not-applicable" }
  | { state: "missing"; candidatePath: string }
  | {
      state: "ambiguous";
      candidatePath: string;
      candidates: readonly SkillParentCandidate[];
    }
  | {
      state: "resolved";
      candidatePath: string;
      parent: SkillParentCandidate;
    };

/** Index possible owning Skills once for both catalog and command resolution. */
export function buildSkillParentIndex(
  documents: ParsedDocument[],
): SkillParentIndex {
  const skillParents = new Map<string, SkillParentCandidate[]>();
  for (const document of documents) {
    if (document.artifact.kind !== "skill") continue;
    const metadata = parseAssetMetadata(document).metadata;
    const skillDirectory = logicalSkillDirectory(document.artifact.path);
    if (!skillDirectory) continue;
    const candidates = skillParents.get(skillDirectory) ?? [];
    candidates.push({
      owner: metadata.owner?.trim() || null,
      id: metadata.id ?? document.artifact.path,
      sourcePath: document.artifact.path,
    });
    skillParents.set(skillDirectory, candidates);
  }
  return skillParents;
}

/** Resolve a Skill-local parent using the same fail-closed index as ownership. */
export function resolveSkillSupportParent(
  relativePath: string,
  skillParents: SkillParentIndex,
): SkillParentResolution {
  const classified = classifyRepositorySkillPath(relativePath);
  if (classified?.kind !== "support") return { state: "not-applicable" };
  const candidatePath = `${classified.skillDirectory}/SKILL.md`;
  const candidates = skillParents.get(classified.skillDirectory) ?? [];
  if (candidates.length === 0) return { state: "missing", candidatePath };
  if (candidates.length > 1) {
    return {
      state: "ambiguous",
      candidatePath,
      candidates: [...candidates].sort((left, right) =>
        left.sourcePath.localeCompare(right.sourcePath),
      ),
    };
  }
  return { state: "resolved", candidatePath, parent: candidates[0]! };
}

/** Attach resolved parent evidence without changing structural classification. */
export function withResolvedSkillParent(
  classification: AssetClassificationEvidence,
  relativePath: string,
  skillParents: SkillParentIndex,
): AssetClassificationEvidence {
  const resolution = resolveSkillSupportParent(relativePath, skillParents);
  if (resolution.state === "not-applicable") return classification;
  if (resolution.state === "resolved") {
    return {
      ...classification,
      parentAssetCandidatePath: resolution.candidatePath,
      parentAssetPath: resolution.parent.sourcePath,
      parentResolution: "resolved",
    };
  }
  if (resolution.state === "ambiguous") {
    return {
      ...classification,
      parentAssetCandidatePath: resolution.candidatePath,
      parentResolution: "ambiguous",
      parentAssetCandidates: resolution.candidates.map(
        (candidate) => candidate.sourcePath,
      ),
    };
  }
  return {
    ...classification,
    parentAssetCandidatePath: resolution.candidatePath,
    parentResolution: "missing",
  };
}

/** Build a deterministic catalog of skill and context entries from parsed documents. */
export function buildCatalog(
  documents: ParsedDocument[],
  repositoryPaths: ReadonlySet<string> = new Set(
    documents.map((document) => document.artifact.path),
  ),
): {
  catalog: Catalog;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const skillParents = buildSkillParentIndex(documents);
  for (const [skillDirectory, candidates] of skillParents) {
    if (candidates.length <= 1) continue;
    diagnostics.push({
      severity: "warning",
      path: skillDirectory,
      message:
        "Ambiguous owning Skill evidence; local support ownership remains unowned.",
      details: {
        skillDirectory,
        candidatePaths: candidates
          .map((candidate) => candidate.sourcePath)
          .sort((left, right) => left.localeCompare(right)),
      },
    });
  }
  const entries = documents
    .map((document): CatalogEntry | undefined => {
      const result = parseAssetMetadata(document);
      const kind = catalogedKind(document, result.metadata);
      diagnostics.push(
        ...metadataBudgetDiagnostics(
          document,
          result.metadata,
          result.metadataFields,
          result.metadataListItems,
        ),
      );
      diagnostics.push(...result.diagnostics);
      if (kind) {
        diagnostics.push(
          ...assetMetadataDiagnostics(document, result.metadata, kind),
        );
      }

      if (!kind) return undefined;

      const ownership = resolveAssetOwnership(
        document,
        result.metadata,
        skillParents,
      );

      const base = {
        id: result.metadata.id ?? document.artifact.path,
        sourcePath: document.artifact.path,
        contentHash:
          document.artifact.contentHash ??
          contentHash(document.artifact.content),
        sizeBytes: document.artifact.sizeBytes,
        contentClassification: document.artifact.contentClassification,
        markdownParserEligible: document.artifact.markdownParserEligible,
        ownership,
        metadata: result.metadata,
        metadataFields: result.metadataFields,
        metadataListItems: result.metadataListItems,
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

  const dependencies = [
    ...entries.flatMap((entry) => dependenciesForEntry(entry)),
    ...buildStaticSupportDependencies(documents, entries, repositoryPaths),
  ].sort((a, b) => {
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

function resolveAssetOwnership(
  document: ParsedDocument,
  metadata: AssetMetadata,
  skillParents: SkillParentIndex,
): AssetOwnership {
  // Ownership is governance evidence, not a naming heuristic. Never derive it
  // from the path, prose, Git author, or modification history.
  const declaredOwner = metadata.owner?.trim() || null;
  if (declaredOwner) {
    return {
      declaredOwner,
      effectiveOwner: declaredOwner,
      source: "declared",
    };
  }

  const resolution = resolveSkillSupportParent(
    document.artifact.path,
    skillParents,
  );
  // Structural placement supplies only a candidate. Inheritance requires one
  // and only one resolved parent Skill and an owner declared by that parent.
  if (resolution.state !== "resolved" || !resolution.parent.owner) {
    return { declaredOwner: null, effectiveOwner: null, source: "unowned" };
  }
  const owningSkill = resolution.parent;
  return {
    declaredOwner: null,
    effectiveOwner: owningSkill.owner,
    source: "inherited",
    inheritedFrom: {
      id: owningSkill.id,
      sourcePath: owningSkill.sourcePath,
    },
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
    document.artifact.kind === "example" ||
    document.artifact.kind === "script" ||
    document.artifact.kind === "asset"
  ) {
    return document.artifact.kind;
  }
  return undefined;
}

function metadataBudgetDiagnostics(
  document: ParsedDocument,
  metadata: AssetMetadata,
  metadataFields: Record<string, CatalogEntry["metadataFields"][string]>,
  metadataListItems: CatalogEntry["metadataListItems"],
): Diagnostic[] {
  const frontmatter = frontmatterRange(document);
  if (!frontmatter) return [];

  const diagnostics: Diagnostic[] = [];
  const frontmatterLines = document.lines.slice(
    frontmatter.startLine - 1,
    frontmatter.endLine,
  );
  const lineCount = frontmatterLines.length;
  const charCount = frontmatterLines.join("\n").length;
  if (
    lineCount > QUALITY.frontmatterMaxLines ||
    charCount > QUALITY.frontmatterMaxChars
  ) {
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
      details: {
        measured: { lines: lineCount, chars: charCount },
        limit: {
          lines: QUALITY.frontmatterMaxLines,
          chars: QUALITY.frontmatterMaxChars,
        },
        unit: "frontmatter_lines_and_characters",
        profile: QUALITY.profile,
      },
    });
  }

  for (const [key, items] of Object.entries(metadataListItems)) {
    for (const item of items) {
      const itemText = metadataListItemText(item.raw);
      if (!shouldBudgetMetadataItem(key, itemText)) continue;
      if (itemText.length <= QUALITY.metadataListItemMaxChars) continue;

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
        details: {
          measured: itemText.length,
          limit: QUALITY.metadataListItemMaxChars,
          unit: "characters",
          profile: QUALITY.profile,
          field: key,
        },
      });
    }
  }

  for (const [key, values] of operationalMetadataLists(metadata)) {
    const field = metadataFields[key];
    if (!field?.key.startsWith("renma.")) continue;
    for (const value of values) {
      if (!shouldBudgetMetadataItem(key, value)) continue;
      if (value.length <= QUALITY.metadataListItemMaxChars) continue;
      diagnostics.push({
        severity: "warning",
        path: document.artifact.path,
        message: `Metadata list item is too long in ${key}. Item has ${value.length} characters; keep list items short and move routing prose into the markdown body or referenced context assets.`,
        evidence: {
          path: field.path,
          startLine: field.startLine,
          endLine: field.endLine,
          snippet: field.raw,
        },
        details: {
          measured: value.length,
          limit: QUALITY.metadataListItemMaxChars,
          unit: "characters",
          profile: QUALITY.profile,
          field: key,
        },
      });
    }
  }

  return diagnostics;
}

function operationalMetadataLists(
  metadata: AssetMetadata,
): Array<[string, string[]]> {
  return [
    ["tags", metadata.tags],
    ["when_to_use", metadata.whenToUse],
    ["when_not_to_use", metadata.whenNotToUse],
    ["requires_context", metadata.requiresContext],
    ["optional_context", metadata.optionalContext],
    ["requires_lens", metadata.requiresLens ?? []],
    ["optional_lens", metadata.optionalLens ?? []],
    ["conflicts", metadata.conflicts],
    ["superseded_by", metadata.supersededBy],
  ];
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

function shouldBudgetMetadataItem(key: string, value: string): boolean {
  if (key === "tags") return true;
  if (key === "when_to_use" || key === "when_not_to_use") return true;
  // IDs, paths, and URLs are machine-facing relationship values and may need
  // to exceed the prose advisory. Their structural validity is checked by the
  // relevant schema and graph rules instead.
  return !(
    /^(?:https?:\/\/|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.@%+~-]+)+)/.test(value) ||
    /^[a-z][a-z0-9_.-]+$/i.test(value)
  );
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
