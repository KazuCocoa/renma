import type { ScanConfig } from "./types/configuration.js";
import type {
  SuppressionConfig,
  SuppressionExpiration,
} from "./types/diagnostics.js";

export interface CanonicalSuppressionEvidence {
  id: string;
  paths: string[];
  reason: string;
  expires: SuppressionExpiration;
}

/** Raw endpoint source used to evaluate target paths under an archived boundary. */
export interface ScanBoundarySource {
  configPath: string | null;
  globs: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  maxDepth: number;
  suppressions: SuppressionConfig[];
}

/** Canonical, deterministic evidence for one revision-local scan boundary. */
export interface ScanBoundaryEvidence {
  schemaVersion: "renma.scan-boundary.v1";
  configPath: string | null;
  globs: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  maxDepth: number;
  activeSuppressions: CanonicalSuppressionEvidence[];
}

/** CI's fail-closed target coverage model and the exact paths it retained. */
export interface EffectiveCiScanBoundaryEvidence {
  schemaVersion: "renma.ci-evidence-boundary.v1";
  coverageModel: "target_path_endpoint_coverage_union";
  configPath: null;
  globs: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  maxDepth: number;
  activeSuppressions: CanonicalSuppressionEvidence[];
  /** Ordered base (`from`) then target (`to`). */
  sourceBoundaries: ScanBoundaryEvidence[];
  inspectedPaths: string[];
}

export type EffectiveScanBoundaryEvidence =
  ScanBoundaryEvidence | EffectiveCiScanBoundaryEvidence;

export function scanBoundarySource(
  config: ScanConfig,
  configPath?: string,
): ScanBoundarySource {
  return {
    configPath: configPath ?? null,
    globs: [...config.globs],
    exclude: [...config.exclude],
    maxFileSizeBytes: config.maxFileSizeBytes,
    maxDepth: config.maxDepth,
    suppressions: config.suppressions.map(copySuppression),
  };
}

export function canonicalScanBoundary(
  source: ScanBoundarySource,
  today: Date | string = new Date(),
): ScanBoundaryEvidence {
  const todayKey = evaluationDateKey(today);
  return {
    schemaVersion: "renma.scan-boundary.v1",
    configPath: source.configPath,
    globs: normalizedStrings(source.globs),
    exclude: normalizedStrings(source.exclude),
    maxFileSizeBytes: source.maxFileSizeBytes,
    maxDepth: source.maxDepth,
    activeSuppressions: canonicalSuppressions(source.suppressions, todayKey),
  };
}

export function effectiveCiScanBoundary(
  sources: readonly ScanBoundarySource[],
  trustedSuppressions: readonly SuppressionConfig[],
  inspectedPaths: readonly string[],
  today: Date | string = new Date(),
): EffectiveCiScanBoundaryEvidence {
  const canonicalSources = sources.map((source) =>
    canonicalScanBoundary(source, today),
  );
  return {
    schemaVersion: "renma.ci-evidence-boundary.v1",
    coverageModel: "target_path_endpoint_coverage_union",
    configPath: null,
    globs: normalizedStrings(canonicalSources.flatMap((item) => item.globs)),
    // This is the common exact exclusion declaration. Actual coverage is the
    // union of the source predicates above, not a reinterpreted merged glob.
    exclude: commonStrings(canonicalSources.map((item) => item.exclude)),
    maxFileSizeBytes: Math.max(
      ...canonicalSources.map((item) => item.maxFileSizeBytes),
    ),
    maxDepth: Math.max(...canonicalSources.map((item) => item.maxDepth)),
    activeSuppressions: canonicalSuppressions(
      trustedSuppressions,
      evaluationDateKey(today),
    ),
    sourceBoundaries: canonicalSources,
    inspectedPaths: normalizedStrings(inspectedPaths),
  };
}

/** Suppressions trusted on both revisions; reason-only changes remain equivalent. */
export function trustedCiSuppressions(
  from: readonly SuppressionConfig[],
  to: readonly SuppressionConfig[],
  today: Date | string = new Date(),
): SuppressionConfig[] {
  const todayKey = evaluationDateKey(today);
  const targetScopes = new Set(activeSuppressionScopes(to, todayKey).keys());
  return [...activeSuppressionScopes(from, todayKey)]
    .filter(([key]) => targetScopes.has(key))
    .map(([, suppression]) => suppression)
    .sort(compareSuppressionConfigs);
}

export function suppressionIsActive(
  suppression: SuppressionConfig,
  today: Date | string,
): boolean {
  const todayKey = evaluationDateKey(today);
  return (
    suppression.expires === undefined ||
    suppression.expires === "never" ||
    suppression.expires >= todayKey
  );
}

export function suppressionEnforcementKey(
  suppression: SuppressionConfig,
): string {
  return [
    suppression.id,
    normalizedStrings(suppression.paths).join("\0"),
    suppression.expires ?? "never",
  ].join("\0\0");
}

export function evaluationDateKey(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value))
    .toISOString()
    .slice(0, 10);
}

function canonicalSuppressions(
  suppressions: readonly SuppressionConfig[],
  todayKey: string,
): CanonicalSuppressionEvidence[] {
  return suppressions
    .filter((suppression) => suppressionIsActive(suppression, todayKey))
    .map((suppression) => ({
      id: suppression.id,
      paths: normalizedStrings(suppression.paths),
      reason: suppression.reason,
      expires: suppression.expires ?? "never",
    }))
    .sort(compareCanonicalSuppressions);
}

function normalizedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizePattern))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function commonStrings(collections: readonly string[][]): string[] {
  if (collections.length === 0) return [];
  const [first = [], ...rest] = collections;
  return first.filter((value) => rest.every((items) => items.includes(value)));
}

function normalizePattern(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function copySuppression(suppression: SuppressionConfig): SuppressionConfig {
  return {
    id: suppression.id,
    paths: [...suppression.paths],
    reason: suppression.reason,
    ...(suppression.expires === undefined
      ? {}
      : { expires: suppression.expires }),
  };
}

function compareCanonicalSuppressions(
  left: CanonicalSuppressionEvidence,
  right: CanonicalSuppressionEvidence,
): number {
  return (
    left.id.localeCompare(right.id) ||
    left.paths.join("\0").localeCompare(right.paths.join("\0")) ||
    left.expires.localeCompare(right.expires) ||
    left.reason.localeCompare(right.reason)
  );
}

function compareSuppressionConfigs(
  left: SuppressionConfig,
  right: SuppressionConfig,
): number {
  return suppressionEnforcementKey(left).localeCompare(
    suppressionEnforcementKey(right),
  );
}

function activeSuppressionScopes(
  suppressions: readonly SuppressionConfig[],
  todayKey: string,
): Map<string, SuppressionConfig> {
  const scopes = new Map<string, SuppressionConfig>();
  for (const suppression of suppressions) {
    if (!suppressionIsActive(suppression, todayKey)) continue;
    for (const path of normalizedStrings(suppression.paths)) {
      const scoped = {
        id: suppression.id,
        paths: [path],
        reason: suppression.reason,
        ...(suppression.expires === undefined
          ? {}
          : { expires: suppression.expires }),
      };
      scopes.set(suppressionEnforcementKey(scoped), scoped);
    }
  }
  return scopes;
}
