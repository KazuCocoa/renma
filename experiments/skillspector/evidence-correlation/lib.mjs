import { createHash } from "node:crypto";
import path from "node:path";

export const experimentalSchemaVersion =
  "renma.experiment.skillspector-evidence.v0";

export const fixtureExpectations = Object.freeze({
  fixtureId: "skillspector-evidence-correlation-v1",
  correlatedTargets: [
    {
      path: "skills/evidence-fixture/SKILL.md",
      kind: "skill",
      minimumFindings: 2,
    },
    {
      path: "skills/evidence-fixture/scripts/probe.py",
      kind: "script",
      minimumFindings: 2,
    },
  ],
  unresolvedTargets: [
    {
      path: "skills/evidence-fixture/README.md",
      minimumFindings: 2,
    },
  ],
  locationPrecision: "start-line-only",
  duplicateGroups: [
    { path: "skills/evidence-fixture/README.md", evidenceCount: 2 },
    { path: "skills/evidence-fixture/SKILL.md", evidenceCount: 2 },
  ],
});

/** Normalize one scanner-reported path without treating backslashes as separators. */
export function normalizeScannerTarget(scannerTargetPath, scannerLocation) {
  const scannerPath = scannerLocation?.file;
  if (typeof scannerPath !== "string" || scannerPath.length === 0) {
    return {
      status: "missing",
      scannerPath: scannerPath ?? null,
      repositoryRelativePath: null,
      explanation: "The scanner finding did not report a target file.",
    };
  }

  if (
    scannerPath.includes("\0") ||
    scannerPath.includes("\\") ||
    path.posix.isAbsolute(scannerPath) ||
    /^[A-Za-z]:/u.test(scannerPath)
  ) {
    return {
      status: "unsafe",
      scannerPath,
      repositoryRelativePath: null,
      explanation:
        "The scanner path is absolute or uses a platform-ambiguous separator and was not normalized.",
    };
  }

  const normalizedScannerPath = path.posix.normalize(scannerPath);
  if (
    normalizedScannerPath === "." ||
    normalizedScannerPath === ".." ||
    normalizedScannerPath.startsWith("../")
  ) {
    return {
      status: "unsafe",
      scannerPath,
      repositoryRelativePath: null,
      explanation:
        "The scanner path is empty after normalization or escapes the scan target.",
    };
  }

  const targetBase =
    scannerTargetPath === "." ? "" : path.posix.normalize(scannerTargetPath);
  if (
    path.posix.isAbsolute(targetBase) ||
    targetBase === ".." ||
    targetBase.startsWith("../") ||
    targetBase.includes("\\")
  ) {
    throw new Error("scannerTargetPath must be repository-relative and safe");
  }

  const repositoryRelativePath = path.posix.normalize(
    path.posix.join(targetBase, normalizedScannerPath),
  );
  if (
    repositoryRelativePath === ".." ||
    repositoryRelativePath.startsWith("../")
  ) {
    return {
      status: "unsafe",
      scannerPath,
      repositoryRelativePath: null,
      explanation: "The normalized target escapes the repository root.",
    };
  }

  return {
    status: "normalized",
    scannerPath,
    repositoryRelativePath,
    explanation:
      scannerPath === repositoryRelativePath && targetBase === ""
        ? "The scanner path was already repository-relative."
        : "The scanner path was normalized relative to the recorded scan target.",
  };
}

export function describeLocationPrecision(location) {
  if (location === null || typeof location !== "object") return "missing";
  const hasFile = typeof location.file === "string" && location.file.length > 0;
  const hasStart = Number.isInteger(location.start_line);
  const hasEnd = Number.isInteger(location.end_line);
  if (!hasFile) return "missing";
  if (hasStart && hasEnd) return "line-range";
  if (hasStart) return "start-line-only";
  return "file-only";
}

/** Correlate only by exact normalized repository-relative asset path. */
export function correlateTarget(target, catalog) {
  if (target.status !== "normalized") {
    return {
      provenance: "experiment-correlation",
      status: "unresolved",
      reasonCode:
        target.status === "missing"
          ? "missing-scanner-target"
          : "unsafe-scanner-target",
      explanation:
        target.status === "missing"
          ? "Correlation was not attempted because no scanner target was reported."
          : "Correlation was not attempted because the scanner target could not be normalized safely.",
      candidates: [],
    };
  }

  const assets = catalog?.catalog?.assets ?? catalog?.assets ?? [];
  const matches = assets.filter(
    (asset) => asset.sourcePath === target.repositoryRelativePath,
  );
  if (matches.length === 0) {
    return {
      provenance: "experiment-correlation",
      status: "unresolved",
      reasonCode: "no-catalog-asset-at-path",
      explanation: `No Renma catalog asset has the exact source path "${target.repositoryRelativePath}".`,
      candidates: [],
    };
  }
  if (matches.length > 1) {
    return {
      provenance: "experiment-correlation",
      status: "ambiguous",
      reasonCode: "multiple-catalog-assets-at-path",
      explanation: `${matches.length} Renma catalog assets have the exact source path "${target.repositoryRelativePath}"; the experiment did not choose one.`,
      candidates: matches.map(projectAsset),
    };
  }

  const asset = matches[0];
  const dependencies =
    catalog?.catalog?.dependencies ?? catalog?.dependencies ?? [];
  const relationships = dependencies
    .filter(
      (dependency) =>
        dependency.from === asset.id || dependency.to === asset.id,
    )
    .map((dependency) => structuredClone(dependency));
  const directSkillAssociations =
    asset.kind === "skill"
      ? [
          {
            basis: "matched-asset-is-skill",
            explanation:
              "The exactly matched asset is itself a Skill entrypoint.",
            skill: projectAsset(asset),
          },
        ]
      : dependencies
          .filter(
            (dependency) =>
              dependency.kind === "owns_local_resource" &&
              dependency.to === asset.id,
          )
          .map((dependency) => ({
            dependency,
            skill: assets.find((candidate) => candidate.id === dependency.from),
          }))
          .filter(({ skill }) => skill?.kind === "skill")
          .map(({ dependency, skill }) => ({
            basis: "direct-owns-local-resource-edge",
            explanation:
              "A direct owns_local_resource catalog edge links the matched asset to this Skill.",
            skill: projectAsset(skill),
            relationship: structuredClone(dependency),
          }));

  return {
    provenance: "experiment-correlation",
    status: "correlated",
    reasonCode: "exact-repository-relative-path",
    explanation: `The normalized target exactly matches Renma asset sourcePath "${asset.sourcePath}".`,
    asset: projectAsset(asset),
    directSkillAssociations,
    relationships,
    candidates: [],
  };
}

/** Build the experimental evidence projection without changing native values. */
export function normalizeEvidence({
  rawReport,
  rawReportText,
  rawOutputReference,
  catalog,
  catalogReference,
  catalogText,
  fixtureId,
  scannerTargetPath = ".",
  scannerName = "SkillSpector",
}) {
  if (!Array.isArray(rawReport?.issues)) {
    throw new Error("SkillSpector report must contain an issues array");
  }
  if (!Array.isArray(catalog?.catalog?.assets ?? catalog?.assets)) {
    throw new Error("Renma catalog must contain an assets array");
  }

  const evidence = rawReport.issues.map((issue, index) => {
    const target = normalizeScannerTarget(scannerTargetPath, issue.location);
    return {
      evidenceIndex: index,
      scannerFact: {
        provenance: "scanner-output",
        rawFindingReference: `${rawOutputReference}#/issues/${index}`,
        nativeFinding: structuredClone(issue),
      },
      normalization: {
        provenance: "experiment-normalization",
        target,
        locationPrecision: describeLocationPrecision(issue.location),
      },
      correlation: correlateTarget(target, catalog),
    };
  });
  const duplicateGroups = observeDuplicates(evidence);

  return {
    experimentalSchemaVersion,
    stability: "experimental-not-a-public-schema",
    boundary: {
      includes: ["scanner facts", "path normalization", "Renma correlation"],
      excludes: [
        "Renma diagnostics",
        "readiness interpretation",
        "policy interpretation",
        "cross-scanner severity comparison",
        "stable finding fingerprints",
      ],
    },
    source: {
      scanner: {
        name: scannerName,
        nameProvenance: "experiment-invocation",
        version: rawReport.metadata?.skillspector_version ?? null,
        versionProvenance: "scanner-output:/metadata/skillspector_version",
        reportedExecution: {
          provenance: "scanner-output",
          executionSuccessful: rawReport.execution_successful ?? null,
          analysisCompleteness:
            rawReport.analysis_completeness === undefined
              ? null
              : structuredClone(rawReport.analysis_completeness),
        },
      },
      fixture: {
        id: fixtureId,
        scannerTargetPath,
      },
      rawOutput: {
        referenceBase: "experiments/skillspector",
        reference: rawOutputReference,
        sha256: sha256(rawReportText),
      },
      renmaCatalog: {
        referenceBase: "experiments/skillspector",
        reference: catalogReference,
        sha256: sha256(catalogText),
      },
    },
    counts: {
      rawFindingCount: rawReport.issues.length,
      normalizedEvidenceCount: evidence.length,
      correlatedCount: evidence.filter(
        (item) => item.correlation.status === "correlated",
      ).length,
      unresolvedCount: evidence.filter(
        (item) => item.correlation.status === "unresolved",
      ).length,
      ambiguousCount: evidence.filter(
        (item) => item.correlation.status === "ambiguous",
      ).length,
      duplicateGroupCount: duplicateGroups.length,
      duplicateEvidenceCount: duplicateGroups.reduce(
        (sum, group) => sum + group.evidenceIndexes.length,
        0,
      ),
    },
    observations: {
      provenance: "experiment-normalization",
      duplicateComparison:
        "Exact equality of scanner-native fields after excluding only finding_id; this is an observation, not a fingerprint.",
      duplicateGroups,
    },
    evidence,
  };
}

/** Evaluate explicit fixture predicates without interpreting scanner policy. */
export function evaluateExperimentEvidence({
  normalized,
  rawReport,
  invocation,
  expectations = fixtureExpectations,
}) {
  const completeness = rawReport.analysis_completeness;
  const analyzerStatusesReported = Array.isArray(
    completeness?.analyzer_statuses,
  );
  const analyzerStatuses = analyzerStatusesReported
    ? completeness.analyzer_statuses
    : [];
  const incompleteAnalyzerStatuses = analyzerStatuses.filter(
    (status) =>
      status.status !== "completed" ||
      status.skipped !== 0 ||
      status.failed !== 0 ||
      status.unaccounted !== 0,
  );
  const correlatedTargets = targetCounts(normalized.evidence, "correlated");
  const unresolvedTargets = targetCounts(normalized.evidence, "unresolved");
  const locationPrecisions = countBy(
    normalized.evidence.map((item) => item.normalization.locationPrecision),
  );
  const duplicateStructures = normalized.observations.duplicateGroups.map(
    (group) => {
      const targetPaths = [
        ...new Set(
          group.evidenceIndexes.map(
            (index) =>
              normalized.evidence[index]?.normalization.target
                .repositoryRelativePath ?? null,
          ),
        ),
      ];
      return {
        targetPaths,
        evidenceCount: group.evidenceIndexes.length,
      };
    },
  );

  const checks = [
    check(
      "fixture.identity",
      "Expected fixture identity",
      normalized.source.fixture.id === expectations.fixtureId,
      normalized.source.fixture.id,
    ),
    check(
      "producer.execution",
      "Producer reported successful execution",
      rawReport.execution_successful === true &&
        completeness?.execution_successful === true &&
        [0, 1].includes(invocation?.scanner?.exitCode),
      `report=${formatFact(rawReport.execution_successful)}, completeness=${formatFact(completeness?.execution_successful)}, exit=${formatFact(invocation?.scanner?.exitCode)}`,
    ),
    check(
      "producer.completeness",
      "Producer reported complete analysis and a non-empty analyzer ledger where every status is completed with zero skipped, failed, and unaccounted work",
      completeness?.is_complete === true &&
        analyzerStatusesReported &&
        analyzerStatuses.length > 0 &&
        incompleteAnalyzerStatuses.length === 0,
      `is_complete=${formatFact(completeness?.is_complete)}, analyzer_statuses=${analyzerStatusesReported ? analyzerStatuses.length : "missing"}, non-complete analyzer statuses=${incompleteAnalyzerStatuses.length}`,
    ),
    check(
      "findings.present",
      "At least one native finding",
      normalized.counts.rawFindingCount > 0,
      normalized.counts.rawFindingCount,
    ),
    check(
      "correlations.present",
      "At least one exact asset correlation",
      normalized.counts.correlatedCount > 0,
      normalized.counts.correlatedCount,
    ),
    ...expectations.correlatedTargets.map((expected) => {
      const matches = correlatedTargets.get(expected.path) ?? [];
      return check(
        `target.correlated:${expected.path}`,
        `Expected correlated ${expected.kind} target ${expected.path}`,
        matches.length >= expected.minimumFindings &&
          matches.every(
            (item) => item.correlation.asset?.kind === expected.kind,
          ),
        `${matches.length} finding(s)`,
      );
    }),
    ...expectations.unresolvedTargets.map((expected) => {
      const matches = unresolvedTargets.get(expected.path) ?? [];
      return check(
        `target.unresolved:${expected.path}`,
        `Expected unresolved target ${expected.path}`,
        matches.length >= expected.minimumFindings,
        `${matches.length} finding(s)`,
      );
    }),
    check(
      "locations.expected-precision",
      `Every finding has ${expectations.locationPrecision} precision`,
      normalized.evidence.length > 0 &&
        Object.keys(locationPrecisions).length === 1 &&
        locationPrecisions[expectations.locationPrecision] ===
          normalized.evidence.length,
      formatCounts(locationPrecisions),
    ),
    check(
      "duplicates.expected-structure",
      "Duplicate observations match the explicit fixture structure",
      duplicateStructures.length === expectations.duplicateGroups.length &&
        expectations.duplicateGroups.every((expected) =>
          duplicateStructures.some(
            (actual) =>
              actual.targetPaths.length === 1 &&
              actual.targetPaths[0] === expected.path &&
              actual.evidenceCount === expected.evidenceCount,
          ),
        ),
      duplicateStructures.length === 0
        ? "none"
        : duplicateStructures
            .map(
              (group) =>
                `${group.targetPaths.join("+") || "missing target"}: ${group.evidenceCount}`,
            )
            .join(", "),
    ),
  ];
  const allPredicatesSatisfied = checks.every((item) => item.passed);

  return {
    expectations: structuredClone(expectations),
    checks,
    allPredicatesSatisfied,
    outcome: allPredicatesSatisfied
      ? "proceed toward a scanner-specific adapter prototype"
      : "run another experiment before defining an adapter boundary",
    failedCheckIds: checks
      .filter((item) => !item.passed)
      .map((item) => item.id),
    observed: {
      locationPrecisions,
      duplicateStructures,
      analyzerStatusesReported,
      analyzerStatusCount: analyzerStatuses.length,
      incompleteAnalyzerStatuses: structuredClone(incompleteAnalyzerStatuses),
    },
  };
}

export function observeDuplicates(evidence) {
  const groups = new Map();
  for (const item of evidence) {
    const nativeFinding = structuredClone(item.scannerFact.nativeFinding);
    delete nativeFinding.finding_id;
    const comparison = JSON.stringify(nativeFinding);
    const group = groups.get(comparison) ?? [];
    group.push(item);
    groups.set(comparison, group);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      evidenceIndexes: group.map((item) => item.evidenceIndex),
      rawFindingIds: group.map(
        (item) => item.scannerFact.nativeFinding.finding_id ?? null,
      ),
      comparisonBasis:
        "same scanner-native fields except scanner-reported finding_id",
    }));
}

export function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function projectAsset(asset) {
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    contentHash: asset.contentHash,
    ownership: structuredClone(asset.ownership),
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function targetCounts(evidence, status) {
  const targets = new Map();
  for (const item of evidence) {
    if (item.correlation.status !== status) continue;
    const target = item.normalization.target.repositoryRelativePath;
    if (target === null) continue;
    const group = targets.get(target) ?? [];
    group.push(item);
    targets.set(target, group);
  }
  return targets;
}

function check(id, label, passed, observed) {
  return { id, label, passed, observed: String(observed) };
}

function formatFact(value) {
  return value === undefined || value === null ? "unknown" : String(value);
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  return entries.length === 0
    ? "none reported"
    : entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}
