import path from "node:path";
import { normalizeEvidence, sha256 } from "../lib.mjs";

export const experimentalSchemaVersion =
  "renma.experiment.skillspector-executable-context.v0";
export const experimentProvenance = "experiment-executable-correlation";

const supportedRepositoryScriptScopes = new Set([
  "skill-local",
  "repository-tool",
  "noncanonical",
]);

export const fixtureExpectations = Object.freeze({
  fixtureId: "skillspector-executable-context-v1",
  cases: [
    {
      id: "direct-skill-invocation",
      path: "skills/shared-owner/scripts/direct-probe.py",
      minimumFindings: 1,
      directSkillInvokers: { exact: 1 },
      directScriptInvokers: { exact: 0 },
      structuralContainers: { exact: 1 },
    },
    {
      id: "shared-skill-invocation",
      path: "skills/shared-owner/scripts/shared-probe.py",
      minimumFindings: 1,
      directSkillInvokers: { minimum: 2 },
      directScriptInvokers: { exact: 0 },
      structuralContainers: { exact: 1 },
    },
    {
      id: "independent-structural-containment",
      path: "skills/shared-owner/scripts/contained-probe.py",
      minimumFindings: 1,
      directSkillInvokers: { exact: 1 },
      directScriptInvokers: { exact: 0 },
      structuralContainers: { exact: 1 },
    },
    {
      id: "direct-script-invocation",
      path: "skills/shared-owner/scripts/callee-probe.py",
      minimumFindings: 1,
      directSkillInvokers: { exact: 0 },
      directScriptInvokers: { minimum: 1 },
      structuralContainers: { exact: 1 },
    },
  ],
  unresolvedTarget: {
    path: "skills/shared-owner/README.md",
    minimumFindings: 2,
  },
  duplicateGroup: {
    path: "skills/shared-owner/README.md",
    evidenceCount: 2,
  },
});

/** Reject malformed or noncanonical executable graph input before deriving context. */
export function validateExecutableGraph(graph) {
  if (graph === null || typeof graph !== "object") {
    throw new Error("Renma executable graph input is required");
  }
  if (graph.view !== "executable") {
    throw new Error('Renma graph view must be exactly "executable"');
  }
  if (!Array.isArray(graph.nodes)) {
    throw new Error("Renma executable graph must contain a nodes array");
  }
  if (!Array.isArray(graph.edges)) {
    throw new Error("Renma executable graph must contain an edges array");
  }

  const nodesById = new Map();
  for (const [index, node] of graph.nodes.entries()) {
    if (node === null || typeof node !== "object") {
      throw new Error(`Executable graph node ${index} must be an object`);
    }
    if (typeof node.id !== "string" || node.id.length === 0) {
      throw new Error(
        `Executable graph node ${index} must have a non-empty id`,
      );
    }
    if (nodesById.has(node.id)) {
      throw new Error(
        `Executable graph contains duplicate node id "${node.id}"`,
      );
    }
    if (typeof node.sourcePath !== "string" || node.sourcePath.length === 0) {
      throw new Error(
        `Executable graph node "${node.id}" must have a non-empty sourcePath`,
      );
    }
    if (
      !["skill", "repository-script", "external-executable"].includes(
        node.executableRole,
      )
    ) {
      throw new Error(
        `Executable graph node "${node.id}" has an unsupported executableRole`,
      );
    }
    if (node.executableRole === "repository-script") {
      if (!isRepositoryRelativePath(node.sourcePath)) {
        throw new Error(
          `Repository-script node "${node.id}" must have a normalized repository-relative sourcePath`,
        );
      }
      if (!supportedRepositoryScriptScopes.has(node.executableScope)) {
        throw new Error(
          `Repository-script node "${node.id}" must have a supported executableScope`,
        );
      }
      if (
        !Number.isInteger(node.invokedBySkillCount) ||
        node.invokedBySkillCount < 0
      ) {
        throw new Error(
          `Repository-script node "${node.id}" must have a non-negative integer invokedBySkillCount`,
        );
      }
    } else if (
      node.invokedBySkillCount !== undefined &&
      (!Number.isInteger(node.invokedBySkillCount) ||
        node.invokedBySkillCount < 0)
    ) {
      throw new Error(
        `Executable graph node "${node.id}" has an invalid invokedBySkillCount`,
      );
    }
    nodesById.set(node.id, node);
  }

  const edgeKeys = new Set();
  for (const [index, edge] of graph.edges.entries()) {
    if (edge === null || typeof edge !== "object") {
      throw new Error(`Executable graph edge ${index} must be an object`);
    }
    if (!["invokes", "contains"].includes(edge.kind)) {
      throw new Error(`Executable graph edge ${index} has an unsupported kind`);
    }
    if (typeof edge.from !== "string" || edge.from.length === 0) {
      throw new Error(`Executable graph edge ${index} must have a source id`);
    }
    if (typeof edge.to !== "string" || edge.to.length === 0) {
      throw new Error(`Executable graph edge ${index} must have a target`);
    }
    const source = nodesById.get(edge.from);
    if (!source) {
      throw new Error(
        `Executable graph edge ${index} references absent source node "${edge.from}"`,
      );
    }
    const targetId = edge.targetId ?? edge.to;
    const target = nodesById.get(targetId);
    if (!target) {
      throw new Error(
        `Executable graph edge ${index} references absent target node "${targetId}"`,
      );
    }
    if (edge.kind === "contains") {
      if (
        source.executableRole !== "skill" ||
        target.executableRole !== "repository-script" ||
        target.executableScope !== "skill-local" ||
        edge.resolved !== true
      ) {
        throw new Error(
          `Executable graph contains edge ${index} must be a resolved Skill-to-skill-local-repository-script relationship`,
        );
      }
      validateRepositoryTargetFields(edge, target, index);
    } else if (target.executableRole === "repository-script") {
      if (
        !["skill", "repository-script"].includes(source.executableRole) ||
        edge.resolved !== true
      ) {
        throw new Error(
          `Executable graph invokes edge ${index} must be a resolved Skill-or-script-to-repository-script relationship`,
        );
      }
      validateRepositoryTargetFields(edge, target, index);
    } else if (
      target.executableRole !== "external-executable" ||
      !["skill", "repository-script"].includes(source.executableRole)
    ) {
      throw new Error(
        `Executable graph invokes edge ${index} has noncanonical node roles`,
      );
    }
    const edgeKey = [edge.from, edge.kind, targetId].join("\0");
    if (edgeKeys.has(edgeKey)) {
      throw new Error(
        `Executable graph contains duplicate canonical edge ${edge.from} --${edge.kind}--> ${targetId}`,
      );
    }
    edgeKeys.add(edgeKey);
  }

  return { nodesById };
}

function validateRepositoryTargetFields(edge, target, index) {
  if (edge.to !== target.id) {
    throw new Error(
      `Executable graph edge ${index} to does not identify target node "${target.id}"`,
    );
  }
  if (edge.targetId !== undefined && edge.targetId !== target.id) {
    throw new Error(
      `Executable graph edge ${index} targetId does not identify target node "${target.id}"`,
    );
  }
  if (edge.targetPath !== undefined && edge.targetPath !== target.sourcePath) {
    throw new Error(
      `Executable graph edge ${index} targetPath does not match target sourcePath "${target.sourcePath}"`,
    );
  }
  if (edge.targetKind !== undefined && edge.targetKind !== "script") {
    throw new Error(
      `Executable graph edge ${index} targetKind does not match a repository script`,
    );
  }
}

function isRepositoryRelativePath(sourcePath) {
  if (
    sourcePath.includes("\0") ||
    sourcePath.includes("\\") ||
    path.posix.isAbsolute(sourcePath) ||
    /^[A-Za-z]:/u.test(sourcePath)
  ) {
    return false;
  }
  const normalized = path.posix.normalize(sourcePath);
  return (
    normalized === sourcePath &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("../")
  );
}

/** Correlate one exact catalog asset to one graph node and only its incoming edges. */
export function correlateExecutableContext(correlation, graph) {
  const { nodesById } = validateExecutableGraph(graph);
  if (correlation?.status !== "correlated") {
    return {
      provenance: experimentProvenance,
      status: correlation?.status === "ambiguous" ? "ambiguous" : "unresolved",
      reasonCode: `catalog-correlation-${correlation?.status ?? "missing"}`,
      explanation:
        "Executable correlation was not attempted because exact catalog correlation did not produce one asset.",
      candidates: [],
      directSkillInvokers: [],
      directScriptInvokers: [],
      structuralContainers: [],
    };
  }

  if (correlation.asset?.kind !== "script") {
    return {
      provenance: experimentProvenance,
      status: "unresolved",
      reasonCode: "catalog-asset-is-not-repository-script",
      explanation:
        "Executable correlation was not attempted because the exactly correlated catalog asset is not a repository script.",
      candidates: [],
      directSkillInvokers: [],
      directScriptInvokers: [],
      structuralContainers: [],
    };
  }

  const sourcePath = correlation.asset?.sourcePath;
  const matches = graph.nodes.filter(
    (node) =>
      node.executableRole === "repository-script" &&
      node.sourcePath === sourcePath,
  );
  if (matches.length === 0) {
    return {
      provenance: experimentProvenance,
      status: "unresolved",
      reasonCode: "no-executable-node-at-exact-path",
      explanation: `No repository-script executable graph node has exact sourcePath "${sourcePath}".`,
      candidates: [],
      directSkillInvokers: [],
      directScriptInvokers: [],
      structuralContainers: [],
    };
  }
  if (matches.length > 1) {
    return {
      provenance: experimentProvenance,
      status: "ambiguous",
      reasonCode: "multiple-executable-nodes-at-exact-path",
      explanation: `${matches.length} repository-script executable graph nodes have exact sourcePath "${sourcePath}"; the experiment did not choose one.`,
      candidates: matches.map(projectNode).sort(compareNodes),
      directSkillInvokers: [],
      directScriptInvokers: [],
      structuralContainers: [],
    };
  }

  const node = matches[0];
  const incoming = graph.edges.filter(
    (edge) => (edge.targetId ?? edge.to) === node.id,
  );
  const directSkillInvokers = incoming
    .filter(
      (edge) =>
        edge.kind === "invokes" &&
        nodesById.get(edge.from)?.executableRole === "skill",
    )
    .map((edge) => relationship(edge, nodesById, "direct-skill-invokes-edge"))
    .sort(compareRelationships);
  const directScriptInvokers = incoming
    .filter(
      (edge) =>
        edge.kind === "invokes" &&
        nodesById.get(edge.from)?.executableRole === "repository-script",
    )
    .map((edge) => relationship(edge, nodesById, "direct-script-invokes-edge"))
    .sort(compareRelationships);
  const structuralContainers = incoming
    .filter(
      (edge) =>
        edge.kind === "contains" &&
        nodesById.get(edge.from)?.executableRole === "skill",
    )
    .map((edge) =>
      relationship(edge, nodesById, "direct-structural-contains-edge"),
    )
    .sort(compareRelationships);
  const reportedCount = Number.isInteger(node.invokedBySkillCount)
    ? node.invokedBySkillCount
    : null;
  const observedCount = new Set(
    directSkillInvokers.map((item) => item.direction.source.id),
  ).size;
  const countAgrees =
    reportedCount === null ? null : reportedCount === observedCount;

  return {
    provenance: experimentProvenance,
    status: countAgrees === false ? "inconclusive" : "correlated",
    reasonCode:
      countAgrees === false
        ? "invoked-by-skill-count-mismatch"
        : "exact-executable-node-path",
    explanation:
      countAgrees === false
        ? `The graph node reports invokedBySkillCount ${reportedCount}, but ${observedCount} distinct direct Skill invokes edge(s) were observed; no identity was manufactured from the count.`
        : `The catalog asset exactly matches executable graph node sourcePath "${sourcePath}"; only canonical incoming edges were projected.`,
    node: projectNode(node),
    candidates: [],
    invokedBySkillCountCheck: {
      reported: reportedCount,
      observedDistinctDirectSkillInvokers: observedCount,
      agrees: countAgrees,
      usedToInferIdentities: false,
    },
    directSkillInvokers,
    directScriptInvokers,
    structuralContainers,
  };
}

/** Preserve the existing scanner/normalization/catalog layers and add graph context. */
export function normalizeEvidenceWithExecutableContext({
  rawReport,
  rawReportText,
  rawOutputReference,
  catalog,
  catalogReference,
  catalogText,
  executableGraph,
  executableGraphReference,
  executableGraphText,
  fixtureId,
  scannerTargetPath = ".",
  scannerName = "SkillSpector",
}) {
  validateExecutableGraph(executableGraph);
  const base = normalizeEvidence({
    rawReport,
    rawReportText,
    rawOutputReference,
    catalog,
    catalogReference,
    catalogText,
    fixtureId,
    scannerTargetPath,
    scannerName,
  });
  const evidence = base.evidence.map((item) => ({
    ...item,
    executableContext: correlateExecutableContext(
      item.correlation,
      executableGraph,
    ),
  }));

  return {
    ...base,
    experimentalSchemaVersion,
    boundary: {
      includes: [
        ...base.boundary.includes,
        "direct executable graph relationships",
      ],
      excludes: [
        ...base.boundary.excludes,
        "ownership inferred from executable relationships",
        "runtime execution or impact",
        "transitive executable reachability",
        "scanner-reviewed Skill scope",
      ],
    },
    source: {
      ...base.source,
      renmaExecutableGraph: {
        referenceBase: "experiments/skillspector",
        reference: executableGraphReference,
        sha256: sha256(executableGraphText),
        view: executableGraph.view,
      },
    },
    counts: {
      ...base.counts,
      executableCorrelatedCount: countStatus(evidence, "correlated"),
      executableUnresolvedCount: countStatus(evidence, "unresolved"),
      executableAmbiguousCount: countStatus(evidence, "ambiguous"),
      executableInconclusiveCount: countStatus(evidence, "inconclusive"),
    },
    evidence,
  };
}

/** Evaluate fixture relationships independently from producer completeness. */
export function evaluateExecutableExperiment({
  normalized,
  rawReport,
  invocation,
  expectations = fixtureExpectations,
}) {
  const checks = [];
  checks.push(
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
        rawReport.analysis_completeness?.execution_successful === true &&
        [0, 1].includes(invocation?.scanner?.exitCode),
      `report=${formatFact(rawReport.execution_successful)}, completeness=${formatFact(rawReport.analysis_completeness?.execution_successful)}, exit=${formatFact(invocation?.scanner?.exitCode)}`,
    ),
    check(
      "renma.catalog.execution",
      "Renma catalog completed cleanly",
      invocation?.renmaCatalog?.exitCode === 0 &&
        invocation?.renmaCatalog?.stderr === "",
      `exit=${formatFact(invocation?.renmaCatalog?.exitCode)}, stderr=${formatStderr(invocation?.renmaCatalog?.stderr)}`,
    ),
    check(
      "renma.executable-graph.execution",
      "First Renma executable graph invocation completed cleanly",
      invocation?.renmaExecutableGraph?.firstInvocation?.exitCode === 0 &&
        invocation?.renmaExecutableGraph?.firstInvocation?.stderr === "",
      `exit=${formatFact(invocation?.renmaExecutableGraph?.firstInvocation?.exitCode)}, stderr=${formatStderr(invocation?.renmaExecutableGraph?.firstInvocation?.stderr)}`,
    ),
    check(
      "renma.executable-graph.repeatability",
      "Repeated Renma executable graph invocation completed cleanly with byte-identical output",
      invocation?.renmaExecutableGraph?.repeatedInvocation?.exitCode === 0 &&
        invocation?.renmaExecutableGraph?.repeatedInvocation?.stderr === "" &&
        invocation?.renmaExecutableGraph?.repeatedInvocation
          ?.stdoutByteIdenticalToFirst === true,
      `exit=${formatFact(invocation?.renmaExecutableGraph?.repeatedInvocation?.exitCode)}, stderr=${formatStderr(invocation?.renmaExecutableGraph?.repeatedInvocation?.stderr)}, byte-identical=${formatFact(invocation?.renmaExecutableGraph?.repeatedInvocation?.stdoutByteIdenticalToFirst)}`,
    ),
    check(
      "findings.present",
      "At least one scanner-native finding",
      normalized.evidence.length > 0,
      String(normalized.evidence.length),
    ),
    check(
      "native-fields.unchanged",
      "Every scanner-native finding remains deeply equal and ordered",
      normalized.evidence.length === rawReport.issues.length &&
        normalized.evidence.every(
          (item, index) =>
            JSON.stringify(item.scannerFact.nativeFinding) ===
            JSON.stringify(rawReport.issues[index]),
        ),
      `${normalized.evidence.length} of ${rawReport.issues.length}`,
    ),
  );

  const caseObservations = expectations.cases.map((expected) => {
    const observed = relationshipSummaryForPath(normalized, expected.path);
    checks.push(
      check(
        `case.${expected.id}.findings`,
        `${expected.id} has scanner-native evidence and exact executable correlation`,
        observed.findingCount >= expected.minimumFindings &&
          observed.contextStatuses.every((status) => status === "correlated"),
        `${observed.findingCount} finding(s); ${formatCounts(observed.statusCounts)}`,
      ),
      relationshipCountCheck(
        expected.id,
        "directSkillInvokers",
        expected.directSkillInvokers,
        observed.directSkillInvokers.length,
      ),
      relationshipCountCheck(
        expected.id,
        "directScriptInvokers",
        expected.directScriptInvokers,
        observed.directScriptInvokers.length,
      ),
      relationshipCountCheck(
        expected.id,
        "structuralContainers",
        expected.structuralContainers,
        observed.structuralContainers.length,
      ),
    );
    return { expected: structuredClone(expected), observed };
  });

  const containmentCase = caseObservations.find(
    (item) => item.expected.id === "independent-structural-containment",
  )?.observed;
  const scriptCase = caseObservations.find(
    (item) => item.expected.id === "direct-script-invocation",
  )?.observed;
  checks.push(
    check(
      "semantics.contains-versus-invokes",
      "Containment and Skill invocation remain separate edge records",
      containmentCase?.directSkillInvokers.every(
        (item) =>
          item.basis === "direct-skill-invokes-edge" &&
          item.edge.kind === "invokes",
      ) === true &&
        containmentCase?.structuralContainers.every(
          (item) =>
            item.basis === "direct-structural-contains-edge" &&
            item.edge.kind === "contains",
        ) === true,
      `invokes=${containmentCase?.directSkillInvokers.length ?? 0}, contains=${containmentCase?.structuralContainers.length ?? 0}`,
    ),
    check(
      "semantics.no-transitive-skill",
      "Script-to-script invocation does not create a direct Skill invoker",
      scriptCase?.directScriptInvokers.length > 0 &&
        scriptCase.directSkillInvokers.length === 0,
      `direct scripts=${scriptCase?.directScriptInvokers.length ?? 0}, direct Skills=${scriptCase?.directSkillInvokers.length ?? 0}`,
    ),
  );

  const unresolved = normalized.evidence.filter(
    (item) =>
      item.normalization.target.repositoryRelativePath ===
      expectations.unresolvedTarget.path,
  );
  checks.push(
    check(
      "unresolved.retained",
      `Unresolved target ${expectations.unresolvedTarget.path} remains unresolved`,
      unresolved.length >= expectations.unresolvedTarget.minimumFindings &&
        unresolved.every(
          (item) =>
            item.correlation.status === "unresolved" &&
            item.executableContext.status === "unresolved",
        ),
      `${unresolved.length} finding(s)`,
    ),
  );

  const duplicate = normalized.observations.duplicateGroups.find((group) => {
    const paths = new Set(
      group.evidenceIndexes.map(
        (index) =>
          normalized.evidence[index]?.normalization.target
            .repositoryRelativePath,
      ),
    );
    return paths.size === 1 && paths.has(expectations.duplicateGroup.path);
  });
  checks.push(
    check(
      "duplicates.retained",
      "Duplicate scanner findings remain separate evidence records",
      duplicate?.evidenceIndexes.length ===
        expectations.duplicateGroup.evidenceCount,
      duplicate ? duplicate.evidenceIndexes.join(", ") : "none",
    ),
    check(
      "graph.counts.agree",
      "Graph invokedBySkillCount agrees with observed direct Skill identities",
      normalized.evidence.every(
        (item) => item.executableContext.status !== "inconclusive",
      ),
      `${normalized.counts.executableInconclusiveCount} inconclusive record(s)`,
    ),
    check(
      "graph.no-ambiguous-context",
      "Controlled fixture has no ambiguous executable correlation",
      normalized.counts.executableAmbiguousCount === 0,
      String(normalized.counts.executableAmbiguousCount),
    ),
  );

  const allPredicatesSatisfied = checks.every((item) => item.passed);
  const completeness = rawReport.analysis_completeness;
  const analyzerStatuses = Array.isArray(completeness?.analyzer_statuses)
    ? completeness.analyzer_statuses
    : [];
  const nonCompleteAnalyzers = analyzerStatuses.filter(
    (item) =>
      item.status !== "completed" ||
      item.skipped !== 0 ||
      item.failed !== 0 ||
      item.unaccounted !== 0,
  );
  const producerCompletenessComplete =
    completeness?.execution_successful === true &&
    completeness?.is_complete === true &&
    analyzerStatuses.length > 0 &&
    nonCompleteAnalyzers.length === 0;
  const adapterBoundaryBlockers = [
    ...(!producerCompletenessComplete
      ? ["producer-native completeness (incomplete or unknown)"]
      : []),
    "unresolved producer-contract gaps",
  ];

  return {
    checks,
    allPredicatesSatisfied,
    failedCheckIds: checks
      .filter((item) => !item.passed)
      .map((item) => item.id),
    caseObservations,
    conclusions: {
      executableRelationshipExperiment: allPredicatesSatisfied
        ? "satisfied"
        : "not satisfied",
      adapterBoundaryReadiness: "blocked",
      adapterBoundaryBlockers,
    },
    producerCompleteness: {
      status: producerCompletenessComplete
        ? "complete"
        : "incomplete-or-unknown",
      isComplete: completeness?.is_complete ?? null,
      analyzerStatusCount: Array.isArray(completeness?.analyzer_statuses)
        ? analyzerStatuses.length
        : null,
      nonCompleteAnalyzerCount: nonCompleteAnalyzers.length,
      satisfiesNativeCompletenessEvidence: producerCompletenessComplete,
    },
  };
}

export function relationshipSummaryForPath(normalized, sourcePath) {
  const records = normalized.evidence.filter(
    (item) => item.normalization.target.repositoryRelativePath === sourcePath,
  );
  return {
    path: sourcePath,
    findingCount: records.length,
    evidenceIndexes: records.map((item) => item.evidenceIndex),
    contextStatuses: records.map((item) => item.executableContext.status),
    statusCounts: countBy(records.map((item) => item.executableContext.status)),
    directSkillInvokers: uniqueRelationships(
      records.flatMap(
        (item) => item.executableContext.directSkillInvokers ?? [],
      ),
    ),
    directScriptInvokers: uniqueRelationships(
      records.flatMap(
        (item) => item.executableContext.directScriptInvokers ?? [],
      ),
    ),
    structuralContainers: uniqueRelationships(
      records.flatMap(
        (item) => item.executableContext.structuralContainers ?? [],
      ),
    ),
  };
}

function relationship(edge, nodesById, basis) {
  const targetId = edge.targetId ?? edge.to;
  return {
    provenance: experimentProvenance,
    basis,
    explanation:
      basis === "direct-skill-invokes-edge"
        ? "Included because this canonical incoming invokes edge starts at a Skill node."
        : basis === "direct-script-invokes-edge"
          ? "Included because this canonical incoming invokes edge starts at a repository-script node."
          : "Included because this canonical incoming contains edge starts at a Skill node; the original direction is retained.",
    edge: structuredClone(edge),
    direction: {
      source: projectNode(nodesById.get(edge.from)),
      target: projectNode(nodesById.get(targetId)),
    },
  };
}

function projectNode(node) {
  return {
    id: node.id,
    sourcePath: node.sourcePath,
    role: node.executableRole,
    ...(node.executableScope === undefined
      ? {}
      : { scope: node.executableScope }),
    ...(node.invokedBySkillCount === undefined
      ? {}
      : { invokedBySkillCount: node.invokedBySkillCount }),
  };
}

function uniqueRelationships(values) {
  const byKey = new Map();
  for (const value of values) {
    const key = [
      value.edge.from,
      value.edge.kind,
      value.edge.targetId ?? value.edge.to,
    ].join("\0");
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()].sort(compareRelationships);
}

function compareRelationships(left, right) {
  return relationshipSortKey(left).localeCompare(relationshipSortKey(right));
}

function relationshipSortKey(item) {
  return [
    item.direction.source.id,
    item.edge.kind,
    item.direction.target.id,
  ].join("\0");
}

function compareNodes(left, right) {
  return [left.sourcePath, left.id]
    .join("\0")
    .localeCompare([right.sourcePath, right.id].join("\0"));
}

function countStatus(evidence, status) {
  return evidence.filter((item) => item.executableContext.status === status)
    .length;
}

function relationshipCountCheck(caseId, field, expectation, actual) {
  const passed =
    expectation.exact === undefined
      ? actual >= expectation.minimum
      : actual === expectation.exact;
  const expected =
    expectation.exact === undefined
      ? `at least ${expectation.minimum}`
      : String(expectation.exact);
  return check(
    `case.${caseId}.${field}`,
    `${caseId} ${field}`,
    passed,
    `${actual} (expected ${expected})`,
  );
}

function check(id, label, passed, observed) {
  return { id, label, passed, observed };
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
  return value.length === 0 ? "empty" : JSON.stringify(value);
}
