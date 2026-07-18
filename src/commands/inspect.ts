import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  zeroContextLensSummary,
  type ContextLensSummary,
} from "../context-lens.js";
import type {
  InspectAssetSummary,
  InspectOutline,
  InspectRelationship,
  InspectRelationshipChain,
  InspectSlice,
} from "../evidence/inspect.js";
import {
  collectTargetDocumentEvidence,
  collectTargetRepositoryEvidence,
  type TargetDocumentEvidence,
  type TargetRepositoryEvidence,
} from "../evidence/target.js";
import type { CatalogEntry, Dependency } from "../model.js";
import { renderTextOutline } from "../renderers/inspect.js";
import type {
  AssetClassificationEvidence,
  AssetGovernanceEvidence,
  ParsedDocument,
} from "../types.js";
import {
  markdownCodeLineNumbers,
  markdownSyntaxForDocument,
} from "../markdown-syntax.js";

const DEFAULT_SECTION_PREVIEW_LINES = 3;

export type InspectFormat = "json" | "text";

export interface InspectOptions {
  format?: InspectFormat;
  lines?: string;
}

// Keep the established deep-import type contract while the implementation DTO
// lives below command orchestration and renderer dependencies.
export type {
  InspectAssetSummary,
  InspectOutline,
  InspectRelationship,
  InspectRelationshipChain,
  InspectSlice,
} from "../evidence/inspect.js";

export async function runInspectCommand(
  target: string,
  options: InspectOptions = {},
): Promise<number> {
  if (options.lines) {
    const slice = await buildInspectSlice(target, options.lines);
    process.stdout.write(
      options.format === "text"
        ? `${slice.text}\n`
        : `${JSON.stringify(slice, null, 2)}\n`,
    );
    return 0;
  }

  const outline = await buildInspectOutline(target);
  process.stdout.write(
    options.format === "text"
      ? renderTextOutline(outline)
      : `${JSON.stringify(outline, null, 2)}\n`,
  );
  return 0;
}

export async function buildInspectOutline(
  target: string,
): Promise<InspectOutline> {
  const targetEvidence = await collectTargetDocumentEvidence(target, {
    unresolvedArtifactPath: "absolute",
  });
  const repositoryEvidence =
    await collectTargetRepositoryEvidence(targetEvidence);
  const { absolutePath, content, document } = targetEvidence;
  const lineCount = document.lines.length;
  const repository = inspectRepositoryForTarget(
    targetEvidence,
    repositoryEvidence,
  );

  return {
    bytes: Buffer.byteLength(content),
    asset: repository.asset,
    codeFences: document.codeFences.map((fence) => ({
      endLine: fence.endLine,
      language: fence.language,
      range: formatRange(fence.startLine, fence.endLine),
      startLine: fence.startLine,
    })),
    contextLens: repository.contextLens,
    classification: repository.classification,
    governance: repository.governance,
    frontmatterRange: frontmatterRange(document.lines),
    headings: document.headings.map((heading, index) => {
      const nextHeading = document.headings
        .slice(index + 1)
        .find((candidate) => candidate.depth <= heading.depth);
      const endLine = nextHeading ? nextHeading.line - 1 : lineCount;
      return {
        depth: heading.depth,
        line: heading.line,
        preview: sectionPreview(document, heading.line + 1, endLine),
        range: formatRange(heading.line, endLine),
        text: heading.text,
      };
    }),
    lineCount,
    links: document.links.map((link) => ({
      line: link.line,
      target: link.target,
    })),
    path: absolutePath,
    repositoryBoundary: targetEvidence.repositoryBoundary,
  };
}

function inspectRepositoryForTarget(
  target: TargetDocumentEvidence,
  repository: TargetRepositoryEvidence,
): {
  asset: InspectAssetSummary | null;
  contextLens: ContextLensSummary;
  governance: AssetGovernanceEvidence | null;
  classification: AssetClassificationEvidence;
} {
  if (repository.state === "unavailable") {
    return {
      asset: null,
      contextLens: zeroContextLensSummary(),
      governance: null,
      classification: target.classification,
    };
  }
  const { snapshot, entry } = repository;
  if (!entry) {
    return {
      asset: null,
      contextLens: snapshot.contextLens,
      governance: repository.governance,
      classification: repository.classification,
    };
  }

  const resolver = createInspectRelationshipResolver(snapshot.catalog.entries);
  const inboundDependents = snapshot.catalog.dependencies
    .filter((dependency) => resolver.matches(dependency.to, entry))
    .map((dependency) => inspectRelationship(dependency, resolver))
    .sort(compareInspectRelationships);
  const outboundDependencies = snapshot.catalog.dependencies
    .filter((dependency) => resolver.matches(dependency.from, entry))
    .map((dependency) => inspectRelationship(dependency, resolver))
    .sort(compareInspectRelationships);

  return {
    asset: {
      id: entry.id,
      kind: entry.kind,
      ...(entry.metadata.owner ? { owner: entry.metadata.owner } : {}),
      ...(entry.metadata.status ? { status: entry.metadata.status } : {}),
      ...(entry.metadata.purpose ? { purpose: entry.metadata.purpose } : {}),
      appliesTo: entry.metadata.appliesTo ?? [],
      focus: entry.metadata.focus ?? [],
      expectedOutputs: entry.metadata.expectedOutputs ?? [],
      inboundDependents,
      outboundDependencies,
      relationshipChains: relationshipChains(
        entry,
        inboundDependents,
        outboundDependencies,
      ),
      tags: entry.metadata.tags,
    },
    contextLens: snapshot.contextLens,
    governance: repository.governance,
    classification: repository.classification,
  };
}

function inspectRelationship(
  dependency: Dependency,
  resolver: InspectRelationshipResolver,
): InspectRelationship {
  const source = resolver.resolve(dependency.from);
  const target = resolver.resolve(dependency.to);

  return {
    from: dependency.from,
    kind: inspectRelationshipKind(dependency, source, target),
    resolved: target !== undefined,
    sourcePath: dependency.sourcePath,
    to: dependency.to,
    ...(target ? { targetId: target.id } : {}),
    ...(target ? { targetKind: target.kind } : {}),
    ...(target ? { targetPath: target.sourcePath } : {}),
  };
}

function inspectRelationshipKind(
  dependency: Dependency,
  source: CatalogEntry | undefined,
  target: CatalogEntry | undefined,
): string {
  if (
    source?.kind === "skill" &&
    (target?.kind === "context_lens" || dependency.to.startsWith("lens."))
  ) {
    if (dependency.kind === "requires") return "requires_lens";
    if (dependency.kind === "optional") return "optional_lens";
  }

  if (
    source?.kind === "skill" &&
    (target?.kind === "context" || dependency.to.startsWith("context."))
  ) {
    if (dependency.kind === "requires") return "requires_context";
    if (dependency.kind === "optional") return "optional_context";
  }

  return dependency.kind;
}

interface InspectRelationshipResolver {
  matches(reference: string, entry: CatalogEntry): boolean;
  resolve(reference: string): CatalogEntry | undefined;
}

function createInspectRelationshipResolver(
  entries: CatalogEntry[],
): InspectRelationshipResolver {
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

  const resolve = (reference: string): CatalogEntry | undefined =>
    byId.get(reference) ?? byPath.get(normalizeReference(reference));

  return {
    matches(reference: string, entry: CatalogEntry): boolean {
      const resolved = resolve(reference);
      if (!resolved) return false;
      return sameCatalogEntry(resolved, entry);
    },
    resolve,
  };
}

function sameCatalogEntry(left: CatalogEntry, right: CatalogEntry): boolean {
  return (
    left.id === right.id ||
    normalizeReference(left.sourcePath) === normalizeReference(right.sourcePath)
  );
}

function normalizeReference(reference: string): string {
  return reference.replace(/\\/g, "/").replace(/^\.\//, "");
}

function relationshipChains(
  entry: CatalogEntry,
  inboundDependents: InspectRelationship[],
  outboundDependencies: InspectRelationship[],
): InspectRelationshipChain[] {
  if (entry.kind !== "context_lens") return [];

  const skillDependents = inboundDependents.filter(
    (relationship) =>
      relationship.kind === "requires_lens" ||
      relationship.kind === "optional_lens",
  );
  const appliedContexts = outboundDependencies.filter(
    (relationship) => relationship.kind === "applies_to",
  );

  return skillDependents.flatMap((dependent) =>
    appliedContexts.map((dependency) => ({
      context: dependency.targetId ?? dependency.to,
      lens: entry.id,
      skill: dependent.from,
    })),
  );
}

function compareInspectRelationships(
  left: InspectRelationship,
  right: InspectRelationship,
): number {
  const byFrom = left.from.localeCompare(right.from);
  if (byFrom !== 0) return byFrom;
  const byKind = left.kind.localeCompare(right.kind);
  if (byKind !== 0) return byKind;
  return left.to.localeCompare(right.to);
}

async function buildInspectSlice(
  target: string,
  requestedRange: string,
): Promise<InspectSlice> {
  const absolutePath = path.resolve(target);
  const content = await readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  const { end, start } = parseLineRange(requestedRange, lines.length);
  const slicedText = lines
    .slice(start - 1, end)
    .map((line, index) => `L${String(start + index).padStart(4, "0")}: ${line}`)
    .join("\n");

  return {
    path: absolutePath,
    range: formatRange(start, end),
    text: slicedText,
  };
}

function frontmatterRange(lines: string[]): null | string {
  if (lines[0] !== "---") {
    return null;
  }

  const endIndex = lines.slice(1).findIndex((line) => line === "---");
  return endIndex === -1 ? null : formatRange(1, endIndex + 2);
}

function sectionPreview(
  document: ParsedDocument,
  start: number,
  end: number,
): string[] {
  const preview: string[] = [];
  const syntax = markdownSyntaxForDocument(document);
  const codeLines =
    syntax === undefined ? new Set<number>() : markdownCodeLineNumbers(syntax);

  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    const line = document.lines[lineNumber - 1] ?? "";
    if (codeLines.has(lineNumber) || line.trim() === "") {
      continue;
    }
    preview.push(`L${String(lineNumber).padStart(4, "0")}: ${line.trim()}`);
    if (preview.length >= DEFAULT_SECTION_PREVIEW_LINES) {
      break;
    }
  }

  return preview;
}

function parseLineRange(
  value: string,
  lineCount: number,
): { end: number; start: number } {
  const match = /^L?(\d+)(?:-L?(\d+))?$/i.exec(value.trim());
  if (!match) {
    throw new Error("--lines must look like L10-L42 or 10-42.");
  }

  const start = Number.parseInt(match[1] ?? "", 10);
  const end = Number.parseInt(match[2] ?? match[1] ?? "", 10);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > lineCount
  ) {
    throw new Error(
      `--lines ${value} is outside the file's 1-${lineCount} range.`,
    );
  }

  return { end, start };
}

function formatRange(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-L${end}`;
}
