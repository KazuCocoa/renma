import { evaluateExecutableExperiment } from "./lib.mjs";

/** Render statements only from scanner, catalog, graph, and invocation inputs. */
export function renderExecutableExperimentReport({
  normalized,
  rawReport,
  invocation,
}) {
  const evaluation = evaluateExecutableExperiment({
    normalized,
    rawReport,
    invocation,
  });
  const counts = normalized.counts;
  const completeness = rawReport.analysis_completeness;
  const analyzerCounts = countBy(
    Array.isArray(completeness?.analyzer_statuses)
      ? completeness.analyzer_statuses.map((item) => item.status ?? "unknown")
      : [],
  );
  const direct = observedCase(evaluation, "direct-skill-invocation");
  const shared = observedCase(evaluation, "shared-skill-invocation");
  const contained = observedCase(
    evaluation,
    "independent-structural-containment",
  );
  const script = observedCase(evaluation, "direct-script-invocation");
  const firstConcrete = normalized.evidence.find(
    (item) => item.executableContext.status === "correlated",
  );
  const firstUnresolved = normalized.evidence.find(
    (item) => item.executableContext.status === "unresolved",
  );
  const passed = evaluation.checks.filter((item) => item.passed).length;

  return `# SkillSpector Executable Relationship Correlation Report

> Experiment only. This report is not a Renma command, public schema, native
> diagnostic source, readiness input, CI policy, ownership claim, impact
> analysis, or scanner-reviewed scope.

## Research question and narrow result

When a scanner-native finding correlates exactly to a repository script, can an
experiment use Renma's public executable graph to show which Skills or scripts
directly invoke that script while keeping invocation, structural containment,
ownership, and scanner assessment semantically separate?

${renderNarrowResult(evaluation, passed)}

## Invocation and provenance evidence

| Evidence | Observed value |
| --- | --- |
| Fixture | \`${normalized.source.fixture.id}\` |
| Fixture scanner target | \`${normalized.source.fixture.scannerTargetPath}\` |
| Scanner | ${normalized.source.scanner.name} ${normalized.source.scanner.version ?? "unknown"} |
| Scanner executable | \`${invocation.scanner?.executable ?? "unknown"}\` |
| Scanner version probe | \`${escapeTable(invocation.scanner?.versionProbeOutput ?? "unknown")}\` |
| Scanner arguments | \`${escapeTable(invocation.scanner?.args?.join(" ") ?? "unknown")}\` |
| Scanner exit | ${formatFact(invocation.scanner?.exitCode)} |
| Renma version | ${invocation.renmaCli?.version ?? "unknown"} |
| Renma CLI revision | \`${invocation.renmaCli?.revision ?? "unknown"}\` |
| Renma executable SHA-256 | \`${invocation.renmaCli?.executableSha256 ?? "unknown"}\` |
| Catalog invocation | \`${escapeTable(invocation.renmaCatalog?.args?.join(" ") ?? "unknown")}\` |
| Catalog exit | ${formatFact(invocation.renmaCatalog?.exitCode)} |
| Catalog stderr | ${formatStderr(invocation.renmaCatalog?.stderr)} |
| Executable graph invocation | \`${escapeTable(invocation.renmaExecutableGraph?.args?.join(" ") ?? "unknown")}\` |
| First executable graph exit | ${formatFact(invocation.renmaExecutableGraph?.firstInvocation?.exitCode)} |
| First executable graph stderr | ${formatStderr(invocation.renmaExecutableGraph?.firstInvocation?.stderr)} |
| Repeated executable graph exit | ${formatFact(invocation.renmaExecutableGraph?.repeatedInvocation?.exitCode)} |
| Repeated executable graph stderr | ${formatStderr(invocation.renmaExecutableGraph?.repeatedInvocation?.stderr)} |
| Repeated graph output byte-identical | ${formatFact(invocation.renmaExecutableGraph?.repeatedInvocation?.stdoutByteIdenticalToFirst)} |
| Git HEAD context | \`${invocation.git?.headRevision ?? "unknown"}\` |
| Git worktree state | ${invocation.git?.worktreeState ?? "unknown"} |
| Exact harness digest | \`${invocation.experimentHarness?.sha256 ?? "unknown"}\` |
| Exact harness files | ${invocation.experimentHarness?.files?.length ?? 0} |
| Revision contains exact harness | ${formatFact(invocation.experimentHarness?.revisionContainsExactHarness)} |
| Exact fixture files | ${invocation.fixture?.files?.length ?? 0} |

Scanner invocation, catalog invocation, and executable-graph invocation are
recorded as separate arrays in \`invocation.json\`. Git revision is only CLI and
worktree context; exact fixture and harness hashes qualify a dirty worktree.

## Independent raw artifacts and digests

| Source | Reference | SHA-256 |
| --- | --- | --- |
| SkillSpector JSON | \`${normalized.source.rawOutput.reference}\` | \`${normalized.source.rawOutput.sha256}\` |
| Renma catalog JSON | \`${normalized.source.renmaCatalog.reference}\` | \`${normalized.source.renmaCatalog.sha256}\` |
| Renma executable graph JSON | \`${normalized.source.renmaExecutableGraph.reference}\` | \`${normalized.source.renmaExecutableGraph.sha256}\` |

The raw scanner report remains authoritative for scanner-native facts. The
catalog and executable graph remain independent public Renma CLI artifacts;
the projection does not merge either into a new authoritative source.

## Producer-native execution and completeness

| Scanner fact | Reported value |
| --- | --- |
| Top-level execution successful | ${formatFact(rawReport.execution_successful)} |
| Completeness execution successful | ${formatFact(completeness?.execution_successful)} |
| Producer \`is_complete\` | ${formatFact(completeness?.is_complete)} |
| Analyzer statuses | ${formatCounts(analyzerCounts)} |
| Non-complete analyzer entries | ${evaluation.producerCompleteness.nonCompleteAnalyzerCount} |
| Native completeness evidence | ${evaluation.producerCompleteness.status} |
| Reported limitations | ${Array.isArray(completeness?.limitations) ? completeness.limitations.length : "unknown"} |

${renderProducerCompletenessInterpretation(evaluation)} Executable relationship
enrichment has a separate decision gate and does not weaken or manufacture
producer-native completeness.

## Exact fixture expectation matrix

| Case | Scanner target | Findings | Direct Skill invokers | Direct script invokers | Structural containers | Context status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
${evaluation.caseObservations.map(renderCaseRow).join("\n")}

Expectations are predicates over observed target paths and relationship
structure. They do not depend on a particular SkillSpector rule ID.

## Correlation and relationship counts

| Observation | Count |
| --- | ---: |
| Raw scanner findings | ${counts.rawFindingCount} |
| Normalized evidence records | ${counts.normalizedEvidenceCount} |
| Exact catalog asset correlations | ${counts.correlatedCount} |
| Unresolved catalog correlations | ${counts.unresolvedCount} |
| Ambiguous catalog correlations | ${counts.ambiguousCount} |
| Exact executable-node correlations | ${counts.executableCorrelatedCount} |
| Unresolved executable contexts | ${counts.executableUnresolvedCount} |
| Ambiguous executable contexts | ${counts.executableAmbiguousCount} |
| Inconclusive executable contexts | ${counts.executableInconclusiveCount} |
| Duplicate groups | ${counts.duplicateGroupCount} |
| Evidence records in duplicate groups | ${counts.duplicateEvidenceCount} |

Relationship counts in the matrix are distinct canonical incoming edges per
target. Duplicate scanner evidence remains separate and may reference the same
context without multiplying the graph relationship.

## Shared-script example

${renderRelationshipExample(shared, "directSkillInvokers")}

This is direct shared use observed in canonical \`invokes\` edges. It is not
shared ownership or exclusive belonging.

## Containment versus invocation example

${renderRelationshipExample(contained, "directSkillInvokers")}

${renderRelationshipExample(contained, "structuralContainers")}

\`contains\` and \`invokes\` retain different basis labels and original edge
directions. Neither relationship is derived from the other.

## Script-to-script example

${renderRelationshipExample(script, "directScriptInvokers")}

The target has ${script?.directSkillInvokers.length ?? 0} direct Skill invoker(s).
The experiment does not traverse from the calling script to a Skill.

## One-Skill direct invocation example

${renderRelationshipExample(direct, "directSkillInvokers")}

## Unresolved evidence example

${renderJson(
  firstUnresolved,
  "The exact normalized scanner target has no catalog asset, so graph correlation remains unresolved without basename, directory, containment, or ownership heuristics.",
  "No unresolved evidence was observed.",
)}

## Duplicate preservation

${renderDuplicates(normalized)}

Duplicates are observations, not stable fingerprints. They are not merged,
suppressed, or converted into graph-edge counts.

## Concrete native finding and complete derived context

${renderJson(
  firstConcrete?.scannerFact.nativeFinding,
  "The complete object below is copied unchanged from the authoritative scanner output:",
  "No scanner-native finding correlated to an executable node.",
)}

${renderJson(
  firstConcrete,
  "The corresponding experimental record preserves the native object and adds separately labeled normalization, catalog correlation, and executable context layers:",
  "No complete derived executable context is available.",
)}

## Information added by executable correlation

- exact identity and role of the one graph node matched by repository-relative
  \`sourcePath\`;
- exact canonical incoming Skill-to-script \`invokes\` edges;
- exact canonical incoming script-to-script \`invokes\` edges;
- exact canonical incoming Skill-to-script \`contains\` edges;
- original edge direction, source and target node identity and role, narrow
  basis, and experiment provenance; and
- an explicit consistency check between \`invokedBySkillCount\` and distinct
  direct Skill edge identities, without using the count to invent identities.

## Information that remains unknown

- whether any invocation executes at runtime or reaches the scanner target;
- transitive callers, blast radius, impact, affected Skills, or review coverage;
- ownership, exclusive belonging, or responsibility for the matched script;
- whether SkillSpector inspected any related Skill rather than the reported
  target file;
- whether the finding is correct, exploitable, suppressed, or resolved;
- producer completeness beyond the native ledger; and
- adapter compatibility, stable field contracts, readiness, safety, or policy
  satisfaction.

## Why the relationships have narrow semantics

An incoming \`invokes\` edge records a direct canonical executable
relationship exposed by Renma. An incoming \`contains\` edge records structural
placement below one Skill's canonical scripts boundary. Neither is ownership,
runtime evidence, transitive impact, confirmed affected scope, scanner review
coverage, requirement satisfaction, or a Renma \`SEC-*\` finding. The experiment
does not reinterpret scanner severity, confidence, explanation, remediation,
risk score, or recommendation.

## Decision gates and conclusion

| Gate | Result |
| --- | --- |
| Executable relationship experiment | **${evaluation.conclusions.executableRelationshipExperiment}** (${passed}/${evaluation.checks.length} predicates) |
| Adapter-boundary readiness | **${evaluation.conclusions.adapterBoundaryReadiness}** — ${escapeTable(evaluation.conclusions.adapterBoundaryBlockers.join("; "))} |

${renderFailedChecks(evaluation)}

${renderConclusion(evaluation, counts)}
`;
}

function renderNarrowResult(evaluation, passed) {
  if (evaluation.allPredicatesSatisfied) {
    return `All ${evaluation.checks.length} executable relationship predicates were satisfied. Direct Skill invokers, direct script invokers, structural containers, unresolved targets, duplicate evidence, and count consistency were observed without merging their meanings. Adapter readiness remains separately blocked by ${evaluation.conclusions.adapterBoundaryBlockers.join(" and ")}.`;
  }
  return `${passed} of ${evaluation.checks.length} executable relationship predicates were satisfied. Failed predicates keep the narrow result inconclusive; producer-native findings and unresolved records are still preserved.`;
}

function renderProducerCompletenessInterpretation(evaluation) {
  if (evaluation.producerCompleteness.satisfiesNativeCompletenessEvidence) {
    return "This input reports complete native analysis with a non-empty all-completed analyzer ledger and zero skipped, failed, or unaccounted work. Producer completeness is therefore not an adapter-readiness blocker for this input; unresolved producer-contract gaps remain blocking.";
  }
  return "This input does not establish complete native analysis. Disabled, partial, failed, skipped, unaccounted, missing, or unknown analyzer work remains a producer-completeness blocker and is not reclassified as complete.";
}

function renderCaseRow({ expected, observed }) {
  return `| ${expected.id} | \`${expected.path}\` | ${observed.findingCount} (expected ${renderExpectation({ minimum: expected.minimumFindings })}) | ${observed.directSkillInvokers.length} (expected ${renderExpectation(expected.directSkillInvokers)}) | ${observed.directScriptInvokers.length} (expected ${renderExpectation(expected.directScriptInvokers)}) | ${observed.structuralContainers.length} (expected ${renderExpectation(expected.structuralContainers)}) | ${escapeTable(formatCounts(observed.statusCounts))} |`;
}

function renderExpectation(expectation) {
  return expectation.exact === undefined
    ? `>= ${expectation.minimum}`
    : String(expectation.exact);
}

function renderRelationshipExample(observation, field) {
  const values = observation?.[field] ?? [];
  if (values.length === 0) return `No ${field} relationship was observed.`;
  return values
    .map(
      (item) =>
        `- \`${item.direction.source.id}\` (${item.direction.source.role}) --\`${item.edge.kind}\`--> \`${item.direction.target.id}\` (${item.direction.target.role}); basis \`${item.basis}\`; provenance \`${item.provenance}\`.`,
    )
    .join("\n");
}

function renderDuplicates(normalized) {
  if (normalized.observations.duplicateGroups.length === 0) {
    return "No duplicate group was observed.";
  }
  return normalized.observations.duplicateGroups
    .map((group) => {
      const targetPaths = [
        ...new Set(
          group.evidenceIndexes.map(
            (index) =>
              normalized.evidence[index]?.normalization.target
                .repositoryRelativePath ?? "missing",
          ),
        ),
      ];
      return `- Evidence ${group.evidenceIndexes.join(", ")} remain separate for \`${targetPaths.join("`, `")}\`; native IDs ${group.rawFindingIds.map((id) => `\`${id}\``).join(", ")}.`;
    })
    .join("\n");
}

function renderFailedChecks(evaluation) {
  if (evaluation.failedCheckIds.length === 0) {
    return "Every executable relationship predicate passed. This does not alter the separate adapter-readiness gate.";
  }
  return `Failed executable predicates: ${evaluation.failedCheckIds.map((id) => `\`${id}\``).join(", ")}.`;
}

function renderConclusion(evaluation, counts) {
  if (!evaluation.allPredicatesSatisfied) {
    return "Direct executable relationship enrichment was not established for this controlled run. The retained evidence remains experimental and inconclusive.";
  }
  return `Direct executable relationship enrichment is feasible from the two separate public Renma artifacts for this controlled fixture. The experiment identified direct Skill invokers, direct script invokers, and structural containers without merging those meanings, while retaining ${counts.executableUnresolvedCount} unresolved executable-context record(s). It does not establish ownership, transitive impact, reviewed scope, producer completeness, adapter readiness, runtime execution, requirement satisfaction, or repository safety.`;
}

function observedCase(evaluation, id) {
  return evaluation.caseObservations.find((item) => item.expected.id === id)
    ?.observed;
}

function renderJson(value, present, absent) {
  if (value === undefined) return absent;
  return `${present}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  return entries.length === 0
    ? "none"
    : entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

function formatFact(value) {
  return value === undefined || value === null ? "unknown" : String(value);
}

function formatStderr(value) {
  if (value === undefined || value === null) return "unknown";
  return value.length === 0 ? "empty" : `\`${escapeTable(value)}\``;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
