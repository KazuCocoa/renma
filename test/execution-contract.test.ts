import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import fc from "fast-check";

import { main } from "../src/cli.js";
import {
  buildExecutionContract,
  formatExecutionContractJson,
  type ExecutionContractReport,
} from "../src/commands/execution-contract.js";
import { canonicalExecutableDependencyGraphEdges } from "../src/executable-dependency-resolution.js";
import { canonicalExecutableInvocationGraphEdges } from "../src/executable-surface-inventory.js";
import {
  collectRepositorySnapshot,
  type RepositorySnapshot,
} from "../src/repository-evidence.js";
import { RepositoryFixture } from "./repository-fixture.js";

test("execution contract retains direct, transitive, duplicate, structural, unresolved, lifecycle, revision, and portable evidence", async (t) => {
  const fixture = await comprehensiveFixture(t);
  const argv = [
    "execution-contract",
    fixture.root,
    "--entrypoint",
    "skill.release-prep",
    "--source-revision",
    "abc123",
    "--format",
    "json",
  ];
  const first = await captureMain(argv);
  const second = await captureMain(argv);

  assert.equal(first.code, 0);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout) as ExecutionContractReport;
  assert.equal(
    report.schemaVersion,
    "renma.experimental-execution-contract.v1",
  );
  assert.equal(report.stability, "experimental");
  assert.deepEqual(report.scope, {
    type: "declared_execution_contract",
    evidenceKind: "static_repository_evidence",
    runtimeUsage: false,
    telemetryCollected: false,
    authorizationDecision: false,
  });
  assert.deepEqual(report.sourceRevision, {
    value: "abc123",
    providedBy: "caller",
    verifiedByRenma: false,
  });
  assert.deepEqual(
    {
      algorithm: report.evidenceDigest.algorithm,
      scope: report.evidenceDigest.scope,
      calculatedBy: report.evidenceDigest.calculatedBy,
    },
    {
      algorithm: "sha256",
      scope: "selected_execution_contract_evidence_v1",
      calculatedBy: "renma",
    },
  );
  assert.match(report.evidenceDigest.value, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    {
      id: report.subject.id,
      sourcePath: report.subject.sourcePath,
      status: report.subject.status,
      statusReason: report.subject.statusReason,
      statusChangedAt: report.subject.statusChangedAt,
    },
    {
      id: "skill.release-prep",
      sourcePath: "skills/release-prep/SKILL.md",
      status: "suspended",
      statusReason: "Release automation is paused",
      statusChangedAt: "2026-07-31",
    },
  );
  assert.match(report.subject.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal("root" in report, false);
  assert.equal("generatedAt" in report, false);

  assert.deepEqual(
    report.executableEvidence.relationships.map((relationship) => ({
      from: relationship.from.sourcePath,
      to: relationship.to.sourcePath,
      reachability: relationship.reachability,
      depth: relationship.minimumTargetDepth,
      evidenceCount: relationship.evidence.length,
      expectation: relationship.expectation,
    })),
    [
      {
        from: "skills/release-prep/SKILL.md",
        to: "skills/release-prep/scripts/prepare.ts",
        reachability: "direct",
        depth: 1,
        evidenceCount: 2,
        expectation: "possible",
      },
      {
        from: "skills/release-prep/SKILL.md",
        to: "tools/shared.sh",
        reachability: "direct",
        depth: 1,
        evidenceCount: 1,
        expectation: "possible",
      },
      {
        from: "skills/release-prep/scripts/prepare.ts",
        to: "tools/transitive.sh",
        reachability: "transitive",
        depth: 2,
        evidenceCount: 2,
        expectation: "possible",
      },
      {
        from: "tools/shared.sh",
        to: "tools/transitive.sh",
        reachability: "transitive",
        depth: 2,
        evidenceCount: 1,
        expectation: "possible",
      },
    ],
  );
  assert.deepEqual(
    report.executableEvidence.structuralRelationships.map((relationship) => [
      relationship.from.id,
      relationship.relationship,
      relationship.to.sourcePath,
      relationship.meaning,
    ]),
    [
      [
        "skill.release-prep",
        "contains",
        "skills/release-prep/scripts/prepare.ts",
        "structural_placement_only",
      ],
      [
        "skill.release-prep",
        "contains",
        "skills/release-prep/scripts/unused.ts",
        "structural_placement_only",
      ],
    ],
  );
  assert.equal(
    report.executableEvidence.relationships.some(
      (relationship) =>
        relationship.to.sourcePath === "skills/release-prep/scripts/unused.ts",
    ),
    false,
  );
  assert.deepEqual(
    report.executableEvidence.unresolvedEvidence.map((evidence) => ({
      type: evidence.type,
      sourcePath: evidence.sourcePath,
      resolution: evidence.resolution,
      target:
        evidence.type === "invocation"
          ? evidence.rawTarget
          : evidence.rawSpecifier,
    })),
    [
      {
        type: "dependency",
        sourcePath: "skills/release-prep/scripts/prepare.ts",
        resolution: "missing",
        target: "../../../tools/missing.sh",
      },
      {
        type: "invocation",
        sourcePath: "skills/release-prep/SKILL.md",
        resolution: "unsafe",
        target: "/opt/vendor/scripts/run.js",
      },
    ],
  );
  assert.equal(
    report.executableEvidence.relationships.some((relationship) =>
      relationship.to.sourcePath.startsWith("/"),
    ),
    false,
  );
  const unused = report.executableEvidence.surfaces.find(
    (surface) => surface.sourcePath === "skills/release-prep/scripts/unused.ts",
  );
  assert.equal(unused?.reachableFromSubject, false);
  assert.equal(unused?.minimumInvocationDepth, undefined);
  assert.equal(
    first.stdout.includes("skill.publish") ||
      first.stdout.includes('"ownership":'),
    false,
  );
  assert.deepEqual(report.analysisBoundary.coverage, {
    reachableRepositoryScriptCount: 3,
    recognizedInvocationEvidenceCount: 4,
    recognizedDependencyEvidenceCount: 4,
    topologicalInvocationEvidenceCount: 3,
    topologicalDependencyEvidenceCount: 3,
    nonTopologicalEvidenceCount: 2,
  });
  assert.deepEqual(report.analysisBoundary.observations, {
    driftAssessmentPerformed: false,
    noUnresolvedStaticEvidenceObserved: false,
    runtimeOrUnsupportedBehaviorAbsenceProven: false,
  });
});

test("a shell path present only in heredoc data is absent from the execution contract", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-heredoc-",
    testContext: t,
  });
  await fixture.skill("demo", {
    id: "skill.demo",
    body: ["# Demo", "", "```bash", "bash tools/entry.sh", "```"].join("\n"),
  });
  await fixture.write(
    "tools/entry.sh",
    ["#!/bin/sh", "cat <<'EOF'", "./heredoc-only.sh", "EOF", ""].join("\n"),
  );
  await fixture.write("tools/heredoc-only.sh", "#!/bin/sh\nexit 0\n");

  const snapshot = await collectRepositorySnapshot(fixture.root);
  assert.equal(
    snapshot.executableSurfaceInventory.dependencies.some(
      (dependency) => dependency.normalizedTarget === "tools/heredoc-only.sh",
    ),
    false,
  );

  const report = buildExecutionContract(snapshot, {
    entrypoint: "skill.demo",
  });
  assert.equal(
    report.executableEvidence.relationships.some(
      (relationship) => relationship.to.sourcePath === "tools/heredoc-only.sh",
    ),
    false,
  );
  assert.equal(
    formatExecutionContractJson(report).includes("tools/heredoc-only.sh"),
    false,
  );
});

test("arithmetic shifts do not hide later shell execution-contract dependencies", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-arithmetic-",
    testContext: t,
  });
  await fixture.skill("demo", {
    id: "skill.demo",
    body: ["# Demo", "", "```bash", "bash tools/entry.sh", "```"].join("\n"),
  });
  await fixture.write(
    "tools/entry.sh",
    [
      "#!/bin/sh",
      "mask=$((1 << 2))",
      "((mask <<= 1))",
      "source ./real-worker.sh",
      "",
    ].join("\n"),
  );
  await fixture.write("tools/real-worker.sh", "#!/bin/sh\nexit 0\n");

  const snapshot = await collectRepositorySnapshot(fixture.root);
  assert.ok(
    snapshot.executableSurfaceInventory.dependencies.some(
      (dependency) =>
        dependency.relation === "static-source" &&
        dependency.normalizedTarget === "tools/real-worker.sh",
    ),
  );

  const report = buildExecutionContract(snapshot, {
    entrypoint: "skill.demo",
  });
  const relationship = report.executableEvidence.relationships.find(
    (candidate) => candidate.to.sourcePath === "tools/real-worker.sh",
  );
  assert.equal(relationship?.relationship, "invokes");
  assert.equal(relationship?.reachability, "transitive");
  assert.equal(relationship?.minimumTargetDepth, 2);
  assert.equal(
    formatExecutionContractJson(report).includes("tools/real-worker.sh"),
    true,
  );
});

test("execution contract accepts an exact SKILL.md path and omits absent revision provenance", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-path-",
    testContext: t,
  });
  await fixture.skill("alpha", {
    id: "skill.alpha",
    body: ["# Alpha", "", "```bash", "bash tools/check.sh", "```"].join("\n"),
  });
  await fixture.write("tools/check.sh", "#!/bin/sh\nexit 0\n");

  const result = await captureMain([
    "execution-contract",
    fixture.root,
    "--entrypoint",
    "./skills/alpha/SKILL.md",
  ]);
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout) as ExecutionContractReport;
  assert.equal(report.subject.id, "skill.alpha");
  assert.equal(report.sourceRevision, undefined);
  assert.match(report.evidenceDigest.value, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    report.analysisBoundary.observations.noUnresolvedStaticEvidenceObserved,
    true,
  );
  assert.equal(
    report.analysisBoundary.observations
      .runtimeOrUnsupportedBehaviorAbsenceProven,
    false,
  );
});

test("execution contract rejects unknown, non-Skill, ambiguous, and unsafe entrypoints deterministically", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-resolution-",
    testContext: t,
  });
  await fixture.skill("alpha", { id: "skill.duplicate" });
  await fixture.skill("beta", { id: "skill.duplicate" });
  await fixture.context("contexts/info.md", { id: "context.info" });

  for (const [entrypoint, expected] of [
    ["skill.unknown", /did not match any asset ID or repository-relative path/],
    ["context.info", /resolved to non-Skill asset context\.info \(context\)/],
    ["skill.duplicate", /entrypoint is ambiguous/],
    [
      "../skills/alpha/SKILL.md",
      /not a safe repository Skill identity or path/,
    ],
  ] as const) {
    const first = await captureMain([
      "execution-contract",
      fixture.root,
      "--entrypoint",
      entrypoint,
    ]);
    const second = await captureMain([
      "execution-contract",
      fixture.root,
      "--entrypoint",
      entrypoint,
    ]);
    assert.equal(first.code, 2);
    assert.equal(first.stdout, "");
    assert.match(first.stderr, expected);
    assert.equal(second.stderr, first.stderr);
  }

  const duplicatePath = await captureMain([
    "execution-contract",
    fixture.root,
    "--entrypoint",
    "skills/alpha/SKILL.md",
  ]);
  assert.equal(duplicatePath.code, 2);
  assert.match(
    duplicatePath.stderr,
    /cannot build a safe executable projection.*Skill ID skill\.duplicate is duplicated/,
  );
});

test("execution contract fails closed when an executable Skill ID collides with a repository-script path", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-identity-collision-",
    testContext: t,
  });
  await fixture.skill("alpha", {
    id: "skill.alpha",
    body: ["# Alpha", "", "```bash", "bash tools/collision.sh", "```"].join(
      "\n",
    ),
  });
  await fixture.skill("beta", {
    id: "tools/collision.sh",
    body: ["# Beta", "", "```bash", "bash tools/second.sh", "```"].join("\n"),
  });
  await fixture.write("tools/collision.sh", "#!/bin/sh\nexit 0\n");
  await fixture.write("tools/second.sh", "#!/bin/sh\nexit 0\n");

  const first = await captureMain([
    "execution-contract",
    fixture.root,
    "--entrypoint",
    "skill.alpha",
  ]);
  const second = await captureMain([
    "execution-contract",
    fixture.root,
    "--entrypoint",
    "skill.alpha",
  ]);

  assert.equal(first.code, 2);
  assert.equal(first.stdout, "");
  assert.equal(first.stderr, second.stderr);
  assert.match(
    first.stderr,
    /Skill IDs collide with repository-script paths: "tools\/collision\.sh" \(Skill source paths: skills\/beta\/SKILL\.md; repository-script path: tools\/collision\.sh\)/,
  );
  assert.doesNotMatch(first.stderr, /tools\/second\.sh/);
});

test("execution contract builder performs no collection after receiving one frozen snapshot", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-snapshot-",
    testContext: t,
  });
  await fixture.skill("alpha", {
    id: "skill.alpha",
    body: ["# Alpha", "", "```bash", "node scripts/check.ts", "```"].join("\n"),
  });
  await fixture.write("skills/alpha/scripts/check.ts", "export {};\n");
  let discoveries = 0;
  let parses = 0;
  const snapshot = await collectRepositorySnapshot(
    fixture.root,
    {},
    {
      onDiscovery: () => {
        discoveries += 1;
      },
      onDocumentParse: () => {
        parses += 1;
      },
    },
  );
  const parsedAtCollection = parses;

  const first = buildExecutionContract(snapshot, { entrypoint: "skill.alpha" });
  const second = buildExecutionContract(snapshot, {
    entrypoint: "skills/alpha/SKILL.md",
  });
  assert.equal(discoveries, 1);
  assert.equal(parses, parsedAtCollection);
  assert.equal(parsedAtCollection, snapshot.scannedFileCount);
  assert.equal(
    formatExecutionContractJson(first),
    formatExecutionContractJson(second),
  );
});

test("execution evidence digest is repeatable, always present, and independent of source revision provenance", async (t) => {
  const fixture = await propertyFixture(t);
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const withoutRevision = buildExecutionContract(snapshot, {
    entrypoint: "skill.property",
  });
  const repeated = buildExecutionContract(snapshot, {
    entrypoint: "skill.property",
  });
  const revisionA = buildExecutionContract(snapshot, {
    entrypoint: "skill.property",
    sourceRevision: "revision-a",
  });
  const revisionB = buildExecutionContract(snapshot, {
    entrypoint: "skill.property",
    sourceRevision: "revision-b",
  });

  assert.deepEqual(withoutRevision.evidenceDigest, {
    algorithm: "sha256",
    value: withoutRevision.evidenceDigest.value,
    scope: "selected_execution_contract_evidence_v1",
    calculatedBy: "renma",
  });
  assert.match(withoutRevision.evidenceDigest.value, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    repeated.evidenceDigest.value,
    withoutRevision.evidenceDigest.value,
  );
  assert.equal(
    revisionA.evidenceDigest.value,
    withoutRevision.evidenceDigest.value,
  );
  assert.equal(
    revisionB.evidenceDigest.value,
    withoutRevision.evidenceDigest.value,
  );
  assert.notEqual(
    formatExecutionContractJson(revisionA),
    formatExecutionContractJson(revisionB),
  );
});

test("execution evidence digest changes with selected content but ignores unrelated surface content", async (t) => {
  const fixture = await digestFixture(t, "renma-execution-contract-digest-");
  const baseline = buildExecutionContract(
    await collectRepositorySnapshot(fixture.root),
    { entrypoint: "skill.digest" },
  );

  await fixture.write("tools/unrelated.sh", "#!/bin/sh\necho changed\n");
  const unrelatedChange = buildExecutionContract(
    await collectRepositorySnapshot(fixture.root),
    { entrypoint: "skill.digest" },
  );
  assert.equal(
    unrelatedChange.evidenceDigest.value,
    baseline.evidenceDigest.value,
  );

  await fixture.write(
    "skills/digest/scripts/a.ts",
    'export const marker = "changed";\n',
  );
  const reachableContentChange = buildExecutionContract(
    await collectRepositorySnapshot(fixture.root),
    { entrypoint: "skill.digest" },
  );
  assert.notEqual(
    reachableContentChange.evidenceDigest.value,
    baseline.evidenceDigest.value,
  );

  await fixture.write(
    "skills/digest/scripts/a.ts",
    'export const marker = "baseline";\n',
  );
  await fixture.skill("digest", {
    id: "skill.digest",
    body: `${digestSkillBody()}\n\nChanged subject guidance.`,
  });
  const subjectContentChange = buildExecutionContract(
    await collectRepositorySnapshot(fixture.root),
    { entrypoint: "skill.digest" },
  );
  assert.notEqual(
    subjectContentChange.evidenceDigest.value,
    baseline.evidenceDigest.value,
  );
});

test("execution evidence digest covers canonical topology and duplicate auditable evidence independently", async (t) => {
  const fixture = await digestFixture(
    t,
    "renma-execution-contract-digest-evidence-",
  );
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const invocation = snapshot.executableSurfaceInventory.invocations[0]!;
  const baseline = buildExecutionContract(snapshot, {
    entrypoint: "skill.digest",
  });

  const topologySnapshot = snapshotWithEvidence(snapshot, {
    invocations: [
      invocation,
      {
        ...invocation,
        line: invocation.line + 1,
        snippet: "node tools/extra.ts",
        rawTarget: "tools/extra.ts",
        normalizedTarget: "tools/extra.ts",
        occurrenceOrdinal: 1,
      },
    ],
    dependencies: snapshot.executableSurfaceInventory.dependencies,
  });
  const topologyChange = buildExecutionContract(topologySnapshot, {
    entrypoint: "skill.digest",
  });
  assert.notDeepEqual(
    relationshipTopology(topologyChange),
    relationshipTopology(baseline),
  );
  assert.notEqual(
    topologyChange.evidenceDigest.value,
    baseline.evidenceDigest.value,
  );

  const duplicateSnapshot = snapshotWithEvidence(snapshot, {
    invocations: [
      invocation,
      { ...invocation, occurrenceOrdinal: invocation.occurrenceOrdinal + 1 },
    ],
    dependencies: snapshot.executableSurfaceInventory.dependencies,
  });
  const duplicateEvidence = buildExecutionContract(duplicateSnapshot, {
    entrypoint: "skill.digest",
  });
  assert.deepEqual(
    relationshipTopology(duplicateEvidence),
    relationshipTopology(baseline),
  );
  assert.equal(
    duplicateEvidence.executableEvidence.relationships[0]?.evidence.length,
    2,
  );
  assert.notEqual(
    duplicateEvidence.evidenceDigest.value,
    baseline.evidenceDigest.value,
  );
});

test("execution evidence digest and portable JSON are independent of absolute checkout location", async (t) => {
  const firstFixture = await digestFixture(
    t,
    "renma-execution-contract-digest-location-a-",
  );
  const secondFixture = await digestFixture(
    t,
    "renma-execution-contract-digest-location-b-",
  );
  const first = buildExecutionContract(
    await collectRepositorySnapshot(firstFixture.root),
    { entrypoint: "skill.digest" },
  );
  const second = buildExecutionContract(
    await collectRepositorySnapshot(secondFixture.root),
    { entrypoint: "skill.digest" },
  );

  assert.notEqual(firstFixture.root, secondFixture.root);
  assert.equal(first.evidenceDigest.value, second.evidenceDigest.value);
  assert.equal(
    formatExecutionContractJson(first),
    formatExecutionContractJson(second),
  );
});

test("execution contract evidence membership and coverage follow the canonical executable helpers", async (t) => {
  const fixture = await canonicalEvidenceFixture(t);
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const inventory = snapshot.executableSurfaceInventory;
  const invocationEdges = canonicalExecutableInvocationGraphEdges(
    inventory.invocations,
  );
  const dependencyEdges = canonicalExecutableDependencyGraphEdges(
    inventory.dependencies,
  );
  const invocationKeys = new Set(
    invocationEdges.map((edge) => evidencePairKey(edge)),
  );
  const dependencyKeys = new Set(
    dependencyEdges.map((edge) => evidencePairKey(edge)),
  );
  const expectedInvocationEvidenceCount = inventory.invocations.filter(
    (invocation) =>
      invocation.normalizedTarget !== undefined &&
      invocationKeys.has(evidencePairKey(invocation)),
  ).length;
  const expectedDependencyEvidenceCount = inventory.dependencies.filter(
    (dependency) =>
      dependency.normalizedTarget !== undefined &&
      dependencyKeys.has(evidencePairKey(dependency)),
  ).length;

  const report = buildExecutionContract(snapshot, {
    entrypoint: "skill.canonical-evidence",
  });
  const directTargets = report.executableEvidence.relationships
    .filter((relationship) => relationship.reachability === "direct")
    .map((relationship) => relationship.to.sourcePath)
    .sort((left, right) => left.localeCompare(right));
  const transitivePairs = report.executableEvidence.relationships
    .filter((relationship) => relationship.reachability === "transitive")
    .map((relationship) =>
      evidencePairKey({
        sourcePath: relationship.from.sourcePath,
        normalizedTarget: relationship.to.sourcePath,
      }),
    )
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(
    directTargets,
    invocationEdges
      .map((edge) => edge.normalizedTarget)
      .sort((left, right) => left.localeCompare(right)),
  );
  assert.deepEqual(
    transitivePairs,
    dependencyEdges
      .map((edge) => evidencePairKey(edge))
      .sort((left, right) => left.localeCompare(right)),
  );

  const relationshipEvidence = report.executableEvidence.relationships.flatMap(
    (relationship) => relationship.evidence,
  );
  const invocationEvidence = relationshipEvidence.filter(
    (evidence) => evidence.type === "invocation",
  );
  const dependencyEvidence = relationshipEvidence.filter(
    (evidence) => evidence.type === "dependency",
  );
  assert.equal(invocationEvidence.length, expectedInvocationEvidenceCount);
  assert.equal(dependencyEvidence.length, expectedDependencyEvidenceCount);
  assert.equal(
    invocationEvidence.every(
      (evidence) =>
        evidence.normalizedTarget !== undefined &&
        invocationKeys.has(evidencePairKey(evidence)),
    ),
    true,
  );
  assert.equal(
    dependencyEvidence.every(
      (evidence) =>
        evidence.normalizedTarget !== undefined &&
        dependencyKeys.has(evidencePairKey(evidence)),
    ),
    true,
  );
  assert.deepEqual(
    [
      ...new Set(relationshipEvidence.map((evidence) => evidence.resolution)),
    ].sort((left, right) => left.localeCompare(right)),
    ["noncanonical", "resolved"],
  );

  assert.deepEqual(
    report.executableEvidence.unresolvedEvidence.map((evidence) => [
      evidence.type,
      evidence.resolution,
      evidence.type === "invocation"
        ? evidence.rawTarget
        : evidence.rawSpecifier,
    ]),
    [
      ["dependency", "missing", "../../orphan/scripts/missing.ts"],
      ["invocation", "unsafe", "/opt/vendor/scripts/run.js"],
    ],
  );
  assert.equal(
    report.executableEvidence.relationships.find(
      (relationship) =>
        relationship.to.sourcePath === "skills/canonical-evidence/scripts/a.ts",
    )?.evidence.length,
    2,
  );
  assert.equal(
    report.executableEvidence.relationships.find(
      (relationship) =>
        relationship.to.sourcePath === "skills/orphan/scripts/transitive.ts",
    )?.evidence.length,
    2,
  );
  assert.deepEqual(report.analysisBoundary.coverage, {
    reachableRepositoryScriptCount: 3,
    recognizedInvocationEvidenceCount: inventory.invocations.length,
    recognizedDependencyEvidenceCount: inventory.dependencies.length,
    topologicalInvocationEvidenceCount: expectedInvocationEvidenceCount,
    topologicalDependencyEvidenceCount: expectedDependencyEvidenceCount,
    nonTopologicalEvidenceCount:
      inventory.invocations.length +
      inventory.dependencies.length -
      expectedInvocationEvidenceCount -
      expectedDependencyEvidenceCount,
  });
});

test("canonical relationship topology is invariant under evidence permutations and duplicates while multiplicity remains auditable", async (t) => {
  const fixture = await propertyFixture(t);
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const invocation = snapshot.executableSurfaceInventory.invocations[0]!;
  const dependency = snapshot.executableSurfaceInventory.dependencies[0]!;
  const baseline = buildExecutionContract(snapshot, {
    entrypoint: "skill.property",
  });
  const topology = relationshipTopology(baseline);

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 8 }),
      fc.integer({ min: 1, max: 8 }),
      fc.boolean(),
      (invocationCount, dependencyCount, reverse) => {
        const invocations = Array.from(
          { length: invocationCount },
          (_, index) => ({ ...invocation, occurrenceOrdinal: index + 1 }),
        );
        const dependencies = Array.from(
          { length: dependencyCount },
          (_, index) => ({ ...dependency, occurrenceOrdinal: index + 1 }),
        );
        const candidate = snapshotWithEvidence(snapshot, {
          invocations: reverse ? invocations.toReversed() : invocations,
          dependencies: reverse ? dependencies.toReversed() : dependencies,
        });
        const opposite = snapshotWithEvidence(snapshot, {
          invocations: reverse ? invocations : invocations.toReversed(),
          dependencies: reverse ? dependencies : dependencies.toReversed(),
        });
        const report = buildExecutionContract(candidate, {
          entrypoint: "skill.property",
        });
        const oppositeReport = buildExecutionContract(opposite, {
          entrypoint: "skill.property",
        });

        assert.deepEqual(relationshipTopology(report), topology);
        assert.equal(
          report.executableEvidence.relationships[0]!.evidence.length,
          invocationCount,
        );
        assert.equal(
          report.executableEvidence.relationships[1]!.evidence.length,
          dependencyCount,
        );
        assert.equal(
          formatExecutionContractJson(report),
          formatExecutionContractJson(oppositeReport),
        );
      },
    ),
    { seed: 82_604, numRuns: 100 },
  );
});

async function comprehensiveFixture(
  t: TestContext,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-",
    testContext: t,
  });
  await fixture.skill("release-prep", {
    id: "skill.release-prep",
    status: "suspended",
    statusReason: "Release automation is paused",
    statusChangedAt: "2026-07-31",
    body: [
      "# Release prep",
      "",
      "```bash",
      "node scripts/prepare.ts",
      "node scripts/prepare.ts",
      "bash tools/shared.sh",
      "node /opt/vendor/scripts/run.js",
      "```",
    ].join("\n"),
  });
  await fixture.skill("publish", {
    id: "skill.publish",
    body: ["# Publish", "", "```bash", "bash tools/shared.sh", "```"].join(
      "\n",
    ),
  });
  await fixture.write(
    "skills/release-prep/scripts/prepare.ts",
    [
      'import "../../../tools/transitive.sh";',
      'import "../../../tools/transitive.sh";',
      'import "../../../tools/missing.sh";',
      "",
    ].join("\n"),
  );
  await fixture.write("skills/release-prep/scripts/unused.ts", "export {};\n");
  await fixture.write(
    "tools/shared.sh",
    "#!/bin/sh\nsource ./transitive.sh\nexit 0\n",
  );
  await fixture.write("tools/transitive.sh", "#!/bin/sh\nexit 0\n");
  return fixture;
}

async function propertyFixture(t: TestContext): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-property-",
    testContext: t,
  });
  await fixture.skill("property", {
    id: "skill.property",
    body: ["# Property", "", "```bash", "node scripts/a.ts", "```"].join("\n"),
  });
  await fixture.write(
    "skills/property/scripts/a.ts",
    'import "../../../tools/b.sh";\n',
  );
  await fixture.write("tools/b.sh", "#!/bin/sh\nexit 0\n");
  return fixture;
}

async function digestFixture(
  t: TestContext,
  prefix: string,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({ prefix, testContext: t });
  await fixture.skill("digest", {
    id: "skill.digest",
    body: digestSkillBody(),
  });
  await fixture.write(
    "skills/digest/scripts/a.ts",
    'export const marker = "baseline";\n',
  );
  await fixture.write("tools/extra.ts", "export {};\n");
  await fixture.write("tools/unrelated.sh", "#!/bin/sh\nexit 0\n");
  return fixture;
}

function digestSkillBody(): string {
  return ["# Digest", "", "```bash", "node scripts/a.ts", "```"].join("\n");
}

async function canonicalEvidenceFixture(
  t: TestContext,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-execution-contract-canonical-evidence-",
    testContext: t,
  });
  await fixture.skill("canonical-evidence", {
    id: "skill.canonical-evidence",
    body: [
      "# Canonical evidence",
      "",
      "```bash",
      "node scripts/a.ts",
      "node scripts/a.ts",
      "node skills/orphan/scripts/direct.ts",
      "node /opt/vendor/scripts/run.js",
      "```",
    ].join("\n"),
  });
  await fixture.write(
    "skills/canonical-evidence/scripts/a.ts",
    [
      'import "../../orphan/scripts/transitive.ts";',
      'import "../../orphan/scripts/transitive.ts";',
      'import "../../orphan/scripts/missing.ts";',
      "",
    ].join("\n"),
  );
  await fixture.write("skills/orphan/scripts/direct.ts", "export {};\n");
  await fixture.write("skills/orphan/scripts/transitive.ts", "export {};\n");
  return fixture;
}

function snapshotWithEvidence(
  snapshot: RepositorySnapshot,
  evidence: Pick<
    RepositorySnapshot["executableSurfaceInventory"],
    "invocations" | "dependencies"
  >,
): RepositorySnapshot {
  return {
    ...snapshot,
    executableSurfaceInventory: {
      ...snapshot.executableSurfaceInventory,
      invocations: evidence.invocations,
      dependencies: evidence.dependencies,
    },
  };
}

function relationshipTopology(report: ExecutionContractReport): unknown {
  return report.executableEvidence.relationships.map((relationship) => ({
    from: relationship.from,
    to: relationship.to,
    relationship: relationship.relationship,
    expectation: relationship.expectation,
    reachability: relationship.reachability,
    minimumTargetDepth: relationship.minimumTargetDepth,
  }));
}

function evidencePairKey(evidence: {
  sourcePath: string;
  normalizedTarget?: string;
}): string {
  return JSON.stringify([evidence.sourcePath, evidence.normalizedTarget]);
}

async function captureMain(argv: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const log = console.log;
  const error = console.error;
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  console.log = (...values: unknown[]) => {
    stdout += `${values.map(String).join(" ")}\n`;
  };
  console.error = (...values: unknown[]) => {
    stderr += `${values.map(String).join(" ")}\n`;
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await main(argv), stdout, stderr };
  } finally {
    console.log = log;
    console.error = error;
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
