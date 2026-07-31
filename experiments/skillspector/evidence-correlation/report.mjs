import { evaluateExperimentEvidence } from "./lib.mjs";

/** Render only statements supported by normalized and scanner-native evidence. */
export function renderExperimentReport({ normalized, rawReport, invocation }) {
  const evaluation = evaluateExperimentEvidence({
    normalized,
    rawReport,
    invocation,
  });
  const firstCorrelated = normalized.evidence.find(
    (item) => item.correlation.status === "correlated",
  );
  const firstUnresolved = normalized.evidence.find(
    (item) => item.correlation.status === "unresolved",
  );
  const firstScript = normalized.evidence.find(
    (item) => item.correlation.asset?.kind === "script",
  );
  const firstSkill = normalized.evidence.find(
    (item) => item.correlation.asset?.kind === "skill",
  );
  const counts = normalized.counts;
  const nativeRisk = rawReport.risk_assessment ?? {};
  const completeness = rawReport.analysis_completeness;
  const analyzerStatusCounts = countBy(
    Array.isArray(completeness?.analyzer_statuses)
      ? completeness.analyzer_statuses.map(
          (status) => status.status ?? "unknown",
        )
      : [],
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

${renderResearchResult(evaluation, counts)}

No result is converted to a Renma diagnostic or used for readiness.

## Invocation context

| Evidence | Value |
| --- | --- |
| Renma CLI revision | \`${invocation.renmaCli?.revision ?? "unknown"}\` |
| Renma CLI executable SHA-256 | \`${invocation.renmaCli?.executableSha256 ?? "unknown"}\` |
| Git HEAD context | \`${invocation.git?.headRevision ?? "unknown"}\` |
| Git worktree state | ${invocation.git?.worktreeState ?? "unknown"} |
| Experiment harness digest | \`${invocation.experimentHarness?.sha256 ?? "unknown"}\` |
| Experiment harness files | ${invocation.experimentHarness?.files?.length ?? 0} hashed file(s) |
| Revision contains exact harness | ${formatFact(invocation.experimentHarness?.revisionContainsExactHarness)} |
| Fixture | \`${normalized.source.fixture.id}\` |
| Fixture scanner target | \`${normalized.source.fixture.scannerTargetPath}\` |
| Scanner | ${normalized.source.scanner.name} ${normalized.source.scanner.version ?? "unknown"} |
| Scanner executable | \`${invocation.scanner?.executable ?? "unknown"}\` |
| Scanner arguments | \`${invocation.scanner?.args?.join(" ") ?? "unknown"}\` |
| Scanner exit | ${formatFact(invocation.scanner?.exitCode)} |
| Renma catalog arguments | \`${invocation.renmaCatalog?.args?.join(" ") ?? "unknown"}\` |
| Raw scanner output | \`${normalized.source.rawOutput.reference}\` |
| Raw scanner SHA-256 | \`${normalized.source.rawOutput.sha256}\` |
| Raw Renma catalog | \`${normalized.source.renmaCatalog.reference}\` |
| Catalog SHA-256 | \`${normalized.source.renmaCatalog.sha256}\` |

Raw artifact references above are relative to
\`${normalized.source.rawOutput.referenceBase}\`. Fixture and harness file
hashes are recorded in \`invocation.json\`. The Git revision is context for the
CLI and worktree; when the worktree is dirty, the harness digest and per-file
hashes—not the revision alone—identify the exact experiment implementation.
The raw report's \`skill.scanned_at\`, scanner-generated finding IDs, absolute
source path, and scanner-wide metadata remain authoritative.

## Scanner-native execution and completeness

| Scanner fact | Reported value |
| --- | --- |
| Top-level execution successful | ${formatFact(rawReport.execution_successful)} |
| Completeness execution successful | ${formatFact(completeness?.execution_successful)} |
| Producer \`is_complete\` | ${formatFact(completeness?.is_complete)} |
| Analyzer statuses | ${formatCounts(analyzerStatusCounts)} |
| Reported limitations | ${Array.isArray(completeness?.limitations) ? completeness.limitations.length : "unknown"} |

These values retain SkillSpector's meaning. Disabled, partial, failed,
skipped, unaccounted, or unknown analyzer work is not reclassified as complete
coverage by the experiment.

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
| Location precision | ${formatCounts(evaluation.observed.locationPrecisions)} |
| Scanner-native assessment | score ${nativeRisk.score ?? "unknown"}, severity ${nativeRisk.severity ?? "unknown"}, recommendation ${nativeRisk.recommendation ?? "unknown"} (opaque) |

The scanner-native assessment is audit context only. Renma does not compare it
with Renma severity or readiness.

## Explicit evidence predicates

| Predicate | Status | Observed |
| --- | --- | --- |
${evaluation.checks
  .map(
    (item) =>
      `| ${escapeTable(item.label)} | ${item.passed ? "satisfied" : "not satisfied"} | ${escapeTable(item.observed)} |`,
  )
  .join("\n")}

## Fixture matrix

| Expected case | Status | Evidence actually observed |
| --- | --- | --- |
${renderFixtureRows(evaluation)}

The matrix reports expectation satisfaction rather than assuming particular
rule IDs, paths, location precision, or duplicate behavior occurred.

## Direct Skill association semantics

\`directSkillAssociations\` has a deliberately narrow meaning:

- a directly matched Skill associates to itself with basis
  \`matched-asset-is-skill\`;
- a matched non-Skill asset associates only through a direct
  \`owns_local_resource\` catalog edge with basis
  \`direct-owns-local-resource-edge\`; and
- no transitive reachability, route membership, or general entrypoint
  association is inferred.

${renderAssociationObservation(firstSkill, "Directly matched Skill")}

${renderAssociationObservation(firstScript, "Directly owned script")}

## Concrete raw evidence

${renderJsonExample(
  rawReport.issues[0],
  "The following object is copied from the authoritative scanner report:",
  "No raw finding was reported, so no raw-finding example is available.",
)}

## Concrete normalized evidence

${renderJsonExample(
  firstCorrelated,
  "This experimental record keeps the native object and labels every derived layer:",
  "No successful correlation was observed, so no correlated normalized example is available.",
)}

## Concrete Renma asset context

${renderJsonExample(
  firstScript?.correlation ?? firstCorrelated?.correlation,
  "The correlation result is exact path evidence from the captured Renma catalog, not scanner policy interpretation:",
  "No correlated Renma asset context was observed.",
)}

## Unresolved evidence example

${renderJsonExample(
  firstUnresolved,
  "No owner, dependency, or policy heuristic is used to force a match:",
  "No unresolved evidence was observed in this input.",
)}

## Duplicate observations

${renderDuplicateObservations(normalized)}

This comparison is intentionally not a stable fingerprint. The experiment
does not merge, suppress, or discard duplicates.

## Information lost or changed during normalization

- No per-finding scanner field is lost: the complete issue object is copied
  unchanged into \`scannerFact.nativeFinding\`, and the full raw report remains
  authoritative.
- Report-wide SkillSpector fields are not duplicated into every evidence
  record. Execution and completeness facts are copied with scanner provenance,
  while the full report remains authoritative.
- The scanner-reported file path is not overwritten. A separate derived
  repository-relative path is added with its normalization explanation.
- A location-precision label is derived from each native location. The
  observed distribution is ${formatCounts(evaluation.observed.locationPrecisions)};
  the label never invents a missing line or range.
- Renma context adds identity, ownership, hashes, direct Skill associations,
  and catalog relationships without changing scanner semantics.

## Scanner-specific fields that remain opaque

${opaqueFields.map((field) => `- \`${field}\``).join("\n")}

In particular, severity labels, confidence numbers, score, and recommendation
retain only SkillSpector's meaning. Another scanner may expose similar-looking
values with incompatible semantics.

## Fields that appeared useful across scanners

- producer name and version with provenance;
- immutable raw-output reference and digest;
- raw finding locator and native payload;
- reported execution, completeness, target, and location facts;
- separately derived repository-relative target;
- correlation status, reason code, and explanation;
- exact Renma asset ID, path, content hash, kind, and ownership; and
- exact catalog relationships and direct Skill associations with explicit
  bases.

These are observations, not a universal schema. A different producer should
not be forced to provide SkillSpector's rule, severity, confidence, or
remediation model.

## Limitations and unresolved questions

- Scanner finding IDs remain opaque raw identifiers; this experiment does not
  establish that they are stable fingerprints.
- Observed location precision is
  ${formatCounts(evaluation.observed.locationPrecisions)}.
- Exact path correlation leaves ${counts.unresolvedCount} finding(s) unresolved
  and ${counts.ambiguousCount} ambiguous; it does not force a match.
- Only one fixture, scanner version, and JSON contract are exercised here.
- Producer \`is_complete\` is ${formatFact(completeness?.is_complete)} and
  ${evaluation.observed.incompleteAnalyzerStatuses.length} analyzer status(es)
  are disabled, partial, failed, skipped, unaccounted, or unknown. Producer
  completeness remains distinct from evidence preservation.
- The experiment does not establish behavior for renamed assets, deleted
  files, symlinks, multiple scan roots, suppressions, or cross-repository
  targets.
- Catalog content hashes identify matched assets, but this input does not
  establish matching producer component hashes for independent verification.

## Implications for a possible future adapter

A future SkillSpector-specific experiment could preserve the native report by
reference, copy native findings losslessly, add path-normalization provenance,
and perform exact catalog correlation. It must keep unresolved and ambiguous
records, raw finding IDs, execution, completeness, and scanner assessment
separate from any later Renma governance interpretation.

This experiment does not justify a generic adapter framework, stable public
schema, severity translation, or scanner-triggered policy.

## Why findings should not affect readiness yet

- Correlation identifies an associated asset; it does not establish a reviewed
  governance rule.
- Duplicate or deliberately controlled findings cannot be consumed as
  readiness facts.
- Producer execution and completeness are independent from preservation and
  correlation.
- Scanner severity, confidence, score, remediation, and recommendation are
  producer policy, not Renma policy.
- No stable finding identity, suppression governance, lifecycle behavior, or
  version-compatibility contract has been demonstrated.

## Conclusion

**${sentenceCase(evaluation.outcome)}.** ${renderConclusionReason(evaluation)}
Future work should exercise report-version changes, suppression, missing
locations, unsafe paths, ambiguous catalog paths, and scanner failures before
any adapter boundary is considered stable.
`;
}

function renderResearchResult(evaluation, counts) {
  const passed = evaluation.checks.filter((item) => item.passed).length;
  if (evaluation.allPredicatesSatisfied) {
    return `All ${evaluation.checks.length} explicit evidence predicates passed. The projection preserved ${counts.rawFindingCount} scanner-native finding(s), correlated ${counts.correlatedCount} by exact repository-relative path, and retained ${counts.unresolvedCount} unresolved finding(s). This supports further scanner-specific prototyping only; it does not establish safety, policy, readiness, or product support.`;
  }
  return `${passed} of ${evaluation.checks.length} explicit evidence predicates passed. The projection preserved ${counts.rawFindingCount} scanner-native finding(s), correlated ${counts.correlatedCount} by exact repository-relative path, and retained ${counts.unresolvedCount} unresolved finding(s), but the failed predicates prevent a positive adapter conclusion. These counts are observed facts, not evidence of complete scanner coverage.`;
}

function renderFixtureRows(evaluation) {
  return evaluation.checks
    .filter(
      (item) =>
        item.id.startsWith("target.") ||
        item.id.startsWith("locations.") ||
        item.id.startsWith("duplicates."),
    )
    .map(
      (item) =>
        `| ${escapeTable(item.label)} | ${item.passed ? "satisfied" : "not satisfied"} | ${escapeTable(item.observed)} |`,
    )
    .join("\n");
}

function renderAssociationObservation(item, label) {
  if (item === undefined) return `- ${label}: not observed.`;
  const associations = item.correlation.directSkillAssociations ?? [];
  if (associations.length === 0) {
    return `- ${label}: evidence ${item.evidenceIndex} had no direct Skill association.`;
  }
  return `- ${label}: evidence ${item.evidenceIndex} associated to ${associations
    .map(
      (association) =>
        `\`${association.skill.id}\` by \`${association.basis}\``,
    )
    .join(", ")}.`;
}

function renderJsonExample(value, presentText, absentText) {
  if (value === undefined) return absentText;
  return `${presentText}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function renderDuplicateObservations(normalized) {
  if (normalized.observations.duplicateGroups.length === 0) {
    return "No duplicate group was observed.";
  }
  return normalized.observations.duplicateGroups
    .map(
      (group) =>
        `- Evidence ${group.evidenceIndexes.join(", ")} have ${group.comparisonBasis}. Raw IDs: ${group.rawFindingIds.map((id) => `\`${id}\``).join(", ")}.`,
    )
    .join("\n");
}

function renderConclusionReason(evaluation) {
  if (evaluation.allPredicatesSatisfied) {
    return "Every explicit fixture, correlation, duplicate, location, execution, and completeness predicate passed. This supports only a non-production scanner-specific prototype.";
  }
  return `The positive threshold was not met because these predicates failed: ${evaluation.failedCheckIds.map((id) => `\`${id}\``).join(", ")}. Observed findings remain useful audit evidence, but they do not justify a positive adapter conclusion.`;
}

function sentenceCase(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
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

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
