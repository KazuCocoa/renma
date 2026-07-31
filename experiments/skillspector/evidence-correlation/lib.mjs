import { createHash } from "node:crypto";
import path from "node:path";

export const experimentalSchemaVersion =
  "renma.experiment.skillspector-evidence.v0";

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
  const entrypoints = dependencies
    .filter(
      (dependency) =>
        dependency.kind === "owns_local_resource" && dependency.to === asset.id,
    )
    .map((dependency) =>
      assets.find((candidate) => candidate.id === dependency.from),
    )
    .filter((candidate) => candidate?.kind === "skill")
    .map(projectAsset);

  return {
    provenance: "experiment-correlation",
    status: "correlated",
    reasonCode: "exact-repository-relative-path",
    explanation: `The normalized target exactly matches Renma asset sourcePath "${asset.sourcePath}".`,
    asset: projectAsset(asset),
    associatedEntrypoints: entrypoints,
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

export function renderExperimentReport({
  normalized,
  rawReport,
  catalog,
  invocation,
}) {
  const firstCorrelated = normalized.evidence.find(
    (item) => item.correlation.status === "correlated",
  );
  const firstUnresolved = normalized.evidence.find(
    (item) => item.correlation.status === "unresolved",
  );
  const firstScript = normalized.evidence.find(
    (item) => item.correlation.asset?.kind === "script",
  );
  const counts = normalized.counts;
  const nativeRisk = rawReport.risk_assessment ?? {};
  const locationCounts = countBy(
    normalized.evidence.map((item) => item.normalization.locationPrecision),
  );
  const opaqueFields = [
    "risk_assessment.score/severity/recommendation",
    "issue category and pattern",
    "scanner-native severity and confidence",
    "explanation and remediation",
    "intent and tags",
    "filtering_mode",
    "analysis_completeness and analyzer statuses",
  ];

  return `# Experimental SkillSpector Evidence Correlation Report

> Experimental only. This report is not a Renma product capability, public
> schema, native diagnostic source, readiness input, or CI policy.

## Research question and result

Can Renma preserve external scanner evidence as auditable facts and correlate
it with governed assets without treating the scanner's conclusions as native
Renma diagnostics?

For this fixture, **yes at the fact-and-correlation layers**. All
${counts.rawFindingCount} scanner findings remain present as scanner-native
objects, ${counts.correlatedCount} correlate to exactly one Renma asset by an
exact repository-relative path, and ${counts.unresolvedCount} remain visible as
unresolved evidence. No result is converted to a Renma diagnostic or used for
readiness.

## Invocation context

| Evidence | Value |
| --- | --- |
| Renma revision | \`${invocation.renmaRevision ?? "unknown"}\` |
| Fixture | \`${normalized.source.fixture.id}\` |
| Fixture scanner target | \`${normalized.source.fixture.scannerTargetPath}\` |
| Scanner | ${normalized.source.scanner.name} ${normalized.source.scanner.version ?? "unknown"} |
| Scanner executable | \`${invocation.scanner.executable}\` |
| Scanner arguments | \`${invocation.scanner.args.join(" ")}\` |
| Scanner exit | ${invocation.scanner.exitCode} |
| Renma catalog arguments | \`${invocation.renmaCatalog.args.join(" ")}\` |
| Raw scanner output | \`${normalized.source.rawOutput.reference}\` |
| Raw scanner SHA-256 | \`${normalized.source.rawOutput.sha256}\` |
| Raw Renma catalog | \`${normalized.source.renmaCatalog.reference}\` |
| Catalog SHA-256 | \`${normalized.source.renmaCatalog.sha256}\` |

Raw artifact references above are relative to
\`${normalized.source.rawOutput.referenceBase}\`. The fixture file hashes are
recorded in \`invocation.json\`. The raw report's
\`skill.scanned_at\`, scanner-generated finding IDs, absolute source path, and
all scanner-wide metadata are preserved rather than made reproducible-looking.
The same scanner version and fixture can reproduce the analysis, but byte-for-
byte raw output is not expected because SkillSpector emits a timestamp and
run-specific finding IDs.

## Results

| Observation | Count or value |
| --- | --- |
| Raw findings | ${counts.rawFindingCount} |
| Normalized evidence records | ${counts.normalizedEvidenceCount} |
| Exact asset correlations | ${counts.correlatedCount} |
| Unresolved correlations | ${counts.unresolvedCount} |
| Ambiguous correlations | ${counts.ambiguousCount} |
| Duplicate groups | ${counts.duplicateGroupCount} |
| Evidence records in duplicate groups | ${counts.duplicateEvidenceCount} |
| Location precision | ${Object.entries(locationCounts)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ")} |
| Scanner-native assessment | score ${nativeRisk.score ?? "unknown"}, severity ${nativeRisk.severity ?? "unknown"}, recommendation ${nativeRisk.recommendation ?? "unknown"} (opaque) |

The scanner-native assessment is reported only for audit context. Renma does
not compare it with Renma severity or readiness.

## Fixture matrix

| Required case | Concrete evidence |
| --- | --- |
| Direct asset mapping | Findings on \`SKILL.md\` normalize to \`skills/evidence-fixture/SKILL.md\` and exactly match the governed Skill asset. |
| Multiple findings on one asset | Duplicate AS3 findings remain separate on the Skill; LP1 capability findings remain separate on the script. |
| Referenced executable | ${firstScript ? `Evidence ${firstScript.evidenceIndex} correlates to \`${firstScript.correlation.asset.id}\`; exact \`owns_local_resource\` and \`statically_references\` edges are retained.` : "No correlated script finding was observed."} |
| Outside governed assets | Findings on \`README.md\` normalize inside the Skill directory, have no exact catalog asset, and remain unresolved. |
| No precise range | SkillSpector reported only a start line for every observed finding; each native \`end_line\` is null and the derived precision is \`start-line-only\`. |
| Duplicate findings | ${counts.duplicateGroupCount} group(s) compare equal after excluding only scanner-generated \`finding_id\`; every raw ID and record is preserved. |
| Native severity/confidence | Native values remain inside each unchanged \`nativeFinding\`; no common severity scale is created. |

## Concrete raw evidence

The following object is copied from the authoritative scanner report:

\`\`\`json
${JSON.stringify(rawReport.issues[0] ?? null, null, 2)}
\`\`\`

## Concrete normalized evidence

This experimental record keeps the native object and labels every derived
layer:

\`\`\`json
${JSON.stringify(firstCorrelated ?? null, null, 2)}
\`\`\`

## Concrete Renma asset context

The correlation result is exact path evidence from the captured Renma catalog,
not scanner policy interpretation:

\`\`\`json
${JSON.stringify(firstScript?.correlation ?? firstCorrelated?.correlation ?? null, null, 2)}
\`\`\`

## Unresolved evidence example

No owner, dependency, or policy heuristic is used to force a match:

\`\`\`json
${JSON.stringify(firstUnresolved ?? null, null, 2)}
\`\`\`

## Duplicate observations

${
  normalized.observations.duplicateGroups.length === 0
    ? "No duplicate group was observed."
    : normalized.observations.duplicateGroups
        .map(
          (group) =>
            `- Evidence ${group.evidenceIndexes.join(", ")} have ${group.comparisonBasis}. Raw IDs: ${group.rawFindingIds.map((id) => `\`${id}\``).join(", ")}.`,
        )
        .join("\n")
}

This comparison is intentionally not a stable fingerprint. The experiment
does not merge, suppress, or discard duplicates.

## Information lost or changed during normalization

- No per-finding scanner field is lost: the complete issue object is copied
  unchanged into \`scannerFact.nativeFinding\`, and the full raw report remains
  authoritative.
- Report-wide SkillSpector fields are not duplicated into every evidence
  record. They remain in the referenced raw output.
- The scanner-reported file path is not overwritten. A separate derived
  repository-relative path is added with its normalization explanation.
- A location-precision label is derived from the native location. Here,
  \`end_line: null\` remains visible; the label does not invent an end line.
- Renma context is projected from the captured catalog. It adds identity,
  ownership, hashes, exact entrypoint relationships, and dependencies without
  changing scanner semantics.

## Scanner-specific fields that remain opaque

${opaqueFields.map((field) => `- \`${field}\``).join("\n")}

In particular, \`LOW\`, \`MEDIUM\`, \`HIGH\`, confidence numbers, score, and
recommendation retain only SkillSpector's meaning. Another scanner may expose
similar-looking values with incompatible semantics.

## Fields that appeared useful across scanners

- producer name and version with provenance;
- immutable raw-output reference and digest;
- raw finding locator and native payload;
- reported target and location, including missing precision;
- separately derived repository-relative target;
- correlation status, reason code, and human-readable explanation;
- exact Renma asset ID, path, content hash, kind, and ownership;
- exact catalog relationships and associated Skill entrypoints.

These are observations, not a universal schema. A different producer should
not be forced to provide SkillSpector's rule, severity, confidence, or
remediation model.

## Limitations and unresolved questions

- SkillSpector 2.5.0 generated run-specific finding IDs, so they are raw
  identifiers rather than stable fingerprints.
- The scanner did not report complete source ranges for these findings.
- Exact path correlation cannot bind excluded files such as this fixture's
  README, even though the scanner inspected them.
- Only one fixture, scanner version, and JSON contract are exercised here.
- The observed static-only run intentionally disables semantic analyzers, and
  producer completeness remains distinct from evidence preservation.
- The experiment does not establish how renamed assets, deleted files,
  symlinks, multiple scan roots, suppressed findings, or cross-repository
  targets should bind.
- Catalog content hashes help identify matched assets, but SkillSpector does
  not report matching per-component hashes for independent verification.

## Implications for a possible future adapter

A future SkillSpector-specific adapter could preserve the native report by
reference, copy native findings losslessly, add explicit path-normalization
provenance, and perform exact catalog correlation. It should keep unresolved
and ambiguous records, treat raw finding IDs as opaque, and keep scanner
assessment separate from any later Renma governance interpretation.

This experiment does not justify a generic adapter framework, stable public
schema, severity translation, or scanner-triggered policy. More versions and
failure modes should be tested inside a scanner-specific prototype before any
public boundary is proposed.

## Why findings should not affect readiness yet

- Correlation answers which asset is associated; it does not establish a
  reviewed governance rule.
- The fixture includes duplicate and deliberately false-positive-candidate
  findings, so counts and severity cannot be consumed as readiness facts.
- Static-only completeness is not equivalent to a complete review profile.
- Scanner severity, confidence, score, remediation, and recommendation are
  producer policy, not Renma policy.
- No stable finding identity, suppression governance, lifecycle behavior, or
  version-compatibility contract has been demonstrated.

## Conclusion

**Proceed toward a scanner-specific adapter prototype.** The evidence shows
that lossless native finding preservation and exact Renma asset correlation
can coexist without creating native Renma diagnostics. The prototype should
remain non-production and should next exercise report-version changes,
suppression, missing locations, unsafe paths, ambiguous catalog paths, and
scanner failures before any adapter boundary is considered stable.
`;
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
