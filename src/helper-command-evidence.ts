import { compareUtf16CodeUnits } from "./canonical-json.js";
import path from "node:path";
import type { PhrasingContent } from "mdast";

import {
  classifyRepositorySkillPath,
  logicalSkillDirectory,
} from "./discovery.js";
import {
  ensureMarkdownSyntaxForDocument,
  markdownSourceColumnRange,
} from "./markdown-syntax.js";
import type { RepositoryPathState } from "./repository-paths.js";
import type { ParsedDocument } from "./types/metadata.js";

const HELPER_COMMAND_LAUNCHERS = [
  "node",
  "bash",
  "sh",
  "python",
  "python3",
  "pwsh",
  "pwsh.exe",
  "powershell",
  "powershell.exe",
  "cmd",
  "cmd.exe",
] as const;

export type HelperCommandLauncher = (typeof HELPER_COMMAND_LAUNCHERS)[number];

export type HelperScriptPathResolution =
  | {
      kind: "candidate";
      path: string;
      source: "repository-root" | "skill-relative";
    }
  | { kind: "unsafe"; path: string }
  | { kind: "unscoped"; path: string };

export type HelperInvocationResolution =
  | "resolved"
  | "missing"
  | "unsafe"
  | "unscoped"
  | "noncanonical"
  | "excluded"
  | "deep"
  | "oversize"
  | "unsupported"
  | "symlink"
  | "unreadable";

export interface HelperCommandEvidence {
  sourcePath: string;
  line: number;
  snippet: string;
  launcher: HelperCommandLauncher;
  rawTarget: string;
  sourceSkillDirectory?: string;
  pathResolution: HelperScriptPathResolution;
}

export interface ResolvedHelperCommandEvidence extends HelperCommandEvidence {
  normalizedTarget?: string;
  resolution: HelperInvocationResolution;
  targetPathState?: RepositoryPathState;
}

const LEGACY_HELPER_COMMAND_PATTERN = /^(node|bash|sh|python|python3)\s+/;
const POWERSHELL_HELPER_COMMAND_PATTERN =
  /^(pwsh(?:\.exe)?|powershell(?:\.exe)?)\s+-File\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+))/iu;
const CMD_HELPER_COMMAND_PATTERN =
  /^(cmd(?:\.exe)?)\s+\/c\s+(?:"([^"\r\n]+)"|(\S+))/iu;
const LEGACY_HELPER_EXTENSION = /\.(?:mjs|js|cjs|ts|mts|cts|sh|bash|py)$/u;
const POWERSHELL_HELPER_EXTENSION = /\.ps1$/iu;
const BATCH_HELPER_EXTENSION = /\.(?:bat|cmd)$/iu;
const STATIC_WINDOWS_HELPER_PATH_FORBIDDEN_RE = /[\0\r\n`$%!*?\[\]{}()|;&<>]/u;

interface ParsedHelperCommand {
  launcher: HelperCommandLauncher;
  rawTarget: string;
  targetKind: "legacy" | "powershell" | "batch";
}

/** Extract the same bounded helper target grammar used by path diagnostics. */
export function helperScriptPath(command: string): string | undefined {
  const parsed = parseHelperCommand(command);
  if (!parsed) return undefined;
  const target = parsed.rawTarget;
  const normalizedSeparators = target.replace(/\\/gu, "/");
  const hasSupportedExtension =
    parsed.targetKind === "legacy"
      ? LEGACY_HELPER_EXTENSION.test(normalizedSeparators)
      : parsed.targetKind === "powershell"
        ? POWERSHELL_HELPER_EXTENSION.test(normalizedSeparators)
        : BATCH_HELPER_EXTENSION.test(normalizedSeparators);
  if (!hasSupportedExtension) return undefined;
  if (
    parsed.targetKind !== "legacy" &&
    STATIC_WINDOWS_HELPER_PATH_FORBIDDEN_RE.test(normalizedSeparators)
  ) {
    return undefined;
  }
  const isExplicitStaticPath =
    /^(?:(?:\.\.?\/)+)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(
      normalizedSeparators,
    ) ||
    (path.posix.isAbsolute(normalizedSeparators) &&
      /(?:^|\/)scripts\//u.test(normalizedSeparators));
  return isExplicitStaticPath ? target : undefined;
}

function parseHelperCommand(command: string): ParsedHelperCommand | undefined {
  const legacy = LEGACY_HELPER_COMMAND_PATTERN.exec(command);
  if (legacy) {
    const parts = command.split(/\s+/u).slice(1);
    const rawTarget = parts.find((part) => !part.startsWith("-"));
    if (!rawTarget) return undefined;
    return {
      launcher: legacy[1] as HelperCommandLauncher,
      rawTarget,
      targetKind: "legacy",
    };
  }
  const powershell = POWERSHELL_HELPER_COMMAND_PATTERN.exec(command);
  if (powershell) {
    const rawTarget = powershell[2] ?? powershell[3] ?? powershell[4];
    if (!rawTarget || !helperTargetBoundary(command, powershell[0].length)) {
      return undefined;
    }
    return {
      launcher: powershell[1]!.toLowerCase() as HelperCommandLauncher,
      rawTarget,
      targetKind: "powershell",
    };
  }
  const cmd = CMD_HELPER_COMMAND_PATTERN.exec(command);
  if (cmd) {
    const rawTarget = cmd[2] ?? cmd[3];
    if (!rawTarget || !helperTargetBoundary(command, cmd[0].length)) {
      return undefined;
    }
    return {
      launcher: cmd[1]!.toLowerCase() as HelperCommandLauncher,
      rawTarget,
      targetKind: "batch",
    };
  }
  return undefined;
}

function helperTargetBoundary(command: string, end: number): boolean {
  return end >= command.length || /\s/u.test(command[end]!);
}

/** Resolve a helper command path without escaping an unambiguous owning Skill. */
export function resolveHelperScriptPath(
  sourcePath: string,
  scriptPath: string,
): HelperScriptPathResolution {
  const rawPath = scriptPath.replace(/\\/g, "/");
  const skillDirectory = logicalSkillDirectory(sourcePath);
  const sourceSkill = skillDirectory ? { skillDirectory } : undefined;
  if (path.posix.isAbsolute(rawPath)) {
    return sourceSkill
      ? { kind: "unsafe", path: rawPath }
      : { kind: "unscoped", path: rawPath };
  }
  const isRepositoryRootPath =
    /^(?:\.\/)?(?:tools|skills|\.agents|contexts?|lenses)\//.test(rawPath);
  const isCanonicalSkillRelative = /^(?:\.\/)?scripts\//.test(rawPath);
  const isSkillRelative =
    isCanonicalSkillRelative ||
    (sourceSkill !== undefined && !isRepositoryRootPath);
  const hasTraversal = rawPath.split("/").includes("..");

  if (isSkillRelative) {
    if (!sourceSkill) return { kind: "unscoped", path: rawPath };
    if (hasTraversal) return { kind: "unsafe", path: rawPath };
    const relativePath = rawPath.replace(/^\.\//, "");
    const candidate = normalizeRepositoryPath(
      path.posix.join(sourceSkill.skillDirectory, relativePath),
    );
    if (!candidate || !isWithinSkill(candidate, sourceSkill.skillDirectory)) {
      return { kind: "unsafe", path: rawPath };
    }
    return { kind: "candidate", path: candidate, source: "skill-relative" };
  }

  if (hasTraversal) {
    return sourceSkill
      ? { kind: "unsafe", path: rawPath }
      : { kind: "unscoped", path: rawPath };
  }

  const candidate = normalizeRepositoryPath(rawPath);
  if (!candidate) {
    return sourceSkill
      ? { kind: "unsafe", path: rawPath }
      : { kind: "unscoped", path: rawPath };
  }
  return { kind: "candidate", path: candidate, source: "repository-root" };
}

/** Collect recognized repository-helper commands once with stable source lines. */
export function collectHelperCommandEvidence(
  documents: readonly ParsedDocument[],
): HelperCommandEvidence[] {
  return documents
    .flatMap((document) => [
      ...collectFencedHelperCommandEvidence(document),
      ...collectInlineRunHelperCommandEvidence(document),
    ])
    .sort(compareHelperCommandEvidence);
}

/** Correlate shared recognition evidence with immutable repository path states. */
export function resolveHelperCommandEvidence(
  evidence: HelperCommandEvidence,
  repositoryPathStates: ReadonlyMap<string, RepositoryPathState>,
): ResolvedHelperCommandEvidence {
  const pathResolution = evidence.pathResolution;
  if (pathResolution.kind === "unsafe") {
    return { ...evidence, resolution: "unsafe" };
  }
  if (pathResolution.kind === "unscoped") {
    return { ...evidence, resolution: "unscoped" };
  }

  const normalizedTarget = pathResolution.path;
  const targetPathState = repositoryPathStates.get(normalizedTarget);
  const stateResolution = repositoryStateResolution(targetPathState);
  if (stateResolution !== "resolved") {
    return {
      ...evidence,
      normalizedTarget,
      resolution: stateResolution,
      ...(targetPathState ? { targetPathState } : {}),
    };
  }

  return {
    ...evidence,
    normalizedTarget,
    resolution: isCanonicalHelperTarget(normalizedTarget)
      ? "resolved"
      : "noncanonical",
    ...(targetPathState ? { targetPathState } : {}),
  };
}

function isCanonicalHelperTarget(candidate: string): boolean {
  if (candidate.startsWith("tools/")) return true;
  const classified = classifyRepositorySkillPath(candidate);
  return (
    classified?.kind === "support" && classified.supportDirectory === "scripts"
  );
}

export function hasSupportedHelperExtension(candidate: string): boolean {
  return (
    LEGACY_HELPER_EXTENSION.test(candidate) ||
    POWERSHELL_HELPER_EXTENSION.test(candidate) ||
    BATCH_HELPER_EXTENSION.test(candidate)
  );
}

function repositoryStateResolution(
  state: RepositoryPathState | undefined,
): HelperInvocationResolution {
  switch (state) {
    case "parsed":
      return "resolved";
    case "excluded":
    case "deep":
    case "oversize":
    case "unsupported":
    case "symlink":
    case "unreadable":
      return state;
    case "absent":
    case undefined:
      return "missing";
  }
}

function isWithinSkill(candidate: string, skillDirectory: string): boolean {
  return (
    candidate === skillDirectory || candidate.startsWith(`${skillDirectory}/`)
  );
}

function normalizeRepositoryPath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");

  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }

  return normalized;
}

function helperCommandEvidenceFromSnippet(
  document: ParsedDocument,
  line: number,
  commandSnippet: string,
): HelperCommandEvidence | undefined {
  const snippet = commandSnippet.trim();
  const parsed = parseHelperCommand(snippet);
  if (!parsed) return undefined;
  const rawTarget = helperScriptPath(snippet);
  if (!rawTarget) return undefined;
  const sourceSkillDirectory = logicalSkillDirectory(document.artifact.path);
  return {
    sourcePath: document.artifact.path,
    line,
    snippet,
    launcher: parsed.launcher,
    rawTarget,
    ...(sourceSkillDirectory ? { sourceSkillDirectory } : {}),
    pathResolution: resolveHelperScriptPath(document.artifact.path, rawTarget),
  };
}

function collectFencedHelperCommandEvidence(
  document: ParsedDocument,
): HelperCommandEvidence[] {
  return document.codeFences.flatMap((fence) =>
    fence.content.split(/\r?\n/).flatMap((line, index) => {
      const evidence = helperCommandEvidenceFromSnippet(
        document,
        fence.startLine + index + 1,
        line,
      );
      return evidence ? [evidence] : [];
    }),
  );
}

function collectInlineRunHelperCommandEvidence(
  document: ParsedDocument,
): HelperCommandEvidence[] {
  const syntax = ensureMarkdownSyntaxForDocument(document);
  if (!syntax) return [];

  return syntax.records.flatMap((record) => {
    if (
      record.node.type !== "inlineCode" ||
      record.parent.type !== "paragraph" ||
      record.ancestors.some((ancestor) => ancestor.type === "blockquote")
    ) {
      return [];
    }
    const range = markdownSourceColumnRange(record.node, syntax.bodyStartLine);
    if (range.startLine !== range.endLine) return [];
    const cueText = inlineRunCueText(
      record.parent.children.slice(0, record.index),
    );
    if (cueText === undefined) return [];
    const visiblePrefix = cueText.replace(/\s+/g, " ").trim();
    if (visiblePrefix !== "Run" && visiblePrefix !== "Run:") return [];

    const evidence = helperCommandEvidenceFromSnippet(
      document,
      range.startLine,
      record.node.value,
    );
    return evidence ? [evidence] : [];
  });
}

function inlineRunCueText(
  nodes: readonly PhrasingContent[],
): string | undefined {
  let result = "";
  for (const node of nodes) {
    let text: string | undefined;
    switch (node.type) {
      case "text":
        text = node.value;
        break;
      case "break":
        text = " ";
        break;
      case "html":
        text = node.value.trimStart().startsWith("<!--") ? "" : undefined;
        break;
      case "emphasis":
      case "strong":
        text = inlineRunCueText(node.children);
        break;
      case "delete":
      case "footnoteReference":
      case "image":
      case "imageReference":
      case "inlineCode":
      case "link":
      case "linkReference":
        return undefined;
    }
    if (text === undefined) return undefined;
    result += text;
  }
  return result;
}

function compareHelperCommandEvidence(
  left: HelperCommandEvidence,
  right: HelperCommandEvidence,
): number {
  return (
    compareUtf16CodeUnits(left.sourcePath, right.sourcePath) ||
    left.line - right.line ||
    compareUtf16CodeUnits(left.launcher, right.launcher) ||
    compareUtf16CodeUnits(left.rawTarget, right.rawTarget) ||
    compareUtf16CodeUnits(left.snippet, right.snippet)
  );
}
