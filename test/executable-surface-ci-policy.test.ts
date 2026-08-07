import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXECUTABLE_SURFACE_CI_MATCH_IDS,
  effectiveExecutableSurfaceCiPolicy,
  evaluateExecutableSurfaceCiPolicy,
} from "../src/executable-surface-ci-policy.js";
import {
  buildExecutableSurfaceDiff,
  type ExecutableInvocationGovernanceChange,
  type ExecutableInvocationGovernanceDelta,
  type ExecutableSurfaceDiff,
} from "../src/executable-surface-diff.js";
import { zeroExecutableSurfaceInventory } from "../src/executable-surface-inventory.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";

test("evaluator projects every high-signal executable-surface match deterministically", () => {
  const diff = neutralDiff();
  diff.addedSurfacePaths = ["tools/new.mjs"];
  diff.newProblematicInvocations = [
    {
      sourcePath: "skills/release/SKILL.md",
      line: 42,
      launcher: "node",
      target: "tools/missing.mjs",
      occurrenceOrdinal: 1,
      resolution: "missing",
    },
  ];
  diff.newProblematicDependencies = [
    {
      sourcePath: "tools/release.mjs",
      line: 4,
      analyzer: "js-ts",
      relation: "static-import",
      target: "tools/missing-helper.mjs",
      occurrenceOrdinal: 1,
      resolution: "missing",
    },
  ];
  diff.newInvocationsWithoutEffectivePolicyEvidence = [
    governanceDelta({ fingerprints: [], effective: false }),
  ];
  diff.invocationsLostEffectivePolicyEvidence = [
    governanceChange({
      fromEffective: true,
      toEffective: false,
      fromFingerprints: ["policy-a"],
      toFingerprints: [],
    }),
  ];
  diff.newInvocationsWithMultipleEffectivePolicyFingerprints = [
    governanceDelta({
      target: "tools/new-ambiguous.mjs",
      fingerprints: ["policy-a", "policy-b"],
      effective: true,
    }),
  ];
  diff.invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints = [
    governanceChange({
      target: "tools/existing-ambiguous.mjs",
      fromEffective: true,
      toEffective: true,
      fromFingerprints: ["policy-a"],
      toFingerprints: ["policy-a", "policy-b"],
    }),
  ];
  diff.newlyUnreachableSkillLocalPaths = ["skills/release/scripts/local.sh"];
  diff.surfacesLostStaticInvocationReachability = ["tools/orphaned.mjs"];
  diff.newlyTransitivelyReachableSurfacePaths = ["tools/transitive.mjs"];

  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.equal(
    evaluation.schemaVersion,
    "renma.executable-surface-ci-policy.v1",
  );
  assert.equal(evaluation.outcome, "fail");
  assert.equal(evaluation.matchCount, 10);
  assert.deepEqual(
    evaluation.matches.map((match) => match.id),
    [
      EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_AMBIGUOUS,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_AMBIGUOUS,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_EVIDENCE_LOST,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_EVIDENCE_MISSING,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_DEPENDENCY_ADDED,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_INVOCATION_ADDED,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.SKILL_LOCAL_REACHABILITY_LOST,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.STATIC_INVOCATION_REACHABILITY_LOST,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.TRANSITIVE_REACHABILITY_ADDED,
    ],
  );
  assert.deepEqual(
    evaluation.matches.find(
      (match) =>
        match.id ===
        EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_INVOCATION_ADDED,
    ),
    {
      id: EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_INVOCATION_ADDED,
      kind: "invocation",
      sourcePath: "skills/release/SKILL.md",
      line: 42,
      launcher: "node",
      target: "tools/missing.mjs",
      occurrenceOrdinal: 1,
      resolution: "missing",
      summary: "A new invocation has problematic resolution evidence.",
    },
  );
});

test("overlapping invocation governance reasons remain separate matches", () => {
  const diff = neutralDiff();
  const invocation = governanceDelta({
    fingerprints: ["policy-a", "policy-b"],
    effective: false,
  });
  diff.newInvocationsWithoutEffectivePolicyEvidence = [invocation];
  diff.newInvocationsWithMultipleEffectivePolicyFingerprints = [invocation];

  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "warn",
    to: "warn",
  });

  assert.equal(evaluation.matchCount, 2);
  assert.deepEqual(
    evaluation.matches.map((match) => match.id),
    [
      EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_AMBIGUOUS,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_EVIDENCE_MISSING,
    ],
  );
});

test("problematic dependency match consumes canonical JS analyzer evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "renma-executable-ci-dependency-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(
    join(root, "renma.config.json"),
    JSON.stringify({ globs: ["tools/**/*"] }),
  );
  const before = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  await mkdir(join(root, "tools"), { recursive: true });
  await writeFile(join(root, "tools", "main.mjs"), 'import "./missing.mjs";\n');
  const after = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;

  const evaluation = evaluateExecutableSurfaceCiPolicy(
    buildExecutableSurfaceDiff(before, after),
    { from: "fail", to: "fail" },
  );
  const match = evaluation.matches.find(
    (candidate) =>
      candidate.id ===
      EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_DEPENDENCY_ADDED,
  );

  assert.deepEqual(match, {
    id: EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_DEPENDENCY_ADDED,
    kind: "dependency",
    sourcePath: "tools/main.mjs",
    line: 1,
    analyzer: "js-ts",
    relation: "static-import",
    target: "tools/missing.mjs",
    occurrenceOrdinal: 1,
    resolution: "missing",
    summary: "A new executable dependency has problematic resolution evidence.",
  });
});

test("removed directly invoked surface is not a static reachability-loss policy match", async (t) => {
  const root = await realDiffFixture(t);
  await writeSkill(root, ["```bash", "node tools/helper.mjs", "```"]);
  await writeExecutable(root, "tools/helper.mjs");
  const before = await executableInventory(root);

  await writeSkill(root, []);
  await rm(join(root, "tools", "helper.mjs"));
  const after = await executableInventory(root);
  const diff = buildExecutableSurfaceDiff(before, after);
  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.ok(diff.removedSurfacePaths.includes("tools/helper.mjs"));
  assert.ok(
    !hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.STATIC_INVOCATION_REACHABILITY_LOST,
      "tools/helper.mjs",
    ),
  );
  assert.ok(
    !evaluation.matches.some(
      (match) => match.id === EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED,
    ),
  );
});

test("removed transitively reachable surface is not a static reachability-loss policy match", async (t) => {
  const root = await realDiffFixture(t);
  await writeSkill(root, ["```bash", "node tools/a.mjs", "```"]);
  await writeExecutable(root, "tools/a.mjs", 'import "./b.mjs";\n');
  await writeExecutable(root, "tools/b.mjs");
  const before = await executableInventory(root);

  await writeExecutable(root, "tools/a.mjs");
  await rm(join(root, "tools", "b.mjs"));
  const after = await executableInventory(root);
  const diff = buildExecutableSurfaceDiff(before, after);
  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.ok(diff.removedSurfacePaths.includes("tools/b.mjs"));
  assert.ok(
    !hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.STATIC_INVOCATION_REACHABILITY_LOST,
      "tools/b.mjs",
    ),
  );
});

test("new unreachable Skill-local script is owned only by surface-added policy", async (t) => {
  const root = await realDiffFixture(t);
  await writeSkill(root, []);
  const before = await executableInventory(root);

  await writeExecutable(root, "skills/demo/scripts/new.sh", "#!/bin/sh\n");
  const after = await executableInventory(root);
  const diff = buildExecutableSurfaceDiff(before, after);
  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.ok(diff.addedSurfacePaths.includes("skills/demo/scripts/new.sh"));
  assert.ok(
    diff.newlyUnreachableSkillLocalPaths.includes("skills/demo/scripts/new.sh"),
  );
  assert.ok(
    hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED,
      "skills/demo/scripts/new.sh",
    ),
  );
  assert.ok(
    !hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.SKILL_LOCAL_REACHABILITY_LOST,
      "skills/demo/scripts/new.sh",
    ),
  );
});

test("new transitively reachable executable is owned only by surface-added policy", async (t) => {
  const root = await realDiffFixture(t);
  await writeSkill(root, ["```bash", "node tools/a.mjs", "```"]);
  await writeExecutable(root, "tools/a.mjs");
  const before = await executableInventory(root);

  await writeExecutable(root, "tools/a.mjs", 'import "./b.mjs";\n');
  await writeExecutable(root, "tools/b.mjs");
  const after = await executableInventory(root);
  const diff = buildExecutableSurfaceDiff(before, after);
  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.ok(diff.addedSurfacePaths.includes("tools/b.mjs"));
  assert.ok(
    diff.newlyTransitivelyReachableSurfacePaths.includes("tools/b.mjs"),
  );
  assert.ok(
    hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED,
      "tools/b.mjs",
    ),
  );
  assert.ok(
    !hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.TRANSITIVE_REACHABILITY_ADDED,
      "tools/b.mjs",
    ),
  );
});

test("true existing-surface reachability transitions remain policy matches", async (t) => {
  const root = await realDiffFixture(t);
  await writeSkill(root, [
    "[Local helper](scripts/local.sh)",
    "",
    "```bash",
    "node tools/direct.mjs",
    "node tools/a.mjs",
    "```",
  ]);
  await writeExecutable(root, "skills/demo/scripts/local.sh", "#!/bin/sh\n");
  await writeExecutable(root, "tools/direct.mjs");
  await writeExecutable(root, "tools/a.mjs");
  await writeExecutable(root, "tools/b.mjs");
  const before = await executableInventory(root);

  await writeSkill(root, ["```bash", "node tools/a.mjs", "```"]);
  await writeExecutable(root, "tools/a.mjs", 'import "./b.mjs";\n');
  const after = await executableInventory(root);
  const diff = buildExecutableSurfaceDiff(before, after);
  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.ok(
    hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.SKILL_LOCAL_REACHABILITY_LOST,
      "skills/demo/scripts/local.sh",
    ),
  );
  assert.ok(
    hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.STATIC_INVOCATION_REACHABILITY_LOST,
      "tools/direct.mjs",
    ),
  );
  assert.ok(
    hasSurfaceMatch(
      evaluation,
      EXECUTABLE_SURFACE_CI_MATCH_IDS.TRANSITIVE_REACHABILITY_ADDED,
      "tools/b.mjs",
    ),
  );
});

test("policy ambiguity is directional and resolving ambiguity is not a match", () => {
  const diff = neutralDiff();
  diff.invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints = [
    governanceChange({
      fromEffective: true,
      toEffective: true,
      fromFingerprints: ["policy-a", "policy-b"],
      toFingerprints: ["policy-a"],
    }),
  ];

  assert.equal(
    evaluateExecutableSurfaceCiPolicy(diff, { from: "fail", to: "fail" })
      .matchCount,
    0,
  );
});

test("ordinary executable diff improvements and removals do not match", () => {
  const diff = neutralDiff();
  diff.changedSurfaces = [
    {
      path: "tools/existing.mjs",
      reasons: ["content", "interpreter", "references"],
      fromFingerprint: "before",
      toFingerprint: "after",
    },
  ];
  diff.removedSurfacePaths = ["tools/removed.mjs"];
  diff.invocationsGainedEffectivePolicyEvidence = [
    governanceChange({
      fromEffective: false,
      toEffective: true,
      fromFingerprints: [],
      toFingerprints: ["policy-a"],
    }),
  ];
  diff.newlyReachableSkillLocalPaths = ["skills/release/scripts/gained.sh"];
  diff.invocationResolutionChanges = [
    {
      sourcePath: "skills/release/SKILL.md",
      launcher: "node",
      target: "tools/fixed.mjs",
      occurrenceOrdinal: 1,
      fromResolution: "missing",
      toResolution: "resolved",
      fromLine: 5,
      toLine: 5,
    },
  ];

  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });
  assert.equal(evaluation.matchCount, 0);
  assert.equal(evaluation.outcome, "pass");
});

test("off warn and fail modes compose with matches and no matches", () => {
  const matching = neutralDiff();
  matching.addedSurfacePaths = ["tools/new.mjs"];

  for (const [mode, outcome] of [
    ["off", "pass"],
    ["warn", "warn"],
    ["fail", "fail"],
  ] as const) {
    const evaluation = evaluateExecutableSurfaceCiPolicy(matching, {
      from: mode,
      to: mode,
    });
    assert.equal(evaluation.outcome, outcome);
    assert.equal(evaluation.matchCount, 1);
    assert.equal(
      evaluateExecutableSurfaceCiPolicy(neutralDiff(), {
        from: mode,
        to: mode,
      }).outcome,
      "pass",
    );
  }
});

test("the stricter archived endpoint mode wins", () => {
  for (const [from, to, expected] of [
    ["fail", "off", "fail"],
    ["warn", "off", "warn"],
    ["off", "warn", "warn"],
    ["warn", "fail", "fail"],
  ] as const) {
    assert.equal(effectiveExecutableSurfaceCiPolicy({ from, to }), expected);
  }
});

function neutralDiff(): ExecutableSurfaceDiff {
  return buildExecutableSurfaceDiff(
    zeroExecutableSurfaceInventory(),
    zeroExecutableSurfaceInventory(),
  );
}

async function realDiffFixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "renma-executable-ci-real-diff-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(
    join(root, "renma.config.json"),
    JSON.stringify({
      globs: ["skills/**/SKILL.md", "skills/**/scripts/**/*", "tools/**/*"],
    }),
  );
  return root;
}

async function writeSkill(root: string, bodyLines: string[]): Promise<void> {
  const skillDirectory = join(root, "skills", "demo");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: Review executable reachability evidence. Use when deterministic CI policy regression coverage is required.",
      "metadata:",
      "  renma.id: skill.demo",
      "  renma.owner: test",
      "  renma.status: stable",
      "---",
      "# Demo",
      "",
      ...bodyLines,
      "",
    ].join("\n"),
  );
}

async function writeExecutable(
  root: string,
  relativePath: string,
  content = "export const value = 1;\n",
): Promise<void> {
  const absolutePath = join(root, ...relativePath.split("/"));
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, content);
}

async function executableInventory(root: string) {
  return (await collectRepositorySnapshot(root)).executableSurfaceInventory;
}

function hasSurfaceMatch(
  evaluation: ReturnType<typeof evaluateExecutableSurfaceCiPolicy>,
  id: (typeof EXECUTABLE_SURFACE_CI_MATCH_IDS)[keyof typeof EXECUTABLE_SURFACE_CI_MATCH_IDS],
  path: string,
): boolean {
  return evaluation.matches.some(
    (match) =>
      match.id === id && match.kind === "surface" && match.path === path,
  );
}

function governanceDelta(input: {
  target?: string;
  fingerprints: string[];
  effective: boolean;
}): ExecutableInvocationGovernanceDelta {
  return {
    sourcePath: "skills/release/SKILL.md",
    launcher: "node",
    target: input.target ?? "tools/release.mjs",
    occurrenceOrdinal: 1,
    hasEffectivePolicyEvidence: input.effective,
    distinctEffectivePolicyFingerprints: input.fingerprints,
    owningSkillResolution: "resolved",
    resolution: "resolved",
    line: 12,
  };
}

function governanceChange(input: {
  target?: string;
  fromEffective: boolean;
  toEffective: boolean;
  fromFingerprints: string[];
  toFingerprints: string[];
}): ExecutableInvocationGovernanceChange {
  return {
    sourcePath: "skills/release/SKILL.md",
    launcher: "node",
    target: input.target ?? "tools/release.mjs",
    occurrenceOrdinal: 1,
    fromHasEffectivePolicyEvidence: input.fromEffective,
    toHasEffectivePolicyEvidence: input.toEffective,
    fromDistinctEffectivePolicyFingerprints: input.fromFingerprints,
    toDistinctEffectivePolicyFingerprints: input.toFingerprints,
    fromOwningSkillResolution: "resolved",
    toOwningSkillResolution: "resolved",
    fromGovernanceFingerprint: "before",
    toGovernanceFingerprint: "after",
    fromLine: 12,
    toLine: 12,
  };
}
