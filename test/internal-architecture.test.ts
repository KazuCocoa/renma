import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildCatalog } from "../src/catalog.js";
import type {
  InspectAssetSummary,
  InspectOutline,
  InspectRelationship,
  InspectRelationshipChain,
  InspectSlice,
} from "../src/commands/inspect.js";
import { buildMetadataSuggestion } from "../src/commands/suggest-metadata.js";
import {
  collectTargetDocumentEvidence,
  collectTargetRepositoryEvidence,
} from "../src/evidence/target.js";

type EstablishedInspectTypes =
  | InspectOutline
  | InspectAssetSummary
  | InspectRelationship
  | InspectRelationshipChain
  | InspectSlice;

// The type-only use makes removal from the established command module a
// compile-time failure while allowing the implementation to move elsewhere.
const establishedInspectTypeCompatibility: EstablishedInspectTypes | undefined =
  undefined;
void establishedInspectTypeCompatibility;

test("metadata suggestion decision branches retain their established contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-decision-matrix-"));
  await mkdir(path.join(root, ".git"));
  const candidate = path.join(root, "contexts", "candidate.md");
  const sufficient = path.join(root, "contexts", "sufficient.md");
  const tool = path.join(root, "tools", "helper.mjs");
  const unknown = path.join(root, "skills", "demo", "tools", "helper.mjs");
  for (const target of [candidate, sufficient, tool, unknown]) {
    await mkdir(path.dirname(target), { recursive: true });
  }
  await writeFile(candidate, "# Candidate\n");
  await writeFile(
    sufficient,
    "---\nid: context.sufficient\ntitle: Sufficient\nowner: docs\n---\n# Sufficient\n",
  );
  await writeFile(tool, "export {};\n");
  await writeFile(unknown, "export {};\n");

  const results = await Promise.all([
    buildMetadataSuggestion(candidate),
    buildMetadataSuggestion(sufficient),
    buildMetadataSuggestion(sufficient, { owner: "qa" }),
    buildMetadataSuggestion(tool),
    buildMetadataSuggestion(unknown),
  ]);
  assert.deepEqual(
    results.map((result) => ({
      status: result.decisionStatus,
      reasonCode: result.decision.reasonCode,
      suggestedMode: result.suggestedMode,
    })),
    [
      {
        status: "human-confirmation-required",
        reasonCode: "independent-governance-intent-unconfirmed",
        suggestedMode: "metadata-retrofit",
      },
      {
        status: "no-change-recommended",
        reasonCode: "metadata-already-sufficient",
        suggestedMode: "no-proposal",
      },
      {
        status: "blocked",
        reasonCode: "conflicting-ownership-evidence",
        suggestedMode: "no-proposal",
      },
      {
        status: "no-change-recommended",
        reasonCode: "repository-tool-not-context",
        suggestedMode: "no-proposal",
      },
      {
        status: "no-change-recommended",
        reasonCode: "outside-recognized-asset-boundary",
        suggestedMode: "no-proposal",
      },
    ],
  );
});

test("target repository evidence preserves exact unavailable boundary reasons", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-target-boundary-"));
  const cases = [
    {
      relativePath: "references/note.md",
      reason: "repository-boundary-unresolved",
    },
    {
      relativePath: "references/contexts/note.md",
      reason: "repository-boundary-ambiguous",
    },
  ] as const;

  for (const fixture of cases) {
    const targetPath = path.join(root, fixture.relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "# Boundary fixture\n");
    const target = await collectTargetDocumentEvidence(targetPath, {
      unresolvedArtifactPath: "absolute",
    });
    const repository = await collectTargetRepositoryEvidence(target);

    assert.equal(target.repositoryBoundary.state, "unresolved");
    if (target.repositoryBoundary.state !== "unresolved") continue;
    assert.equal(target.repositoryBoundary.reasonCode, fixture.reason);
    assert.equal(repository.state, "unavailable");
    if (repository.state !== "unavailable") continue;
    assert.equal(repository.reason, fixture.reason);
  }
});

test("target repository evidence keeps snapshot collection failures distinct", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-target-snapshot-"));
  const targetPath = path.join(root, "contexts", "note.md");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(path.join(root, "renma.config.json"), "{}\n");
  await writeFile(targetPath, "# Snapshot fixture\n");
  const target = await collectTargetDocumentEvidence(targetPath, {
    unresolvedArtifactPath: "absolute",
  });
  assert.equal(target.repositoryBoundary.state, "resolved");

  await writeFile(path.join(root, "renma.config.json"), "{ invalid\n");
  const repository = await collectTargetRepositoryEvidence(target);
  assert.equal(repository.state, "unavailable");
  if (repository.state !== "unavailable") return;
  assert.equal(repository.reason, "snapshot-unavailable");
});

test("one snapshot keeps catalog ownership and target parent governance aligned", async () => {
  const fixtures = [
    {
      label: "canonical parent",
      parents: ["skills/demo/SKILL.md"],
      parentState: "resolved",
      owner: "qa-platform",
      expectedOwnership: "inherited",
    },
    {
      label: "historical parent",
      parents: ["skills/demo/skill.md"],
      parentState: "resolved",
      owner: "qa-platform",
      expectedOwnership: "unowned",
    },
    {
      label: "missing parent",
      parents: [],
      parentState: "missing",
      owner: undefined,
      expectedOwnership: "unowned",
    },
    {
      label: "ambiguous parent",
      parents: ["skills/demo/SKILL.md", "skills/demo.skill.md"],
      parentState: "ambiguous",
      owner: "qa-platform",
      expectedOwnership: "unowned",
    },
  ] as const;

  for (const fixture of fixtures) {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "renma-parent-index-evidence-"),
    );
    const supportPath = "skills/demo/scripts/run.mjs";
    await mkdir(path.join(root, ".git"));
    await mkdir(path.dirname(path.join(root, supportPath)), {
      recursive: true,
    });
    await writeFile(path.join(root, supportPath), "console.log('safe');\n");
    for (const parentPath of fixture.parents) {
      await mkdir(path.dirname(path.join(root, parentPath)), {
        recursive: true,
      });
      await writeFile(
        path.join(root, parentPath),
        skillDocument(fixture.owner),
      );
    }

    const target = await collectTargetDocumentEvidence(
      path.join(root, supportPath),
      { unresolvedArtifactPath: "absolute" },
    );
    const repository = await collectTargetRepositoryEvidence(target);
    assert.equal(repository.state, "resolved", fixture.label);
    if (repository.state !== "resolved") continue;
    assert.equal(repository.parent.state, fixture.parentState, fixture.label);
    assert.equal(
      repository.classification.parentResolution,
      fixture.parentState,
      fixture.label,
    );
    assert.equal(
      repository.entry?.ownership.source,
      fixture.expectedOwnership,
      fixture.label,
    );
    assert.deepEqual(
      repository.governance?.ownership,
      repository.entry?.ownership,
      fixture.label,
    );
  }
});

test("catalog construction consumes the supplied snapshot parent index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-supplied-index-"));
  const parentPath = "skills/demo/SKILL.md";
  const supportPath = "skills/demo/scripts/run.mjs";
  await mkdir(path.join(root, ".git"));
  await mkdir(path.dirname(path.join(root, supportPath)), { recursive: true });
  await writeFile(path.join(root, parentPath), skillDocument("qa-platform"));
  await writeFile(path.join(root, supportPath), "console.log('safe');\n");

  const target = await collectTargetDocumentEvidence(
    path.join(root, supportPath),
    {
      unresolvedArtifactPath: "absolute",
    },
  );
  const repository = await collectTargetRepositoryEvidence(target);
  assert.equal(repository.state, "resolved");
  if (repository.state !== "resolved") return;
  assert.equal(repository.entry?.ownership.source, "inherited");

  const suppliedWithoutParents = buildCatalog(
    repository.snapshot.documents,
    repository.snapshot.repositoryPaths,
    new Map(),
  );
  const support = suppliedWithoutParents.catalog.entries.find(
    (entry) => entry.sourcePath === supportPath,
  );
  assert.equal(support?.ownership.source, "unowned");
});

function skillDocument(owner: string | undefined): string {
  return [
    "---",
    "name: demo",
    "description: Review support. Use when parent evidence needs validation.",
    "metadata:",
    "  renma.id: skill.demo",
    ...(owner ? [`  renma.owner: ${owner}`] : []),
    "---",
    "# Demo",
    "",
    "Run scripts/run.mjs.",
    "",
  ].join("\n");
}
