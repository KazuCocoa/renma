import path from "node:path";

import type {
  ExecutableDependencyAnalyzer,
  ExecutableDependencyCandidate,
} from "./executable-dependency-analyzer.js";

interface Token {
  kind: "identifier" | "dot" | "comma" | "left" | "right" | "newline";
  value: string;
  line: number;
  start: number;
  end: number;
}

export const PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER: ExecutableDependencyAnalyzer =
  Object.freeze({
    id: "python",
    supports(input: {
      path: string;
      contentClassification: "text" | "binary";
    }) {
      return (
        input.contentClassification === "text" &&
        path.posix.extname(input.path).toLowerCase() === ".py"
      );
    },
    collect(input: { path: string; content: string }) {
      return collectPythonDependencies(input.path, input.content);
    },
  });

function collectPythonDependencies(
  sourcePath: string,
  content: string,
): ExecutableDependencyCandidate[] {
  const tokens = tokenize(content);
  const candidates: ExecutableDependencyCandidate[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const from = tokens[index]!;
    if (from.kind !== "identifier" || from.value !== "from") continue;
    const parsed = parseRelativeFrom(tokens, index);
    if (!parsed) continue;
    if (parsed.moduleParts.length > 0) {
      candidates.push(
        pythonCandidate(
          sourcePath,
          content,
          from,
          parsed.end,
          parsed.level,
          parsed.moduleParts,
        ),
      );
      continue;
    }
    for (const importedName of parsed.importedNames) {
      candidates.push(
        pythonCandidate(sourcePath, content, from, parsed.end, parsed.level, [
          importedName,
        ]),
      );
    }
  }
  return candidates;
}

function parseRelativeFrom(
  tokens: readonly Token[],
  index: number,
):
  | {
      level: number;
      moduleParts: string[];
      importedNames: string[];
      end: number;
    }
  | undefined {
  let cursor = index + 1;
  let level = 0;
  while (tokens[cursor]?.kind === "dot") {
    level += 1;
    cursor += 1;
  }
  if (level === 0) return undefined;

  const moduleParts: string[] = [];
  while (tokens[cursor]?.kind === "identifier") {
    if (tokens[cursor]!.value === "import") break;
    moduleParts.push(tokens[cursor]!.value);
    cursor += 1;
    if (tokens[cursor]?.kind !== "dot") break;
    cursor += 1;
  }
  const importToken = tokens[cursor];
  if (importToken?.kind !== "identifier" || importToken.value !== "import") {
    return undefined;
  }
  cursor += 1;

  const importedNames: string[] = [];
  let depth = 0;
  let expectingName = true;
  let end = importToken.end;
  while (cursor < tokens.length) {
    const token = tokens[cursor]!;
    if (token.kind === "newline" && depth === 0) break;
    end = token.end;
    if (token.kind === "left") {
      depth += 1;
    } else if (token.kind === "right") {
      depth = Math.max(0, depth - 1);
    } else if (token.kind === "comma") {
      expectingName = true;
    } else if (
      moduleParts.length === 0 &&
      expectingName &&
      token.kind === "identifier" &&
      token.value !== "as"
    ) {
      importedNames.push(token.value);
      expectingName = false;
    }
    cursor += 1;
  }
  return { level, moduleParts, importedNames, end };
}

function pythonCandidate(
  sourcePath: string,
  content: string,
  from: Token,
  end: number,
  level: number,
  moduleParts: readonly string[],
): ExecutableDependencyCandidate {
  const resolved = normalizePythonModule(sourcePath, level, moduleParts);
  return {
    analyzer: "python",
    sourcePath,
    declarationOffset: from.start,
    line: from.line,
    snippet: boundedSnippet(content.slice(from.start, end)),
    relation: "static-import",
    rawSpecifier: `${".".repeat(level)}${moduleParts.join(".")}`,
    normalizedTargetCandidates: resolved.candidates,
    unsafe: resolved.unsafe,
  };
}

function normalizePythonModule(
  sourcePath: string,
  level: number,
  moduleParts: readonly string[],
): { candidates: string[]; unsafe: boolean } {
  const directoryParts = path.posix
    .dirname(sourcePath)
    .split("/")
    .filter((part) => part && part !== ".");
  const parentCount = level - 1;
  if (parentCount > directoryParts.length) {
    return { candidates: [], unsafe: true };
  }
  const baseParts = directoryParts.slice(
    0,
    directoryParts.length - parentCount,
  );
  const moduleBase = [...baseParts, ...moduleParts].join("/");
  if (!moduleBase) return { candidates: [], unsafe: true };
  return {
    candidates: [`${moduleBase}.py`, `${moduleBase}/__init__.py`],
    unsafe: false,
  };
}

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let parenthesisDepth = 0;
  let continued = false;
  while (index < content.length) {
    const character = content[index]!;
    if (character === "\r" && content[index + 1] === "\n") {
      index += 1;
      continue;
    }
    if (character === "\n") {
      if (parenthesisDepth === 0 && !continued) {
        tokens.push({
          kind: "newline",
          value: "\n",
          line,
          start: index,
          end: index + 1,
        });
      }
      line += 1;
      index += 1;
      continued = false;
      continue;
    }
    if (character === "\\") {
      let cursor = index + 1;
      if (content[cursor] === "\r") cursor += 1;
      if (content[cursor] === "\n") {
        continued = true;
        index = cursor;
        continue;
      }
    }
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "#") {
      while (index < content.length && content[index] !== "\n") index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      const skipped = skipPythonString(content, index, line, character);
      index = skipped.index;
      line = skipped.line;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const start = index;
      const tokenLine = line;
      index += 1;
      while (index < content.length && /[A-Za-z0-9_]/u.test(content[index]!)) {
        index += 1;
      }
      tokens.push({
        kind: "identifier",
        value: content.slice(start, index),
        line: tokenLine,
        start,
        end: index,
      });
      continue;
    }
    const kind =
      character === "."
        ? "dot"
        : character === ","
          ? "comma"
          : character === "("
            ? "left"
            : character === ")"
              ? "right"
              : undefined;
    if (kind) {
      if (kind === "left") parenthesisDepth += 1;
      if (kind === "right")
        parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      tokens.push({
        kind,
        value: character,
        line,
        start: index,
        end: index + 1,
      });
    }
    index += 1;
  }
  tokens.push({
    kind: "newline",
    value: "\n",
    line,
    start: content.length,
    end: content.length,
  });
  return tokens;
}

function skipPythonString(
  content: string,
  start: number,
  startLine: number,
  quote: string,
): { index: number; line: number } {
  const triple = content[start + 1] === quote && content[start + 2] === quote;
  let index = start + (triple ? 3 : 1);
  let line = startLine;
  while (index < content.length) {
    if (content[index] === "\n") {
      line += 1;
      if (!triple) return { index: index + 1, line };
    }
    if (content[index] === "\\") {
      index += 2;
      continue;
    }
    if (
      triple &&
      content[index] === quote &&
      content[index + 1] === quote &&
      content[index + 2] === quote
    ) {
      return { index: index + 3, line };
    }
    if (!triple && content[index] === quote) {
      return { index: index + 1, line };
    }
    index += 1;
  }
  return { index, line };
}

function boundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}
