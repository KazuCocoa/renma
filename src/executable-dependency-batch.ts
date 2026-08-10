import path from "node:path";

import type {
  ExecutableDependencyAnalyzer,
  ExecutableDependencyCandidate,
} from "./executable-dependency-analyzer.js";

const TARGET_EXTENSION = /\.(?:bat|cmd)$/iu;
const STATIC_PATH_FORBIDDEN_RE = /[\0\r\n^%!*?\[\]{}()#|;&<>:]/u;
const SCRIPT_DIRECTORY_ANCHOR = "%~dp0";

interface BatchWord {
  value: string;
  start: number;
  end: number;
  quoted: boolean;
}

export const BATCH_EXECUTABLE_DEPENDENCY_ANALYZER: ExecutableDependencyAnalyzer =
  Object.freeze({
    id: "batch",
    supports(input: {
      path: string;
      contentClassification: "text" | "binary";
    }) {
      const extension = path.posix.extname(input.path).toLowerCase();
      return (
        input.contentClassification === "text" &&
        (extension === ".bat" || extension === ".cmd")
      );
    },
    collect(input: { path: string; content: string }) {
      return collectBatchDependencies(input.path, input.content);
    },
  });

function collectBatchDependencies(
  sourcePath: string,
  content: string,
): ExecutableDependencyCandidate[] {
  const candidates: ExecutableDependencyCandidate[] = [];
  let continued = false;
  let line = 1;
  let lineStart = 0;
  while (lineStart < content.length) {
    const newline = content.indexOf("\n", lineStart);
    const physicalEnd = newline < 0 ? content.length : newline;
    const lineEnd =
      content[physicalEnd - 1] === "\r" ? physicalEnd - 1 : physicalEnd;
    const sourceLine = content.slice(lineStart, lineEnd);
    if (!continued && !isBatchComment(sourceLine)) {
      const candidate = batchDependencyCandidate(
        sourcePath,
        content,
        sourceLine,
        lineStart,
        line,
      );
      if (candidate) candidates.push(candidate);
    }
    continued = hasBatchLineContinuation(sourceLine);
    if (newline < 0) break;
    lineStart = newline + 1;
    line += 1;
  }
  return candidates;
}

function isBatchComment(sourceLine: string): boolean {
  const command = sourceLine.trimStart().replace(/^@/u, "").trimStart();
  return /^::/u.test(command) || /^rem(?:[ \t]|$)/iu.test(command);
}

function hasBatchLineContinuation(sourceLine: string): boolean {
  let cursor = sourceLine.length - 1;
  if (cursor < 0 || sourceLine[cursor] !== "^") return false;
  let count = 0;
  while (cursor >= 0 && sourceLine[cursor] === "^") {
    count += 1;
    cursor -= 1;
  }
  return count % 2 === 1;
}

function batchDependencyCandidate(
  sourcePath: string,
  content: string,
  sourceLine: string,
  lineOffset: number,
  line: number,
): ExecutableDependencyCandidate | undefined {
  const commandStart = batchCommandStart(sourceLine);
  const words = firstBatchWords(sourceLine, commandStart.offset, 3);
  const first = words[0];
  if (!first) return undefined;

  let specifier: BatchWord;
  const command = first.value.toLowerCase();
  if (command === "call") {
    const second = words[1];
    if (!second || second.value.startsWith(":")) return undefined;
    specifier = second;
  } else if (command === "cmd" || command === "cmd.exe") {
    const commandOption = words[1];
    const target = words[2];
    if (commandOption?.value.toLowerCase() !== "/c" || !target) {
      return undefined;
    }
    specifier = target;
  } else {
    specifier = first;
  }

  const normalized = normalizeBatchTarget(sourcePath, specifier.value);
  if (!normalized) return undefined;
  const declarationStart = lineOffset + commandStart.declarationStart;
  const declarationEnd = lineOffset + specifier.end;
  return {
    analyzer: "batch",
    sourcePath,
    declarationOffset: declarationStart,
    line,
    snippet: boundedSnippet(content.slice(declarationStart, declarationEnd)),
    relation: "static-execution",
    rawSpecifier: specifier.value,
    normalizedTargetCandidates: normalized.path ? [normalized.path] : [],
    unsafe: normalized.unsafe,
  };
}

function batchCommandStart(sourceLine: string): {
  offset: number;
  declarationStart: number;
} {
  let cursor = 0;
  while (/[ \t]/u.test(sourceLine[cursor] ?? "")) cursor += 1;
  const declarationStart = cursor;
  if (sourceLine[cursor] === "@") {
    cursor += 1;
    while (/[ \t]/u.test(sourceLine[cursor] ?? "")) cursor += 1;
  }
  return { offset: cursor, declarationStart };
}

function firstBatchWords(
  sourceLine: string,
  initialOffset: number,
  limit: number,
): BatchWord[] {
  const words: BatchWord[] = [];
  let cursor = initialOffset;
  while (words.length < limit) {
    while (/[ \t]/u.test(sourceLine[cursor] ?? "")) cursor += 1;
    if (cursor >= sourceLine.length) break;
    const start = cursor;
    if (sourceLine[cursor] === '"') {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < sourceLine.length && sourceLine[cursor] !== '"') {
        cursor += 1;
      }
      if (cursor >= sourceLine.length) return [];
      const end = cursor + 1;
      if (!batchWordBoundary(sourceLine[end])) return [];
      words.push({
        value: sourceLine.slice(valueStart, cursor),
        start,
        end,
        quoted: true,
      });
      cursor = end;
      continue;
    }
    while (
      cursor < sourceLine.length &&
      !/[ \t&|<>]/u.test(sourceLine[cursor]!)
    ) {
      cursor += 1;
    }
    if (cursor === start) return words;
    words.push({
      value: sourceLine.slice(start, cursor),
      start,
      end: cursor,
      quoted: false,
    });
  }
  return words;
}

function batchWordBoundary(character: string | undefined): boolean {
  return character === undefined || /[ \t&|<>]/u.test(character);
}

function normalizeBatchTarget(
  sourcePath: string,
  value: string,
): { path?: string; unsafe: boolean } | undefined {
  let repositoryRelative: string;
  if (value.startsWith(SCRIPT_DIRECTORY_ANCHOR)) {
    const suffix = value.slice(SCRIPT_DIRECTORY_ANCHOR.length);
    if (!suffix || !isStaticBatchPath(suffix)) return undefined;
    repositoryRelative = path.posix.join(
      path.posix.dirname(sourcePath),
      suffix.replace(/\\/gu, "/"),
    );
  } else {
    const normalizedSeparators = value.replace(/\\/gu, "/");
    if (
      (!normalizedSeparators.startsWith("./") &&
        !normalizedSeparators.startsWith("../")) ||
      !isStaticBatchPath(value)
    ) {
      return undefined;
    }
    repositoryRelative = path.posix.join(
      path.posix.dirname(sourcePath),
      normalizedSeparators,
    );
  }
  if (!TARGET_EXTENSION.test(value)) return undefined;
  const normalized = path.posix.normalize(repositoryRelative);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return { unsafe: true };
  }
  return { path: normalized, unsafe: false };
}

function isStaticBatchPath(value: string): boolean {
  return value.length > 0 && !STATIC_PATH_FORBIDDEN_RE.test(value);
}

function boundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}
