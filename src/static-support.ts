import path from "node:path";

import {
  classifyRepositorySkillPath,
  logicalSkillDirectory,
} from "./discovery.js";
import { markdownBodyStartLineForArtifact } from "./frontmatter-envelope.js";
import {
  ensureMarkdownSyntaxForDocument,
  type MarkdownLinkTargetRecord,
  type MarkdownSourceColumnRange,
} from "./markdown-syntax.js";
import type { SkillParentIndex } from "./catalog.js";
import type { CatalogEntry, Dependency } from "./model.js";
import type { ParsedDocument } from "./types/metadata.js";

const SUPPORT_ROOTS = [
  "references",
  "scripts",
  "assets",
  "profiles",
  "examples",
] as const;

export interface StaticSupportReference {
  sourcePath: string;
  targetPath: string;
  relativePath: string;
  line: number;
  raw: string;
}

export interface PlainTextSupportSecurityReachability {
  owningSkillPath: string;
  depth: number;
}

export interface StaticSupportReachabilityEvidence {
  targetPath: string;
  owningSkillPath: string;
  sourcePath: string;
  sourceLine: number;
  sourceRaw: string;
  depth: number;
}

export interface StaticSupportBoundaryReachabilityEvidence {
  boundaryPath: string;
  owningSkillPath: string;
  sourcePath: string;
  sourceLine: number;
  sourceRaw: string;
  depth: number;
}

export interface StaticSupportInspectionExpectations {
  paths: StaticSupportReachabilityEvidence[];
  incompleteBoundaries: StaticSupportBoundaryReachabilityEvidence[];
}

interface IncompleteStaticSupportBasenameReference {
  sourcePath: string;
  basename: string;
  line: number;
  raw: string;
}

interface BasenameReferenceToken {
  basename: string;
  raw: string;
}

interface StaticSupportReferenceAnalysis {
  references: StaticSupportReference[];
  incompleteBasenameReferences: IncompleteStaticSupportBasenameReference[];
}

/** Parse exact, repository-local support references once for rules and graphs. */
export function staticSupportReferences(
  document: ParsedDocument,
  skillDirectory: string,
  localCandidatePaths: readonly string[],
  incompleteCandidateDirectories: readonly string[] = [],
): StaticSupportReference[] {
  return analyzeStaticSupportReferences(
    document,
    skillDirectory,
    localCandidatePaths,
    incompleteCandidateDirectories,
  ).references;
}

function analyzeStaticSupportReferences(
  document: ParsedDocument,
  skillDirectory: string,
  localCandidatePaths: readonly string[],
  incompleteCandidateDirectories: readonly string[],
): StaticSupportReferenceAnalysis {
  const candidatesByBasename = new Map<string, string[]>();
  for (const candidate of new Set(localCandidatePaths)) {
    const basename = path.posix.basename(candidate);
    const values = candidatesByBasename.get(basename) ?? [];
    values.push(candidate);
    candidatesByBasename.set(basename, values);
  }

  const references: StaticSupportReference[] = [];
  const incompleteBasenameReferences: IncompleteStaticSupportBasenameReference[] =
    [];
  const seenReferences = new Set<string>();
  const seenIncomplete = new Set<string>();
  const candidateSetIncomplete = incompleteCandidateDirectories.length > 0;
  const markdownSyntax = ensureMarkdownSyntaxForDocument(document);
  const markdownStructuralRanges = [
    ...(markdownSyntax?.linkSyntax ?? []),
    ...(markdownSyntax?.definitions ?? []),
  ];
  const bodyStartIndex =
    markdownBodyStartLineForArtifact(document.artifact, document.lines) - 1;
  for (let index = 0; index < document.lines.length; index += 1) {
    const line = document.lines[index] ?? "";
    const explicitValues: Array<{ raw: string; value: string }> =
      markdownSyntax?.linkTargets
        .filter((target) => target.startLine === index + 1)
        .map((target) => ({ raw: target.source, value: target.target })) ?? [];

    let unquotedLine = maskMarkdownStructuralEvidence(
      line,
      index + 1,
      markdownStructuralRanges,
    );
    const quotedMatches: string[] = [];
    for (const match of unquotedLine.matchAll(
      /([`'"])((?:\.\/)?(?:references|scripts|assets|profiles|examples)\/.*?)\1/g,
    )) {
      if (match[2]) {
        explicitValues.push({ raw: match[0], value: match[2] });
        quotedMatches.push(match[0]);
      }
    }
    unquotedLine = maskRawMatches(unquotedLine, quotedMatches);
    for (const match of unquotedLine.matchAll(
      /(?:^|[\s([])((?:\.\/)?(?:references|scripts|assets|profiles|examples)\/[^\s)`'"\],;]+)/g,
    )) {
      if (match[1]) {
        explicitValues.push({ raw: match[0].trim(), value: match[1] });
      }
    }

    const explicitBasenames = new Set<string>();
    for (const value of explicitValues) {
      const normalized = normalizeStaticSupportReference(
        value.value,
        skillDirectory,
      );
      if (!normalized) continue;
      explicitBasenames.add(path.posix.basename(normalized.targetPath));
      addReference(normalized, value.raw, index + 1);
    }

    if (index < bodyStartIndex) continue;
    const basenameTokens = [
      ...markdownBasenameReferenceTokens(
        markdownSyntax?.linkTargets ?? [],
        index + 1,
      ),
      ...basenameReferenceTokens(unquotedLine),
    ];
    for (const token of basenameTokens) {
      if (explicitBasenames.has(token.basename)) continue;
      const paths = candidatesByBasename.get(token.basename) ?? [];
      if (paths.length > 1) continue;
      if (candidateSetIncomplete) {
        addIncompleteBasename(token, index + 1);
        continue;
      }
      if (paths.length !== 1) continue;
      const normalized = normalizeStaticSupportReference(
        paths[0]!,
        skillDirectory,
      );
      if (normalized) addReference(normalized, token.raw, index + 1);
    }
  }

  function addReference(
    normalized: { targetPath: string; relativePath: string },
    raw: string,
    line: number,
  ): void {
    const key = `${line}:${normalized.targetPath}`;
    if (seenReferences.has(key)) return;
    seenReferences.add(key);
    references.push({
      sourcePath: document.artifact.path,
      targetPath: normalized.targetPath,
      relativePath: normalized.relativePath,
      line,
      raw,
    });
  }

  function addIncompleteBasename(
    token: BasenameReferenceToken,
    line: number,
  ): void {
    const key = `${line}:${token.basename}`;
    if (seenIncomplete.has(key)) return;
    seenIncomplete.add(key);
    incompleteBasenameReferences.push({
      sourcePath: document.artifact.path,
      basename: token.basename,
      line,
      raw: token.raw,
    });
  }

  return {
    references: references.sort(
      (left, right) =>
        left.line - right.line ||
        left.targetPath.localeCompare(right.targetPath) ||
        left.raw.localeCompare(right.raw),
    ),
    incompleteBasenameReferences: incompleteBasenameReferences.sort(
      (left, right) =>
        left.line - right.line || left.basename.localeCompare(right.basename),
    ),
  };
}

function markdownBasenameReferenceTokens(
  destinations: readonly MarkdownLinkTargetRecord[],
  lineNumber: number,
): BasenameReferenceToken[] {
  return destinations.flatMap((destination): BasenameReferenceToken[] => {
    if (destination.startLine !== lineNumber) return [];
    const basename = normalizePotentialBasename(destination.target);
    if (basename === undefined || !isStaticSupportBasename(basename)) return [];
    return [{ basename, raw: destination.source }];
  });
}

/**
 * Resolve minimum static-reference depth from one owning SKILL.md.
 * Rules and inventory projections share this graph without reinterpreting text.
 */
export function localSupportReachabilityDepth(
  skill: ParsedDocument,
  skillDirectory: string,
  localSupportDocs: ParsedDocument[],
  candidatePaths: string[],
  incompleteCandidateDirectories: readonly string[] = [],
): Map<string, number> {
  const reachable = localSupportReferenceReachability(
    skill,
    skillDirectory,
    localSupportDocs,
    candidatePaths,
    incompleteCandidateDirectories,
  );
  return new Map(
    localSupportDocs.flatMap((document): Array<[string, number]> => {
      const evidence = reachable.paths.get(document.artifact.path);
      return evidence ? [[document.artifact.path, evidence.depth]] : [];
    }),
  );
}

/**
 * Prove expected Skill-local targets from parsed reference sources, including
 * targets that discovery could not turn into ParsedDocument evidence.
 */
export function staticallyExpectedSupportInspection(
  documents: ParsedDocument[],
  candidatePaths: readonly string[],
  skillParents: SkillParentIndex,
  incompleteCandidateDirectories: readonly string[] = [],
): StaticSupportInspectionExpectations {
  const documentsByPath = new Map(
    documents.map((document) => [document.artifact.path, document]),
  );
  const expectedPaths = new Map<string, StaticSupportReachabilityEvidence>();
  const incompleteBoundaries = new Map<
    string,
    StaticSupportBoundaryReachabilityEvidence
  >();

  for (const [skillDirectory, parents] of [...skillParents].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (parents.length !== 1) continue;
    const skill = documentsByPath.get(parents[0]!.sourcePath);
    if (!skill) continue;
    const localSupportDocs = documents.filter((document) => {
      const classified = classifyRepositorySkillPath(document.artifact.path);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    const localCandidatePaths = candidatePaths.filter((candidate) => {
      const classified = classifyRepositorySkillPath(candidate);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    const localIncompleteDirectories = incompleteCandidateDirectories.filter(
      (candidate) => {
        const classified = classifyRepositorySkillPath(candidate);
        return (
          classified?.kind === "support" &&
          classified.skillDirectory === skillDirectory
        );
      },
    );
    const reachability = localSupportReferenceReachability(
      skill,
      skillDirectory,
      localSupportDocs,
      localCandidatePaths,
      localIncompleteDirectories,
    );
    for (const evidence of reachability.paths.values()) {
      const previous = expectedPaths.get(evidence.targetPath);
      if (!previous || compareReachabilityEvidence(evidence, previous) < 0) {
        expectedPaths.set(evidence.targetPath, evidence);
      }
    }
    for (const evidence of reachability.incompleteBoundaries.values()) {
      const previous = incompleteBoundaries.get(evidence.boundaryPath);
      if (!previous || compareReachabilityEvidence(evidence, previous) < 0) {
        incompleteBoundaries.set(evidence.boundaryPath, evidence);
      }
    }
  }

  return {
    paths: [...expectedPaths.values()].sort(
      (left, right) =>
        left.targetPath.localeCompare(right.targetPath) ||
        compareReachabilityEvidence(left, right),
    ),
    incompleteBoundaries: [...incompleteBoundaries.values()].sort(
      (left, right) =>
        left.boundaryPath.localeCompare(right.boundaryPath) ||
        compareReachabilityEvidence(left, right),
    ),
  };
}

/**
 * Select only statically reachable UTF-8 plain-text support owned by one Skill.
 * Security orchestration consumes this repository-owned evidence without
 * reparsing references or independently reconstructing reachability.
 */
export function plainTextSupportSecurityReachability(
  documents: ParsedDocument[],
  repositoryPaths: ReadonlySet<string>,
  incompleteCandidateDirectories: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, PlainTextSupportSecurityReachability> {
  const skillsByDirectory = new Map<string, ParsedDocument[]>();
  for (const document of documents) {
    if (document.artifact.kind !== "skill") continue;
    const classified = classifyRepositorySkillPath(document.artifact.path);
    if (classified?.kind !== "entrypoint") continue;
    const skills = skillsByDirectory.get(classified.skillDirectory) ?? [];
    skills.push(document);
    skillsByDirectory.set(classified.skillDirectory, skills);
  }

  const eligible: Array<[string, PlainTextSupportSecurityReachability]> = [];
  for (const [skillDirectory, skills] of skillsByDirectory) {
    if (skills.length !== 1) continue;
    const skill = skills[0]!;
    const localSupportDocs = documents.filter((document) => {
      const classified = classifyRepositorySkillPath(document.artifact.path);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    const candidatePaths = [...repositoryPaths].filter((candidate) => {
      const classified = classifyRepositorySkillPath(candidate);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    const localIncompleteDirectories = [
      ...incompleteCandidateDirectories,
    ].filter((candidate) => {
      const classified = classifyRepositorySkillPath(candidate);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    const reachability = localSupportReachabilityDepth(
      skill,
      skillDirectory,
      localSupportDocs,
      candidatePaths,
      localIncompleteDirectories,
    );

    for (const document of localSupportDocs) {
      const classified = classifyRepositorySkillPath(document.artifact.path);
      const depth = reachability.get(document.artifact.path);
      if (
        classified?.kind !== "support" ||
        classified.supportDirectory === "scripts" ||
        document.artifact.kind === "script" ||
        document.artifact.contentClassification !== "text" ||
        path.posix.extname(document.artifact.path).toLowerCase() !== ".txt" ||
        depth === undefined
      ) {
        continue;
      }
      eligible.push([
        document.artifact.path,
        { owningSkillPath: skill.artifact.path, depth },
      ]);
    }
  }

  return new Map(eligible.sort(([left], [right]) => left.localeCompare(right)));
}

function localSupportReferenceReachability(
  skill: ParsedDocument,
  skillDirectory: string,
  localSupportDocs: ParsedDocument[],
  candidatePaths: readonly string[],
  incompleteCandidateDirectories: readonly string[],
): {
  paths: Map<string, StaticSupportReachabilityEvidence>;
  incompleteBoundaries: Map<string, StaticSupportBoundaryReachabilityEvidence>;
} {
  const sources = [skill, ...localSupportDocs].sort((left, right) =>
    left.artifact.path.localeCompare(right.artifact.path),
  );
  const analyses = new Map(
    sources.map((document) => [
      document.artifact.path,
      analyzeStaticSupportReferences(
        document,
        skillDirectory,
        candidatePaths,
        incompleteCandidateDirectories,
      ),
    ]),
  );
  const paths = new Map<string, StaticSupportReachabilityEvidence>();
  const incompleteBoundaries = new Map<
    string,
    StaticSupportBoundaryReachabilityEvidence
  >();
  let changed = true;

  while (changed) {
    changed = false;
    for (const source of sources) {
      const sourceDepth =
        source.artifact.path === skill.artifact.path
          ? 0
          : paths.get(source.artifact.path)?.depth;
      if (sourceDepth === undefined) continue;
      const analysis = analyses.get(source.artifact.path);
      for (const reference of analysis?.references ?? []) {
        const evidence: StaticSupportReachabilityEvidence = {
          targetPath: reference.targetPath,
          owningSkillPath: skill.artifact.path,
          sourcePath: reference.sourcePath,
          sourceLine: reference.line,
          sourceRaw: reference.raw,
          depth: sourceDepth + 1,
        };
        const previous = paths.get(reference.targetPath);
        if (!previous || compareReachabilityEvidence(evidence, previous) < 0) {
          paths.set(reference.targetPath, evidence);
          changed = true;
        }
      }
      for (const reference of analysis?.incompleteBasenameReferences ?? []) {
        for (const boundaryPath of incompleteCandidateDirectories) {
          const evidence: StaticSupportBoundaryReachabilityEvidence = {
            boundaryPath,
            owningSkillPath: skill.artifact.path,
            sourcePath: reference.sourcePath,
            sourceLine: reference.line,
            sourceRaw: reference.raw,
            depth: sourceDepth + 1,
          };
          const previous = incompleteBoundaries.get(boundaryPath);
          if (
            !previous ||
            compareReachabilityEvidence(evidence, previous) < 0
          ) {
            incompleteBoundaries.set(boundaryPath, evidence);
          }
        }
      }
    }
  }

  return { paths, incompleteBoundaries };
}

function compareReachabilityEvidence(
  left:
    | StaticSupportReachabilityEvidence
    | StaticSupportBoundaryReachabilityEvidence,
  right:
    | StaticSupportReachabilityEvidence
    | StaticSupportBoundaryReachabilityEvidence,
): number {
  return (
    left.depth - right.depth ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.sourceLine - right.sourceLine ||
    left.sourceRaw.localeCompare(right.sourceRaw)
  );
}

function maskRawMatches(line: string, matches: string[]): string {
  let masked = line;
  for (const match of matches) {
    masked = masked.replace(match, " ".repeat(match.length));
  }
  return masked;
}

/**
 * Derive only repository-proven Skill ownership and static-reference edges.
 * Ambiguous Skill parents and unresolved or external paths never produce edges.
 */
export function buildStaticSupportDependencies(
  documents: ParsedDocument[],
  entries: CatalogEntry[],
  repositoryPaths: ReadonlySet<string>,
  incompleteCandidateDirectories: ReadonlySet<string> = new Set(),
): Dependency[] {
  const documentsByPath = new Map(
    documents.map((document) => [document.artifact.path, document]),
  );
  const entriesByPath = new Map(
    entries.map((entry) => [entry.sourcePath, entry]),
  );
  const skillEntries = entries.filter((entry) => entry.kind === "skill");
  const skillCounts = new Map<string, number>();
  for (const skill of skillEntries) {
    const directory = logicalSkillDirectory(skill.sourcePath);
    if (!directory) continue;
    skillCounts.set(directory, (skillCounts.get(directory) ?? 0) + 1);
  }
  const result: Dependency[] = [];

  for (const skill of skillEntries) {
    const skillDirectory = logicalSkillDirectory(skill.sourcePath);
    if (!skillDirectory) continue;
    if (skillCounts.get(skillDirectory) !== 1) continue;
    const localEntries = entries.filter((entry) => {
      const classified = classifyRepositorySkillPath(entry.sourcePath);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    for (const local of localEntries) {
      result.push({
        from: skill.id,
        to: local.id,
        kind: "owns_local_resource",
        sourcePath: skill.sourcePath,
      });
      if (local.ownership.source === "inherited") {
        result.push({
          from: local.id,
          to: skill.id,
          kind: "inherits_owner",
          sourcePath: local.sourcePath,
        });
      }
      if (local.kind === "script" || local.kind === "asset") {
        result.push({
          from: local.id,
          to: skill.id,
          kind: "inherits_policy",
          sourcePath: local.sourcePath,
        });
      }
    }

    const candidatePaths = [...repositoryPaths].filter((candidate) => {
      const classified = classifyRepositorySkillPath(candidate);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    const localIncompleteDirectories = [
      ...incompleteCandidateDirectories,
    ].filter((candidate) => {
      const classified = classifyRepositorySkillPath(candidate);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    const sources = [skill, ...localEntries]
      .map((entry) => documentsByPath.get(entry.sourcePath))
      .filter((document): document is ParsedDocument => document !== undefined);
    for (const source of sources) {
      for (const reference of staticSupportReferences(
        source,
        skillDirectory,
        candidatePaths,
        localIncompleteDirectories,
      )) {
        const target = entriesByPath.get(reference.targetPath);
        if (
          !target ||
          target.id === entriesByPath.get(source.artifact.path)?.id
        )
          continue;
        result.push({
          from: entriesByPath.get(source.artifact.path)?.id ?? skill.id,
          to: target.id,
          kind: "statically_references",
          sourcePath: source.artifact.path,
          evidence: {
            path: source.artifact.path,
            startLine: reference.line,
            endLine: reference.line,
            snippet: reference.raw,
          },
        });
      }
    }
  }

  return dedupeDependencies(result);
}

function normalizeStaticSupportReference(
  value: string,
  skillDirectory: string,
): { targetPath: string; relativePath: string } | undefined {
  const cleaned = decodePath(stripUriSuffix(value.trim()))
    .replace(/^<|>$/g, "")
    .replace(/[),.;:]+$/, "")
    .replace(/^\.\//, "");
  if (!cleaned || path.posix.isAbsolute(cleaned)) return undefined;
  if (cleaned.split("/").includes("..")) return undefined;
  const repositoryRelative = cleaned.startsWith(`${skillDirectory}/`)
    ? cleaned
    : path.posix.join(skillDirectory, cleaned);
  const normalized = path.posix.normalize(repositoryRelative);
  const relativePath = path.posix.relative(skillDirectory, normalized);
  if (
    relativePath.startsWith("../") ||
    relativePath === ".." ||
    !SUPPORT_ROOTS.includes(
      relativePath.split("/")[0] as (typeof SUPPORT_ROOTS)[number],
    ) ||
    relativePath.endsWith("/")
  ) {
    return undefined;
  }
  return { targetPath: normalized, relativePath };
}

function stripUriSuffix(value: string): string {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const boundary = [query, fragment]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return boundary === undefined ? value : value.slice(0, boundary);
}

function containsExactBasename(content: string, basename: string): boolean {
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[\\s\`'"()\\[\\]{},;:])${escaped}(?=$|[\\s\`'"()\\[\\]{},;:?!]|\\.(?=\\s|$))`,
    "m",
  ).test(content);
}

/**
 * Parse the one basename-only support-reference syntax consumed by both
 * candidate-backed resolution and incomplete-candidate boundary evidence.
 */
function basenameReferenceTokens(line: string): BasenameReferenceToken[] {
  const tokens = new Map<string, BasenameReferenceToken>();
  let bareLine = line;
  const quotedMatches: string[] = [];
  for (const match of bareLine.matchAll(/([`'"])(.*?)\1/g)) {
    addBasenameReferenceToken(tokens, line, match[2] ?? "");
    quotedMatches.push(match[0]);
  }
  bareLine = maskRawMatches(bareLine, quotedMatches);

  for (const match of bareLine.matchAll(/[^\s`'"()[\]{},;:!?/\\]+/g)) {
    const raw = match[0];
    addBasenameReferenceToken(
      tokens,
      line,
      raw.endsWith(".") ? raw.slice(0, -1) : raw,
    );
  }

  return [...tokens.values()].sort(
    (left, right) =>
      left.basename.localeCompare(right.basename) ||
      left.raw.localeCompare(right.raw),
  );
}

function maskMarkdownStructuralEvidence(
  line: string,
  lineNumber: number,
  ranges: readonly MarkdownSourceColumnRange[],
): string {
  const masked = line.split("");
  for (const range of ranges) {
    if (lineNumber < range.startLine || lineNumber > range.endLine) continue;
    const start = lineNumber === range.startLine ? range.startColumn - 1 : 0;
    const end =
      lineNumber === range.endLine ? range.endColumn - 1 : masked.length;
    masked.fill(" ", Math.max(0, start), Math.min(masked.length, end));
  }
  return masked.join("");
}

function addBasenameReferenceToken(
  tokens: Map<string, BasenameReferenceToken>,
  line: string,
  value: string,
): void {
  const candidate = normalizePotentialBasename(value);
  if (
    !candidate ||
    !isStaticSupportBasename(candidate) ||
    !containsExactBasename(line, candidate)
  )
    return;
  tokens.set(candidate, { basename: candidate, raw: candidate });
}

/** Filename syntax, not natural-language intent, bounds basename references. */
function isStaticSupportBasename(value: string): boolean {
  return (
    /^\.[\p{L}\p{N}_-]+$/u.test(value) ||
    /^(?:[\p{L}\p{N}_-]+(?:[ .][\p{L}\p{N}_-]+)*)\.[\p{L}][\p{L}\p{N}_-]*$/u.test(
      value,
    ) ||
    /^[\p{Lu}\p{N}][\p{Lu}\p{N}_-]*$/u.test(value) ||
    /^\p{Lu}[\p{L}\p{N}_-]*file$/u.test(value)
  );
}

function normalizePotentialBasename(value: string): string | undefined {
  const cleaned = decodePath(stripUriSuffix(value.trim())).replace(
    /^<|>$/g,
    "",
  );
  if (
    !cleaned ||
    cleaned === "." ||
    cleaned === ".." ||
    cleaned.includes("/") ||
    cleaned.includes("\\") ||
    cleaned.includes(":") ||
    cleaned.includes("?") ||
    cleaned.includes("#")
  ) {
    return undefined;
  }
  return cleaned;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function dedupeDependencies(dependencies: Dependency[]): Dependency[] {
  const seen = new Set<string>();
  return dependencies.filter((dependency) => {
    const key = `${dependency.from}\0${dependency.kind}\0${dependency.to}\0${dependency.sourcePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
