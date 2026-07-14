import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  zeroContextLensSummary,
  type ContextLensSummary,
} from "../context-lens.js";
import {
  classifyAssetPath,
  repositoryClassificationPath,
} from "../discovery.js";
import { parseDocument } from "../markdown.js";
import { parseAssetMetadata } from "../metadata.js";
import type {
  AssetKind,
  AssetStatus,
  CatalogEntry,
  Dependency,
} from "../model.js";
import { collectRepositorySnapshot } from "../repository-evidence.js";
import { collectSecurityPolicyAssetEvidence } from "../security-policy-inventory.js";
import type {
  Artifact,
  AssetClassificationEvidence,
  AssetGovernanceEvidence,
  ParsedDocument,
} from "../types.js";

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
  classification: AssetClassificationEvidence;
  governance: AssetGovernanceEvidence | null;
  asset: InspectAssetSummary | null;
  contextLens: ContextLensSummary;
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
  const classificationContext = repositoryClassificationPath(target);
  const classificationPath =
    classificationContext?.relativePath ?? target.replace(/\\/g, "/");
  const initialClassification = classifyAssetPath(classificationPath);
  const artifact: Artifact = {
    absolutePath,
    content,
    kind: initialClassification.kind,
    path: absolutePath,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: /\.mdx?$/i.test(absolutePath),
  };
  const document = parseDocument(artifact);
  const metadata = parseAssetMetadata(document).metadata;
  const classification = classifyAssetPath(classificationPath, {
    ...(metadata.type ? { metadataType: metadata.type } : {}),
  });
  const lineCount = document.lines.length;
  const repository = await inspectRepositoryForTarget(
    absolutePath,
    classificationContext?.root,
    document,
    classification,
  );

  return {
    bytes: artifact.sizeBytes,
    asset: repository.asset,
    codeFences: document.codeFences.map((fence) => ({
      endLine: fence.endLine,
      language: fence.language,
      range: formatRange(fence.startLine, fence.endLine),
      startLine: fence.startLine,
    })),
    contextLens: repository.contextLens,
    classification,
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

async function inspectRepositoryForTarget(
  absolutePath: string,
  inferredRoot: string | undefined,
  document: ParsedDocument,
  classification: AssetClassificationEvidence,
): Promise<{
  asset: InspectAssetSummary | null;
  contextLens: ContextLensSummary;
  governance: AssetGovernanceEvidence | null;
}> {
  try {
    const root = inferredRoot ?? inferCatalogRoot(absolutePath);
    const snapshot = await collectRepositorySnapshot(root);
    const entry = snapshot.catalog.entries.find(
      (candidate) => path.resolve(root, candidate.sourcePath) === absolutePath,
    );
    if (!entry) {
      return {
        asset: null,
        contextLens: snapshot.contextLens,
        governance: null,
      };
    }

    const resolver = createInspectRelationshipResolver(
      snapshot.catalog.entries,
    );
    const inboundDependents = snapshot.catalog.dependencies
      .filter((dependency) => resolver.matches(dependency.to, entry))
      .map((dependency) => inspectRelationship(dependency, resolver))
      .sort(compareInspectRelationships);
    const outboundDependencies = snapshot.catalog.dependencies
      .filter((dependency) => resolver.matches(dependency.from, entry))
      .map((dependency) => inspectRelationship(dependency, resolver))
      .sort(compareInspectRelationships);
    const policy = collectSecurityPolicyAssetEvidence(
      snapshot.artifacts,
      snapshot.config.security,
    ).find((candidate) => candidate.path === entry.sourcePath);

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
      governance: {
        ownership: entry.ownership,
        policySource: policySource(policy),
        ...(policy?.inheritedFrom
          ? { policyInheritedFrom: policy.inheritedFrom.sourcePath }
          : {}),
        metadataState: inspectMetadataState(document, classification),
      },
    };
  } catch {
    return {
      asset: null,
      contextLens: zeroContextLensSummary(),
      governance: null,
    };
  }
}

function policySource(
  policy:
    | ReturnType<typeof collectSecurityPolicyAssetEvidence>[number]
    | undefined,
): "declared" | "inherited" | "missing" {
  if (!policy?.hasEffectivePolicy) return "missing";
  if (policy.hasLocalPolicyMetadata) return "declared";
  return "inherited";
}

function inspectMetadataState(
  document: ParsedDocument,
  classification: AssetClassificationEvidence,
): "declared" | "partial" | "missing" | "not-required" {
  const metadata = parseAssetMetadata(document).metadata;
  const hasMetadata = Object.keys(document.metadata).length > 0;
  if (classification.scope === "skill-local" && !hasMetadata) {
    return "not-required";
  }
  if (!hasMetadata) return "missing";
  if (metadata.id && metadata.owner) return "declared";
  return "partial";
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
    "",
    "Classification:",
    ...renderClassification(outline.classification),
    "",
    "Governance:",
    ...renderGovernance(outline.governance),
    ...(outline.asset
      ? ["", "Asset:", ...renderAssetSummary(outline.asset)]
      : []),
    "",
    "Context Lens:",
    ...renderContextLensSummary(outline.contextLens),
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

function renderClassification(
  classification: AssetClassificationEvidence,
): string[] {
  return [
    `- Kind: ${classification.kind}`,
    `- Scope: ${classification.scope}`,
    `- Matched rule: ${classification.matchedRule}`,
    `- Reason code: ${classification.reasonCode}`,
    ...(classification.recognizedRoot
      ? [`- Recognized root: ${classification.recognizedRoot}`]
      : []),
    ...(classification.parentAssetPath
      ? [`- Parent asset: ${classification.parentAssetPath}`]
      : []),
    ...(classification.supportDirectory
      ? [`- Support directory: ${classification.supportDirectory}`]
      : []),
    ...(classification.ignoredNestedSegments?.length
      ? [
          `- Ignored nested segments: ${classification.ignoredNestedSegments.join(", ")}`,
        ]
      : []),
    `- Reason: ${classification.reason}`,
    ...(classification.competingRules?.flatMap((competing) => [
      `- Competing rule: ${competing.rule} (${competing.reasonCode})`,
      `  ${competing.reason}`,
    ]) ?? []),
  ];
}

function renderGovernance(
  governance: AssetGovernanceEvidence | null,
): string[] {
  if (!governance) return ["- Unresolved: target is not a catalog entry."];
  const inheritedOwner = governance.ownership.inheritedFrom?.sourcePath;
  return [
    `- Declared owner: ${governance.ownership.declaredOwner ?? "(none)"}`,
    `- Effective owner: ${governance.ownership.effectiveOwner ?? "(unowned)"}`,
    `- Ownership source: ${governance.ownership.source}`,
    ...(inheritedOwner
      ? [`- Ownership inherited from: ${inheritedOwner}`]
      : []),
    `- Policy source: ${governance.policySource ?? "missing"}`,
    ...(governance.policyInheritedFrom
      ? [`- Policy inherited from: ${governance.policyInheritedFrom}`]
      : []),
    `- Metadata state: ${governance.metadataState ?? "missing"}`,
  ];
}

function renderContextLensSummary(contextLens: ContextLensSummary): string[] {
  return [
    `- Enabled: ${contextLens.enabled ? "yes" : "no"}`,
    `- Detected: ${contextLens.detected ? "yes" : "no"}`,
    `- Lenses: ${contextLens.validLensCount}/${contextLens.totalLensCount} valid (${contextLens.invalidLensCount} invalid)`,
    `- Diagnostics: error ${contextLens.diagnosticCounts.error}, warning ${contextLens.diagnosticCounts.warning}, info ${contextLens.diagnosticCounts.info}`,
    `- Representative diagnostic: ${contextLens.representativeDiagnosticCode ?? "(none)"}`,
    `- Definition paths: ${list(contextLens.definitionPaths)}`,
    `- Target references: ${list(contextLens.targetReferences)}`,
  ];
}

function renderAssetSummary(asset: InspectAssetSummary): string[] {
  return [
    `- ID: ${asset.id}`,
    `- Kind: ${asset.kind}`,
    ...(asset.owner ? [`- Owner: ${asset.owner}`] : []),
    ...(asset.status ? [`- Status: ${asset.status}`] : []),
    `- Tags: ${list(asset.tags)}`,
    ...(asset.kind === "context_lens"
      ? [
          ...(asset.purpose ? [`- Purpose: ${asset.purpose}`] : []),
          `- Applies to: ${list(asset.appliesTo)}`,
          `- Focus: ${list(asset.focus)}`,
          `- Expected outputs: ${list(asset.expectedOutputs)}`,
        ]
      : []),
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
