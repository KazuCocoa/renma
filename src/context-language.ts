const DATED_OR_VERSIONED_CONTEXT_LINE_PATTERN =
  /\b(?:\d{4}-\d{2}-\d{2}|v?\d+\.\d+(?:\.\d+)?)\b/i;
const VAGUE_WORDING_PATTERNS: LinePattern[] = [
  { pattern: /\busually\b/i, label: "usually" },
  { pattern: /\boften\b/i, label: "often" },
  { pattern: /\bquickly\b/i, label: "quickly" },
  { pattern: /\bsoon\b/i, label: "soon" },
  { pattern: /\bas needed\b/i, label: "as needed" },
  { pattern: /\bwhere appropriate\b/i, label: "where appropriate" },
  { pattern: /\bmajor\b/i, label: "major" },
];
const CURRENTNESS_PATTERNS: LinePattern[] = [
  { pattern: /\brecently\b/i, label: "recently" },
  { pattern: /\blatest\b/i, label: "latest" },
  { pattern: /\bcurrently\b/i, label: "currently" },
  { pattern: /\bas of now\b/i, label: "as of now" },
];

type LinePattern = {
  pattern: RegExp;
  label: string;
};

type ContextDocument = {
  artifact: { path: string };
  lines: string[];
};

type ContextDiagnostic = {
  severity: "warning";
  path: string;
  message: string;
  evidence: {
    path: string;
    startLine: number;
    endLine: number;
    snippet: string;
  };
};

type LineMatch = {
  label: string;
  line: number;
  text: string;
};

export function contextBodyLanguageDiagnostics(
  document: ContextDocument,
): ContextDiagnostic[] {
  const diagnostics: ContextDiagnostic[] = [];
  const vagueMatch = firstBodyLinePatternMatch(
    document,
    VAGUE_WORDING_PATTERNS,
  );
  if (vagueMatch) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: `Shared context asset contains vague wording "${vagueMatch.label}".`,
      evidence: evidence(document, vagueMatch.line, vagueMatch.text),
    });
  }

  const currentnessMatch = firstBodyLinePatternMatch(
    document,
    CURRENTNESS_PATTERNS,
    (line) => !DATED_OR_VERSIONED_CONTEXT_LINE_PATTERN.test(line),
  );
  if (currentnessMatch) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: `Shared context asset contains currentness wording "${currentnessMatch.label}" without an explicit date or version.`,
      evidence: evidence(
        document,
        currentnessMatch.line,
        currentnessMatch.text,
      ),
    });
  }

  return diagnostics;
}

function firstBodyLinePatternMatch(
  document: ContextDocument,
  patterns: LinePattern[],
  shouldInspectLine: (line: string) => boolean = () => true,
): LineMatch | undefined {
  for (const index of markdownBodyLineIndexes(document)) {
    const line = document.lines[index] ?? "";
    if (!line.trim()) continue;
    if (!shouldInspectLine(line)) continue;

    for (const { pattern, label } of patterns) {
      if (!pattern.test(line)) continue;
      return { label, line: index + 1, text: line };
    }
  }

  return undefined;
}

function markdownBodyLineIndexes(document: ContextDocument): number[] {
  const bodyStart = frontmatterEndLine(document);
  return document.lines
    .map((_, index) => index)
    .filter((index) => index >= bodyStart);
}

function frontmatterEndLine(document: ContextDocument): number {
  if (document.lines[0]?.trim() !== "---") return 0;
  const endIndex = document.lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return endIndex < 0 ? 0 : endIndex + 1;
}

function evidence(
  document: ContextDocument,
  line: number,
  snippet: string,
): ContextDiagnostic["evidence"] {
  return {
    path: document.artifact.path,
    startLine: line,
    endLine: line,
    snippet: snippet.trim().slice(0, 240),
  };
}
