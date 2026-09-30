/** Read-only, snapshot-based asset binding contract for external builders. */
import { ASSET_BINDING_METADATA_KEYS } from "./metadata-definitions.js";
import { compareUtf16CodeUnits as order } from "./canonical-json.js";
import { createHash } from "node:crypto";
import { parseDocument as parseYaml } from "yaml";
import { ensureMarkdownSyntaxForDocument } from "./markdown-syntax.js";
import type { Nodes } from "mdast";
import {
  parseTree,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import { parseAssetMetadata } from "./metadata.js";
import { inspectAgentSkill } from "./agent-skills.js";
import { buildCatalog } from "./catalog.js";
import {
  classifyAssetPath,
  normalizeAssetRepositoryRelativePath,
} from "./discovery.js";
import { parseDocument } from "./markdown.js";
import {
  ensureYamlFrontmatterForDocument,
  parseRenmaFrontmatter,
  type YamlFrontmatterField,
} from "./yaml-frontmatter.js";
import type { ParsedDocument } from "./types/metadata.js";

export interface AssetBindingFile {
  readonly path: string;
  /** Original UTF-8 bytes, including any BOM and CRLF. Invalid UTF-8 is rejected. */
  readonly bytes: Uint8Array;
}
export type BindingAssetKind = "skill" | "context" | "context_lens";
export type BindingRelationshipKind =
  | "requires_context"
  | "optional_context"
  | "requires_lens"
  | "optional_lens"
  | "requires_skill"
  | "optional_skill"
  | "applies_to";
export interface AssetBindingLocation {
  path: string;
  sha256: string;
  /** Half-open UTF-16 code-unit offsets in the original decoded file. */
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  raw: string;
}
export interface AssetBindingIdentity {
  path: string;
  kind: string;
  id: string | null;
  version: string | null;
  evidence: AssetBindingLocation;
  idEvidence: AssetBindingLocation;
  versionEvidence: AssetBindingLocation;
}
export interface AssetBindingRelationship {
  relationship: BindingRelationshipKind;
  target: string;
  declarationIndex: number;
  targetKind: BindingAssetKind;
  sourceValid: boolean;
  evidence: AssetBindingLocation;
}
export interface AssetBindingReference {
  alias: string;
  evidence: AssetBindingLocation;
  /** Only present for supported inline link destinations. */
  destination?: AssetBindingLocation;
}
export interface AssetBindingDiagnostic {
  code: string;
  message: string;
  evidence: AssetBindingLocation;
  entryIndex?: number;
  phase: "declaration" | "local-satisfaction";
}
export interface NormalizedAssetBinding {
  alias: string;
  target: string;
  version: string;
  entryIndex: number;
  evidence: AssetBindingLocation;
  relationships: AssetBindingRelationship[];
  declarationValid: boolean;
  satisfaction: AssetBindingSatisfaction;
}
export interface AssetBindingSatisfaction {
  status:
    | "matched"
    | "missing"
    | "ambiguous"
    | "kind-mismatch"
    | "target-version-invalid"
    | "version-mismatch";
  candidates: AssetBindingIdentity[];
}
export interface AssetBindingDocument {
  identity: AssetBindingIdentity;
  relationships: AssetBindingRelationship[];
  bindings: NormalizedAssetBinding[];
  references: AssetBindingReference[];
  diagnostics: AssetBindingDiagnostic[];
  declarationValid: boolean;
}
export interface AssetBindingReport {
  schemaVersion: "renma.asset-bindings.v1";
  offsetUnit: "utf16-code-unit";
  documents: AssetBindingDocument[];
}

const kinds = new Set<string>(["skill", "context", "context_lens"]);
const relations = new Set<string>([
  "requires_context",
  "optional_context",
  "requires_lens",
  "optional_lens",
  "requires_skill",
  "optional_skill",
  "applies_to",
]);
const aliasPattern = /^[a-z][a-z0-9-]*$/u;
const exactText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;
const stableId = (value: unknown): value is string =>
  exactText(value) &&
  !/[\s/\\:#?]/u.test(value) &&
  value !== "." &&
  value !== "..";

/** Compare a pin with supplied inspected candidates; never acquire or choose a snapshot. */
export function compareAssetBinding(
  binding: Pick<NormalizedAssetBinding, "target" | "version" | "relationships">,
  candidates: readonly AssetBindingIdentity[],
): AssetBindingSatisfaction {
  const matches = candidates
    .filter((candidate) => candidate.id === binding.target)
    .map((candidate) => structuredClone(candidate))
    .sort((a, b) => order(a.path, b.path));
  const target = matches[0];
  const status =
    matches.length === 0
      ? "missing"
      : matches.length > 1
        ? "ambiguous"
        : !kinds.has(target!.kind) ||
            binding.relationships.some((r) => r.targetKind !== target!.kind)
          ? "kind-mismatch"
          : !exactText(target!.version)
            ? "target-version-invalid"
            : target!.version !== binding.version
              ? "version-mismatch"
              : "matched";
  return { status, candidates: matches };
}

/** Inspect one caller-supplied repository snapshot without filesystem access or mutation. */
export function inspectAssetBindings(
  files: readonly AssetBindingFile[],
): AssetBindingReport {
  const paths = new Set<string>();
  const documents = [...files]
    .sort((a, b) => order(a.path, b.path))
    .map((file) => {
      if (
        normalizeAssetRepositoryRelativePath(file.path) !== file.path ||
        paths.has(file.path)
      )
        throw new Error(
          `Expected a unique normalized repository-relative path: ${file.path}`,
        );
      paths.add(file.path);
      const content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(file.bytes);
      const type = parseRenmaFrontmatter(content).values.type;
      const classification = classifyAssetPath(
        file.path,
        typeof type === "string" ? { metadataType: type } : {},
      );
      return parseDocument({
        path: file.path,
        absolutePath: file.path,
        kind: classification.kind,
        content,
        sizeBytes: file.bytes.byteLength,
        contentHash: createHash("sha256").update(file.bytes).digest("hex"),
        contentClassification: "text",
        markdownParserEligible: /\.md$/iu.test(file.path),
      });
    });
  const { catalog } = buildCatalog(documents);
  const identities = documents.map((document) => {
    const entry = catalog.entries.find(
      (entry) => entry.sourcePath === document.artifact.path,
    );
    const fm = ensureYamlFrontmatterForDocument(document);
    const skill = document.artifact.kind === "skill";
    const fields = skill ? fm.metadataFields : fm.fields;
    const idKey = skill ? "renma.id" : "id";
    const versionKey = skill
      ? "renma.version"
      : document.artifact.kind === "context_lens"
        ? ASSET_BINDING_METADATA_KEYS.lensReleaseVersion
        : "version";
    const unique = (key: string) => fields.filter((field) => field.key === key);
    const idFields = unique(idKey),
      versionFields = unique(versionKey);
    const valid = fm.closed && fm.mapping && fm.errors.length === 0;
    const id =
      valid &&
      entry?.metadata.id &&
      idFields.length === 1 &&
      stableId(idFields[0]!.value)
        ? idFields[0]!.value
        : null;
    const version =
      valid &&
      entry?.metadata.id &&
      versionFields.length === 1 &&
      exactText(versionFields[0]!.value)
        ? versionFields[0]!.value
        : null;
    return {
      path: document.artifact.path,
      kind: document.artifact.kind,
      id,
      version,
      evidence: location(document, 0, document.artifact.content.length),
      idEvidence: fieldLocation(document, idFields[0]),
      versionEvidence: fieldLocation(document, versionFields[0]),
    } satisfies AssetBindingIdentity;
  });
  const result: AssetBindingReport = {
    schemaVersion: "renma.asset-bindings.v1",
    offsetUnit: "utf16-code-unit",
    documents: [],
  };
  for (const [index, document] of documents.entries()) {
    const identity = identities[index]!;
    const fm = ensureYamlFrontmatterForDocument(document);
    const skill = identity.kind === "skill";
    const fieldKey = skill
      ? ASSET_BINDING_METADATA_KEYS.skill
      : ASSET_BINDING_METADATA_KEYS.nonSkill;
    const fields = (skill ? fm.metadataFields : fm.fields).filter(
      (field) => field.key === fieldKey,
    );
    const relationships = catalog.dependencies
      .filter(
        (edge) =>
          edge.sourcePath === identity.path &&
          relations.has(edge.declaration ?? ""),
      )
      .map((edge) => {
        const relationship = edge.declaration as BindingRelationshipKind;
        return {
          relationship,
          target: edge.to,
          declarationIndex: edge.declarationIndex ?? 0,
          targetKind: relationship.endsWith("skill")
            ? "skill"
            : relationship.endsWith("lens")
              ? "context_lens"
              : "context",
          sourceValid:
            kinds.has(identity.kind) &&
            (relationship.endsWith("skill")
              ? skill
              : relationship === "applies_to"
                ? identity.kind === "context_lens"
                : true),
          evidence: lineLocation(
            document,
            edge.evidence?.startLine ?? 1,
            edge.evidence?.endLine ?? 1,
          ),
        } satisfies AssetBindingRelationship;
      });
    const item: AssetBindingDocument = {
      identity,
      relationships,
      bindings: [],
      references: [],
      diagnostics: [],
      declarationValid: true,
    };
    const issue = (
      code: string,
      message: string,
      evidence: AssetBindingLocation,
      entryIndex?: number,
    ) =>
      item.diagnostics.push({
        code,
        message,
        evidence,
        phase: "declaration",
        ...(entryIndex === undefined ? {} : { entryIndex }),
      });
    const misplaced = skill
      ? fm.fields.find(
          (field) => field.key === ASSET_BINDING_METADATA_KEYS.nonSkill,
        )
      : fm.metadataFields.find(
          (field) => field.key === ASSET_BINDING_METADATA_KEYS.skill,
        );
    if (misplaced)
      issue(
        "RN-BINDING-MALFORMED",
        `Use ${fieldKey} in the document's canonical metadata location.`,
        fieldLocation(document, misplaced),
      );
    const bindingEvidence = fieldLocation(document, fields[0]);
    if (
      document.artifact.markdownParserEligible &&
      fm.present &&
      (!fm.closed || !fm.mapping || fm.errors.length)
    )
      issue(
        "RN-BINDING-MALFORMED",
        "Invalid YAML prevents declaration validation.",
        bindingEvidence,
      );
    if (fields.length && fm.closed) {
      const yaml = parseYaml(
        document.lines.slice(1, fm.bodyStartLine - 2).join("\n"),
        { uniqueKeys: true },
      );
      if (yaml.errors.length)
        issue(
          "RN-BINDING-MALFORMED",
          "Binding metadata contains invalid YAML or duplicate keys.",
          bindingEvidence,
        );
    }
    let values: unknown = [];
    if (fields.length) {
      if (
        fields.length !== 1 ||
        !fm.closed ||
        !fm.mapping ||
        fm.errors.length ||
        !kinds.has(identity.kind)
      )
        issue(
          "RN-BINDING-MALFORMED",
          "Bindings require one valid field on an independently governed Skill, Context or Lens.",
          bindingEvidence,
        );
      else {
        values = fields[0]!.value;
        if (skill) {
          try {
            if (typeof values !== "string")
              throw new Error("Expected a JSON-array string.");
            const errors: ParseError[] = [];
            const tree = parseTree(values, errors, {
              disallowComments: true,
              allowTrailingComma: false,
            });
            if (errors.length || !tree || duplicateJsonKeys(tree))
              throw new Error("Invalid JSON or duplicate object keys.");
            values = JSON.parse(values);
          } catch {
            issue(
              "RN-BINDING-MALFORMED",
              "Skill bindings must be a strict JSON-array string without duplicate object keys.",
              bindingEvidence,
            );
            values = [];
          }
        }
        if (!Array.isArray(values)) {
          issue(
            "RN-BINDING-MALFORMED",
            "Bindings must be an array of alias, target and version objects.",
            bindingEvidence,
          );
          values = [];
        }
      }
      if (!identity.id || !identity.version)
        issue(
          "RN-BINDING-SOURCE-IDENTITY",
          "A binding source needs an explicit stable ID and release version.",
          !identity.id ? identity.idEvidence : identity.versionEvidence,
        );
    }
    if (item.diagnostics.some((d) => d.code === "RN-BINDING-MALFORMED"))
      values = [];
    for (const [entryIndex, value] of (values as unknown[]).entries()) {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).sort(order).join(",") !== "alias,target,version"
      ) {
        issue(
          "RN-BINDING-MALFORMED",
          "Each binding needs exactly alias, target and version.",
          bindingEvidence,
          entryIndex,
        );
        continue;
      }
      const { alias, target, version } = value as Record<string, unknown>;
      if (
        typeof alias !== "string" ||
        !aliasPattern.test(alias) ||
        !stableId(target) ||
        !exactText(version)
      ) {
        issue(
          "RN-BINDING-MALFORMED",
          "Invalid alias, stable target ID or exact release version.",
          bindingEvidence,
          entryIndex,
        );
        continue;
      }
      const boundRelationships = relationships.filter(
        (edge) => edge.target === target,
      );
      if (!boundRelationships.length)
        issue(
          "RN-BINDING-UNDECLARED-TARGET",
          `No composition declaration names ${target}.`,
          bindingEvidence,
          entryIndex,
        );
      if (boundRelationships.some((edge) => !edge.sourceValid))
        issue(
          "RN-BINDING-SOURCE-KIND",
          "Binding annotates a relationship invalid for this source kind.",
          bindingEvidence,
          entryIndex,
        );
      const binding = {
        alias,
        target,
        version,
        entryIndex,
        evidence: bindingEvidence,
        relationships: boundRelationships,
        declarationValid: true,
        satisfaction: compareAssetBinding(
          { target, version, relationships: boundRelationships },
          identities,
        ),
      };
      item.bindings.push(binding);
    }
    for (const binding of item.bindings) {
      if (
        item.bindings.filter(
          (other) =>
            other.alias === binding.alias || other.target === binding.target,
        ).length > 1
      )
        issue(
          "RN-BINDING-DUPLICATE",
          "Aliases and targets must each be unique in a document.",
          binding.evidence,
          binding.entryIndex,
        );
    }
    inspectReferences(document, item, issue);
    // A target may be inspected alone in an acquired snapshot. Retain its
    // declaration diagnostics even without bindings or incoming local edges.
    for (const diagnostic of parseAssetMetadata(document).diagnostics)
      issue(
        "RN-BINDING-METADATA",
        diagnostic.message,
        lineLocation(
          document,
          diagnostic.evidence?.startLine ?? 1,
          diagnostic.evidence?.endLine ?? 1,
        ),
      );
    if (skill)
      for (const diagnostic of inspectAgentSkill(
        document,
      ).validation.issues.filter((d) => d.severity === "error"))
        issue(
          "RN-BINDING-METADATA",
          diagnostic.message,
          lineLocation(
            document,
            diagnostic.startLine ?? 1,
            diagnostic.endLine ?? 1,
          ),
        );
    if (fm.errors.length)
      issue(
        "RN-BINDING-MALFORMED",
        "Invalid YAML prevents binding validation.",
        bindingEvidence,
      );
    item.declarationValid = item.diagnostics.length === 0;
    for (const binding of item.bindings)
      binding.declarationValid = item.declarationValid;
    for (const binding of item.bindings)
      if (binding.satisfaction.status !== "matched")
        item.diagnostics.push({
          code: `RN-BINDING-${binding.satisfaction.status.toUpperCase()}`,
          message: `Expected ${binding.target} at exact version ${binding.version}; local snapshot: ${binding.satisfaction.status}.`,
          evidence: binding.evidence,
          entryIndex: binding.entryIndex,
          phase: "local-satisfaction",
        });
    result.documents.push(item);
  }
  return result;
}

function duplicateJsonKeys(node: JsonNode): boolean {
  if (node.type === "object") {
    const keys =
      node.children?.map((child) => child.children?.[0]?.value) ?? [];
    if (new Set(keys).size !== keys.length) return true;
  }
  return node.children?.some(duplicateJsonKeys) ?? false;
}
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++)
    if (content[i] === "\n") starts.push(i + 1);
  return starts;
}
function location(
  document: ParsedDocument,
  start: number,
  end: number,
): AssetBindingLocation {
  const content = document.artifact.content;
  const line = (offset: number) => content.slice(0, offset).split("\n").length;
  return {
    path: document.artifact.path,
    sha256: document.artifact.contentHash!,
    start,
    end,
    startLine: line(start),
    endLine: line(Math.max(start, end - 1)),
    raw: content.slice(start, end),
  };
}
function lineLocation(
  document: ParsedDocument,
  start: number,
  end: number,
): AssetBindingLocation {
  const starts = lineStarts(document.artifact.content);
  return location(
    document,
    starts[start - 1] ?? 0,
    starts[end] ?? document.artifact.content.length,
  );
}
function fieldLocation(
  document: ParsedDocument,
  field: YamlFrontmatterField | undefined,
): AssetBindingLocation {
  return lineLocation(document, field?.startLine ?? 1, field?.endLine ?? 1);
}
function inspectReferences(
  document: ParsedDocument,
  item: AssetBindingDocument,
  issue: (
    code: string,
    message: string,
    evidence: AssetBindingLocation,
  ) => void,
): void {
  if (!document.artifact.markdownParserEligible) return;
  // Reuse the parser-owned tree. Its body normalizes line endings, so map
  // line/column positions back to original bytes decoded as UTF-16 text.
  const syntax = ensureMarkdownSyntaxForDocument(document);
  if (!syntax) return;
  const root = syntax.root;
  const starts = lineStarts(document.artifact.content);
  const originalOffset = (
    point: { line: number; column: number } | undefined,
  ): number =>
    point
      ? (starts[point.line + syntax.bodyStartLine - 2] ??
          document.artifact.content.length) +
        point.column -
        1
      : 0;
  const definitions = new Map<string, string>();
  const walk = (
    node: Nodes,
    fn: (node: Nodes, blockquoteDepth: number) => void,
    blockquoteDepth = 0,
  ): void => {
    fn(node, blockquoteDepth);
    if ("children" in node)
      for (const child of node.children)
        walk(child, fn, blockquoteDepth + (node.type === "blockquote" ? 1 : 0));
  };
  walk(root, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  walk(root, (node, blockquoteDepth) => {
    const start = originalOffset(node.position?.start),
      end = originalOffset(node.position?.end);
    const evidence = location(document, start, end);
    const url =
      "url" in node
        ? node.url
        : node.type === "linkReference" || node.type === "imageReference"
          ? definitions.get(node.identifier)
          : undefined;
    if (node.type === "html") {
      if (
        /\b(?:href|src)\s*=\s*["']?renma-asset:/iu.test(
          node.value.replace(/<!--[\s\S]*?-->/gu, ""),
        )
      )
        issue(
          "RN-BINDING-UNSUPPORTED-REFERENCE",
          "HTML asset references are unsupported.",
          evidence,
        );
      return;
    }
    if (!url || !/^renma-asset:/iu.test(url)) return;
    const alias = url.slice("renma-asset:".length);
    const reference: AssetBindingReference = { alias, evidence };
    item.references.push(reference);
    // Start after the parser-owned label, so decoys in labels/titles cannot
    // select a destination. Only whitespace and actual container continuations
    // may precede the closing bracket and the literal destination.
    const labelEnd =
      node.type === "link" && node.children.length
        ? originalOffset(node.children.at(-1)?.position?.end)
        : start + 1;
    const content = document.artifact.content;
    const closingLabel = skipLinkWhitespace(
      content,
      labelEnd,
      end,
      blockquoteDepth,
    );
    const destinationOffset = skipLinkWhitespace(
      content,
      closingLabel + 2,
      end,
      blockquoteDepth,
    );
    const match = content.startsWith("](", closingLabel)
      ? /^(?:<(renma-asset:[a-z][a-z0-9-]*)>|(renma-asset:[a-z][a-z0-9-]*))(?=\s|\))/u.exec(
          content.slice(destinationOffset, end),
        )
      : null;
    if (
      node.type !== "link" ||
      !url.startsWith("renma-asset:") ||
      !aliasPattern.test(alias) ||
      !match ||
      (match[1] ?? match[2]) !== url
    ) {
      issue(
        "RN-BINDING-UNSUPPORTED-REFERENCE",
        "Use a literal inline link destination renma-asset:alias.",
        evidence,
      );
      return;
    }
    const destinationStart = destinationOffset + match[0].lastIndexOf(url);
    reference.destination = location(
      document,
      destinationStart,
      destinationStart + url.length,
    );
    if (item.bindings.filter((binding) => binding.alias === alias).length !== 1)
      issue(
        "RN-BINDING-UNDECLARED-ALIAS",
        `Alias ${alias} has no unique valid binding.`,
        evidence,
      );
  });
}

/** Advance original offsets only; never strip or normalize Markdown source. */
function skipLinkWhitespace(
  content: string,
  start: number,
  end: number,
  blockquoteDepth: number,
): number {
  let cursor = start;
  let remainingMarkers = content[cursor - 1] === "\n" ? blockquoteDepth : 0;
  while (cursor < end) {
    const character = content[cursor];
    if (character === "\n") remainingMarkers = blockquoteDepth;
    else if (character === ">" && remainingMarkers > 0) remainingMarkers--;
    else if (character !== " " && character !== "\t" && character !== "\r")
      break;
    cursor++;
  }
  return cursor;
}
