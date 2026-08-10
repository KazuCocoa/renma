import path from "node:path";

import type {
  ExecutableDependencyAnalyzer,
  ExecutableDependencyCandidate,
  ExecutableDependencyRelation,
} from "./executable-dependency-analyzer.js";

const TARGET_EXTENSION = /\.ps1$/iu;
const STATIC_PATH_FORBIDDEN_RE = /[\0\r\n`*?\[\]{}()$#|;&<>:]/u;
const PSSCRIPTROOT = "$psscriptroot";

interface PowerShellWord {
  value: string;
  start: number;
  end: number;
  quote?: "'" | '"';
}

interface PowerShellLexicalState {
  blockCommentDepth: number;
  quote: "'" | '"' | undefined;
  hereString: "'" | '"' | undefined;
  continued: boolean;
  opaque: boolean;
}

export const POWERSHELL_EXECUTABLE_DEPENDENCY_ANALYZER: ExecutableDependencyAnalyzer =
  Object.freeze({
    id: "powershell",
    supports(input: {
      path: string;
      contentClassification: "text" | "binary";
    }) {
      return (
        input.contentClassification === "text" &&
        path.posix.extname(input.path).toLowerCase() === ".ps1"
      );
    },
    collect(input: { path: string; content: string }) {
      return collectPowerShellDependencies(input.path, input.content);
    },
  });

function collectPowerShellDependencies(
  sourcePath: string,
  content: string,
): ExecutableDependencyCandidate[] {
  const candidates: ExecutableDependencyCandidate[] = [];
  const state: PowerShellLexicalState = {
    blockCommentDepth: 0,
    quote: undefined,
    hereString: undefined,
    continued: false,
    opaque: false,
  };
  let line = 1;
  let lineStart = 0;
  while (lineStart < content.length) {
    if (state.opaque) break;
    const newline = content.indexOf("\n", lineStart);
    const physicalEnd = newline < 0 ? content.length : newline;
    const lineEnd =
      content[physicalEnd - 1] === "\r" ? physicalEnd - 1 : physicalEnd;
    const sourceLine = content.slice(lineStart, lineEnd);
    const commandEligible =
      state.blockCommentDepth === 0 &&
      state.quote === undefined &&
      state.hereString === undefined &&
      !state.continued;
    if (commandEligible) {
      const candidate = powerShellDependencyCandidate(
        sourcePath,
        content,
        sourceLine,
        lineStart,
        line,
      );
      if (candidate) candidates.push(candidate);
    }
    scanPowerShellLine(sourceLine, state);
    if (newline < 0) break;
    lineStart = newline + 1;
    line += 1;
  }
  return candidates;
}

function scanPowerShellLine(
  sourceLine: string,
  state: PowerShellLexicalState,
): void {
  state.continued = false;
  if (state.hereString !== undefined) {
    const terminator = state.hereString === "'" ? "'@" : '"@';
    if (sourceLine === terminator) state.hereString = undefined;
    return;
  }
  if (
    state.blockCommentDepth === 0 &&
    state.quote === undefined &&
    /^[ \t]*data(?:[ \t{]|$)/iu.test(sourceLine)
  ) {
    state.opaque = true;
    return;
  }

  let cursor = 0;
  while (cursor < sourceLine.length) {
    if (state.blockCommentDepth > 0) {
      if (sourceLine.slice(cursor, cursor + 2) === "<#") {
        state.blockCommentDepth += 1;
        cursor += 2;
        continue;
      }
      if (sourceLine.slice(cursor, cursor + 2) === "#>") {
        state.blockCommentDepth -= 1;
        cursor += 2;
        continue;
      }
      cursor += 1;
      continue;
    }

    const character = sourceLine[cursor]!;
    if (state.quote === "'") {
      if (character === "'" && sourceLine[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }
      if (character === "'") state.quote = undefined;
      cursor += 1;
      continue;
    }
    if (state.quote === '"') {
      if (character === "`") {
        cursor += cursor + 1 < sourceLine.length ? 2 : 1;
        continue;
      }
      if (character === '"') state.quote = undefined;
      cursor += 1;
      continue;
    }

    if (character === "#") break;
    if (sourceLine.slice(cursor, cursor + 2) === "<#") {
      state.blockCommentDepth = 1;
      cursor += 2;
      continue;
    }
    if (
      character === "@" &&
      (sourceLine[cursor + 1] === "'" || sourceLine[cursor + 1] === '"')
    ) {
      state.hereString = sourceLine[cursor + 1] as "'" | '"';
      return;
    }
    if (character === "'" || character === '"') {
      state.quote = character;
      cursor += 1;
      continue;
    }
    if (character === "`") {
      if (cursor + 1 >= sourceLine.length) {
        state.continued = true;
        return;
      }
      cursor += 2;
      continue;
    }
    cursor += 1;
  }
}

function powerShellDependencyCandidate(
  sourcePath: string,
  content: string,
  sourceLine: string,
  lineOffset: number,
  line: number,
): ExecutableDependencyCandidate | undefined {
  const words = firstPowerShellWords(sourceLine, 3);
  const first = words[0];
  if (!first) return undefined;

  let specifier: PowerShellWord;
  let relation: ExecutableDependencyRelation;
  const firstLower = first.value.toLowerCase();
  if (first.value === "&") {
    const second = words[1];
    if (!second) return undefined;
    specifier = second;
    relation = "static-execution";
  } else if (first.value === ".") {
    const second = words[1];
    if (!second) return undefined;
    specifier = second;
    relation = "static-source";
  } else if (
    firstLower === "pwsh" ||
    firstLower === "pwsh.exe" ||
    firstLower === "powershell" ||
    firstLower === "powershell.exe"
  ) {
    const fileOption = words[1];
    const target = words[2];
    if (fileOption?.value.toLowerCase() !== "-file" || !target) {
      return undefined;
    }
    specifier = target;
    relation = "static-execution";
  } else {
    if (first.quote !== undefined) return undefined;
    specifier = first;
    relation = "static-execution";
  }

  const normalized = normalizePowerShellTarget(sourcePath, specifier);
  if (!normalized) return undefined;
  const declarationStart = lineOffset + first.start;
  const declarationEnd = lineOffset + specifier.end;
  return {
    analyzer: "powershell",
    sourcePath,
    declarationOffset: declarationStart,
    line,
    snippet: boundedSnippet(content.slice(declarationStart, declarationEnd)),
    relation,
    rawSpecifier: specifier.value,
    normalizedTargetCandidates: normalized.path ? [normalized.path] : [],
    unsafe: normalized.unsafe,
  };
}

function firstPowerShellWords(
  sourceLine: string,
  limit: number,
): PowerShellWord[] {
  const words: PowerShellWord[] = [];
  let cursor = 0;
  while (words.length < limit) {
    while (/[ \t]/u.test(sourceLine[cursor] ?? "")) cursor += 1;
    if (cursor >= sourceLine.length || sourceLine[cursor] === "#") break;
    const start = cursor;
    const quote = sourceLine[cursor];
    if (quote === "'" || quote === '"') {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < sourceLine.length && sourceLine[cursor] !== quote) {
        if (sourceLine[cursor] === "`") return [];
        cursor += 1;
      }
      if (cursor >= sourceLine.length) return [];
      const end = cursor + 1;
      if (!powerShellWordBoundary(sourceLine[end])) return [];
      words.push({
        value: sourceLine.slice(valueStart, cursor),
        start,
        end,
        quote,
      });
      cursor = end;
      continue;
    }
    while (
      cursor < sourceLine.length &&
      !/[ \t#;|&<>]/u.test(sourceLine[cursor]!)
    ) {
      cursor += 1;
    }
    if (cursor === start) {
      if (sourceLine[cursor] === "&") {
        words.push({ value: "&", start, end: cursor + 1 });
        cursor += 1;
        continue;
      }
      return words;
    }
    words.push({
      value: sourceLine.slice(start, cursor),
      start,
      end: cursor,
    });
  }
  return words;
}

function powerShellWordBoundary(character: string | undefined): boolean {
  return character === undefined || /[ \t#;|&<>]/u.test(character);
}

function normalizePowerShellTarget(
  sourcePath: string,
  specifier: PowerShellWord,
): { path?: string; unsafe: boolean } | undefined {
  const value = specifier.value;
  let repositoryRelative: string;
  if (hasPowerShellScriptRootAnchor(value)) {
    if (specifier.quote === "'") return undefined;
    const suffix = value.slice(PSSCRIPTROOT.length + 1);
    if (!isStaticPowerShellPath(suffix)) return undefined;
    repositoryRelative = path.posix.join(
      path.posix.dirname(sourcePath),
      suffix.replace(/\\/gu, "/"),
    );
  } else {
    const normalizedSeparators = value.replace(/\\/gu, "/");
    if (
      (!normalizedSeparators.startsWith("./") &&
        !normalizedSeparators.startsWith("../")) ||
      !isStaticPowerShellPath(value)
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

function hasPowerShellScriptRootAnchor(value: string): boolean {
  return (
    value.slice(0, PSSCRIPTROOT.length).toLowerCase() === PSSCRIPTROOT &&
    (value[PSSCRIPTROOT.length] === "\\" || value[PSSCRIPTROOT.length] === "/")
  );
}

function isStaticPowerShellPath(value: string): boolean {
  return value.length > 0 && !STATIC_PATH_FORBIDDEN_RE.test(value);
}

function boundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}
