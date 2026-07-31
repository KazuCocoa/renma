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

export const HELPER_COMMAND_LAUNCHERS = [
  "node",
  "bash",
  "sh",
  "python",
  "python3",
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

const HELPER_COMMAND_PATTERN = /^(node|bash|sh|python|python3)\s+/;

/** Extract the same bounded helper target grammar used by path diagnostics. */
export function helperScriptPath(command: string): string | undefined {
  const parts = command.split(/\s+/).slice(1);
  const target = parts.find((part) => !part.startsWith("-"));
  if (!target) return undefined;

  const hasSupportedExtension = /\.(?:mjs|js|cjs|ts|mts|cts|sh|bash|py)$/.test(
    target,
  );
  if (!hasSupportedExtension) return undefined;
  const startsAtSupportedRoot = /^(?:(?:\.\.?\/)+)?(?:scripts|tools)\//.test(
    target,
  );
  const isExplicitSkillScript = /(?:^|\/)scripts\//.test(target);
  return startsAtSupportedRoot || isExplicitSkillScript ? target : undefined;
}

/** Resolve a helper command path without escaping an unambiguous owning Skill. */
export function resolveHelperScriptPath(
  sourcePath: string,
  scriptPath: string,
): HelperScriptPathResolution {
  const rawPath = scriptPath.replace(/\\/g, "/");
  const skillDirectory = logicalSkillDirectory(sourcePath);
  const sourceSkill = skillDirectory ? { skillDirectory } : undefined;
  const isSkillRelative = /^(?:\.\/)?scripts\//.test(rawPath);
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

export function isCanonicalHelperTarget(candidate: string): boolean {
  if (candidate.startsWith("tools/")) return true;
  const classified = classifyRepositorySkillPath(candidate);
  return (
    classified?.kind === "support" && classified.supportDirectory === "scripts"
  );
}

export function hasSupportedHelperExtension(candidate: string): boolean {
  return /\.(?:mjs|js|cjs|ts|mts|cts|sh|bash|py)$/.test(candidate);
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
  const launcherMatch = HELPER_COMMAND_PATTERN.exec(snippet);
  if (!launcherMatch) return undefined;
  const rawTarget = helperScriptPath(snippet);
  if (!rawTarget) return undefined;
  const launcher = launcherMatch[1] as HelperCommandLauncher;
  const sourceSkillDirectory = logicalSkillDirectory(document.artifact.path);
  return {
    sourcePath: document.artifact.path,
    line,
    snippet,
    launcher,
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
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.line - right.line ||
    left.launcher.localeCompare(right.launcher) ||
    left.rawTarget.localeCompare(right.rawTarget) ||
    left.snippet.localeCompare(right.snippet)
  );
}
