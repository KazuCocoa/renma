import type { ArtifactKind } from "./artifact.js";

/** Stable schema identifier for per-artifact security-analysis coverage. */
export const SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION =
  "renma.security-analysis-coverage.v1" as const;

/**
 * Execution state for one security-analysis layer.
 *
 * `not-analyzable` is reserved for a conceptually applicable surface whose
 * source is present but cannot be interpreted deterministically, such as an
 * ambiguous canonical Skill description. Repository read/traversal failures
 * remain `blocked` evidence in repository inspection coverage and do not
 * create synthetic artifact entries here.
 */
export type SecurityAnalysisCoverageState =
  "analyzed" | "not-applicable" | "unsupported" | "blocked" | "not-analyzable";

/** Security-analysis layers Renma can identify deterministically today. */
export interface SecurityAnalysisCoverageAnalyses {
  hiddenUnicode: SecurityAnalysisCoverageState;
  semanticInstructions: SecurityAnalysisCoverageState;
  canonicalDescription: SecurityAnalysisCoverageState;
  yamlFrontmatterComments: SecurityAnalysisCoverageState;
}

/** Counts of concrete surfaces analyzed without conflating absence with failure. */
export interface SecurityAnalysisCoverageSurfaceCounts {
  yamlFrontmatterComments: number;
}

/** Coverage evidence for one artifact already admitted by repository discovery. */
export interface SecurityAnalysisCoverageArtifact {
  path: string;
  kind: ArtifactKind;
  contentClassification: "text" | "binary";
  analyses: SecurityAnalysisCoverageAnalyses;
  surfaceCounts?: SecurityAnalysisCoverageSurfaceCounts;
}

/** Versioned target-state security-analysis coverage evidence. */
export interface SecurityAnalysisCoverage {
  schemaVersion: typeof SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION;
  artifacts: SecurityAnalysisCoverageArtifact[];
}
