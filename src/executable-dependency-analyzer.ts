import type { Artifact } from "./types/artifact.js";
import type { ParsedDocument } from "./types/metadata.js";
import { collectHelperCommandEvidence } from "./helper-command-evidence.js";
import { hasSupportedHelperExtension } from "./helper-command-evidence.js";
import { JS_TS_EXECUTABLE_DEPENDENCY_ANALYZER } from "./executable-dependency-js-ts.js";
import { PYTHON_EXECUTABLE_DEPENDENCY_ANALYZER } from "./executable-dependency-python.js";

export type BuiltInExecutableDependencyAnalyzerId = "js-ts" | "python";

export type ExecutableDependencyRelation = "static-import" | "static-reexport";

export interface ExecutableDependencyCandidate {
  analyzer: BuiltInExecutableDependencyAnalyzerId;
  sourcePath: string;
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
  ]);

/** Identify the existing inventory surface candidates before path-state resolution. */
export function executableSurfaceArtifacts(
  artifacts: readonly Artifact[],
  documents: readonly ParsedDocument[],
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
  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((artifactPath) => {
      const artifact = artifactsByPath.get(artifactPath);
      return artifact ? [artifact] : [];
    });
}

/** Run every built-in analyzer once over eligible text executable surfaces. */
export function collectExecutableDependencyCandidates(
  artifacts: readonly Artifact[],
  documents: readonly ParsedDocument[],
): ExecutableDependencyCandidate[] {
  const deduplicated = new Map<string, ExecutableDependencyCandidate>();
  for (const artifact of executableSurfaceArtifacts(artifacts, documents)) {
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
        deduplicated.set(JSON.stringify(candidate), candidate);
      }
    }
  }
  return [...deduplicated.values()].sort(compareDependencyCandidates);
}

function compareDependencyCandidates(
  left: ExecutableDependencyCandidate,
  right: ExecutableDependencyCandidate,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.line - right.line ||
    left.analyzer.localeCompare(right.analyzer) ||
    left.relation.localeCompare(right.relation) ||
    left.normalizedTargetCandidates
      .join("\0")
      .localeCompare(right.normalizedTargetCandidates.join("\0")) ||
    left.rawSpecifier.localeCompare(right.rawSpecifier)
  );
}
