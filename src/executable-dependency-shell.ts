import path from "node:path";

import type {
  ExecutableDependencyAnalyzer,
  ExecutableDependencyCandidate,
  ExecutableDependencyRelation,
} from "./executable-dependency-analyzer.js";

const SOURCE_EXTENSIONS = new Set([".sh", ".bash"]);
const TARGET_EXTENSION = /\.(?:sh|bash)$/u;
const STATIC_PATH_FORBIDDEN_RE = /[\0\r\n\\$`*?\[\]{}()!]/u;

interface ShellWord {
  value: string;
  start: number;
  end: number;
}

export const SHELL_EXECUTABLE_DEPENDENCY_ANALYZER: ExecutableDependencyAnalyzer =
  Object.freeze({
    id: "shell",
    supports(input: {
      path: string;
      contentClassification: "text" | "binary";
    }) {
      return (
        input.contentClassification === "text" &&
        SOURCE_EXTENSIONS.has(path.posix.extname(input.path).toLowerCase())
      );
    },
    collect(input: { path: string; content: string }) {
      return collectShellDependencies(input.path, input.content);
    },
  });

function collectShellDependencies(
  sourcePath: string,
  content: string,
): ExecutableDependencyCandidate[] {
  const candidates: ExecutableDependencyCandidate[] = [];
  let line = 1;
  let lineStart = 0;
  while (lineStart < content.length) {
    const newline = content.indexOf("\n", lineStart);
    const physicalEnd = newline < 0 ? content.length : newline;
    const lineEnd =
      content[physicalEnd - 1] === "\r" ? physicalEnd - 1 : physicalEnd;
    const candidate = shellDependencyCandidate(
      sourcePath,
      content,
      content.slice(lineStart, lineEnd),
      lineStart,
      line,
    );
    if (candidate !== undefined) candidates.push(candidate);
    if (newline < 0) break;
    lineStart = newline + 1;
    line += 1;
  }
  return candidates;
}

function shellDependencyCandidate(
  sourcePath: string,
  content: string,
  sourceLine: string,
  lineOffset: number,
  line: number,
): ExecutableDependencyCandidate | undefined {
  const words = firstShellWords(sourceLine, 2);
  const first = words[0];
  if (first === undefined) return undefined;

  let specifier: ShellWord;
  let relation: ExecutableDependencyRelation;
  if (first.value === "bash" || first.value === "sh") {
    const second = words[1];
    if (second === undefined) return undefined;
    specifier = second;
    relation = "static-execution";
  } else if (first.value === "source" || first.value === ".") {
    const second = words[1];
    if (second === undefined) return undefined;
    specifier = second;
    relation = "static-source";
  } else {
    specifier = first;
    relation = "static-execution";
  }

  const rawSpecifier = specifier.value;
  if (!isStaticRelativeShellPath(rawSpecifier)) return undefined;
  const normalized = normalizeRelativeTarget(sourcePath, rawSpecifier);
  const declarationStart = lineOffset + first.start;
  const declarationEnd = lineOffset + specifier.end;
  return {
    analyzer: "shell",
    sourcePath,
    declarationOffset: declarationStart,
    line,
    snippet: boundedSnippet(content.slice(declarationStart, declarationEnd)),
    relation,
    rawSpecifier,
    normalizedTargetCandidates: normalized.path ? [normalized.path] : [],
    unsafe: normalized.unsafe,
  };
}

function firstShellWords(sourceLine: string, limit: number): ShellWord[] {
  const words: ShellWord[] = [];
  let cursor = 0;
  while (words.length < limit) {
    while (cursor < sourceLine.length && /[ \t]/u.test(sourceLine[cursor]!)) {
      cursor += 1;
    }
    if (cursor >= sourceLine.length || sourceLine[cursor] === "#") break;
    const start = cursor;
    const quote = sourceLine[cursor];
    if (quote === "'" || quote === '"') {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < sourceLine.length && sourceLine[cursor] !== quote) {
        cursor += 1;
      }
      if (cursor >= sourceLine.length) return [];
      if (
        cursor + 1 < sourceLine.length &&
        !/[ \t;&|<>#]/u.test(sourceLine[cursor + 1]!)
      ) {
        return [];
      }
      words.push({
        value: sourceLine.slice(valueStart, cursor),
        start,
        end: cursor + 1,
      });
      cursor += 1;
    } else {
      while (
        cursor < sourceLine.length &&
        !/[ \t;&|<>]/u.test(sourceLine[cursor]!)
      ) {
        cursor += 1;
      }
      if (cursor === start) return words;
      words.push({
        value: sourceLine.slice(start, cursor),
        start,
        end: cursor,
      });
    }
  }
  return words;
}

function isStaticRelativeShellPath(value: string): boolean {
  return (
    (value.startsWith("./") || value.startsWith("../")) &&
    TARGET_EXTENSION.test(value) &&
    !STATIC_PATH_FORBIDDEN_RE.test(value) &&
    !value.includes("#")
  );
}

function normalizeRelativeTarget(
  sourcePath: string,
  rawSpecifier: string,
): { path?: string; unsafe: boolean } {
  const joined = path.posix.join(path.posix.dirname(sourcePath), rawSpecifier);
  const normalized = path.posix.normalize(joined);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return { unsafe: true };
  }
  return { path: normalized, unsafe: false };
}

function boundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}
