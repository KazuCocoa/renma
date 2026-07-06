import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "../markdown.js";
import type {
  AssetKind,
  AssetStatus,
  CatalogEntry,
  Dependency,
} from "../model.js";
import type { Artifact } from "../types.js";
import { catalog } from "./catalog.js";

const DEFAULT_SECTION_PREVIEW_LINES = 3;

export type InspectFormat = "json" | "text";

export interface InspectOptions {
  format?: InspectFormat;
  lines?: string;
}

export interface InspectOutline {
  path: string;
  bytes: number;
  lineCount: number;
  frontmatterRange: null | string;
  asset: InspectAssetSummary | null;
  headings: Array<{
    depth: number;
    line: number;
    range: string;
    text: string;
    preview: string[];
  }>;
  codeFences: Array<{
    endLine: number;
    language: string;
    range: string;
    startLine: number;
  }>;
  links: Array<{
    line: number;
    target: string;
  }>;
}

export interface InspectAssetSummary {
  id: string;
  kind: AssetKind;
  owner?: string;
  status?: AssetStatus;
  tags: string[];
  purpose?: string;
  appliesTo: string[];
  focus: string[];
  expectedOutputs: string[];
  inboundDependents: InspectRelationship[];
  outboundDependencies: InspectRelationship[];
  relationshipChains: InspectRelationshipChain[];
}

export interface InspectRelationship {
  from: string;
  to: string;
  kind: string;
  sourcePath: string;
  resolved: boolean;
  targetId?: string;
  targetKind?: AssetKind;
  targetPath?: string;
}

export interface InspectRelationshipChain {
  skill: string;
  lens: string;
  context: string;
}

export interface InspectSlice {
  path: string;
  range: string;
  text: string;
}

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
  const absolutePath = path.resolve(target);
  const content = await readFile(absolutePath, "utf8");
  const artifact: Artifact = {
    absolutePath,
    content,
    kind: "reference",
    path: absolutePath,
    sizeBytes: Buffer.byteLength(content),
  };
  const document = parseDocument(artifact);
  const lineCount = document.lines.length;

  return {
    bytes: artifact.sizeBytes,
    asset: await inspectAssetForTarget(absolutePath),
    codeFences: document.codeFences.map((fence) => ({
      endLine: fence.endLine,
      language: fence.language,
      range: formatRange(fence.startLine, fence.endLine),
      startLine: fence.startLine,
    })),
    frontmatterRange: frontmatterRange(document.lines),
    headings: document.headings.map((heading, index) => {
      const nextHeading = document.headings
        .slice(index + 1)
        .find((candidate) => candidate.depth <= heading.depth);
      const endLine = nextHeading ? nextHeading.line - 1 : lineCount;
      return {
        depth: heading.depth,
        line: heading.line,
        preview: sectionPreview(document.lines, heading.line + 1, endLine),
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
  };
}

async function inspectAssetForTarget(
  absolutePath: string,
): Promise<InspectAssetSummary | null> {
  try {
    const root = inferCatalogRoot(absolutePath);
    const result = await catalog(root);
    const entry = result.catalog.entries.find(
      (candidate) => path.resolve(root, candidate.sourcePath) === absolutePath,
    );
    if (!entry) return null;

    const entriesById = new Map(
      result.catalog.entries.map((candidate) => [candidate.id, candidate]),
    );
    const inboundDependents = result.catalog.dependencies
      .filter((dependency) => dependency.to === entry.id)
      .map((dependency) => inspectRelationship(dependency, entriesById))
      .sort(compareInspectRelationships);
    const outboundDependencies = result.catalog.dependencies
      .filter((dependency) => dependency.from === entry.id)
      .map((dependency) => inspectRelationship(dependency, entriesById))
      .sort(compareInspectRelationships);

    return {
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
    };
  } catch {
    return null;
  }
}

function inspectRelationship(
  dependency: Dependency,
  entriesById: Map<string, CatalogEntry>,
): InspectRelationship {
  const source = entriesById.get(dependency.from);
  const target = entriesById.get(dependency.to);

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
      context: dependency.to,
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

function inferCatalogRoot(absolutePath: string): string {
  const segments = absolutePath.split(path.sep);
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    if (
      segments[index] === "skills" ||
      segments[index] === "context" ||
      segments[index] === "contexts" ||
      segments[index] === "lenses" ||
      segments[index] === ".agents"
    ) {
      return (
        segments.slice(0, index).join(path.sep) || path.parse(absolutePath).root
      );
    }
  }

  const cwd = path.resolve(process.cwd());
  const relativeToCwd = path.relative(cwd, absolutePath);
  if (
    relativeToCwd &&
    !relativeToCwd.startsWith("..") &&
    !path.isAbsolute(relativeToCwd)
  ) {
    return cwd;
  }
  return path.dirname(absolutePath);
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

function sectionPreview(lines: string[], start: number, end: number): string[] {
  const preview: string[] = [];
  let inFence = false;

  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    const line = lines[lineNumber - 1] ?? "";
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.trim() === "") {
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

function renderTextOutline(outline: InspectOutline): string {
  const lines = [
    `Path: ${outline.path}`,
    `Lines: ${outline.lineCount}`,
    `Bytes: ${outline.bytes}`,
    `Frontmatter: ${outline.frontmatterRange ?? "none"}`,
    ...(outline.asset
      ? ["", "Asset:", ...renderAssetSummary(outline.asset)]
      : []),
    "",
    "Headings:",
    ...outline.headings.flatMap((heading) => [
      `- ${"#".repeat(heading.depth)} ${heading.text} ${heading.range}`,
      ...heading.preview.map((line) => `  ${line}`),
    ]),
    "",
    "Code fences:",
    ...outline.codeFences.map(
      (fence) => `- ${fence.range} ${fence.language || "(no language)"}`,
    ),
    "",
    "Links:",
    ...outline.links.map((link) => `- L${link.line}: ${link.target}`),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function renderAssetSummary(asset: InspectAssetSummary): string[] {
  return [
    `- ID: ${asset.id}`,
    `- Kind: ${asset.kind}`,
    ...(asset.owner ? [`- Owner: ${asset.owner}`] : []),
    ...(asset.status ? [`- Status: ${asset.status}`] : []),
    `- Tags: ${list(asset.tags)}`,
    ...(asset.purpose ? [`- Purpose: ${asset.purpose}`] : []),
    `- Applies to: ${list(asset.appliesTo)}`,
    `- Focus: ${list(asset.focus)}`,
    `- Expected outputs: ${list(asset.expectedOutputs)}`,
    "",
    "Relationships:",
    "- Inbound dependents:",
    ...relationshipLines(asset.inboundDependents),
    "- Outbound dependencies:",
    ...relationshipLines(asset.outboundDependencies),
    ...(asset.relationshipChains.length > 0
      ? [
          "- Relationship chains:",
          ...asset.relationshipChains.map(
            (chain) =>
              `  - ${chain.skill} -> ${chain.lens} -> ${chain.context}`,
          ),
        ]
      : []),
  ];
}

function relationshipLines(relationships: InspectRelationship[]): string[] {
  if (relationships.length === 0) return ["  - (none)"];
  return relationships.map(
    (relationship) =>
      `  - ${relationship.from} ${relationship.kind} -> ${relationship.to}`,
  );
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function formatRange(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-L${end}`;
}
