import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("one collection parses once and memoizes every requested projection", async (t) => {
  const root = await repositoryFixture(t);
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

test("catalog evidence does not prepare unrelated snapshot projections", async (t) => {
  const root = await repositoryFixture(t);
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
  const root = await repositoryFixture(t);
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

test("a working tree mutation cannot partially affect lazy projections", async (t) => {
  const root = await repositoryFixture(t);
  const skillPath = path.join(root, "skills", "demo", "SKILL.md");
  const snapshot = await collectRepositorySnapshot(root);

  await writeFile(skillPath, "---\nname: [invalid\n---\n# Changed\n");

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

async function repositoryFixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-projections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillPath = path.join(root, "skills", "demo", "SKILL.md");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(
    skillPath,
    `---
name: demo
description: Review repository evidence. Use when snapshot projections need validation.
metadata:
  renma.id: skill.demo
  renma.owner: qa
  renma.status: stable
---
# Demo

Use this Skill when validating repository evidence.
Do not use it for runtime selection.
`,
  );
  return root;
}
