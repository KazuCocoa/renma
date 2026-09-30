/** Shared snapshot-based binding analysis for catalog and API consumers. */
import { createHash } from "node:crypto";
import { ASSET_BINDING_METADATA_KEYS } from "./metadata-definitions.js";
import { compareUtf16CodeUnits as order } from "./canonical-json.js";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { toHast } from "mdast-util-to-hast";
import { toHtml } from "hast-util-to-html";
import { parseDocument as parseYaml } from "yaml";
import { ensureMarkdownSyntaxForDocument } from "./markdown-syntax.js";
import type { Nodes, Root } from "mdast";
import {
  parseTree,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import { parseAssetMetadata } from "./metadata.js";
import { inspectAgentSkill } from "./agent-skills.js";
import { inspectContextLensDeclaration } from "./context-lens.js";
import type { Catalog, Dependency } from "./model.js";
import {
  ensureYamlFrontmatterForDocument,
  type YamlFrontmatterField,
} from "./yaml-frontmatter.js";
import type { ParsedDocument } from "./types/metadata.js";

import type {
  BindingRelationshipKind,
  AssetBindingLocation,
  AssetBindingIdentity,
  AssetBindingRelationship,
  AssetBindingReference,
  NormalizedAssetBinding,
  AssetBindingSatisfaction,
  AssetBindingDocument,
  AssetBindingReport,
} from "./types/asset-bindings.js";

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

/** Analyze parser-owned documents once and annotate existing catalog declarations. */
export function analyzeAssetBindings(
  documents: readonly ParsedDocument[],
  catalog: Catalog,
): AssetBindingReport {
  const assetsByPath = new Map(
    catalog.entries.map((entry) => [entry.sourcePath, entry]),
  );
  const declarationsByPath = new Map<string, Dependency[]>();
  for (const dependency of catalog.dependencies) {
    if (!relations.has(dependency.declaration ?? "")) continue;
    const declarations = declarationsByPath.get(dependency.sourcePath) ?? [];
    declarations.push(dependency);
    declarationsByPath.set(dependency.sourcePath, declarations);
  }
  const sourceLocations = documents.map(createBindingLocations);
  const identities = documents.map((document, index) => {
    const locations = sourceLocations[index]!;
    const entry = assetsByPath.get(document.artifact.path);
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
      evidence: locations.location(0, document.artifact.content.length),
      idEvidence: locations.fieldLocation(idFields[0]),
      versionEvidence: locations.fieldLocation(versionFields[0]),
    } satisfies AssetBindingIdentity;
  });
  const result: AssetBindingReport = {
    schemaVersion: "renma.asset-bindings.v1",
    offsetUnit: "utf16-code-unit",
    documents: [],
  };
  for (const [index, document] of documents.entries()) {
    const identity = identities[index]!;
    const locations = sourceLocations[index]!;
    const fm = ensureYamlFrontmatterForDocument(document);
    const skill = identity.kind === "skill";
    const fieldKey = skill
      ? ASSET_BINDING_METADATA_KEYS.skill
      : ASSET_BINDING_METADATA_KEYS.nonSkill;
    const fields = (skill ? fm.metadataFields : fm.fields).filter(
      (field) => field.key === fieldKey,
    );
    const declarations = declarationsByPath.get(identity.path) ?? [];
    const relationships = declarations.map((edge) => {
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
        evidence: locations.lineLocation(
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
        locations.fieldLocation(misplaced),
      );
    const bindingEvidence = locations.fieldLocation(fields[0]);
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
    const declaredBindingTargets = new Set(
      (values as unknown[]).flatMap((value) => {
        const target =
          value && typeof value === "object" && "target" in value
            ? value.target
            : undefined;
        return stableId(target) ? [target] : [];
      }),
    );
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
    inspectReferences(document, item, issue, locations);
    // A target may be inspected alone in an acquired snapshot. Retain its
    // declaration diagnostics even without bindings or incoming local edges.
    for (const diagnostic of parseAssetMetadata(document).diagnostics)
      issue(
        "RN-BINDING-METADATA",
        diagnostic.message,
        locations.lineLocation(
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
          locations.lineLocation(
            diagnostic.startLine ?? 1,
            diagnostic.endLine ?? 1,
          ),
        );
    if (identity.kind === "context_lens")
      for (const diagnostic of inspectContextLensDeclaration(document).filter(
        (d) => d.severity === "error",
      ))
        issue(
          "RN-BINDING-METADATA",
          diagnostic.message,
          locations.lineLocation(
            diagnostic.evidence?.startLine ?? 1,
            diagnostic.evidence?.endLine ?? 1,
          ),
        );
    if (fm.errors.length)
      issue(
        "RN-BINDING-MALFORMED",
        "Invalid YAML prevents binding validation.",
        bindingEvidence,
      );
    item.declarationValid = item.diagnostics.length === 0;
    for (const binding of item.bindings) {
      binding.declarationValid = item.declarationValid;
      binding.satisfied =
        binding.declarationValid && binding.satisfaction.status === "matched";
    }
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
    const asset = assetsByPath.get(identity.path);
    if (asset && kinds.has(asset.kind) && identity.version)
      asset.releaseVersion = identity.version;
    for (const dependency of declarations) {
      const bindings = item.bindings.filter((binding) =>
        binding.relationships.some(
          (relationship) =>
            relationship.relationship === dependency.declaration &&
            relationship.declarationIndex === dependency.declarationIndex &&
            relationship.target === dependency.to,
        ),
      );
      if (bindings.length)
        dependency.bindings = bindings.map((binding) => ({
          ...binding,
          satisfied: binding.satisfied!,
          diagnostics: item.diagnostics.filter(
            (diagnostic) =>
              diagnostic.entryIndex === undefined ||
              diagnostic.entryIndex === binding.entryIndex,
          ),
        }));
      // Malformed fields may yield no normalized binding. Keep that failure
      // visible without inventing an alias, release, or dependency edge.
      if (
        (fields.length || misplaced) &&
        !item.declarationValid &&
        (declaredBindingTargets.has(dependency.to) ||
          bindings.length ||
          (!declaredBindingTargets.size &&
            item.diagnostics.some(
              (diagnostic) => diagnostic.code === "RN-BINDING-MALFORMED",
            )))
      ) {
        dependency.bindingDiagnostics = item.diagnostics.filter(
          (diagnostic) => diagnostic.phase === "declaration",
        );
      }
    }
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
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\r") {
      if (content[i + 1] === "\n") i++;
      starts.push(i + 1);
    } else if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}
/** One source index per document and analysis; offsets always address original text. */
function createBindingLocations(document: ParsedDocument) {
  const content = document.artifact.content;
  const starts = lineStarts(content);
  let sha256 = document.artifact.contentHash;
  const line = (offset: number): number => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle]! <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const location = (start: number, end: number): AssetBindingLocation => ({
    path: document.artifact.path,
    sha256: (sha256 ??= createHash("sha256").update(content).digest("hex")),
    start,
    end,
    startLine: line(start),
    endLine: line(Math.max(start, end - 1)),
    raw: content.slice(start, end),
  });
  const lineLocation = (start: number, end: number): AssetBindingLocation =>
    location(starts[start - 1] ?? 0, starts[end] ?? content.length);
  const fieldLocation = (
    field: YamlFrontmatterField | undefined,
  ): AssetBindingLocation =>
    lineLocation(field?.startLine ?? 1, field?.endLine ?? 1);
  return { location, lineLocation, fieldLocation, starts };
}
function inspectReferences(
  document: ParsedDocument,
  item: AssetBindingDocument,
  issue: (
    code: string,
    message: string,
    evidence: AssetBindingLocation,
  ) => void,
  locations: ReturnType<typeof createBindingLocations>,
): void {
  if (!document.artifact.markdownParserEligible) return;
  // Reuse the parser-owned tree. Its body normalizes line endings, so map
  // line/column positions back to original bytes decoded as UTF-16 text.
  const syntax = ensureMarkdownSyntaxForDocument(document);
  if (!syntax) return;
  const root = syntax.root;
  const starts = locations.starts;
  // fromMarkdown consumes an initial BOM in its body input, even when that
  // body follows frontmatter. Restore its original first-line column offset.
  const bodyBom = syntax.sourceLines[syntax.bodyStartLine - 1]?.startsWith(
    "\uFEFF",
  )
    ? 1
    : 0;
  const originalOffset = (
    point: { line: number; column: number } | undefined,
  ): number =>
    point
      ? (starts[point.line + syntax.bodyStartLine - 2] ??
          document.artifact.content.length) +
        point.column -
        1 +
        (point.line === 1 ? bodyBom : 0)
      : 0;
  const definitions = new Map<string, string>();
  let hasHtml = false;
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
    if (node.type === "html") hasHtml = true;
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  const unsupportedHtmlNodes = hasHtml
    ? findHtmlAssetReferenceNodes(document.artifact.content, root)
    : new Set<Nodes>();
  walk(root, (node, blockquoteDepth) => {
    const url =
      "url" in node
        ? node.url
        : node.type === "linkReference" || node.type === "imageReference"
          ? definitions.get(node.identifier)
          : undefined;
    if (node.type === "html") {
      if (unsupportedHtmlNodes.has(node))
        issue(
          "RN-BINDING-UNSUPPORTED-REFERENCE",
          "HTML asset references are unsupported.",
          locations.location(
            originalOffset(node.position?.start),
            originalOffset(node.position?.end),
          ),
        );
      return;
    }
    if (!url || !/^renma-asset:/iu.test(url)) return;
    const start = originalOffset(node.position?.start),
      end = originalOffset(node.position?.end);
    const evidence = locations.location(start, end);
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
    reference.destination = locations.location(
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
  let remainingMarkers = /[\r\n]/u.test(content[cursor - 1] ?? "")
    ? blockquoteDepth
    : 0;
  while (cursor < end) {
    const character = content[cursor];
    if (character === "\n" || character === "\r")
      remainingMarkers = blockquoteDepth;
    else if (character === ">" && remainingMarkers > 0) remainingMarkers--;
    else if (character !== " " && character !== "\t" && character !== "\r")
      break;
    cursor++;
  }
  return cursor;
}

/** Parse rendered Markdown, attributing HTML diagnostics to original mdast nodes. */
function findHtmlAssetReferenceNodes(
  content: string,
  root: Root,
): Set<Extract<Nodes, { type: "html" }>> {
  // Substitute raw HTML only during serialization, then restore it before
  // parsing. This preserves Markdown-generated container tags and gives exact
  // rendered ranges without inserting markers into the HTML parser's input.
  let marker = "\u0000renma-html:";
  while (content.includes(marker)) marker = "\u0000" + marker;
  const htmlNodes: Extract<Nodes, { type: "html" }>[] = [];
  const tree = toHast(root, {
    handlers: {
      html(_state, node) {
        const index = htmlNodes.push(node) - 1;
        return { type: "raw", value: `${marker}${index}\u0000` };
      },
    },
  });
  const result = new Set<Extract<Nodes, { type: "html" }>>();
  if (!htmlNodes.length) return result;
  const mask = (value: string): string => value.replace(/[^\t\n\f\r ]/g, "x");
  const projectedRanges: Array<{
    node: Extract<Nodes, { type: "html" }>;
    start: number;
    end: number;
  }> = [];
  let adjustment = 0;
  let projection = toHtml(tree, { allowDangerousHtml: true }).replace(
    new RegExp(`${marker}(\\d+)\u0000`, "gu"),
    (token: string, index: string, offset: number) => {
      const node = htmlNodes[Number(index)]!;
      const start = offset + adjustment;
      projectedRanges.push({ node, start, end: start + node.value.length });
      adjustment += node.value.length - token.length;
      return node.value;
    },
  );
  let fragment: DefaultTreeAdapterTypes.DocumentFragment;
  for (;;) {
    const cdataErrors: number[] = [];
    fragment = parseFragment(projection, {
      sourceCodeLocationInfo: true,
      onParseError: (error) => {
        if (error.code === "cdata-in-html-content")
          cdataErrors.push(error.startOffset);
      },
    });
    if (!cdataErrors.length) break;
    const elements: DefaultTreeAdapterTypes.Element[] = [];
    const collectElements = (node: DefaultTreeAdapterTypes.Node): void => {
      if ("attrs" in node) elements.push(node);
      if ("childNodes" in node)
        for (const child of node.childNodes) collectElements(child);
      if ("content" in node) collectElements(node.content);
    };
    collectElements(fragment);
    const protectedSpans = cdataErrors.flatMap((errorOffset) => {
      const start = projection.lastIndexOf("<![CDATA[", errorOffset);
      if (start < 0) return [];
      const current = elements
        .filter((element) => {
          const location = element.sourceCodeLocation;
          return (
            location?.startTag !== undefined &&
            location.startTag.endOffset <= start &&
            start < location.endOffset
          );
        })
        .sort(
          (a, b) =>
            b.sourceCodeLocation!.startOffset -
            a.sourceCodeLocation!.startOffset,
        )[0];
      if (!current || current.namespaceURI === "http://www.w3.org/1999/xhtml")
        return [];
      const closing = projection.indexOf("]]>", start + 9);
      return [{ start, end: closing < 0 ? projection.length : closing + 3 }];
    });
    for (const span of protectedSpans)
      projection =
        projection.slice(0, span.start) +
        mask(projection.slice(span.start, span.end)) +
        projection.slice(span.end);
    if (!protectedSpans.length) break;
  }
  const asciiCaseInsensitiveEqual = (
    value: string,
    expected: string,
  ): boolean =>
    value.length === expected.length &&
    [...expected].every(
      (character, index) =>
        value[index] === character || value[index] === character.toUpperCase(),
    );
  const reservedDestination = (value: string): boolean => {
    const urlInput = value
      .replace(/[\t\n\r]/gu, "")
      .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/gu, "");
    return (
      asciiCaseInsensitiveEqual(urlInput.slice(0, 12), "renma-asset:") ||
      asciiCaseInsensitiveEqual(urlInput.slice(0, 12), "renma‐asset:")
    );
  };
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if (
      "attrs" in node &&
      node.attrs.some(
        (attribute) =>
          (attribute.name === "href" || attribute.name === "src") &&
          reservedDestination(attribute.value),
      )
    ) {
      const offset =
        node.sourceCodeLocation?.startTag?.startOffset ??
        node.sourceCodeLocation?.startOffset;
      if (offset !== undefined) {
        const owner = projectedRanges.find(
          (range) => range.start <= offset && offset < range.end,
        );
        if (owner) result.add(owner.node);
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
    if ("content" in node) visit(node.content);
  };
  visit(fragment);
  return result;
}
