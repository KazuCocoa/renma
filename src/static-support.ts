import path from "node:path";

import {
  classifyRepositorySkillPath,
  logicalSkillDirectory,
} from "./discovery.js";
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

/** Parse exact, repository-local support references once for rules and graphs. */
export function staticSupportReferences(
  document: ParsedDocument,
  skillDirectory: string,
  localCandidatePaths: readonly string[],
): StaticSupportReference[] {
  const candidatesByBasename = new Map<string, string[]>();
  for (const candidate of localCandidatePaths) {
    const basename = path.posix.basename(candidate);
    const values = candidatesByBasename.get(basename) ?? [];
    values.push(candidate);
    candidatesByBasename.set(basename, values);
  }

  const references: StaticSupportReference[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < document.lines.length; index += 1) {
    const line = document.lines[index] ?? "";
    const values: Array<{ raw: string; value: string }> = [];

    const markdownLinks = markdownLinkDestinations(line);
    values.push(...markdownLinks);
    let unquotedLine = maskRawMatches(
      line,
      markdownLinks.map((link) => link.raw),
    );
    const quotedMatches: string[] = [];
    for (const match of unquotedLine.matchAll(
      /([`'"])((?:\.\/)?(?:references|scripts|assets|profiles|examples)\/.*?)\1/g,
    )) {
      if (match[2]) {
        values.push({ raw: match[0], value: match[2] });
        quotedMatches.push(match[0]);
      }
    }
    unquotedLine = maskRawMatches(unquotedLine, quotedMatches);
    for (const match of unquotedLine.matchAll(
      /(?:^|[\s([])((?:\.\/)?(?:references|scripts|assets|profiles|examples)\/[^\s)`'"\],;]+)/g,
    )) {
      if (match[1]) values.push({ raw: match[0].trim(), value: match[1] });
    }

    for (const [basename, paths] of candidatesByBasename) {
      if (paths.length !== 1 || !containsExactBasename(line, basename))
        continue;
      values.push({ raw: basename, value: paths[0]! });
    }

    for (const value of values) {
      const normalized = normalizeStaticSupportReference(
        value.value,
        skillDirectory,
      );
      if (!normalized) continue;
      const key = `${index + 1}:${normalized.targetPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({
        sourcePath: document.artifact.path,
        targetPath: normalized.targetPath,
        relativePath: normalized.relativePath,
        line: index + 1,
        raw: value.raw,
      });
    }
  }
  return references.sort(
    (left, right) =>
      left.line - right.line ||
      left.targetPath.localeCompare(right.targetPath) ||
      left.raw.localeCompare(right.raw),
  );
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
): Map<string, number> {
  const reachable = localSupportReferenceReachability(
    skill,
    skillDirectory,
    localSupportDocs,
    candidatePaths,
  );
  return new Map(
    localSupportDocs.flatMap((document): Array<[string, number]> => {
      const evidence = reachable.get(document.artifact.path);
      return evidence ? [[document.artifact.path, evidence.depth]] : [];
    }),
  );
}

/**
 * Prove expected Skill-local targets from parsed reference sources, including
 * targets that discovery could not turn into ParsedDocument evidence.
 */
export function staticallyExpectedSupportPaths(
  documents: ParsedDocument[],
  candidatePaths: readonly string[],
  skillParents: SkillParentIndex,
): StaticSupportReachabilityEvidence[] {
  const documentsByPath = new Map(
    documents.map((document) => [document.artifact.path, document]),
  );
  const expected = new Map<string, StaticSupportReachabilityEvidence>();

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
    for (const evidence of localSupportReferenceReachability(
      skill,
      skillDirectory,
      localSupportDocs,
      localCandidatePaths,
    ).values()) {
      const previous = expected.get(evidence.targetPath);
      if (!previous || compareReachabilityEvidence(evidence, previous) < 0) {
        expected.set(evidence.targetPath, evidence);
      }
    }
  }

  return [...expected.values()].sort(
    (left, right) =>
      left.targetPath.localeCompare(right.targetPath) ||
      compareReachabilityEvidence(left, right),
  );
}

/**
 * Select only statically reachable UTF-8 plain-text support owned by one Skill.
 * Security orchestration consumes this repository-owned evidence without
 * reparsing references or independently reconstructing reachability.
 */
export function plainTextSupportSecurityReachability(
  documents: ParsedDocument[],
  repositoryPaths: ReadonlySet<string>,
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
    const reachability = localSupportReachabilityDepth(
      skill,
      skillDirectory,
      localSupportDocs,
      candidatePaths,
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
): Map<string, StaticSupportReachabilityEvidence> {
  const sources = [skill, ...localSupportDocs].sort((left, right) =>
    left.artifact.path.localeCompare(right.artifact.path),
  );
  const references = new Map(
    sources.map((document) => [
      document.artifact.path,
      staticSupportReferences(document, skillDirectory, [...candidatePaths]),
    ]),
  );
  const reachable = new Map<string, StaticSupportReachabilityEvidence>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const source of sources) {
      const sourceDepth =
        source.artifact.path === skill.artifact.path
          ? 0
          : reachable.get(source.artifact.path)?.depth;
      if (sourceDepth === undefined) continue;
      for (const reference of references.get(source.artifact.path) ?? []) {
        const evidence: StaticSupportReachabilityEvidence = {
          targetPath: reference.targetPath,
          owningSkillPath: skill.artifact.path,
          sourcePath: reference.sourcePath,
          sourceLine: reference.line,
          sourceRaw: reference.raw,
          depth: sourceDepth + 1,
        };
        const previous = reachable.get(reference.targetPath);
        if (!previous || compareReachabilityEvidence(evidence, previous) < 0) {
          reachable.set(reference.targetPath, evidence);
          changed = true;
        }
      }
    }
  }

  return reachable;
}

function compareReachabilityEvidence(
  left: StaticSupportReachabilityEvidence,
  right: StaticSupportReachabilityEvidence,
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
    const sources = [skill, ...localEntries]
      .map((entry) => documentsByPath.get(entry.sourcePath))
      .filter((document): document is ParsedDocument => document !== undefined);
    for (const source of sources) {
      for (const reference of staticSupportReferences(
        source,
        skillDirectory,
        candidatePaths,
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

function markdownLinkDestinations(
  line: string,
): Array<{ raw: string; value: string }> {
  const destinations: Array<{ raw: string; value: string }> = [];
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const opener = line.indexOf("](", searchFrom);
    if (opener < 0) break;
    const rawStart = line.lastIndexOf("[", opener);
    let cursor = opener + 2;
    while (/\s/.test(line[cursor] ?? "")) cursor += 1;
    const destinationStart = cursor;
    let destination = "";

    if (line[cursor] === "<") {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < line.length && line[cursor] !== ">") cursor += 1;
      if (line[cursor] === ">") {
        destination = line.slice(valueStart, cursor);
        cursor += 1;
      }
    } else {
      let nestedParentheses = 0;
      while (cursor < line.length) {
        const character = line[cursor] ?? "";
        if (character === "\\" && cursor + 1 < line.length) {
          cursor += 2;
          continue;
        }
        if (character === "(") {
          nestedParentheses += 1;
        } else if (character === ")") {
          if (nestedParentheses === 0) break;
          nestedParentheses -= 1;
        } else if (/\s/.test(character) && nestedParentheses === 0) {
          break;
        }
        cursor += 1;
      }
      destination = line.slice(destinationStart, cursor);
    }

    let outerClose = cursor;
    let titleParentheses = 0;
    let quote: string | undefined;
    while (outerClose < line.length) {
      const character = line[outerClose] ?? "";
      if (character === "\\") {
        outerClose += 2;
        continue;
      }
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "(") {
        titleParentheses += 1;
      } else if (character === ")") {
        if (titleParentheses === 0) break;
        titleParentheses -= 1;
      }
      outerClose += 1;
    }

    if (destination && outerClose < line.length) {
      destinations.push({
        raw: line.slice(rawStart >= 0 ? rawStart : opener, outerClose + 1),
        value: destination,
      });
    }
    searchFrom = Math.max(outerClose + 1, opener + 2);
  }
  return destinations;
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
