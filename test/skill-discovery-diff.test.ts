import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";

import fc from "fast-check";

import {
  buildSkillDiscoveryDiff,
  type SkillDiscoveryDiff,
} from "../src/skill-discovery-diff.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import type { SkillDiscoveryIndex } from "../src/skill-discovery.js";
import {
  RepositoryFixture,
  type SkillFixtureOptions,
} from "./repository-fixture.js";

interface DiscoveryFixtureSpec {
  adopted?: boolean;
  skills?: Array<[string, SkillFixtureOptions]>;
  contexts?: Array<[string, string]>;
  raw?: Array<[string, string]>;
}

test("identical Discovery topology produces a compact no-change diff", async (t) => {
  const index = await preparedIndex(t, {
    skills: [
      [
        "a",
        {
          id: "skill.a",
          publishedEntrypoint: true,
          continuesWith: ["skill.b"],
        },
      ],
      ["b", { id: "skill.b" }],
    ],
  });

  const report = buildSkillDiscoveryDiff(index, index);

  assert.deepEqual(report.adoption, {
    from: "partial",
    to: "partial",
    changed: false,
  });
  assert.deepEqual(report.coverage, {
    from: "descriptive",
    to: "descriptive",
    changed: false,
  });
  assert.deepEqual(report.summary, {
    publishedEntrypointCountDelta: 0,
    routeEligibleSkillCountDelta: 0,
    reachableSkillCountDelta: 0,
    notReachedSkillCountDelta: 0,
    unroutedSkillCountDelta: 0,
    usableRouteCountDelta: 0,
    unusableRouteCountDelta: 0,
    unresolvedRouteCountDelta: 0,
    cycleComponentCountDelta: 0,
  });
  assertAllIdentityListsEmpty(report);
});

test("adoption transitions report exact facts without classification", async (t) => {
  const notAdopted = await preparedIndex(t, {
    skills: [["a", { id: "skill.a" }]],
  });
  const partial = await preparedIndex(t, {
    skills: [["a", { id: "skill.a", publishedEntrypoint: true }]],
  });
  const adopted = await preparedIndex(t, {
    adopted: true,
    skills: [["a", { id: "skill.a", publishedEntrypoint: true }]],
  });
  const incomplete = await preparedIndex(t, {
    adopted: true,
    skills: [["a", { id: "skill.a" }]],
  });

  assert.deepEqual(buildSkillDiscoveryDiff(notAdopted, partial).adoption, {
    from: "not-adopted",
    to: "partial",
    changed: true,
  });
  assert.deepEqual(buildSkillDiscoveryDiff(partial, adopted).adoption, {
    from: "partial",
    to: "adopted",
    changed: true,
  });
  assert.deepEqual(buildSkillDiscoveryDiff(partial, adopted).reachability, {
    newlyReachable: [],
    newlyNotReached: [],
  });
  assert.deepEqual(buildSkillDiscoveryDiff(adopted, incomplete).adoption, {
    from: "adopted",
    to: "incomplete",
    changed: true,
  });
});

test("publication, reachability, and unrouted changes use stable Skill identities", async (t) => {
  const from = await preparedIndex(t, {
    skills: [
      [
        "entry",
        {
          id: "skill.entry",
          publishedEntrypoint: true,
          continuesWith: ["skill.reached"],
        },
      ],
      ["reached", { id: "skill.reached" }],
      ["independent", { id: "skill.independent" }],
    ],
  });
  const to = await preparedIndex(t, {
    adopted: true,
    skills: [
      [
        "entry",
        {
          id: "skill.entry",
          continuesWith: ["skill.reached"],
        },
      ],
      [
        "reached",
        {
          id: "skill.reached",
          publishedEntrypoint: true,
          continuesWith: ["skill.independent"],
        },
      ],
      ["independent", { id: "skill.independent" }],
    ],
  });

  const report = buildSkillDiscoveryDiff(from, to);

  assert.deepEqual(report.publishedEntrypoints, {
    added: [{ id: "skill.reached", path: "skills/reached/SKILL.md" }],
    removed: [{ id: "skill.entry", path: "skills/entry/SKILL.md" }],
  });
  assert.deepEqual(report.reachability.newlyReachable, [
    { id: "skill.independent", path: "skills/independent/SKILL.md" },
  ]);
  assert.deepEqual(report.reachability.newlyNotReached, [
    { id: "skill.entry", path: "skills/entry/SKILL.md" },
  ]);
  assert.deepEqual(report.unroutedSkills.newlyUnrouted, [
    { id: "skill.entry", path: "skills/entry/SKILL.md" },
  ]);
  assert.deepEqual(report.unroutedSkills.resolvedUnrouted, [
    { id: "skill.independent", path: "skills/independent/SKILL.md" },
  ]);
  assert.equal(report.coverage.from, "descriptive");
  assert.equal(report.coverage.to, "authoritative");
});

test("structural roots and rejected markers are not effective publication", async (t) => {
  const from = await preparedIndex(t, {
    skills: [["root", { id: "skill.root" }]],
  });
  const to = await preparedIndex(t, {
    skills: [
      [
        "root",
        {
          id: "skill.root",
          metadata: { "published-entrypoint": "false" },
        },
      ],
    ],
  });

  const report = buildSkillDiscoveryDiff(from, to);

  assert.deepEqual(report.publishedEntrypoints, { added: [], removed: [] });
});

test("route identity separates additions/removals from normalized state changes", async (t) => {
  const unresolved = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.target"] }],
    ],
  });
  const resolved = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.target"] }],
      ["target", { id: "skill.target" }],
    ],
  });
  const differentRoute = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.other"] }],
      ["other", { id: "skill.other" }],
    ],
  });

  const stateChange = buildSkillDiscoveryDiff(unresolved, resolved);
  assert.equal(stateChange.routes.added.length, 0);
  assert.equal(stateChange.routes.removed.length, 0);
  assert.deepEqual(stateChange.routes.changed[0]?.changedFields, [
    "resolution",
    "candidates",
    "resolvedTarget",
    "targetLifecycle",
    "usable",
    "usabilityReasons",
  ]);
  assert.equal(stateChange.routes.changed[0]?.from.resolution, "unresolved");
  assert.equal(stateChange.routes.changed[0]?.to.resolution, "resolved");

  const identityChange = buildSkillDiscoveryDiff(resolved, differentRoute);
  assert.equal(identityChange.routes.added.length, 1);
  assert.equal(identityChange.routes.removed.length, 1);
  assert.equal(identityChange.routes.changed.length, 0);
});

test("route resolution and usability state transitions remain changed routes", async (t) => {
  const unresolved = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.target"] }],
    ],
  });
  const resolved = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.target"] }],
      ["target", { id: "skill.target" }],
    ],
  });
  const ambiguous = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.target"] }],
      ["alpha", { id: "skill.target" }],
      ["beta", { id: "skill.target" }],
    ],
  });
  const wrongKind = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.target"] }],
    ],
    contexts: [["contexts/target.md", "skill.target"]],
  });
  const inactive = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.target"] }],
      ["target", { id: "skill.target", status: "archived" }],
    ],
  });
  const invalid: SkillDiscoveryIndex = {
    ...resolved,
    routes: resolved.routes.map((route) => ({
      ...route,
      resolvedTarget: {
        ...route.resolvedTarget!,
        agentSkillsValid: false,
      },
      usable: false,
      usabilityReasons: ["invalid-target"],
    })),
    summary: {
      ...resolved.summary,
      usableRouteCount: 0,
      invalidRouteCount: 1,
    },
  };

  for (const [label, from, to, expectedFrom, expectedTo] of [
    ["ambiguous to resolved", ambiguous, resolved, "ambiguous", "resolved"],
    ["wrong-kind to resolved", wrongKind, resolved, "wrong-kind", "resolved"],
    ["resolved to unresolved", resolved, unresolved, "resolved", "unresolved"],
    ["resolved to ambiguous", resolved, ambiguous, "resolved", "ambiguous"],
    ["active to inactive", resolved, inactive, "resolved", "resolved"],
    ["invalid to valid", invalid, resolved, "resolved", "resolved"],
  ] as const) {
    const report = buildSkillDiscoveryDiff(from, to);
    assert.equal(report.routes.added.length, 0, label);
    assert.equal(report.routes.removed.length, 0, label);
    assert.equal(report.routes.changed.length, 1, label);
    assert.equal(
      report.routes.changed[0]?.from.resolution,
      expectedFrom,
      label,
    );
    assert.equal(report.routes.changed[0]?.to.resolution, expectedTo, label);
  }
  assert.deepEqual(
    buildSkillDiscoveryDiff(resolved, inactive).routes.changed[0]
      ?.changedFields,
    ["targetLifecycle", "usable", "usabilityReasons"],
  );
  assert.deepEqual(
    buildSkillDiscoveryDiff(invalid, resolved).routes.changed[0]?.changedFields,
    ["usable", "usabilityReasons"],
  );
});

test("duplicate counts, declaration permutations, and equivalent paths are stable", async (t) => {
  const one = await preparedIndex(t, {
    skills: [
      [
        "source",
        {
          id: "skill.source",
          continuesWith: ["skills/b/SKILL.md"],
        },
      ],
      ["b", { id: "skill.b" }],
      ["c", { id: "skill.c" }],
    ],
  });
  const duplicate = await preparedIndex(t, {
    skills: [
      [
        "source",
        {
          id: "skill.source",
          continuesWith: ["skills/b/SKILL.md", "./skills/b/SKILL.md"],
        },
      ],
      ["b", { id: "skill.b" }],
      ["c", { id: "skill.c" }],
    ],
  });
  const ordered = await preparedIndex(t, {
    skills: [
      [
        "source",
        {
          id: "skill.source",
          continuesWith: ["skill.b", "skill.c"],
        },
      ],
      ["b", { id: "skill.b" }],
      ["c", { id: "skill.c" }],
    ],
  });
  const reordered = await preparedIndex(t, {
    skills: [
      [
        "source",
        {
          id: "skill.source",
          continuesWith: ["skill.c", "skill.b"],
        },
      ],
      ["b", { id: "skill.b" }],
      ["c", { id: "skill.c" }],
    ],
  });
  const equivalentSpellings = await preparedIndex(t, {
    skills: [
      [
        "source",
        {
          id: "skill.source",
          continuesWith: ["skill.b", "skills/b/SKILL.md"],
        },
      ],
      ["b", { id: "skill.b" }],
    ],
  });
  const reorderedEquivalentSpellings = await preparedIndex(t, {
    skills: [
      [
        "source",
        {
          id: "skill.source",
          continuesWith: ["skills/b/SKILL.md", "skill.b"],
        },
      ],
      ["b", { id: "skill.b" }],
    ],
  });

  const duplicateDiff = buildSkillDiscoveryDiff(one, duplicate);
  assert.equal(duplicateDiff.routes.added.length, 0);
  assert.equal(duplicateDiff.routes.removed.length, 0);
  assert.deepEqual(duplicateDiff.routes.changed[0]?.changedFields, [
    "declarationCount",
  ]);
  assert.equal(duplicateDiff.routes.changed[0]?.from.declarationCount, 1);
  assert.equal(duplicateDiff.routes.changed[0]?.to.declarationCount, 2);
  assert.deepEqual(buildSkillDiscoveryDiff(ordered, reordered).routes, {
    added: [],
    removed: [],
    changed: [],
  });
  assert.deepEqual(
    buildSkillDiscoveryDiff(equivalentSpellings, reorderedEquivalentSpellings)
      .routes,
    {
      added: [],
      removed: [],
      changed: [],
    },
  );
});

test("cycle identity uses maximal member sets and ignores route order", async (t) => {
  const acyclic = await preparedIndex(t, {
    skills: [
      ["a", { id: "skill.a", continuesWith: ["skill.b"] }],
      ["b", { id: "skill.b" }],
      ["c", { id: "skill.c" }],
    ],
  });
  const cyclic = await preparedIndex(t, {
    skills: [
      ["a", { id: "skill.a", continuesWith: ["skill.b"] }],
      ["b", { id: "skill.b", continuesWith: ["skill.a"] }],
      ["c", { id: "skill.c", continuesWith: ["skill.c"] }],
    ],
  });
  const cyclicReordered = {
    ...cyclic,
    skills: [...cyclic.skills].reverse(),
    routes: [...cyclic.routes].reverse(),
  };

  const added = buildSkillDiscoveryDiff(acyclic, cyclic);
  assert.deepEqual(
    added.cycles.added.map((cycle) => [cycle.skillIds, cycle.selfLoop]),
    [
      [["skill.a", "skill.b"], false],
      [["skill.c"], true],
    ],
  );
  assert.deepEqual(
    buildSkillDiscoveryDiff(cyclic, acyclic).cycles.resolved,
    added.cycles.added,
  );
  assert.deepEqual(buildSkillDiscoveryDiff(cyclic, cyclicReordered).cycles, {
    added: [],
    resolved: [],
  });
});

test("duplicate IDs keep candidate paths deterministic and leak no internal evidence", async (t) => {
  const from = await preparedIndex(t, {
    skills: [
      ["source", { id: "skill.source", continuesWith: ["skill.duplicate"] }],
      ["zeta", { id: "skill.duplicate" }],
      ["alpha", { id: "skill.duplicate" }],
    ],
  });
  const to = {
    ...from,
    skills: [...from.skills].reverse(),
    routes: [...from.routes].reverse(),
  };

  const report = buildSkillDiscoveryDiff(from, to);
  const json = JSON.stringify(report);

  assertAllIdentityListsEmpty(report);
  assert.doesNotMatch(json, /declarationIndex|startLine|endLine|snippet/);
  assert.equal("diagnostics" in report, false);
  assert.equal("skills" in report, false);
});

test("representative Discovery semantic diff matches the public JSON golden", async (t) => {
  const from = await preparedIndex(t, {
    adopted: true,
    skills: [
      [
        "a",
        {
          id: "skill.a",
          publishedEntrypoint: true,
          continuesWith: ["skill.c"],
        },
      ],
      ["b", { id: "skill.b" }],
      ["c", { id: "skill.c" }],
      ["c-duplicate", { id: "skill.c" }],
    ],
  });
  const to = await preparedIndex(t, {
    adopted: true,
    skills: [
      ["a", { id: "skill.a", continuesWith: ["skill.c"] }],
      [
        "b",
        {
          id: "skill.b",
          publishedEntrypoint: true,
          continuesWith: ["skill.c"],
        },
      ],
      ["c", { id: "skill.c", continuesWith: ["skill.b"] }],
    ],
  });
  const report = buildSkillDiscoveryDiff(from, to);
  const golden = await readFile(
    path.join(process.cwd(), "test/fixtures/skill-discovery-diff.golden"),
    "utf8",
  );

  assert.equal(`${JSON.stringify(report, null, 2)}\n`, golden);
  assert.equal(report.routes.changed.length, 1);
  assert.equal(report.cycles.added.length, 1);
  assert.equal("declarationIndex" in report.routes.changed[0]!.from, false);
});

test("Discovery diff is deterministic, permutation-invariant, reversible, and non-mutating", async (t) => {
  const from = await preparedIndex(t, {
    skills: [
      [
        "a",
        {
          id: "skill.a",
          publishedEntrypoint: true,
          continuesWith: ["skill.b", "skill.c"],
        },
      ],
      ["b", { id: "skill.b" }],
      ["c", { id: "skill.c" }],
    ],
  });
  const to = await preparedIndex(t, {
    skills: [
      [
        "a",
        {
          id: "skill.a",
          publishedEntrypoint: true,
          continuesWith: ["skill.c", "skill.b", "skill.d"],
        },
      ],
      ["b", { id: "skill.b" }],
      ["c", { id: "skill.c" }],
      ["d", { id: "skill.d" }],
    ],
  });
  const beforeFrom = JSON.stringify(from);
  const beforeTo = JSON.stringify(to);
  const forward = buildSkillDiscoveryDiff(from, to);
  const reverse = buildSkillDiscoveryDiff(to, from);

  for (const key of Object.keys(forward.summary) as Array<
    keyof typeof forward.summary
  >) {
    assert.equal(forward.summary[key] + reverse.summary[key], 0);
  }
  assert.deepEqual(
    forward.publishedEntrypoints.added,
    reverse.publishedEntrypoints.removed,
  );
  assert.deepEqual(forward.routes.added, reverse.routes.removed);
  assert.equal(JSON.stringify(from), beforeFrom);
  assert.equal(JSON.stringify(to), beforeTo);
  assert.deepEqual(buildSkillDiscoveryDiff(from, to), forward);

  fc.assert(
    fc.property(
      fc.shuffledSubarray(
        Array.from({ length: to.routes.length }, (_, index) => index),
        {
          minLength: to.routes.length,
          maxLength: to.routes.length,
        },
      ),
      fc.shuffledSubarray(
        Array.from({ length: to.skills.length }, (_, index) => index),
        {
          minLength: to.skills.length,
          maxLength: to.skills.length,
        },
      ),
      (routeOrder, skillOrder) => {
        const permuted = {
          ...to,
          routes: routeOrder.map((index) => to.routes[index]!),
          skills: skillOrder.map((index) => to.skills[index]!),
        };
        assert.deepEqual(buildSkillDiscoveryDiff(from, permuted), forward);
      },
    ),
    { seed: 2301, numRuns: 50 },
  );
});

async function preparedIndex(
  t: TestContext,
  spec: DiscoveryFixtureSpec,
): Promise<SkillDiscoveryIndex> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-skill-discovery-diff-",
    testContext: t,
  });
  if (spec.adopted !== undefined) {
    await fixture.writeConfig({
      skill_discovery: { adopted: spec.adopted },
    });
  }
  for (const [path, options] of spec.skills ?? []) {
    await fixture.skill(path, {
      owner: "qa",
      status: "stable",
      ...options,
    });
  }
  for (const [path, id] of spec.contexts ?? []) {
    await fixture.context(path, {
      id,
      owner: "qa",
      status: "stable",
    });
  }
  for (const [path, content] of spec.raw ?? []) {
    await fixture.write(path, content);
  }
  return (await collectRepositorySnapshot(fixture.root)).skillDiscovery;
}

function assertAllIdentityListsEmpty(report: SkillDiscoveryDiff): void {
  assert.deepEqual(report.publishedEntrypoints, {
    added: [],
    removed: [],
  });
  assert.deepEqual(report.reachability, {
    newlyReachable: [],
    newlyNotReached: [],
  });
  assert.deepEqual(report.unroutedSkills, {
    newlyUnrouted: [],
    resolvedUnrouted: [],
  });
  assert.deepEqual(report.routes, {
    added: [],
    removed: [],
    changed: [],
  });
  assert.deepEqual(report.cycles, { added: [], resolved: [] });
}
