import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  buildSkillDiscoveryReadiness,
  formatReadinessJson,
  formatReadinessMarkdown,
  readiness,
  readinessFromRepositorySnapshot,
  runReadinessCommand,
  type ReadinessCheck,
} from "../src/commands/readiness.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import type { SkillDiscoveryIndex } from "../src/skill-discovery.js";
import { RepositoryFixture } from "./repository-fixture.js";

const DISCOVERY_CHECK_IDS = [
  "discovery.publication",
  "discovery.route_validity",
  "discovery.coverage",
  "discovery.unrouted_skills",
  "discovery.cycle_review",
] as const;

test("authoritative healthy topology has a compact all-pass Discovery readiness projection", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-healthy-",
    testContext: t,
  });
  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  await fixture.skill("a", {
    id: "skill.a",
    owner: "qa",
    status: "stable",
    publishedEntrypoint: true,
    continuesWith: ["skill.b", "skill.c"],
  });
  await fixture.skill("b", {
    id: "skill.b",
    owner: "qa",
    status: "stable",
  });
  await fixture.skill("c", {
    id: "skill.c",
    owner: "qa",
    status: "stable",
    continuesWith: ["skill.d"],
  });
  await fixture.skill("d", {
    id: "skill.d",
    owner: "qa",
    status: "stable",
  });
  await fixture.skill("e", {
    id: "skill.e",
    owner: "qa",
    status: "stable",
    publishedEntrypoint: true,
  });

  const report = await readiness(fixture.root);
  const json = JSON.parse(formatReadinessJson(report)) as {
    summary: { skillDiscovery: Record<string, unknown> };
  };
  const markdown = formatReadinessMarkdown(report);

  assert.deepEqual(report.summary.skillDiscovery, {
    adoptionState: "adopted",
    publishedEntrypointCount: 2,
    routeEligibleSkillCount: 5,
    reachableSkillCount: 5,
    notReachedSkillCount: 0,
    unroutedSkillCount: 0,
    usableRouteCount: 3,
    unusableRouteCount: 0,
    unresolvedRouteCount: 0,
    cycleComponentCount: 0,
  });
  assert.deepEqual(
    discoveryChecks(report.checks).map((check) => [check.id, check.status]),
    DISCOVERY_CHECK_IDS.map((id) => [id, "pass"]),
  );
  assert.deepEqual(Object.keys(json.summary.skillDiscovery), [
    "adoptionState",
    "publishedEntrypointCount",
    "routeEligibleSkillCount",
    "reachableSkillCount",
    "notReachedSkillCount",
    "unroutedSkillCount",
    "usableRouteCount",
    "unusableRouteCount",
    "unresolvedRouteCount",
    "cycleComponentCount",
  ]);
  assert.equal("routes" in json.summary.skillDiscovery, false);
  assert.equal("skills" in json.summary.skillDiscovery, false);
  assert.equal("diagnostics" in json.summary.skillDiscovery, false);
  assert.match(markdown, /^## Skill Discovery$/m);
  assert.match(markdown, /- Adoption: adopted/);
  assert.match(markdown, /- Discovery-eligible Skills: 5/);
  assert.match(markdown, /- Route cycles requiring review: 0/);
  assert.match(
    markdown,
    /Run `renma skill-index` for the complete Discovery report\./,
  );
  assert.match(
    markdown,
    /Run `renma graph --view discovery` for route topology and source evidence\./,
  );
  assert.equal(formatReadinessJson(report), formatReadinessJson(report));
  assert.equal(markdown, formatReadinessMarkdown(report));
});

test("authoritative coverage gaps reuse one existing diagnostic without a second score penalty", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-gap-",
    testContext: t,
  });
  await fixture.skill("entry", {
    id: "skill.entry",
    owner: "qa",
    status: "stable",
    publishedEntrypoint: true,
  });
  await fixture.skill("unreached", {
    id: "skill.unreached",
    owner: "qa",
    status: "stable",
  });
  await fixture.writeConfig({ skill_discovery: { adopted: false } });
  const partial = await readiness(fixture.root);

  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const diagnosticCount = snapshot.skillDiscovery.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
  ).length;
  const authoritative = await readiness(fixture.root);
  const coverage = check(authoritative.checks, "discovery.coverage");

  assert.equal(authoritative.summary.skillDiscovery.notReachedSkillCount, 1);
  assert.equal(coverage.status, "warn");
  assert.equal(
    coverage.evidence?.[0]?.id,
    DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
  );
  assert.equal(coverage.evidence?.[0]?.path, "skills/unreached/SKILL.md");
  assert.equal(diagnosticCount, 1);
  assert.equal(
    authoritative.diagnostics?.some(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
    ) ?? false,
    false,
  );
  assert.equal(authoritative.score, partial.score);
  assert.equal(authoritative.level, partial.level);
});

test("partial coverage and unrouted Skills stay descriptive and non-authoritative", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-partial-",
    testContext: t,
  });
  await fixture.skill("entry", {
    id: "skill.entry",
    owner: "qa",
    status: "stable",
    publishedEntrypoint: true,
    continuesWith: ["skill.reached"],
  });
  await fixture.skill("reached", {
    id: "skill.reached",
    owner: "qa",
    status: "stable",
  });
  await fixture.skill("independent", {
    id: "skill.independent",
    owner: "qa",
    status: "stable",
  });

  const report = await readiness(fixture.root);

  assert.deepEqual(
    {
      adoption: report.summary.skillDiscovery.adoptionState,
      reachable: report.summary.skillDiscovery.reachableSkillCount,
      notReached: report.summary.skillDiscovery.notReachedSkillCount,
      unrouted: report.summary.skillDiscovery.unroutedSkillCount,
    },
    {
      adoption: "partial",
      reachable: 2,
      notReached: 1,
      unrouted: 1,
    },
  );
  assert.equal(check(report.checks, "discovery.coverage").status, "pass");
  assert.equal(check(report.checks, "discovery.coverage").severity, "info");
  assert.match(
    check(report.checks, "discovery.coverage").summary,
    /descriptive only/,
  );
  assert.equal(
    check(report.checks, "discovery.unrouted_skills").status,
    "pass",
  );
  assert.notEqual(report.level, "not_ready");
});

test("not-adopted repositories retain inventory without publication or coverage warnings", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-not-adopted-",
    testContext: t,
  });
  await fixture.skill("first", {
    id: "skill.first",
    owner: "qa",
    status: "stable",
  });
  await fixture.skill("second", {
    id: "skill.second",
    owner: "qa",
    status: "stable",
  });

  const snapshot = await collectRepositorySnapshot(fixture.root);
  const report = readinessFromRepositorySnapshot(snapshot);
  const withoutDiscovery = readinessFromRepositorySnapshot(snapshot, {
    includeSkillDiscovery: false,
  });
  const publication = check(report.checks, "discovery.publication");
  const coverage = check(report.checks, "discovery.coverage");
  const cli = await captureStdout(() =>
    runReadinessCommand(fixture.root, { format: "json" }),
  );

  assert.equal(report.summary.skillDiscovery.adoptionState, "not-adopted");
  assert.equal(report.summary.skillDiscovery.routeEligibleSkillCount, 2);
  assert.equal(report.summary.skillDiscovery.unroutedSkillCount, 2);
  assert.equal(publication.status, "pass");
  assert.equal(publication.severity, "info");
  assert.match(publication.summary, /no published entrypoint is required/i);
  assert.match(publication.summary, /structural roots are not inferred/i);
  assert.equal(coverage.status, "pass");
  assert.equal(coverage.severity, "info");
  assert.match(coverage.summary, /was not evaluated/i);
  assert.doesNotMatch(coverage.summary, /\d+ reachable/i);
  assert.deepEqual(
    discoveryChecks(report.checks).map((item) => item.status),
    ["pass", "pass", "pass", "pass", "pass"],
  );
  assert.equal(report.score, withoutDiscovery.score);
  assert.equal(report.level, withoutDiscovery.level);
  assert.deepEqual(report.diagnostics, withoutDiscovery.diagnostics);
  assert.equal(cli.code, report.level === "ready" ? 0 : 1);
  assert.equal(
    (JSON.parse(cli.stdout) as { score: number }).score,
    report.score,
  );
});

test("partial adoption without publication warns without promoting structural roots", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-no-publication-",
    testContext: t,
  });
  await fixture.skill("root", {
    id: "skill.root",
    owner: "qa",
    status: "stable",
    continuesWith: ["skill.child"],
  });
  await fixture.skill("child", {
    id: "skill.child",
    owner: "qa",
    status: "stable",
  });

  const report = await readiness(fixture.root);
  const publication = check(report.checks, "discovery.publication");
  const coverage = check(report.checks, "discovery.coverage");

  assert.equal(report.summary.skillDiscovery.adoptionState, "partial");
  assert.equal(report.summary.skillDiscovery.publishedEntrypointCount, 0);
  assert.equal(report.summary.skillDiscovery.usableRouteCount, 1);
  assert.equal(publication.status, "warn");
  assert.match(publication.summary, /structural roots are not inferred/);
  assert.equal(coverage.status, "warn");
  assert.match(coverage.summary, /cannot be evaluated/);
  assert.match(coverage.summary, /structural roots are not inferred/);
});

test("incomplete repository adoption warns when no effective entrypoint exists", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-incomplete-",
    testContext: t,
  });
  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  await fixture.skill("only", {
    id: "skill.only",
    owner: "qa",
    status: "stable",
  });

  const report = await readiness(fixture.root);
  const publication = check(report.checks, "discovery.publication");
  const coverage = check(report.checks, "discovery.coverage");

  assert.equal(report.summary.skillDiscovery.adoptionState, "incomplete");
  assert.equal(report.summary.skillDiscovery.routeEligibleSkillCount, 1);
  assert.equal(report.summary.skillDiscovery.publishedEntrypointCount, 0);
  assert.equal(publication.status, "warn");
  assert.match(publication.summary, /Repository-wide Skill Discovery/);
  assert.equal(coverage.status, "warn");
  assert.match(coverage.summary, /cannot be evaluated/);
});

test("route validity aggregates existing structured unusable reasons and diagnostics", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-routes-",
    testContext: t,
  });
  await fixture.skill("source", {
    id: "skill.source",
    owner: "qa",
    status: "stable",
    publishedEntrypoint: true,
    continuesWith: [
      "skill.missing",
      "skill.duplicate",
      "context.target",
      "skill.inactive",
      "skills/invalid/SKILL.md",
      "skill.valid",
      "skill.valid",
    ],
  });
  await fixture.skill("duplicate-a", {
    id: "skill.duplicate",
    owner: "qa",
    status: "stable",
  });
  await fixture.skill("duplicate-b", {
    id: "skill.duplicate",
    owner: "qa",
    status: "stable",
  });
  await fixture.context("contexts/target.md", {
    id: "context.target",
    owner: "qa",
    status: "stable",
  });
  await fixture.skill("inactive", {
    id: "skill.inactive",
    owner: "qa",
    status: "archived",
  });
  await fixture.write(
    "skills/invalid/SKILL.md",
    [
      "---",
      "name: invalid",
      "metadata:",
      "  renma.id: skill.invalid",
      "  renma.owner: qa",
      "  renma.status: stable",
      "---",
      "# Invalid",
      "",
    ].join("\n"),
  );
  await fixture.skill("valid", {
    id: "skill.valid",
    owner: "qa",
    status: "stable",
  });

  const snapshot = await collectRepositorySnapshot(fixture.root);
  const report = await readiness(fixture.root);
  const routeValidity = check(report.checks, "discovery.route_validity");
  const reasons = new Set(
    snapshot.skillDiscovery.routes.flatMap((route) => route.usabilityReasons),
  );

  assert.equal(routeValidity.status, "warn");
  for (const reason of [
    "unresolved-target",
    "ambiguous-target",
    "wrong-kind",
    "inactive-target",
    "invalid-target",
    "duplicate-declaration",
  ]) {
    assert.equal(reasons.has(reason as never), true, reason);
    assert.match(routeValidity.summary, new RegExp(`${reason}: [1-9]`));
  }
  assert.equal(
    routeValidity.evidence?.some(
      (item) => item.id === DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
    ),
    true,
  );
  assert.equal(
    routeValidity.evidence?.some(
      (item) => item.id === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_TARGET_NOT_SKILL,
    ),
    true,
  );
  assert.equal(
    routeValidity.evidence?.some(
      (item) => item.id === DIAGNOSTIC_IDS.DISCOVERY_DUPLICATE_DECLARED_ROUTE,
    ),
    true,
  );
});

test("cycle review counts maximal components deterministically without hard failure", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-cycles-",
    testContext: t,
  });
  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  await fixture.skill("a", {
    id: "skill.a",
    owner: "qa",
    status: "stable",
    publishedEntrypoint: true,
    continuesWith: ["skill.b", "skill.self", "skill.x"],
  });
  await fixture.skill("b", {
    id: "skill.b",
    owner: "qa",
    status: "stable",
    continuesWith: ["skill.a"],
  });
  await fixture.skill("self", {
    id: "skill.self",
    owner: "qa",
    status: "stable",
    continuesWith: ["skill.self"],
  });
  await fixture.skill("x", {
    id: "skill.x",
    owner: "qa",
    status: "stable",
    continuesWith: ["skill.y"],
  });
  await fixture.skill("y", {
    id: "skill.y",
    owner: "qa",
    status: "stable",
    continuesWith: ["skill.x"],
  });

  const first = await readiness(fixture.root);
  const second = await readiness(fixture.root);
  const cycle = check(first.checks, "discovery.cycle_review");
  const markdown = formatReadinessMarkdown(first);

  assert.equal(first.summary.skillDiscovery.cycleComponentCount, 3);
  assert.equal(cycle.status, "warn");
  assert.equal(cycle.severity, "warning");
  assert.equal(cycle.evidence?.length, 3);
  assert.match(cycle.summary, /does not prove runtime recursion/);
  assert.match(markdown, /^### Discovery check evidence$/m);
  assert.match(
    markdown,
    /discovery\.cycle_review: DISCOVERY-ROUTE-CYCLE — skills\/a\/SKILL\.md/,
  );
  assert.notEqual(first.level, "not_ready");
  assert.deepEqual(first.summary.skillDiscovery, second.summary.skillDiscovery);
  assert.deepEqual(cycle, check(second.checks, "discovery.cycle_review"));
});

test("repositories without Skills get a stable zero summary and neutral Discovery checks", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-empty-",
    testContext: t,
  });

  const report = await readiness(fixture.root);

  assert.deepEqual(report.summary.skillDiscovery, {
    adoptionState: "not-adopted",
    publishedEntrypointCount: 0,
    routeEligibleSkillCount: 0,
    reachableSkillCount: 0,
    notReachedSkillCount: 0,
    unroutedSkillCount: 0,
    usableRouteCount: 0,
    unusableRouteCount: 0,
    unresolvedRouteCount: 0,
    cycleComponentCount: 0,
  });
  assert.deepEqual(
    discoveryChecks(report.checks).map((item) => item.status),
    ["pass", "pass", "pass", "pass", "pass"],
  );
});

test("Discovery readiness aggregation is deterministic and does not mutate prepared indexes", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-readiness-discovery-property-",
    testContext: t,
  });
  await fixture.skill("a", {
    id: "skill.a",
    owner: "qa",
    status: "stable",
    publishedEntrypoint: true,
    continuesWith: ["skill.b", "skill.missing"],
  });
  await fixture.skill("b", {
    id: "skill.b",
    owner: "qa",
    status: "stable",
  });
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const index = snapshot.skillDiscovery;
  const before = JSON.stringify(index);
  const expected = buildSkillDiscoveryReadiness(index);

  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      (reverseSkills, reverseRoutes, reverseDiagnostics) => {
        const reordered: SkillDiscoveryIndex = {
          ...index,
          skills: reverseSkills
            ? [...index.skills].reverse()
            : [...index.skills],
          routes: reverseRoutes
            ? [...index.routes].reverse()
            : [...index.routes],
          diagnostics: reverseDiagnostics
            ? [...index.diagnostics].reverse()
            : [...index.diagnostics],
        };
        assert.deepEqual(
          buildSkillDiscoveryReadiness(reordered).summary,
          expected.summary,
        );
      },
    ),
    { seed: 2300, numRuns: 32 },
  );
  assert.equal(JSON.stringify(index), before);
  assert.deepEqual(buildSkillDiscoveryReadiness(index), expected);
});

function discoveryChecks(checks: readonly ReadinessCheck[]): ReadinessCheck[] {
  return checks.filter((item) => item.id.startsWith("discovery."));
}

function check(
  checks: readonly ReadinessCheck[],
  id: (typeof DISCOVERY_CHECK_IDS)[number],
): ReadinessCheck {
  const result = checks.find((item) => item.id === id);
  assert.ok(result, `missing ${id}`);
  return result;
}

async function captureStdout(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string }> {
  const stdoutWrite = process.stdout.write;
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await callback(), stdout };
  } finally {
    process.stdout.write = stdoutWrite;
  }
}
