import { createHash } from "node:crypto";
import path from "node:path";

import { loadConfig, type ConfigOverrides } from "../config.js";
import { discoverArtifacts } from "../discovery.js";
import { parseDocument } from "../markdown.js";
import type { Diagnostic, ParsedDocument } from "../types.js";

export type DiscoverContextPatternsFormat = "json" | "markdown";

export interface DiscoverContextPatternsResult {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  candidates: ContextPatternCandidate[];
  diagnostics: Diagnostic[];
}

export interface ContextFragment {
  id: string;
  sourcePath: string;
  range: string;
  headingPath: string[];
  normalizedTextHash: string;
  commandFingerprints: string[];
  keywords: string[];
}

export interface ContextPatternCandidate {
  id: string;
  label: string;
  classification: "exact_duplicate" | "near_duplicate" | "semantic_candidate";
  score: number;
  signalKinds: string[];
  suggestedContextPath: string;
  fragments: Array<{
    sourcePath: string;
    range: string;
    headingPath: string[];
  }>;
}

interface Fragment extends ContextFragment {
  normalizedText: string;
}

interface SignalGroup {
  classification: ContextPatternCandidate["classification"];
  key: string;
  label: string;
  signalKind: string;
  fragments: Fragment[];
}

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "before",
  "check",
  "context",
  "from",
  "guide",
  "into",
  "must",
  "only",
  "reference",
  "should",
  "skill",
  "step",
  "task",
  "that",
  "the",
  "this",
  "when",
  "with",
  "workflow",
]);

export async function runDiscoverContextPatternsCommand(
  targetPath: string,
  options: {
    format: DiscoverContextPatternsFormat;
    overrides?: ConfigOverrides;
  },
): Promise<number> {
  const result = await buildDiscoverContextPatternsResult(
    targetPath,
    options.overrides ?? {},
  );
  process.stdout.write(
    options.format === "json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : renderMarkdown(result),
  );
  return result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
}

async function buildDiscoverContextPatternsResult(
  targetPath: string,
  overrides: ConfigOverrides,
): Promise<DiscoverContextPatternsResult> {
  const root = path.resolve(targetPath);
  const loaded = await loadConfig(root, overrides);
  const discovery = await discoverArtifacts(root, loaded.config);
  const documents = discovery.artifacts.map(parseDocument);
  const fragments = documents.flatMap((document) => fragmentsFor(document));

  return {
    root,
    ...(loaded.configPath ? { configPath: loaded.configPath } : {}),
    scannedFileCount: documents.length,
    candidates: buildCandidates(fragments),
    diagnostics: discovery.diagnostics,
  };
}

function fragmentsFor(document: ParsedDocument): Fragment[] {
  if (document.headings.length === 0) {
    const normalizedText = normalizeText(document.artifact.content);
    if (!isUsefulText(normalizedText)) return [];
    return [
      buildFragment(document, 1, document.lines.length, [], normalizedText),
    ];
  }

  return document.headings.flatMap((heading, index) => {
    const nextHeading = document.headings[index + 1];
    const endLine = nextHeading ? nextHeading.line - 1 : document.lines.length;
    const text = document.lines.slice(heading.line - 1, endLine).join("\n");
    const normalizedText = normalizeText(text);
    if (!isUsefulText(normalizedText)) return [];
    return [
      buildFragment(
        document,
        heading.line,
        endLine,
        headingPath(document, index),
        normalizedText,
      ),
    ];
  });
}

function buildFragment(
  document: ParsedDocument,
  startLine: number,
  endLine: number,
  headingPath: string[],
  normalizedText: string,
): Fragment {
  const commandFingerprints = document.codeFences
    .filter((fence) => fence.startLine >= startLine && fence.endLine <= endLine)
    .map((fence) =>
      hash(
        normalizeText(
          document.lines.slice(fence.startLine, fence.endLine - 1).join("\n"),
        ),
      ),
    );
  const keywords = keywordFingerprint(
    [
      document.artifact.path,
      ...headingPath,
      document.lines.slice(startLine - 1, endLine).join("\n"),
    ].join("\n"),
  );

  return {
    id: `${document.artifact.path}:${formatRange(startLine, endLine)}`,
    sourcePath: document.artifact.path,
    range: formatRange(startLine, endLine),
    headingPath,
    normalizedText,
    normalizedTextHash: hash(normalizedText),
    commandFingerprints,
    keywords,
  };
}

function headingPath(document: ParsedDocument, headingIndex: number): string[] {
  const heading = document.headings[headingIndex];
  if (!heading) return [];

  return document.headings
    .slice(0, headingIndex + 1)
    .filter((candidate) => candidate.depth <= heading.depth)
    .filter((candidate, index, candidates) => {
      const next = candidates[index + 1];
      return !next || next.depth > candidate.depth;
    })
    .map((candidate) => candidate.text);
}

function buildCandidates(fragments: Fragment[]): ContextPatternCandidate[] {
  const groups = [
    ...exactDuplicateGroups(fragments),
    ...commandGroups(fragments),
    ...headingGroups(fragments),
    ...keywordGroups(fragments),
  ];
  const merged = new Map<string, SignalGroup>();

  for (const group of groups) {
    const files = new Set(
      group.fragments.map((fragment) => fragment.sourcePath),
    );
    if (files.size < 2) continue;

    const mergeKey = `${group.classification}:${group.label}`;
    const existing = merged.get(mergeKey);
    if (!existing) {
      merged.set(mergeKey, group);
      continue;
    }

    const byId = new Map(
      existing.fragments.map((fragment) => [fragment.id, fragment]),
    );
    for (const fragment of group.fragments) byId.set(fragment.id, fragment);
    existing.fragments = [...byId.values()].sort(compareFragments);
    existing.signalKind = `${existing.signalKind},${group.signalKind}`;
  }

  return [...merged.values()]
    .map(toCandidate)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function exactDuplicateGroups(fragments: Fragment[]): SignalGroup[] {
  return groupsBy(fragments, (fragment) => fragment.normalizedTextHash).map(
    ([key, matches]) => ({
      classification: "exact_duplicate",
      key,
      label: bestLabel(matches),
      signalKind: "normalized_text_hash",
      fragments: matches,
    }),
  );
}

function commandGroups(fragments: Fragment[]): SignalGroup[] {
  const pairs = fragments.flatMap((fragment) =>
    fragment.commandFingerprints.map((fingerprint) => ({
      fingerprint,
      fragment,
    })),
  );
  return groupsBy(pairs, (pair) => pair.fingerprint).map(([key, matches]) => ({
    classification: "near_duplicate",
    key,
    label: bestLabel(matches.map((match) => match.fragment)),
    signalKind: "command_fingerprint",
    fragments: matches.map((match) => match.fragment),
  }));
}

function headingGroups(fragments: Fragment[]): SignalGroup[] {
  return groupsBy(fragments, (fragment) =>
    normalizeText(fragment.headingPath.at(-1) ?? ""),
  )
    .filter(([key]) => key.length > 0)
    .map(([key, matches]) => ({
      classification: "semantic_candidate",
      key,
      label: titleCase(key),
      signalKind: "heading",
      fragments: matches,
    }));
}

function keywordGroups(fragments: Fragment[]): SignalGroup[] {
  const pairs = fragments.flatMap((fragment) =>
    fragment.keywords.map((keyword) => ({ keyword, fragment })),
  );
  return groupsBy(pairs, (pair) => pair.keyword).map(([key, matches]) => ({
    classification: "semantic_candidate",
    key,
    label: titleCase(key),
    signalKind: "keyword",
    fragments: matches.map((match) => match.fragment),
  }));
}

function toCandidate(group: SignalGroup): ContextPatternCandidate {
  const signalKinds = [...new Set(group.signalKind.split(","))].sort();
  const fragments = group.fragments.sort(compareFragments);
  const files = new Set(fragments.map((fragment) => fragment.sourcePath));
  const score =
    files.size * 2 + fragments.length + signalKinds.length + scoreBoost(group);

  return {
    id: `${group.classification}:${slug(group.label)}:${hash(group.key).slice(7, 15)}`,
    label: group.label,
    classification: group.classification,
    score,
    signalKinds,
    suggestedContextPath: `context/${slug(group.label)}.md`,
    fragments: fragments.map((fragment) => ({
      sourcePath: fragment.sourcePath,
      range: fragment.range,
      headingPath: fragment.headingPath,
    })),
  };
}

function scoreBoost(group: SignalGroup): number {
  if (group.classification === "exact_duplicate") return 4;
  if (group.classification === "near_duplicate") return 2;
  return 0;
}

function groupsBy<T>(
  items: T[],
  keyFor: (item: T) => string,
): Array<[string, T[]]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()].filter(([, matches]) => matches.length > 1);
}

function bestLabel(fragments: Fragment[]): string {
  const heading = fragments
    .map((fragment) => fragment.headingPath.at(-1))
    .find((value): value is string => Boolean(value));
  if (heading) return heading;

  const keyword = fragments
    .flatMap((fragment) => fragment.keywords)
    .find((value) => value.length > 0);
  return keyword ? titleCase(keyword) : "Repeated Context";
}

function keywordFingerprint(text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([token]) => token.length >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizeText(text: string): string {
  return tokenize(text).join(" ");
}

function isUsefulText(text: string): boolean {
  return text.length >= 40 && tokenize(text).length >= 6;
}

function renderMarkdown(result: DiscoverContextPatternsResult): string {
  const lines = [
    "# Repeated Context Patterns",
    "",
    `Root: ${result.root}`,
    `Files scanned: ${result.scannedFileCount}`,
    `Candidates: ${result.candidates.length}`,
  ];

  if (result.diagnostics.length > 0) {
    lines.push("", "## Diagnostics");
    for (const diagnostic of result.diagnostics) {
      lines.push(
        `- ${diagnostic.severity}: ${diagnostic.path ?? "(root)"}: ${diagnostic.message}`,
      );
    }
  }

  if (result.candidates.length === 0) {
    lines.push("", "No repeated context patterns found.");
    return `${lines.join("\n")}\n`;
  }

  for (const candidate of result.candidates) {
    lines.push(
      "",
      `## ${candidate.label}`,
      "",
      `- Classification: ${candidate.classification}`,
      `- Score: ${candidate.score}`,
      `- Signals: ${candidate.signalKinds.join(", ")}`,
      `- Suggested context: ${candidate.suggestedContextPath}`,
      "- Evidence:",
      ...candidate.fragments.map(
        (fragment) =>
          `  - ${fragment.sourcePath} ${fragment.range}${renderHeadingPath(
            fragment.headingPath,
          )}`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderHeadingPath(headingPath: string[]): string {
  return headingPath.length > 0 ? ` (${headingPath.join(" > ")})` : "";
}

function compareFragments(a: Fragment, b: Fragment): number {
  return (
    a.sourcePath.localeCompare(b.sourcePath) || a.range.localeCompare(b.range)
  );
}

function formatRange(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-L${end}`;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function slug(value: string): string {
  return normalizeText(value).replace(/\s+/g, "-") || "repeated-context";
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
