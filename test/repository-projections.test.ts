import assert from "node:assert/strict";
import test from "node:test";

import { buildBomReport } from "../src/commands/bom.js";
import { readinessFromRepositorySnapshot } from "../src/commands/readiness.js";
import {
  collectRepositoryEvidence,
  collectRepositorySnapshot,
  type RepositoryCollectionInstrumentation,
  type RepositoryProjectionName,
} from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";
import { RepositoryFixture } from "./repository-fixture.js";

test("one collection parses once and memoizes every requested projection", async (t) => {
  const fixture = await repositoryFixture(t);
  const { root } = fixture;
  let discoveryCount = 0;
  const parsedPaths: string[] = [];
  const projectionCounts = new Map<RepositoryProjectionName, number>();
  const instrumentation = collectionInstrumentation(
    () => {
      discoveryCount += 1;
    },
    (artifactPath) => parsedPaths.push(artifactPath),
    (projection) =>
      projectionCounts.set(
        projection,
        (projectionCounts.get(projection) ?? 0) + 1,
      ),
  );

  const snapshot = await collectRepositorySnapshot(root, {}, instrumentation);
  assert.equal(discoveryCount, 1);
  assert.equal(parsedPaths.length, snapshot.scannedFileCount);
  assert.ok(Object.isFrozen(snapshot.core));

  assert.equal(snapshot.catalog, snapshot.catalog);
  assert.equal(snapshot.skillParents, snapshot.skillParents);
  assert.equal(snapshot.agentSkills, snapshot.agentSkills);
  assert.equal(snapshot.skillDiscovery, snapshot.skillDiscovery);
  assert.equal(snapshot.classifications, snapshot.classifications);
  assert.equal(snapshot.securityPolicies, snapshot.securityPolicies);
  assert.equal(snapshot.contextLens, snapshot.contextLens);
  assert.equal(snapshot.diagnostics, snapshot.diagnostics);

  assert.equal(discoveryCount, 1);
  assert.equal(parsedPaths.length, snapshot.scannedFileCount);
  for (const count of projectionCounts.values()) assert.equal(count, 1);
  assert.deepEqual([...projectionCounts.keys()].sort(), [
    "agent-skills",
    "catalog",
    "classifications",
    "context-lens",
    "repository-paths",
    "security-policies",
    "skill-discovery",
  ]);
});

test("caller-visible mutations cannot change later lazy projections", async (t) => {
  const fixture = await mutationRepositoryFixture(t);
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const original = await collectRepositorySnapshot(fixture.root);

  const catalogBefore = snapshot.catalog;
  const expected = {
    catalog: original.catalog,
    agentSkills: original.agentSkills,
    skillDiscovery: original.skillDiscovery,
    classifications: original.classifications,
    securityPolicies: original.securityPolicies,
    contextLens: original.contextLens,
  };

  assert.throws(() => snapshot.documents.pop(), TypeError);
  assert.throws(() => snapshot.artifacts.pop(), TypeError);
  assert.throws(() => {
    snapshot.config.skillDiscovery.adopted = false;
  }, TypeError);
  assert.throws(() => {
    const document = snapshot.documents[0];
    if (document) document.lines[0] = "mutated";
  }, TypeError);
  assert.throws(() => {
    const artifact = snapshot.artifacts[0];
    if (artifact) artifact.path = "skills/mutated/SKILL.md";
  }, TypeError);
  assert.throws(
    () =>
      (snapshot.core.discoveredPaths as Set<string>).add(
        "skills/mutated/SKILL.md",
      ),
    TypeError,
  );
  assert.throws(
    () =>
      (snapshot.repositoryPaths as Set<string>).add("skills/mutated/SKILL.md"),
    TypeError,
  );
  assert.throws(
    () =>
      (snapshot.repositoryPathStates as Map<string, "parsed" | "absent">).set(
        "skills/mutated/SKILL.md",
        "parsed",
      ),
    TypeError,
  );
  assert.throws(() => catalogBefore.entries.pop(), TypeError);
  assert.throws(() => {
    const entry = catalogBefore.entries[0];
    if (entry) entry.metadata.owner = "mutated";
  }, TypeError);

  assert.deepEqual(snapshot.catalog, expected.catalog);
  assert.deepEqual(snapshot.agentSkills, expected.agentSkills);
  assert.deepEqual(snapshot.skillDiscovery, expected.skillDiscovery);
  assert.deepEqual(
    [...snapshot.classifications],
    [...expected.classifications],
  );
  assert.deepEqual(snapshot.securityPolicies, expected.securityPolicies);
  assert.deepEqual(snapshot.contextLens, expected.contextLens);

  assert.equal(snapshot.catalog, catalogBefore);
  assert.equal(snapshot.agentSkills, snapshot.agentSkills);
  assert.equal(snapshot.skillDiscovery, snapshot.skillDiscovery);
  assert.equal(snapshot.classifications, snapshot.classifications);
  assert.equal(snapshot.securityPolicies, snapshot.securityPolicies);
  assert.equal(snapshot.contextLens, snapshot.contextLens);
});

test("catalog evidence does not prepare unrelated snapshot projections", async (t) => {
  const { root } = await repositoryFixture(t);
  const projections: RepositoryProjectionName[] = [];
  const result = await collectRepositoryEvidence(
    root,
    {},
    collectionInstrumentation(undefined, undefined, (projection) =>
      projections.push(projection),
    ),
  );

  assert.equal(result.catalog.entries.length, 1);
  assert.deepEqual(projections, ["catalog", "context-lens"]);
});

test("scan, Readiness, and BOM reuse one collected core", async (t) => {
  const { root } = await repositoryFixture(t);
  let discoveryCount = 0;
  const projectionCounts = new Map<RepositoryProjectionName, number>();
  const snapshot = await collectRepositorySnapshot(
    root,
    {},
    collectionInstrumentation(
      () => {
        discoveryCount += 1;
      },
      undefined,
      (projection) =>
        projectionCounts.set(
          projection,
          (projectionCounts.get(projection) ?? 0) + 1,
        ),
    ),
  );
  const core = snapshot.core;

  const scan = scanFromRepositorySnapshot(snapshot);
  const readiness = readinessFromRepositorySnapshot(snapshot);
  const bom = buildBomReport(snapshot, { omitGeneratedAt: true });

  assert.equal(snapshot.core, core);
  assert.equal(scan.root, core.root);
  assert.equal(readiness.root, core.root);
  assert.equal(bom.root, core.root);
  assert.equal(discoveryCount, 1);
  for (const count of projectionCounts.values()) assert.equal(count, 1);
});

test("Readiness prepares and reuses the Skill Discovery projection at most once", async (t) => {
  const { root } = await repositoryFixture(t);
  let discoveryCount = 0;
  let parseCount = 0;
  const projectionCounts = new Map<RepositoryProjectionName, number>();
  const snapshot = await collectRepositorySnapshot(
    root,
    {},
    collectionInstrumentation(
      () => {
        discoveryCount += 1;
      },
      () => {
        parseCount += 1;
      },
      (projection) =>
        projectionCounts.set(
          projection,
          (projectionCounts.get(projection) ?? 0) + 1,
        ),
    ),
  );

  const first = readinessFromRepositorySnapshot(snapshot);
  const second = readinessFromRepositorySnapshot(snapshot);

  assert.equal(discoveryCount, 1);
  assert.equal(parseCount, snapshot.scannedFileCount);
  assert.equal(projectionCounts.get("skill-discovery"), 1);
  assert.equal(projectionCounts.get("catalog"), 1);
  assert.equal(projectionCounts.get("agent-skills"), 1);
  assert.deepEqual(first.summary.skillDiscovery, second.summary.skillDiscovery);
});

test("a working tree mutation cannot partially affect lazy projections", async (t) => {
  const fixture = await repositoryFixture(t);
  const { root } = fixture;
  const snapshot = await collectRepositorySnapshot(root);

  await fixture.write(
    "skills/demo/SKILL.md",
    "---\nname: [invalid\n---\n# Changed\n",
  );

  assert.equal(snapshot.agentSkills.validSkillCount, 1);
  assert.equal(snapshot.agentSkills.invalidSkillCount, 0);
  assert.equal(snapshot.catalog.entries[0]?.id, "skill.demo");

  const freshSnapshot = await collectRepositorySnapshot(root);
  assert.equal(freshSnapshot.agentSkills.validSkillCount, 0);
  assert.equal(freshSnapshot.agentSkills.invalidSkillCount, 1);
});

function collectionInstrumentation(
  onDiscovery?: () => void,
  onDocumentParse?: (artifactPath: string) => void,
  onProjection?: (projection: RepositoryProjectionName) => void,
): RepositoryCollectionInstrumentation {
  return {
    ...(onDiscovery ? { onDiscovery } : {}),
    ...(onDocumentParse ? { onDocumentParse } : {}),
    ...(onProjection ? { onProjection } : {}),
  };
}

async function repositoryFixture(
  t: test.TestContext,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-projections-",
    testContext: t,
  });
  await fixture.skill("demo", {
    id: "skill.demo",
    owner: "qa",
    status: "stable",
  });
  return fixture;
}

async function mutationRepositoryFixture(
  t: test.TestContext,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-immutable-projections-",
    testContext: t,
  });
  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  await fixture.skill("source", {
    id: "skill.source",
    owner: "qa",
    status: "stable",
    continuesWith: ["skill.target"],
    publishedEntrypoint: true,
  });
  await fixture.skill("target", {
    id: "skill.target",
    owner: "qa",
    status: "stable",
  });
  await fixture.context("contexts/reference.md", {
    id: "context.reference",
    owner: "qa",
    status: "stable",
    whenToUse: ["repository review"],
    whenNotToUse: ["runtime selection"],
  });
  await fixture.contextLens("lenses/review.md", {
    id: "lens.review",
    owner: "qa",
    purpose: "Review repository evidence.",
    appliesTo: ["context.reference"],
    focus: ["governance"],
    expectedOutputs: ["review summary"],
  });
  return fixture;
}
