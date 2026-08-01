import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  correlateExecutableContext,
  evaluateExecutableExperiment,
  normalizeEvidenceWithExecutableContext,
  relationshipSummaryForPath,
  validateExecutableGraph,
} from "./lib.mjs";
import { renderExecutableExperimentReport } from "./report.mjs";

const paths = {
  skill: "skills/shared-owner/SKILL.md",
  direct: "skills/shared-owner/scripts/direct-probe.py",
  shared: "skills/shared-owner/scripts/shared-probe.py",
  contained: "skills/shared-owner/scripts/contained-probe.py",
  caller: "skills/shared-owner/scripts/caller-probe.mjs",
  callee: "skills/shared-owner/scripts/callee-probe.py",
  unresolved: "skills/shared-owner/README.md",
};

test("missing executable graph input fails closed", () => {
  assert.throws(
    () => validateExecutableGraph(undefined),
    /executable graph input is required/u,
  );
});

test("a graph whose view is not executable fails closed", () => {
  assert.throws(
    () => validateExecutableGraph({ view: "full", nodes: [], edges: [] }),
    /view must be exactly "executable"/u,
  );
});

test("missing graph nodes fail closed", () => {
  assert.throws(
    () => validateExecutableGraph({ view: "executable", edges: [] }),
    /nodes array/u,
  );
});

test("multiple nodes at one correlatable path remain ambiguous", () => {
  const graph = executableGraph();
  graph.nodes.push({
    ...graph.nodes.find((node) => node.id === paths.direct),
    id: "duplicate-direct-node",
  });
  const context = correlateExecutableContext(
    correlatedAsset(paths.direct),
    graph,
  );
  assert.equal(context.status, "ambiguous");
  assert.equal(context.candidates.length, 2);
  assert.equal(context.directSkillInvokers.length, 0);
});

test("an exact SKILL.md catalog correlation is not executable context", () => {
  const normalized = normalizeFixture({
    rawReport: reportWithIssues([nativeIssue("SKILL.md", "skill-one")]),
  });
  const { correlation, executableContext: context } = normalized.evidence[0];
  assert.equal(correlation.status, "correlated");
  assert.equal(correlation.asset.kind, "skill");
  assert.equal(context.status, "unresolved");
  assert.equal(context.reasonCode, "catalog-asset-is-not-repository-script");
  assert.deepEqual(context.candidates, []);
});

test("a correlated catalog asset whose kind is not script is rejected", () => {
  const context = correlateExecutableContext(
    correlatedAsset(paths.direct, "context"),
    executableGraph(),
  );
  assert.equal(context.status, "unresolved");
  assert.equal(context.reasonCode, "catalog-asset-is-not-repository-script");
  assert.equal(context.node, undefined);
});

test("a path matching only a Skill graph node cannot correlate as a script", () => {
  const context = correlateExecutableContext(
    correlatedAsset(paths.skill, "script"),
    executableGraph(),
  );
  assert.equal(context.status, "unresolved");
  assert.equal(context.reasonCode, "no-executable-node-at-exact-path");
  assert.deepEqual(context.candidates, []);
});

test("an edge whose target node is absent fails closed", () => {
  const graph = executableGraph();
  graph.edges.push(edge("skill.alpha", "invokes", "absent-target"));
  assert.throws(() => validateExecutableGraph(graph), /absent target node/u);
});

test("an edge whose source node is absent fails closed", () => {
  const graph = executableGraph();
  graph.edges.push(edge("absent-source", "invokes", paths.direct));
  assert.throws(() => validateExecutableGraph(graph), /absent source node/u);
});

test("contains cannot target a repository tool", () => {
  const graph = executableGraph();
  graph.nodes.find((node) => node.id === paths.direct).executableScope =
    "repository-tool";
  assert.throws(
    () => validateExecutableGraph(graph),
    /Skill-to-skill-local-repository-script/u,
  );
});

test("contains cannot target a repository script without skill-local scope", () => {
  const graph = executableGraph();
  delete graph.nodes.find((node) => node.id === paths.direct).executableScope;
  assert.throws(
    () => validateExecutableGraph(graph),
    /supported executableScope/u,
  );
});

test("unresolved internal repository invocation fails closed", () => {
  const graph = executableGraph();
  graph.edges.find(
    (item) => item.from === "skill.owner" && item.targetId === paths.direct,
  ).resolved = false;
  assert.throws(
    () => validateExecutableGraph(graph),
    /resolved Skill-or-script-to-repository-script/u,
  );
});

test("targetId and to cannot identify different repository nodes", () => {
  const graph = executableGraph();
  graph.edges.find(
    (item) => item.from === "skill.owner" && item.targetId === paths.direct,
  ).to = paths.shared;
  assert.throws(
    () => validateExecutableGraph(graph),
    /to does not identify target node/u,
  );
});

test("targetPath must agree with the repository target sourcePath", () => {
  const graph = executableGraph();
  graph.edges.find(
    (item) => item.from === "skill.owner" && item.targetId === paths.direct,
  ).targetPath = paths.shared;
  assert.throws(
    () => validateExecutableGraph(graph),
    /targetPath does not match target sourcePath/u,
  );
});

test("repository-script nodes require scope and direct-Skill count", async (t) => {
  for (const field of ["executableScope", "invokedBySkillCount"]) {
    await t.test(`missing ${field}`, () => {
      const graph = executableGraph();
      delete graph.nodes.find((node) => node.id === paths.direct)[field];
      assert.throws(
        () => validateExecutableGraph(graph),
        field === "executableScope"
          ? /supported executableScope/u
          : /non-negative integer invokedBySkillCount/u,
      );
    });
  }
});

test("the reviewed captured executable graph satisfies focused invariants", () => {
  const graph = JSON.parse(
    readFileSync(
      new URL(
        "./captured/fixture-run/renma-executable-graph.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.doesNotThrow(() => validateExecutableGraph(graph));
});

test("contains stays separate from invokes", () => {
  const context = correlateExecutableContext(
    correlatedAsset(paths.contained),
    executableGraph(),
  );
  assert.equal(context.status, "correlated");
  assert.deepEqual(
    context.directSkillInvokers.map((item) => [item.edge.kind, item.basis]),
    [["invokes", "direct-skill-invokes-edge"]],
  );
  assert.deepEqual(
    context.structuralContainers.map((item) => [item.edge.kind, item.basis]),
    [["contains", "direct-structural-contains-edge"]],
  );
  assert.notEqual(
    context.directSkillInvokers[0].direction.source.id,
    context.structuralContainers[0].direction.source.id,
  );
});

test("Skill-to-script direct invocation keeps exact direction and nodes", () => {
  const context = correlateExecutableContext(
    correlatedAsset(paths.direct),
    executableGraph(),
  );
  assert.equal(context.directSkillInvokers.length, 1);
  assert.equal(context.directSkillInvokers[0].edge.from, "skill.owner");
  assert.equal(context.directSkillInvokers[0].edge.targetId, paths.direct);
  assert.equal(context.directSkillInvokers[0].direction.source.role, "skill");
  assert.equal(
    context.directSkillInvokers[0].direction.target.role,
    "repository-script",
  );
});

test("multiple Skills invoking one script remain separate and sorted", () => {
  const graph = executableGraph();
  graph.edges.reverse();
  const context = correlateExecutableContext(
    correlatedAsset(paths.shared),
    graph,
  );
  assert.deepEqual(
    context.directSkillInvokers.map((item) => item.direction.source.id),
    ["skill.alpha", "skill.beta"],
  );
  assert.equal(context.invokedBySkillCountCheck.agrees, true);
});

test("script-to-script direct invocation is retained as script context", () => {
  const context = correlateExecutableContext(
    correlatedAsset(paths.callee),
    executableGraph(),
  );
  assert.deepEqual(
    context.directScriptInvokers.map((item) => item.direction.source.id),
    [paths.caller],
  );
  assert.equal(context.directSkillInvokers.length, 0);
});

test("no transitive Skill is inferred through a calling script", () => {
  const context = correlateExecutableContext(
    correlatedAsset(paths.callee),
    executableGraph(),
  );
  assert.ok(
    executableGraph().edges.some(
      (item) => item.from === "skill.owner" && item.targetId === paths.caller,
    ),
  );
  assert.equal(context.directSkillInvokers.length, 0);
});

test("duplicate canonical graph edges fail closed", () => {
  const graph = executableGraph();
  graph.edges.push(structuredClone(graph.edges[0]));
  assert.throws(
    () => validateExecutableGraph(graph),
    /duplicate canonical edge/u,
  );
});

test("repeated declaration evidence does not multiply one canonical edge", () => {
  const graph = executableGraph();
  const directEdge = graph.edges.find(
    (item) => item.from === "skill.owner" && item.targetId === paths.direct,
  );
  directEdge.evidenceCount = 9;
  const context = correlateExecutableContext(
    correlatedAsset(paths.direct),
    graph,
  );
  assert.equal(context.directSkillInvokers.length, 1);
  assert.equal(context.directSkillInvokers[0].edge.evidenceCount, 9);
});

test("invokedBySkillCount mismatch is inconclusive and invents no identity", () => {
  const graph = executableGraph();
  graph.nodes.find((node) => node.id === paths.shared).invokedBySkillCount = 3;
  const context = correlateExecutableContext(
    correlatedAsset(paths.shared),
    graph,
  );
  assert.equal(context.status, "inconclusive");
  assert.equal(context.reasonCode, "invoked-by-skill-count-mismatch");
  assert.equal(context.directSkillInvokers.length, 2);
  assert.equal(context.invokedBySkillCountCheck.usedToInferIdentities, false);
});

test("unresolved scanner paths remain unresolved through graph correlation", () => {
  const normalized = normalizedFixture();
  const unresolved = normalized.evidence.filter(
    (item) =>
      item.normalization.target.repositoryRelativePath === paths.unresolved,
  );
  assert.equal(unresolved.length, 2);
  assert.ok(
    unresolved.every(
      (item) =>
        item.correlation.status === "unresolved" &&
        item.executableContext.status === "unresolved",
    ),
  );
});

test("unsafe scanner paths remain unresolved", () => {
  const rawReport = reportWithIssues([
    nativeIssue("../../outside.py", "unsafe-one"),
  ]);
  const normalized = normalizeFixture({ rawReport });
  assert.equal(normalized.evidence[0].normalization.target.status, "unsafe");
  assert.equal(normalized.evidence[0].correlation.status, "unresolved");
  assert.equal(normalized.evidence[0].executableContext.status, "unresolved");
});

test("scanner findings with missing locations remain unresolved", () => {
  const issue = nativeIssue(paths.direct, "missing-location");
  delete issue.location;
  const normalized = normalizeFixture({ rawReport: reportWithIssues([issue]) });
  assert.equal(normalized.evidence[0].normalization.target.status, "missing");
  assert.equal(normalized.evidence[0].executableContext.status, "unresolved");
});

test("duplicate scanner findings retain separate records and shared context", () => {
  const normalized = normalizedFixture();
  const duplicate = normalized.observations.duplicateGroups.find(
    (group) => group.evidenceIndexes.length === 2,
  );
  assert.deepEqual(duplicate.evidenceIndexes, [4, 5]);
  assert.equal(normalized.evidence.length, rawReport().issues.length);
  assert.notEqual(normalized.evidence[4], normalized.evidence[5]);
  assert.deepEqual(
    normalized.evidence[4].executableContext,
    normalized.evidence[5].executableContext,
  );
});

test("identical inputs produce byte-identical derived output", () => {
  assert.equal(
    JSON.stringify(normalizedFixture(), null, 2),
    JSON.stringify(normalizedFixture(), null, 2),
  );
});

test("native scanner fields remain deeply equal and separately cloned", () => {
  const report = rawReport();
  const normalized = normalizeFixture({ rawReport: report });
  normalized.evidence.forEach((item, index) => {
    assert.deepEqual(item.scannerFact.nativeFinding, report.issues[index]);
    assert.notEqual(item.scannerFact.nativeFinding, report.issues[index]);
  });
});

test("external executable nodes cannot match repository scanner assets", () => {
  const graph = executableGraph();
  graph.nodes.push({
    id: "external:/opt/vendor/probe.py",
    sourcePath: paths.direct,
    executableRole: "external-executable",
  });
  const context = correlateExecutableContext(
    correlatedAsset(paths.direct),
    graph,
  );
  assert.equal(context.status, "correlated");
  assert.equal(context.node.id, paths.direct);
  assert.equal(context.candidates.length, 0);
});

test("catalog exit 1 prevents a positive experiment conclusion", () => {
  const evaluation = evaluationWithInvocation((invocation) => {
    invocation.renmaCatalog.exitCode = 1;
  });
  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(evaluation.failedCheckIds.includes("renma.catalog.execution"));
});

test("non-empty catalog stderr prevents a positive experiment conclusion", () => {
  const evaluation = evaluationWithInvocation((invocation) => {
    invocation.renmaCatalog.stderr = "catalog warning";
  });
  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(evaluation.failedCheckIds.includes("renma.catalog.execution"));
});

test("first graph exit 1 prevents a positive experiment conclusion", () => {
  const evaluation = evaluationWithInvocation((invocation) => {
    invocation.renmaExecutableGraph.firstInvocation.exitCode = 1;
  });
  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(
    evaluation.failedCheckIds.includes("renma.executable-graph.execution"),
  );
});

test("repeated graph exit 1 prevents a positive experiment conclusion", () => {
  const evaluation = evaluationWithInvocation((invocation) => {
    invocation.renmaExecutableGraph.repeatedInvocation.exitCode = 1;
    invocation.renmaExecutableGraph.repeatedInvocation.stdoutByteIdenticalToFirst = false;
  });
  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(
    evaluation.failedCheckIds.includes("renma.executable-graph.repeatability"),
  );
});

test("non-empty graph stderr prevents a positive experiment conclusion", () => {
  const evaluation = evaluationWithInvocation((invocation) => {
    invocation.renmaExecutableGraph.firstInvocation.stderr = "graph warning";
  });
  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(
    evaluation.failedCheckIds.includes("renma.executable-graph.execution"),
  );
});

test("non-empty repeated graph stderr prevents a positive conclusion", () => {
  const evaluation = evaluationWithInvocation((invocation) => {
    invocation.renmaExecutableGraph.repeatedInvocation.stderr =
      "repeated graph warning";
  });
  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(
    evaluation.failedCheckIds.includes("renma.executable-graph.repeatability"),
  );
});

test("equal graph output cannot hide different invocation exits", () => {
  const evaluation = evaluationWithInvocation((invocation) => {
    invocation.renmaExecutableGraph.repeatedInvocation.exitCode = 1;
    invocation.renmaExecutableGraph.repeatedInvocation.stdoutByteIdenticalToFirst = true;
  });
  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(
    evaluation.failedCheckIds.includes("renma.executable-graph.repeatability"),
  );
});

test("different repeated graph output prevents a positive conclusion", () => {
  const evaluation = evaluationWithInvocation((invocation) => {
    invocation.renmaExecutableGraph.repeatedInvocation.stdoutByteIdenticalToFirst = false;
  });
  assert.equal(evaluation.allPredicatesSatisfied, false);
  assert.ok(
    evaluation.failedCheckIds.includes("renma.executable-graph.repeatability"),
  );
});

test("clean catalog and repeated graph execution passes all Renma predicates", () => {
  const evaluation = evaluationWithInvocation(() => {});
  assert.equal(evaluation.allPredicatesSatisfied, true);
  assert.equal(
    evaluation.checks.find((item) => item.id === "renma.catalog.execution")
      .passed,
    true,
  );
  assert.equal(
    evaluation.checks.find(
      (item) => item.id === "renma.executable-graph.execution",
    ).passed,
    true,
  );
  assert.equal(
    evaluation.checks.find(
      (item) => item.id === "renma.executable-graph.repeatability",
    ).passed,
    true,
  );
});

test("fixture evaluation separates executable success from adapter readiness", () => {
  const normalized = normalizedFixture();
  const evaluation = evaluateExecutableExperiment({
    normalized,
    rawReport: rawReport(),
    invocation: reportInvocation(),
  });
  assert.equal(evaluation.allPredicatesSatisfied, true);
  assert.equal(
    evaluation.conclusions.executableRelationshipExperiment,
    "satisfied",
  );
  assert.equal(evaluation.conclusions.adapterBoundaryReadiness, "blocked");
  assert.ok(
    evaluation.conclusions.adapterBoundaryBlockers.includes(
      "producer-native completeness (incomplete or unknown)",
    ),
  );
  assert.equal(evaluation.producerCompleteness.isComplete, false);
});

test("complete native ledger is not misreported as an adapter blocker", () => {
  const report = rawReport();
  report.analysis_completeness = {
    execution_successful: true,
    is_complete: true,
    analyzer_statuses: [
      {
        analyzer_id: "static",
        status: "completed",
        skipped: 0,
        failed: 0,
        unaccounted: 0,
      },
    ],
  };
  const normalized = normalizeFixture({ rawReport: report });
  const invocation = reportInvocation();
  const evaluation = evaluateExecutableExperiment({
    normalized,
    rawReport: report,
    invocation,
  });
  const rendered = renderExecutableExperimentReport({
    normalized,
    rawReport: report,
    invocation,
  });

  assert.equal(evaluation.allPredicatesSatisfied, true);
  assert.equal(
    evaluation.conclusions.executableRelationshipExperiment,
    "satisfied",
  );
  assert.equal(evaluation.conclusions.adapterBoundaryReadiness, "blocked");
  assert.deepEqual(evaluation.conclusions.adapterBoundaryBlockers, [
    "unresolved producer-contract gaps",
  ]);
  assert.equal(
    evaluation.producerCompleteness.satisfiesNativeCompletenessEvidence,
    true,
  );
  assert.match(
    rendered,
    /Producer completeness is therefore not an adapter-readiness blocker/u,
  );
  assert.doesNotMatch(
    rendered,
    /producer-native completeness \(incomplete or unknown\)|does not establish complete native analysis/u,
  );
});

test("relationship summaries deduplicate context without merging findings", () => {
  const normalized = normalizedFixture();
  const summary = relationshipSummaryForPath(normalized, paths.callee);
  assert.equal(summary.findingCount, 1);
  assert.equal(summary.directScriptInvokers.length, 1);
  assert.equal(summary.structuralContainers.length, 1);
});

test("report renders separate positive experiment and blocked adapter gates", () => {
  const report = rawReport();
  const rendered = renderExecutableExperimentReport({
    normalized: normalizeFixture({ rawReport: report }),
    rawReport: report,
    invocation: reportInvocation(),
  });
  assert.match(
    rendered,
    /Executable relationship experiment \| \*\*satisfied/u,
  );
  assert.match(rendered, /Adapter-boundary readiness \| \*\*blocked/u);
  assert.match(rendered, /direct-skill-invokes-edge/u);
  assert.match(rendered, /direct-script-invokes-edge/u);
  assert.match(rendered, /direct-structural-contains-edge/u);
  assert.match(rendered, /ownership, transitive impact, reviewed scope/u);
});

test("report conclusion changes when graph count evidence contradicts edges", () => {
  const report = rawReport();
  const catalog = fixtureCatalog();
  const graph = executableGraph();
  graph.nodes.find((node) => node.id === paths.shared).invokedBySkillCount = 9;
  const normalized = normalizeEvidenceWithExecutableContext({
    rawReport: report,
    rawReportText: JSON.stringify(report),
    rawOutputReference: "generated/skillspector-report.json",
    catalog,
    catalogReference: "generated/renma-catalog.json",
    catalogText: JSON.stringify(catalog),
    executableGraph: graph,
    executableGraphReference: "generated/renma-executable-graph.json",
    executableGraphText: JSON.stringify(graph),
    fixtureId: "skillspector-executable-context-v1",
    scannerTargetPath: "skills/shared-owner",
  });
  const rendered = renderExecutableExperimentReport({
    normalized,
    rawReport: report,
    invocation: reportInvocation(),
  });
  assert.match(
    rendered,
    /Executable relationship experiment \| \*\*not satisfied/u,
  );
  assert.doesNotMatch(
    rendered,
    /Direct executable relationship enrichment is feasible/u,
  );
});

function evaluationWithInvocation(mutate) {
  const invocation = reportInvocation();
  mutate(invocation);
  return evaluateExecutableExperiment({
    normalized: normalizedFixture(),
    rawReport: rawReport(),
    invocation,
  });
}

function normalizedFixture() {
  return normalizeFixture({ rawReport: rawReport() });
}

function normalizeFixture({ rawReport }) {
  const catalog = fixtureCatalog();
  const graph = executableGraph();
  return normalizeEvidenceWithExecutableContext({
    rawReport,
    rawReportText: JSON.stringify(rawReport),
    rawOutputReference: "generated/skillspector-report.json",
    catalog,
    catalogReference: "generated/renma-catalog.json",
    catalogText: JSON.stringify(catalog),
    executableGraph: graph,
    executableGraphReference: "generated/renma-executable-graph.json",
    executableGraphText: JSON.stringify(graph),
    fixtureId: "skillspector-executable-context-v1",
    scannerTargetPath: "skills/shared-owner",
  });
}

function rawReport() {
  const unresolved = nativeIssue("README.md", "unresolved-one");
  return reportWithIssues([
    nativeIssue("scripts/direct-probe.py", "direct-one"),
    nativeIssue("scripts/shared-probe.py", "shared-one"),
    nativeIssue("scripts/contained-probe.py", "contained-one"),
    nativeIssue("scripts/callee-probe.py", "callee-one"),
    unresolved,
    { ...structuredClone(unresolved), finding_id: "unresolved-two" },
  ]);
}

function reportWithIssues(issues) {
  return {
    metadata: { skillspector_version: "2.5.0" },
    execution_successful: true,
    analysis_completeness: {
      execution_successful: true,
      is_complete: false,
      analyzer_statuses: [
        {
          analyzer_id: "static",
          status: "completed",
          skipped: 0,
          failed: 0,
          unaccounted: 0,
        },
        {
          analyzer_id: "semantic",
          status: "disabled",
          skipped: 0,
          failed: 0,
          unaccounted: 0,
        },
      ],
    },
    issues,
  };
}

function nativeIssue(file, findingId) {
  return {
    id: "native-rule",
    finding_id: findingId,
    category: "Native category",
    pattern: "Native pattern",
    severity: "MEDIUM",
    confidence: 0.8,
    location: { file, start_line: 1, end_line: null },
    finding: "native finding",
    explanation: "Scanner-native explanation.",
    remediation: "Scanner-native remediation.",
    code_snippet: null,
    intent: null,
    tags: ["native"],
  };
}

function fixtureCatalog() {
  return {
    catalog: {
      assets: Object.values(paths)
        .filter((sourcePath) => sourcePath !== paths.unresolved)
        .map((sourcePath) => ({
          id: sourcePath,
          sourcePath,
          kind: sourcePath.endsWith("SKILL.md") ? "skill" : "script",
          contentHash: `sha256:${sourcePath}`,
          ownership: { source: "unowned" },
        })),
      dependencies: [],
    },
  };
}

function correlatedAsset(sourcePath, kind = "script") {
  return {
    provenance: "experiment-correlation",
    status: "correlated",
    asset: {
      id: sourcePath,
      sourcePath,
      kind,
      contentHash: `sha256:${sourcePath}`,
      ownership: { source: "unowned" },
    },
  };
}

function executableGraph() {
  const nodes = [
    skillNode("skill.alpha", "skills/alpha/SKILL.md"),
    skillNode("skill.beta", "skills/beta/SKILL.md"),
    skillNode("skill.owner", "skills/shared-owner/SKILL.md"),
    scriptNode(paths.direct, 1),
    scriptNode(paths.shared, 2),
    scriptNode(paths.contained, 1),
    scriptNode(paths.caller, 1),
    scriptNode(paths.callee, 0),
  ];
  const edges = [
    edge("skill.owner", "invokes", paths.direct),
    edge("skill.alpha", "invokes", paths.shared),
    edge("skill.beta", "invokes", paths.shared),
    edge("skill.beta", "invokes", paths.contained),
    edge("skill.owner", "invokes", paths.caller),
    edge(paths.caller, "invokes", paths.callee),
    edge("skill.owner", "contains", paths.direct),
    edge("skill.owner", "contains", paths.shared),
    edge("skill.owner", "contains", paths.contained),
    edge("skill.owner", "contains", paths.caller),
    edge("skill.owner", "contains", paths.callee),
  ];
  return { view: "executable", nodes, edges, executable: {} };
}

function skillNode(id, sourcePath) {
  return { id, sourcePath, executableRole: "skill" };
}

function scriptNode(sourcePath, invokedBySkillCount) {
  return {
    id: sourcePath,
    sourcePath,
    executableRole: "repository-script",
    executableScope: "skill-local",
    invokedBySkillCount,
  };
}

function edge(from, kind, targetId) {
  return {
    from,
    to: targetId,
    kind,
    declaration:
      kind === "contains"
        ? "structural-skill-boundary"
        : from.startsWith("skill.")
          ? "executable-invocation"
          : "executable-dependency",
    sourcePath: from,
    resolved: true,
    targetId,
    targetKind: "script",
    targetPath: targetId,
    ...(kind === "invokes" ? { evidenceCount: 1 } : {}),
  };
}

function reportInvocation() {
  return {
    scanner: {
      executable: "/external/skillspector",
      versionProbeOutput: "SkillSpector v2.5.0",
      args: ["scan", "/fixture", "--no-llm"],
      exitCode: 0,
    },
    renmaCli: {
      version: "0.28.3",
      revision: "revision",
      executableSha256: "sha256:cli",
    },
    renmaCatalog: {
      args: ["catalog", "/fixture", "--format", "json"],
      exitCode: 0,
      stderr: "",
    },
    renmaExecutableGraph: {
      args: ["graph", "/fixture", "--view", "executable", "--format", "json"],
      firstInvocation: { exitCode: 0, stderr: "" },
      repeatedInvocation: {
        exitCode: 0,
        stderr: "",
        stdoutByteIdenticalToFirst: true,
      },
    },
    git: { headRevision: "head", worktreeState: "dirty" },
    experimentHarness: {
      sha256: "sha256:harness",
      files: [],
      revisionContainsExactHarness: false,
    },
    fixture: { files: [] },
  };
}
