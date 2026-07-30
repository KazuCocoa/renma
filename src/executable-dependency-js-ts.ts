import path from "node:path";

import type {
  ExecutableDependencyAnalyzer,
  ExecutableDependencyCandidate,
  ExecutableDependencyRelation,
} from "./executable-dependency-analyzer.js";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".mts", ".cts"]);
const TARGET_EXTENSION = /\.(?:js|mjs|cjs|ts|mts|cts|py|sh|bash)$/u;
const MAX_DECLARATION_TOKENS = 256;
const MAX_DECLARATION_CHARACTERS = 4096;

interface Token {
  kind: "identifier" | "string" | "punctuator";
  value: string;
  line: number;
  start: number;
  end: number;
}

export const JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER: ExecutableDependencyAnalyzer =
  Object.freeze({
    id: "js-ts",
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
      return collectJsTsDependencies(input.path, input.content);
    },
  });

function collectJsTsDependencies(
  sourcePath: string,
  content: string,
): ExecutableDependencyCandidate[] {
  const tokens = tokenize(content);
  const candidates: ExecutableDependencyCandidate[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "identifier") continue;
    if (token.value === "import") {
      const collected = collectImport(tokens, index, sourcePath, content);
      if (collected) candidates.push(collected);
    } else if (token.value === "export") {
      const collected = collectExport(tokens, index, sourcePath, content);
      if (collected) candidates.push(collected);
    }
  }
  return candidates;
}

function collectImport(
  tokens: readonly Token[],
  index: number,
  sourcePath: string,
  content: string,
): ExecutableDependencyCandidate | undefined {
  const keyword = tokens[index]!;
  const next = tokens[index + 1];
  if (!next) return undefined;
  if (
    (next.kind === "punctuator" &&
      (next.value === "." || next.value === "(")) ||
    (next.kind === "identifier" && next.value === "type")
  ) {
    return undefined;
  }
  if (next.kind === "string") {
    return dependencyCandidate(
      sourcePath,
      content,
      keyword,
      next,
      "static-import",
    );
  }
  for (
    let cursor = index + 1;
    cursor < tokens.length && cursor <= index + MAX_DECLARATION_TOKENS;
    cursor += 1
  ) {
    const token = tokens[cursor]!;
    if (token.start - keyword.start > MAX_DECLARATION_CHARACTERS) break;
    if (token.kind === "punctuator" && token.value === ";") break;
    if (token.kind === "punctuator" && token.value === "=") return undefined;
    if (
      cursor > index + 1 &&
      token.kind === "identifier" &&
      (token.value === "import" || token.value === "export")
    ) {
      break;
    }
    if (token.kind === "identifier" && token.value === "from") {
      const specifier = tokens[cursor + 1];
      return specifier?.kind === "string"
        ? dependencyCandidate(
            sourcePath,
            content,
            keyword,
            specifier,
            "static-import",
          )
        : undefined;
    }
  }
  return undefined;
}

function collectExport(
  tokens: readonly Token[],
  index: number,
  sourcePath: string,
  content: string,
): ExecutableDependencyCandidate | undefined {
  const keyword = tokens[index]!;
  const next = tokens[index + 1];
  if (next?.kind === "identifier" && next.value === "type") return undefined;
  for (
    let cursor = index + 1;
    cursor < tokens.length && cursor <= index + MAX_DECLARATION_TOKENS;
    cursor += 1
  ) {
    const token = tokens[cursor]!;
    if (token.start - keyword.start > MAX_DECLARATION_CHARACTERS) break;
    if (token.kind === "punctuator" && token.value === ";") break;
    if (
      cursor > index + 1 &&
      token.kind === "identifier" &&
      (token.value === "import" || token.value === "export")
    ) {
      break;
    }
    if (token.kind === "identifier" && token.value === "from") {
      const specifier = tokens[cursor + 1];
      return specifier?.kind === "string"
        ? dependencyCandidate(
            sourcePath,
            content,
            keyword,
            specifier,
            "static-reexport",
          )
        : undefined;
    }
  }
  return undefined;
}

function dependencyCandidate(
  sourcePath: string,
  content: string,
  keyword: Token,
  specifierToken: Token,
  relation: ExecutableDependencyRelation,
): ExecutableDependencyCandidate | undefined {
  const rawSpecifier = specifierToken.value;
  if (
    (!rawSpecifier.startsWith("./") && !rawSpecifier.startsWith("../")) ||
    rawSpecifier.includes("?") ||
    rawSpecifier.includes("#") ||
    !TARGET_EXTENSION.test(rawSpecifier)
  ) {
    return undefined;
  }
  const normalized = normalizeRelativeTarget(sourcePath, rawSpecifier);
  return {
    analyzer: "js-ts",
    sourcePath,
    line: keyword.line,
    snippet: boundedSnippet(content.slice(keyword.start, specifierToken.end)),
    relation,
    rawSpecifier,
    normalizedTargetCandidates: normalized.path ? [normalized.path] : [],
    unsafe: normalized.unsafe,
  };
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

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  while (index < content.length) {
    const character = content[index]!;
    if (character === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && content[index + 1] === "/") {
      index = skipLineComment(content, index + 2);
      continue;
    }
    if (character === "/" && content[index + 1] === "*") {
      const skipped = skipBlockComment(content, index + 2, line);
      index = skipped.index;
      line = skipped.line;
      continue;
    }
    if (character === "'" || character === '"') {
      const string = readQuotedString(content, index, line, character);
      if (string) {
        tokens.push(string.token);
        index = string.index;
        line = string.line;
      } else {
        index += 1;
      }
      continue;
    }
    if (character === "`") {
      const skipped = skipTemplateLiteral(content, index + 1, line);
      index = skipped.index;
      line = skipped.line;
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      const tokenLine = line;
      index += 1;
      while (index < content.length && isIdentifierPart(content[index]!)) {
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
    tokens.push({
      kind: "punctuator",
      value: character,
      line,
      start: index,
      end: index + 1,
    });
    index += 1;
  }
  return tokens;
}

function readQuotedString(
  content: string,
  start: number,
  startLine: number,
  quote: string,
): { token: Token; index: number; line: number } | undefined {
  let index = start + 1;
  const line = startLine;
  let value = "";
  while (index < content.length) {
    const character = content[index]!;
    if (character === quote) {
      return {
        token: {
          kind: "string",
          value,
          line: startLine,
          start,
          end: index + 1,
        },
        index: index + 1,
        line,
      };
    }
    if (character === "\n" || character === "\r") return undefined;
    if (character === "\\") {
      const escaped = content[index + 1];
      if (escaped === undefined) return undefined;
      value += escaped;
      index += 2;
      continue;
    }
    value += character;
    index += 1;
  }
  return undefined;
}

function skipLineComment(content: string, index: number): number {
  while (index < content.length && content[index] !== "\n") index += 1;
  return index;
}

function skipBlockComment(
  content: string,
  start: number,
  startLine: number,
): { index: number; line: number } {
  let index = start;
  let line = startLine;
  while (index < content.length) {
    if (content[index] === "\n") line += 1;
    if (content[index] === "*" && content[index + 1] === "/") {
      return { index: index + 2, line };
    }
    index += 1;
  }
  return { index, line };
}

function skipTemplateLiteral(
  content: string,
  start: number,
  startLine: number,
): { index: number; line: number } {
  let index = start;
  let line = startLine;
  while (index < content.length) {
    const character = content[index]!;
    if (character === "\n") line += 1;
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "$" && content[index + 1] === "{") {
      const skipped = skipTemplateExpression(content, index + 2, line);
      index = skipped.index;
      line = skipped.line;
      continue;
    }
    if (character === "`") return { index: index + 1, line };
    index += 1;
  }
  return { index, line };
}

function skipTemplateExpression(
  content: string,
  start: number,
  startLine: number,
): { index: number; line: number } {
  let index = start;
  let line = startLine;
  let depth = 1;
  while (index < content.length && depth > 0) {
    const character = content[index]!;
    if (character === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (character === "/" && content[index + 1] === "/") {
      index = skipLineComment(content, index + 2);
      continue;
    }
    if (character === "/" && content[index + 1] === "*") {
      const skipped = skipBlockComment(content, index + 2, line);
      index = skipped.index;
      line = skipped.line;
      continue;
    }
    if (character === "'" || character === '"') {
      const skipped = skipJsExpressionString(
        content,
        index + 1,
        line,
        character,
      );
      index = skipped.index;
      line = skipped.line;
      continue;
    }
    if (character === "`") {
      const skipped = skipTemplateLiteral(content, index + 1, line);
      index = skipped.index;
      line = skipped.line;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    index += 1;
  }
  return { index, line };
}

function skipJsExpressionString(
  content: string,
  start: number,
  startLine: number,
  quote: string,
): { index: number; line: number } {
  let index = start;
  let line = startLine;
  while (index < content.length) {
    const character = content[index]!;
    if (character === "\\") {
      if (content[index + 1] === "\n") line += 1;
      index += 2;
      continue;
    }
    if (character === "\n") {
      line += 1;
      return { index: index + 1, line };
    }
    if (character === quote) return { index: index + 1, line };
    index += 1;
  }
  return { index, line };
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_$]/u.test(character);
}

function isIdentifierPart(character: string): boolean {
  return /[A-Za-z0-9_$]/u.test(character);
}

function boundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}
