import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  SKILL_DISCOVERY_CI_POLICY_MATCH_IDS,
  effectiveSkillDiscoveryCiPolicy,
  evaluateSkillDiscoveryCiPolicy,
} from "../src/skill-discovery-ci-policy.js";
import type {
  SkillDiscoveryDiff,
  SkillDiscoveryRouteChange,
  SkillDiscoveryRouteDiffState,
} from "../src/skill-discovery-diff.js";

const WARN_POLICY = { from: "warn", to: "warn" } as const;

test("effective policy uses the stricter archived-ref mode", () => {
  assert.equal(
    effectiveSkillDiscoveryCiPolicy({ from: "off", to: "off" }),
    "off",
  );
  assert.equal(
    effectiveSkillDiscoveryCiPolicy({ from: "off", to: "warn" }),
    "warn",
  );
  assert.equal(
    effectiveSkillDiscoveryCiPolicy({ from: "warn", to: "warn" }),
    "warn",
  );
  assert.equal(
    effectiveSkillDiscoveryCiPolicy({ from: "warn", to: "off" }),
    "warn",
  );
});

test("policy off always passes without evaluating hypothetical matches", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (arbitraryDiscovery) => {
      const result = evaluateSkillDiscoveryCiPolicy(
        arbitraryDiscovery as unknown as SkillDiscoveryDiff,
        { from: "off", to: "off" },
      );
      assert.deepEqual(result, {
        schemaVersion: "renma.skill-discovery-ci-policy.v1",
        configured: {
          from: "off",
          to: "off",
          effective: "off",
        },
        outcome: "pass",
        matchCount: 0,
        matches: [],
      });
    }),
    { seed: 233, numRuns: 100 },
  );
});

test("policy independently matches each fixed review condition", async (t) => {
  const cases: Array<{
    name: string;
    discovery: SkillDiscoveryDiff;
    id: string;
  }> = [
    {
      name: "adoption weakened",
      discovery: discoveryWith({
        adoption: {
          from: "adopted",
          to: "partial",
          changed: true,
        },
      }),
      id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADOPTION_WEAKENED,
    },
    {
      name: "adoption incomplete",
      discovery: discoveryWith({
        adoption: {
          from: "partial",
          to: "incomplete",
          changed: true,
        },
      }),
      id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADOPTION_INCOMPLETE,
    },
    {
      name: "newly not reached",
      discovery: discoveryWith({
        reachability: {
          newlyReachable: [],
          newlyNotReached: [
            { id: "skill.target", path: "skills/target/SKILL.md" },
          ],
        },
      }),
      id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.NEWLY_NOT_REACHED,
    },
    {
      name: "route became unusable",
      discovery: discoveryWith({
        routes: {
          added: [],
          removed: [],
          changed: [routeChange(true, false)],
        },
      }),
      id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ROUTE_BECAME_UNUSABLE,
    },
    {
      name: "added unusable route",
      discovery: discoveryWith({
        routes: {
          added: [route("skills/new/SKILL.md", "skill.missing", false)],
          removed: [],
          changed: [],
        },
      }),
      id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADDED_UNUSABLE_ROUTE,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const result = evaluateSkillDiscoveryCiPolicy(
        fixture.discovery,
        WARN_POLICY,
      );
      assert.equal(result.outcome, "warn");
      assert.equal(result.matchCount, 1);
      assert.equal(result.matches[0]?.id, fixture.id);
    });
  }
});

test("authoritative coverage is required for per-Skill and route matches", () => {
  for (const coverage of ["descriptive", "not-evaluated"] as const) {
    const discovery = discoveryWith({
      coverage: {
        from: coverage,
        to: coverage,
        changed: false,
      },
      reachability: {
        newlyReachable: [],
        newlyNotReached: [
          { id: "skill.target", path: "skills/target/SKILL.md" },
        ],
      },
      routes: {
        added: [route("skills/new/SKILL.md", "skill.missing", false)],
        removed: [],
        changed: [routeChange(true, false)],
      },
    });

    const result = evaluateSkillDiscoveryCiPolicy(discovery, WARN_POLICY);
    assert.equal(result.outcome, "pass");
    assert.deepEqual(result.matches, []);
  }
});

test("explicit non-policy Discovery changes remain unmatched", () => {
  const discovery = discoveryWith({
    adoption: {
      from: "partial",
      to: "adopted",
      changed: true,
    },
    summary: {
      ...neutralDiscovery().summary,
      publishedEntrypointCountDelta: -1,
      unroutedSkillCountDelta: 1,
      cycleComponentCountDelta: 1,
    },
    publishedEntrypoints: {
      added: [],
      removed: [{ id: "skill.entry", path: "skills/entry/SKILL.md" }],
    },
    reachability: {
      newlyReachable: [{ id: "skill.target", path: "skills/target/SKILL.md" }],
      newlyNotReached: [],
    },
    unroutedSkills: {
      newlyUnrouted: [
        { id: "skill.unrouted", path: "skills/unrouted/SKILL.md" },
      ],
      resolvedUnrouted: [],
    },
    routes: {
      added: [],
      removed: [route("skills/old/SKILL.md", "skill.target", false)],
      changed: [
        routeChange(false, true),
        {
          ...routeChange(true, true),
          changedFields: ["declarationCount"],
          from: {
            ...route("skills/source/SKILL.md", "skill.target", true),
            declarationCount: 1,
          },
          to: {
            ...route("skills/source/SKILL.md", "skill.target", true),
            declarationCount: 2,
          },
        },
      ],
    },
    cycles: {
      added: [
        {
          skillIds: ["skill.entry", "skill.target"],
          skills: [
            { id: "skill.entry", path: "skills/entry/SKILL.md" },
            { id: "skill.target", path: "skills/target/SKILL.md" },
          ],
          selfLoop: false,
        },
        {
          skillIds: ["skill.self"],
          skills: [{ id: "skill.self", path: "skills/self/SKILL.md" }],
          selfLoop: true,
        },
      ],
      resolved: [],
    },
  });

  const result = evaluateSkillDiscoveryCiPolicy(discovery, WARN_POLICY);
  assert.equal(result.outcome, "pass");
  assert.deepEqual(result.matches, []);
});

test("policy matches use stable ID and identity ordering", () => {
  const discovery = discoveryWith({
    adoption: {
      from: "adopted",
      to: "incomplete",
      changed: true,
    },
    reachability: {
      newlyReachable: [],
      newlyNotReached: [
        { id: "skill.z", path: "skills/z/SKILL.md" },
        { id: "skill.a2", path: "skills/a/SKILL.md" },
        { id: "skill.a1", path: "skills/a/SKILL.md" },
      ],
    },
    routes: {
      added: [
        route("skills/z/SKILL.md", "skill.z", false),
        route("skills/a/SKILL.md", "skill.z", false),
        route("skills/a/SKILL.md", "skill.a", false),
      ],
      removed: [],
      changed: [
        routeChange(true, false, "skills/z/SKILL.md", "skill.z"),
        routeChange(true, false, "skills/a/SKILL.md", "skill.z"),
        routeChange(true, false, "skills/a/SKILL.md", "skill.a"),
      ],
    },
  });

  const result = evaluateSkillDiscoveryCiPolicy(discovery, WARN_POLICY);
  assert.deepEqual(
    result.matches.map((match) => [
      match.id,
      match.skill?.path,
      match.route?.sourcePath,
      match.route?.normalizedTarget,
      match.skill?.id,
    ]),
    [
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADOPTION_INCOMPLETE,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.NEWLY_NOT_REACHED,
        "skills/a/SKILL.md",
        undefined,
        undefined,
        "skill.a1",
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.NEWLY_NOT_REACHED,
        "skills/a/SKILL.md",
        undefined,
        undefined,
        "skill.a2",
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.NEWLY_NOT_REACHED,
        "skills/z/SKILL.md",
        undefined,
        undefined,
        "skill.z",
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ROUTE_BECAME_UNUSABLE,
        undefined,
        "skills/a/SKILL.md",
        "skill.a",
        undefined,
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ROUTE_BECAME_UNUSABLE,
        undefined,
        "skills/a/SKILL.md",
        "skill.z",
        undefined,
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ROUTE_BECAME_UNUSABLE,
        undefined,
        "skills/z/SKILL.md",
        "skill.z",
        undefined,
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADDED_UNUSABLE_ROUTE,
        undefined,
        "skills/a/SKILL.md",
        "skill.a",
        undefined,
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADDED_UNUSABLE_ROUTE,
        undefined,
        "skills/a/SKILL.md",
        "skill.z",
        undefined,
      ],
      [
        SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADDED_UNUSABLE_ROUTE,
        undefined,
        "skills/z/SKILL.md",
        "skill.z",
        undefined,
      ],
    ],
  );
});

test("permuting policy inputs does not change sorted output", () => {
  const skills = [
    { id: "skill.c", path: "skills/c/SKILL.md" },
    { id: "skill.a", path: "skills/a/SKILL.md" },
    { id: "skill.b", path: "skills/b/SKILL.md" },
  ];
  const addedRoutes = [
    route("skills/c/SKILL.md", "skill.c", false),
    route("skills/a/SKILL.md", "skill.a", false),
    route("skills/b/SKILL.md", "skill.b", false),
  ];
  const changedRoutes = [
    routeChange(true, false, "skills/c/SKILL.md", "skill.c"),
    routeChange(true, false, "skills/a/SKILL.md", "skill.a"),
    routeChange(true, false, "skills/b/SKILL.md", "skill.b"),
  ];
  const expected = evaluateSkillDiscoveryCiPolicy(
    discoveryWith({
      reachability: { newlyReachable: [], newlyNotReached: skills },
      routes: { added: addedRoutes, removed: [], changed: changedRoutes },
    }),
    WARN_POLICY,
  );

  fc.assert(
    fc.property(
      fc.shuffledSubarray(skills, {
        minLength: skills.length,
        maxLength: skills.length,
      }),
      fc.shuffledSubarray(addedRoutes, {
        minLength: addedRoutes.length,
        maxLength: addedRoutes.length,
      }),
      fc.shuffledSubarray(changedRoutes, {
        minLength: changedRoutes.length,
        maxLength: changedRoutes.length,
      }),
      (skillOrder, addedOrder, changedOrder) => {
        const actual = evaluateSkillDiscoveryCiPolicy(
          discoveryWith({
            reachability: {
              newlyReachable: [],
              newlyNotReached: skillOrder,
            },
            routes: {
              added: addedOrder,
              removed: [],
              changed: changedOrder,
            },
          }),
          WARN_POLICY,
        );
        assert.deepEqual(actual, expected);
      },
    ),
    { seed: 233, numRuns: 100 },
  );
});

test("evaluation is deterministic, non-mutating, and cycle-neutral", () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { maxLength: 20 }), (selfLoops) => {
      const discovery = discoveryWith({
        cycles: {
          added: selfLoops.map((selfLoop, index) => ({
            skillIds: [`skill.${index}`],
            skills: [
              {
                id: `skill.${index}`,
                path: `skills/${index}/SKILL.md`,
              },
            ],
            selfLoop,
          })),
          resolved: selfLoops.map((selfLoop, index) => ({
            skillIds: [`skill.resolved.${index}`],
            skills: [
              {
                id: `skill.resolved.${index}`,
                path: `skills/resolved-${index}/SKILL.md`,
              },
            ],
            selfLoop,
          })),
        },
      });
      const before = JSON.stringify(discovery);
      const first = evaluateSkillDiscoveryCiPolicy(discovery, WARN_POLICY);
      const second = evaluateSkillDiscoveryCiPolicy(discovery, WARN_POLICY);

      assert.equal(JSON.stringify(discovery), before);
      assert.deepEqual(first, second);
      assert.equal(first.outcome, "pass");
      assert.deepEqual(first.matches, []);
      assert.notEqual((first as { outcome: string }).outcome, "fail");
    }),
    { seed: 233, numRuns: 100 },
  );
});

test("changing only non-policy Discovery facts leaves evaluation unchanged", () => {
  const expected = evaluateSkillDiscoveryCiPolicy(
    neutralDiscovery(),
    WARN_POLICY,
  );

  fc.assert(
    fc.property(
      fc.integer({ min: -100, max: 100 }),
      fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
        maxLength: 20,
      }),
      (delta, ids) => {
        const discovery = discoveryWith({
          summary: Object.fromEntries(
            Object.keys(neutralDiscovery().summary).map((key) => [key, delta]),
          ) as unknown as SkillDiscoveryDiff["summary"],
          publishedEntrypoints: {
            added: [],
            removed: ids.map((id, index) => ({
              id,
              path: `skills/removed-${index}/SKILL.md`,
            })),
          },
          reachability: {
            newlyReachable: ids.map((id, index) => ({
              id,
              path: `skills/reachable-${index}/SKILL.md`,
            })),
            newlyNotReached: [],
          },
          unroutedSkills: {
            newlyUnrouted: ids.map((id, index) => ({
              id,
              path: `skills/unrouted-${index}/SKILL.md`,
            })),
            resolvedUnrouted: [],
          },
          routes: {
            added: [],
            removed: ids.map((id, index) =>
              route(`skills/removed-${index}/SKILL.md`, id, false),
            ),
            changed: [],
          },
        });

        assert.deepEqual(
          evaluateSkillDiscoveryCiPolicy(discovery, WARN_POLICY),
          expected,
        );
      },
    ),
    { seed: 233, numRuns: 100 },
  );
});

function discoveryWith(
  overrides: Partial<SkillDiscoveryDiff>,
): SkillDiscoveryDiff {
  return {
    ...neutralDiscovery(),
    ...overrides,
  };
}

function neutralDiscovery(): SkillDiscoveryDiff {
  return {
    schemaVersion: "renma.skill-discovery-diff.v1",
    adoption: {
      from: "adopted",
      to: "adopted",
      changed: false,
    },
    coverage: {
      from: "authoritative",
      to: "authoritative",
      changed: false,
    },
    summary: {
      publishedEntrypointCountDelta: 0,
      routeEligibleSkillCountDelta: 0,
      reachableSkillCountDelta: 0,
      notReachedSkillCountDelta: 0,
      unroutedSkillCountDelta: 0,
      usableRouteCountDelta: 0,
      unusableRouteCountDelta: 0,
      unresolvedRouteCountDelta: 0,
      cycleComponentCountDelta: 0,
    },
    publishedEntrypoints: {
      added: [],
      removed: [],
    },
    reachability: {
      newlyReachable: [],
      newlyNotReached: [],
    },
    unroutedSkills: {
      newlyUnrouted: [],
      resolvedUnrouted: [],
    },
    routes: {
      added: [],
      removed: [],
      changed: [],
    },
    cycles: {
      added: [],
      resolved: [],
    },
  };
}

function route(
  sourcePath: string,
  normalizedTarget: string,
  usable: boolean,
): SkillDiscoveryRouteDiffState {
  return {
    sourceId: sourcePath.replaceAll("/", "."),
    sourcePath,
    normalizedTarget,
    declarationCount: 1,
    resolution: usable ? "resolved" : "unresolved",
    candidates: [],
    usable,
    usabilityReasons: usable ? [] : ["unresolved-target"],
  };
}

function routeChange(
  fromUsable: boolean,
  toUsable: boolean,
  sourcePath = "skills/source/SKILL.md",
  normalizedTarget = "skill.target",
): SkillDiscoveryRouteChange {
  return {
    identity: {
      sourcePath,
      normalizedTarget,
    },
    changedFields: ["usable", "usabilityReasons"],
    from: route(sourcePath, normalizedTarget, fromUsable),
    to: route(sourcePath, normalizedTarget, toUsable),
  };
}
