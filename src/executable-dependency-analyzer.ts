import { compareUtf16CodeUnits } from "./canonical-json.js";
import type { Artifact } from "./types/artifact.js";
import type { ParsedDocument } from "./types/metadata.js";
import { collectHelperCommandEvidence } from "./helper-command-evidence.js";
import { hasSupportedHelperExtension } from "./helper-command-evidence.js";
import { JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER } from "./executable-dependency-js-ts.js";
import { PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER } from "./executable-dependency-python.js";
import { SHELL_EXECUTABLE_DEPENDENCY_ANALYZER } from "./executable-dependency-shell.js";
import { POWERSHELL_EXECUTABLE_DEPENDENCY_ANALYZER } from "./executable-dependency-powershell.js";
import { BATCH_EXECUTABLE_DEPENDENCY_ANALYZER } from "./executable-dependency-batch.js";

export type BuiltInExecutableDependencyAnalyzerId =
  "js-ts" | "python" | "shell" | "powershell" | "batch";

export type ExecutableDependencyRelation =
  "static-execution" | "static-import" | "static-reexport" | "static-source";

export interface ExecutableDependencyCandidate {
  analyzer: BuiltInExecutableDependencyAnalyzerId;
  sourcePath: string;
  declarationOffset: number;
  line: number;
  snippet: string;
  relation: ExecutableDependencyRelation;
  rawSpecifier: string;
  normalizedTargetCandidates: string[];
  unsafe: boolean;
}

export interface ExecutableDependencyAnalyzer {
  readonly id: BuiltInExecutableDependencyAnalyzerId;
  supports(input: {
    path: string;
    contentClassification: "text" | "binary";
  }): boolean;
  collect(input: {
    path: string;
    content: string;
  }): ExecutableDependencyCandidate[];
}

/** Fixed private registry; package exports intentionally do not expose it. */
export const BUILT_IN_EXECUTABLE_DEPENDENCY_ANALYZERS: readonly ExecutableDependencyAnalyzer[] =
  Object.freeze([
    JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER,
    PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER,
    SHELL_EXECUTABLE_DEPENDENCY_ANALYZER,
    POWERSHELL_EXECUTABLE_DEPENDENCY_ANALYZER,
    BATCH_EXECUTABLE_DEPENDENCY_ANALYZER,
  ]);

/** Identify the existing inventory surface candidates before path-state resolution. */
export function executableSurfaceArtifacts(
  artifacts: readonly Artifact[],
  documents: readonly ParsedDocument[],
  explicitlyReferencedPaths: ReadonlySet<string> = new Set(),
): Artifact[] {
  const artifactsByPath = new Map(
    artifacts.map((artifact) => [artifact.path, artifact]),
  );
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    if (
      artifact.kind === "script" ||
      (artifact.path.startsWith("tools/") &&
        hasSupportedHelperExtension(artifact.path))
    ) {
      paths.add(artifact.path);
    }
  }
  for (const evidence of collectHelperCommandEvidence(documents)) {
    if (evidence.pathResolution.kind !== "candidate") continue;
    if (artifactsByPath.has(evidence.pathResolution.path)) {
      paths.add(evidence.pathResolution.path);
    }
  }
  for (const artifactPath of explicitlyReferencedPaths) {
    if (
      hasSupportedHelperExtension(artifactPath) &&
      artifactsByPath.has(artifactPath)
    ) {
      paths.add(artifactPath);
    }
  }
  return [...paths]
    .sort((left, right) => compareUtf16CodeUnits(left, right))
    .flatMap((artifactPath) => {
      const artifact = artifactsByPath.get(artifactPath);
      return artifact ? [artifact] : [];
    });
}

/** Run every built-in analyzer once over eligible text executable surfaces. */
export function collectExecutableDependencyCandidates(
  artifacts: readonly Artifact[],
  documents: readonly ParsedDocument[],
  explicitlyReferencedPaths: ReadonlySet<string> = new Set(),
): ExecutableDependencyCandidate[] {
  const occurrences = new Map<string, ExecutableDependencyCandidate>();
  for (const artifact of executableSurfaceArtifacts(
    artifacts,
    documents,
    explicitlyReferencedPaths,
  )) {
    for (const analyzer of BUILT_IN_EXECUTABLE_DEPENDENCY_ANALYZERS) {
      if (
        !analyzer.supports({
          path: artifact.path,
          contentClassification: artifact.contentClassification,
        })
      ) {
        continue;
      }
      for (const candidate of analyzer.collect({
        path: artifact.path,
        content: artifact.content,
      })) {
        const key = executableDependencyCandidateOccurrenceKey(candidate);
        if (!occurrences.has(key)) occurrences.set(key, candidate);
      }
    }
  }
  return [...occurrences.values()].sort(compareDependencyCandidates);
}

/** Private syntactic-occurrence identity shared with dependency preparation. */
export function executableDependencyCandidateOccurrenceKey(
  candidate: ExecutableDependencyCandidate,
): string {
  return JSON.stringify([
    candidate.sourcePath,
    candidate.declarationOffset,
    candidate.relation,
    candidate.rawSpecifier,
    candidate.normalizedTargetCandidates,
    candidate.unsafe,
  ]);
}

function compareDependencyCandidates(
  left: ExecutableDependencyCandidate,
  right: ExecutableDependencyCandidate,
): number {
  return (
    compareUtf16CodeUnits(left.sourcePath, right.sourcePath) ||
    left.line - right.line ||
    compareUtf16CodeUnits(left.analyzer, right.analyzer) ||
    compareUtf16CodeUnits(left.relation, right.relation) ||
    compareUtf16CodeUnits(
      left.normalizedTargetCandidates.join("\0"),
      right.normalizedTargetCandidates.join("\0"),
    ) ||
    compareUtf16CodeUnits(left.rawSpecifier, right.rawSpecifier) ||
    left.declarationOffset - right.declarationOffset
  );
}
