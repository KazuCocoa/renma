import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { bom } from "../src/commands/bom.js";
import {
  ciReport,
  formatCiReport,
  runCiReportCommand,
} from "../src/commands/ci-report.js";
import {
  diff,
  diffWithoutSkillDiscovery,
  formatDiff,
} from "../src/commands/diff.js";
import { readiness } from "../src/commands/readiness.js";
import { trustGraph } from "../src/commands/trust-graph.js";
import { CONTEXT_LENS_DIAGNOSTIC_CODES } from "../src/context-lens.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { scan } from "../src/scanner.js";
import type { DiagnosticV2 } from "../src/types.js";
import { RepositoryFixture } from "./repository-fixture.js";

test("graph --view discovery JSON exposes the dedicated route contract", async (t) => {
  const root = await routeFixture(t);
  const result = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "json"]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout) as {
    view: string;
    edgeCount: number;
    diagnostics?: Array<{ code?: string; severity: string }>;
    edges: Array<{
      from: string;
      to: string;
      kind: string;
      resolved: boolean;
      targetId?: string;
    }>;
    discovery: {
      summary: {
        visibleSkillCount: number;
        declaredRouteCount: number;
        usableRouteCount: number;
        unresolvedOrAmbiguousRouteCount: number;
        invalidRouteCount: number;
        structuralRootCount: number;
        reachableSkillCount: number;
        notReachedSkillCount: number;
        unroutedSkillCount: number;
      };
      skills: Array<{
        id: string;
        sourcePath: string;
        agentSkillsValid: boolean;
        lifecycleActive: boolean;
        effectiveIdUnique: boolean;
        routeEligible: boolean;
      }>;
      routes: Array<{
        declarationIndex: number;
        rawTarget: string;
        normalizedTarget: string;
        resolution: string;
        resolvedTarget?: { id: string; sourcePath: string; kind: string };
        usable: boolean;
        usabilityReasons: string[];
        evidence: { path: string; startLine: number; declarationIndex: number };
        linkedDiagnostics: Array<{ code: string }>;
      }>;
      structuralRootIds: string[];
      standaloneSkillIds: string[];
      diagnostics: Array<{ code: string }>;
    };
  };

  assert.equal(report.view, "discovery");
  assert.equal(report.diagnostics, undefined);
  assert.equal(report.edgeCount, 1);
  assert.deepEqual(
    report.edges.map((edge) => [
      edge.from,
      edge.to,
      edge.kind,
      edge.resolved,
      edge.targetId,
    ]),
    [["skill.source", "skill.target", "continues_with", true, "skill.target"]],
  );
  assert.deepEqual(report.discovery.summary, {
    visibleSkillCount: 3,
    routeEligibleSkillCount: 2,
    declaredRouteCount: 3,
    usableRouteCount: 1,
    unresolvedRouteCount: 1,
    ambiguousRouteCount: 0,
    unresolvedOrAmbiguousRouteCount: 1,
    invalidRouteCount: 1,
    structuralRootCount: 1,
    standaloneSkillCount: 0,
    unroutedSkillCount: 1,
    publishedEntrypointCount: 0,
    reachableSkillCount: 0,
    notReachedSkillCount: 0,
  });
  assert.deepEqual(report.discovery.structuralRootIds, ["skill.source"]);
  assert.deepEqual(report.discovery.standaloneSkillIds, []);
  assert.ok(
    report.discovery.skills.every(
      (skill) =>
        typeof skill.sourcePath === "string" &&
        typeof skill.agentSkillsValid === "boolean" &&
        typeof skill.lifecycleActive === "boolean" &&
        typeof skill.effectiveIdUnique === "boolean" &&
        typeof skill.routeEligible === "boolean",
    ),
  );
  assert.deepEqual(
    report.discovery.routes.map((route) => [
      route.declarationIndex,
      route.resolution,
      route.resolvedTarget?.id,
      route.usable,
      route.usabilityReasons,
    ]),
    [
      [0, "resolved", "skill.target", true, []],
      [1, "unresolved", undefined, false, ["unresolved-target"]],
      [2, "resolved", "skill.old", false, ["inactive-target"]],
    ],
  );
  assert.equal(report.discovery.routes[0]?.evidence.declarationIndex, 0);
  assert.equal(
    report.discovery.routes[0]?.evidence.path,
    "skills/source/SKILL.md",
  );
  assert.deepEqual(
    report.discovery.diagnostics.map((diagnostic) => diagnostic.code),
    [
      DIAGNOSTIC_IDS.DISCOVERY_INACTIVE_ROUTE_TARGET,
      DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
    ],
  );
  assert.ok(
    report.discovery.diagnostics.every(
      (diagnostic) =>
        diagnostic.code.startsWith("DISCOVERY-") &&
        !report.diagnostics?.some((item) => item.code === diagnostic.code),
    ),
  );
});

test("graph --view discovery Markdown explains static routing and repairs", async (t) => {
  const root = await routeFixture(t);
  const result = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "markdown"]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^# Renma Skill Discovery Graph/m);
  assert.match(result.stdout, /static declared Skill-to-Skill continuation/);
  assert.match(
    result.stdout,
    /does not select, load, invoke, rank, or execute/,
  );
  assert.match(result.stdout, /Open each source `SKILL.md`/);
  assert.match(result.stdout, /Visible Skills: 3/);
  assert.match(result.stdout, /Declared routes: 3/);
  assert.match(result.stdout, /Usable routes: 1/);
  assert.match(result.stdout, /Unresolved or ambiguous routes: 1/);
  assert.match(result.stdout, /Invalid routes: 1/);
  assert.match(result.stdout, /skill.source — skills\/source\/SKILL.md/);
  assert.match(result.stdout, /skills\/source\/SKILL.md:L6/);
  assert.match(result.stdout, /DISCOVERY-UNRESOLVED-DECLARED-ROUTE/);
  assert.match(result.stdout, /Do not create a placeholder/i);
});

test("graph --view discovery Mermaid separates usable and unusable declarations", async (t) => {
  const root = await routeFixture(t);
  const first = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "mermaid"]),
  );
  const second = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "mermaid"]),
  );

  assert.equal(first.code, 0);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /^graph TD/);
  assert.match(first.stdout, /-->|continues-with/);
  assert.match(first.stdout, /-\.->\|continues-with unresolved\|/);
  assert.match(first.stdout, /inactive-target/);
  assert.match(first.stdout, /classDef structuralRoot/);
  assert.match(first.stdout, /%% coverage mode: not-evaluated/);
  assert.match(first.stdout, /%% reachable eligible Skill IDs: \(none\)/);
  assert.match(first.stdout, /%% unrouted Skill IDs: skill\.source/);
  assert.match(first.stdout, /%% declaration skills\/source\/SKILL.md index 0/);
  assert.match(first.stdout, /%% Discovery diagnostics:/);
  assert.match(first.stdout, /does not execute Skills/);
});

test("Discovery preserves repository errors separately and returns exit code 1", async (t) => {
  const root = await routeFixture(t);
  await writeBrokenLens(root);

  const json = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "json"]),
  );
  const report = JSON.parse(json.stdout) as {
    diagnostics?: Array<{ code?: string; severity: string }>;
    discovery: { diagnostics: Array<{ code: string; severity: string }> };
  };

  assert.equal(json.code, 1);
  assert.equal(json.stderr, "");
  assert.ok(
    report.diagnostics?.some(
      (diagnostic) =>
        diagnostic.code ===
          CONTEXT_LENS_DIAGNOSTIC_CODES.MISSING_REQUIRED_FIELD &&
        diagnostic.severity === "error",
    ),
  );
  assert.equal(
    report.diagnostics?.some((diagnostic) =>
      diagnostic.code?.startsWith("DISCOVERY-"),
    ),
    false,
  );
  assert.deepEqual(
    report.discovery.diagnostics.map((diagnostic) => diagnostic.code),
    [
      DIAGNOSTIC_IDS.DISCOVERY_INACTIVE_ROUTE_TARGET,
      DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
    ],
  );
  assert.ok(
    report.discovery.diagnostics.every(
      (diagnostic) => diagnostic.severity === "warning",
    ),
  );

  const markdown = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "markdown"]),
  );
  assert.equal(markdown.code, 1);
  const discoveryMarkdown = markdown.stdout.split(
    "## Repository diagnostics",
  )[0]!;
  const repositoryMarkdown = markdown.stdout.split(
    "## Repository diagnostics",
  )[1]!;
  assert.match(discoveryMarkdown, /## Discovery diagnostics/);
  assert.match(discoveryMarkdown, /DISCOVERY-UNRESOLVED-DECLARED-ROUTE/);
  assert.doesNotMatch(discoveryMarkdown, /CONTEXT-LENS-MISSING-REQUIRED-FIELD/);
  assert.match(repositoryMarkdown, /CONTEXT-LENS-MISSING-REQUIRED-FIELD/);
  assert.doesNotMatch(repositoryMarkdown, /DISCOVERY-/);

  const mermaid = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "mermaid"]),
  );
  assert.equal(mermaid.code, 1);
  const discoveryMermaid = mermaid.stdout.split(
    "%% Repository diagnostics:",
  )[0]!;
  const repositoryMermaid = mermaid.stdout.split(
    "%% Repository diagnostics:",
  )[1]!;
  assert.match(discoveryMermaid, /%% Discovery diagnostics:/);
  assert.match(discoveryMermaid, /DISCOVERY-UNRESOLVED-DECLARED-ROUTE/);
  assert.doesNotMatch(discoveryMermaid, /CONTEXT-LENS-MISSING-REQUIRED-FIELD/);
  assert.match(repositoryMermaid, /CONTEXT-LENS-MISSING-REQUIRED-FIELD/);
  assert.doesNotMatch(repositoryMermaid, /DISCOVERY-/);
});

test("Discovery Mermaid remains valid for empty, cyclic, and duplicate-ID graphs", async () => {
  const emptyRoot = await mkdtemp(
    path.join(os.tmpdir(), "renma-discovery-cli-"),
  );
  await writeSkill(emptyRoot, "standalone", "skill.standalone");
  const empty = await captured(() =>
    main(["graph", emptyRoot, "--view", "discovery", "--format", "mermaid"]),
  );
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /^graph TD/);
  assert.doesNotMatch(empty.stdout, /-->|-\.->/);

  const cycleRoot = await mkdtemp(
    path.join(os.tmpdir(), "renma-discovery-cli-"),
  );
  await writeSkill(cycleRoot, "alpha", "skill.alpha", ["skill.beta"]);
  await writeSkill(cycleRoot, "beta", "skill.beta", ["skill.alpha"]);
  const cycle = await captured(() =>
    main(["graph", cycleRoot, "--view", "discovery", "--format", "mermaid"]),
  );
  assert.equal(cycle.code, 0);
  assert.equal((cycle.stdout.match(/-->/g) ?? []).length, 2);

  const duplicateRoot = await mkdtemp(
    path.join(os.tmpdir(), "renma-discovery-cli-"),
  );
  await writeSkill(duplicateRoot, "source", "skill.source", [
    "skills/alpha/SKILL.md",
    "skills/alpha/SKILL.md",
  ]);
  await writeSkill(duplicateRoot, "alpha", "skill.duplicate");
  await writeSkill(duplicateRoot, "beta", "skill.duplicate");
  const duplicate = await captured(() =>
    main([
      "graph",
      duplicateRoot,
      "--view",
      "discovery",
      "--format",
      "mermaid",
    ]),
  );
  assert.equal(duplicate.code, 0);
  assert.match(duplicate.stdout, /duplicate-target-id/);
  assert.match(duplicate.stdout, /duplicate-declaration/);
  assert.match(duplicate.stdout, /DISCOVERY-DUPLICATE-DECLARED-ROUTE/);
});

test("focused Discovery uses exact Skill ID or source path and direct routes", async (t) => {
  const root = await routeFixture(t);
  await writeSkill(root, "upstream", "skill.upstream", ["skill.source"]);
  await writeSkill(root, "unrelated", "skill.unrelated");

  for (const focus of ["skill.source", "./skills/source/SKILL.md"] as const) {
    const result = await captured(() =>
      main([
        "graph",
        root,
        "--view",
        "discovery",
        "--focus",
        focus,
        "--format",
        "json",
      ]),
    );
    const report = JSON.parse(result.stdout) as {
      discovery: {
        focus: { id: string; sourcePath: string };
        skills: Array<{ id: string }>;
        routes: Array<{ sourceId: string; normalizedTarget: string }>;
      };
    };
    assert.equal(result.code, 0);
    assert.deepEqual(report.discovery.focus, {
      id: "skill.source",
      sourcePath: "skills/source/SKILL.md",
    });
    assert.equal(
      report.discovery.skills.some((skill) => skill.id === "skill.unrelated"),
      false,
    );
    assert.deepEqual(
      report.discovery.routes.map((route) => [
        route.sourceId,
        route.normalizedTarget,
      ]),
      [
        ["skill.source", "skill.target"],
        ["skill.source", "skill.missing"],
        ["skill.source", "skill.old"],
        ["skill.upstream", "skill.source"],
      ],
    );
  }
});

test("Discovery adoption config is strict and invalid forms return exit code 2", async (t) => {
  const cases = [
    [{ skill_discovery: [] }, /skill_discovery must be an object/],
    [
      { skill_discovery: { adopted: "true" } },
      /skill_discovery\.adopted must be a boolean/,
    ],
    [
      { skill_discovery: { adopted: true, extra: true } },
      /Unknown skill_discovery config key "extra"/,
    ],
    [
      { skillDiscovery: { adopted: true } },
      /Unknown config field "skillDiscovery"/,
    ],
  ] as const;

  for (const [config, message] of cases) {
    await t.test(JSON.stringify(config), async () => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "renma-discovery-cli-"),
      );
      await writeFile(
        path.join(root, "renma.config.json"),
        `${JSON.stringify(config)}\n`,
      );
      const result = await captured(() =>
        main(["graph", root, "--view", "discovery", "--format", "json"]),
      );
      assert.equal(result.code, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, message);
    });
  }
});

test("graph Discovery projects explicit adoption and publication in every format", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: true } })}\n`,
  );
  await writeSkill(
    root,
    "published",
    "skill.published",
    undefined,
    "stable",
    true,
    "qa-platform",
  );

  const json = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "json"]),
  );
  const report = JSON.parse(json.stdout) as {
    discovery: {
      adoption: {
        state: string;
        repositoryWideAdopted: boolean;
        publishedEntrypointCount: number;
        configPath?: string;
      };
      coverage: {
        scope: string;
        mode: string;
        reason: string;
        sourceEntrypointIds: string[];
        eligibleSkillCount: number;
        reachableSkillCount: number;
        notReachedSkillCount: number;
        complete: boolean | null;
      };
      publishedEntrypointIds: string[];
      skills: Array<{
        id: string;
        ownership: {
          declaredOwner: string | null;
          effectiveOwner: string | null;
          source: string;
        };
        publication: {
          marker: { state: string; evidence?: { snippet: string } };
          requested: boolean;
          accepted: boolean;
        };
      }>;
    };
  };
  assert.equal(json.code, 0);
  assert.deepEqual(report.discovery.adoption, {
    state: "adopted",
    discoveryMetadataPresent: true,
    repositoryWideAdopted: true,
    publishedEntrypointCount: 1,
    reason: "repository-adoption-has-effective-published-entrypoint",
    configPath: "renma.config.json",
  });
  assert.deepEqual(report.discovery.coverage, {
    scope: "repository",
    mode: "authoritative",
    reason: "repository-wide-discovery-adopted",
    sourceEntrypointIds: ["skill.published"],
    eligibleSkillCount: 1,
    reachableSkillCount: 1,
    notReachedSkillCount: 0,
    complete: true,
  });
  assert.deepEqual(report.discovery.publishedEntrypointIds, [
    "skill.published",
  ]);
  assert.deepEqual(report.discovery.skills[0]?.ownership, {
    declaredOwner: "qa-platform",
    effectiveOwner: "qa-platform",
    source: "declared",
  });
  assert.deepEqual(report.discovery.skills[0]?.publication, {
    marker: {
      state: "valid",
      canonicalKey: "metadata.renma.published-entrypoint",
      present: true,
      valid: true,
      rawValue: "true",
      evidence: {
        path: "skills/published/SKILL.md",
        startLine: 8,
        endLine: 8,
        snippet: '  renma.published-entrypoint: "true"',
      },
    },
    requested: true,
    accepted: true,
    rejectionReasons: [],
    linkedDiagnostics: [],
  });

  const markdown = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "markdown"]),
  );
  assert.equal(markdown.code, 0);
  assert.ok(
    markdown.stdout.indexOf("## Adoption") <
      markdown.stdout.indexOf("## Published entrypoints"),
  );
  assert.ok(
    markdown.stdout.indexOf("## Published entrypoints") <
      markdown.stdout.indexOf("## Structural roots"),
  );
  assert.match(markdown.stdout, /State: adopted/);
  assert.match(markdown.stdout, /## Coverage/);
  assert.match(markdown.stdout, /Mode: authoritative/);
  assert.match(
    markdown.stdout,
    /Authoritative coverage is evaluated only because the repository explicitly declared skill_discovery\.adopted: true\./,
  );
  assert.match(
    markdown.stdout,
    /None\. Every Discovery-eligible Skill is reachable/,
  );
  assert.match(markdown.stdout, /### skill\.published/);
  assert.match(markdown.stdout, /Owner: qa-platform \(declared\)/);
  assert.match(
    markdown.stdout,
    /Published entrypoints are explicit first-hop declarations\. Structural roots are derived graph facts\./,
  );

  const mermaid = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "mermaid"]),
  );
  assert.equal(mermaid.code, 0);
  assert.match(mermaid.stdout, /classDef publishedEntrypoint/);
  assert.match(mermaid.stdout, /class skill_0 publishedEntrypoint/);
  assert.match(mermaid.stdout, /class skill_0 structuralRoot/);
  assert.match(mermaid.stdout, /%% coverage mode: authoritative/);
  assert.match(mermaid.stdout, /%% source entrypoint IDs: skill\.published/);
  assert.match(
    mermaid.stdout,
    /%% reachable eligible Skill IDs: skill\.published/,
  );

  const full = await captured(() =>
    main(["graph", root, "--view", "full", "--format", "json"]),
  );
  const fullReport = JSON.parse(full.stdout) as {
    discovery?: unknown;
    edges: Array<{ kind: string }>;
  };
  assert.equal(full.code, 0);
  assert.equal(fullReport.discovery, undefined);
  assert.equal(
    fullReport.edges.some((edge) => edge.kind === "continues_with"),
    false,
  );
  assert.doesNotMatch(
    full.stdout,
    /publishedEntrypoint|published_entrypoint|published-entrypoint/,
  );
});

test("focused Discovery retains global adoption while filtering entrypoints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: true } })}\n`,
  );
  await writeSkill(
    root,
    "published",
    "skill.published",
    undefined,
    undefined,
    true,
  );
  await writeSkill(root, "focused", "skill.focused");

  const result = await captured(() =>
    main([
      "graph",
      root,
      "--view",
      "discovery",
      "--focus",
      "skill.focused",
      "--format",
      "json",
    ]),
  );
  const report = JSON.parse(result.stdout) as {
    discovery: {
      adoption: { state: string; publishedEntrypointCount: number };
      coverage: {
        mode: string;
        reachableSkillCount: number;
        notReachedSkillCount: number;
        complete: boolean;
      };
      publishedEntrypointIds: string[];
      reachableDiscoveryEligibleSkillIds: string[];
      notReachedDiscoveryEligibleSkillIds: string[];
      unroutedSkillIds: string[];
      skills: Array<{
        id: string;
        reachability: { state: string; reason: string };
      }>;
      summary: {
        publishedEntrypointCount: number;
        reachableSkillCount: number;
        notReachedSkillCount: number;
        unroutedSkillCount: number;
      };
    };
  };

  assert.equal(result.code, 0);
  assert.equal(report.discovery.adoption.state, "adopted");
  assert.equal(report.discovery.adoption.publishedEntrypointCount, 1);
  assert.deepEqual(report.discovery.coverage, {
    scope: "repository",
    sourceEntrypointIds: ["skill.published"],
    eligibleSkillCount: 2,
    reachableSkillCount: 1,
    notReachedSkillCount: 1,
    mode: "authoritative",
    reason: "repository-wide-discovery-adopted",
    complete: false,
  });
  assert.deepEqual(report.discovery.publishedEntrypointIds, []);
  assert.deepEqual(report.discovery.reachableDiscoveryEligibleSkillIds, []);
  assert.deepEqual(report.discovery.notReachedDiscoveryEligibleSkillIds, [
    "skill.focused",
  ]);
  assert.deepEqual(report.discovery.unroutedSkillIds, ["skill.focused"]);
  assert.deepEqual(report.discovery.skills[0]?.reachability, {
    state: "not-reached",
    reason: "no-usable-path-from-published-entrypoint",
    sourceEntrypointIds: [],
  });
  assert.equal(report.discovery.summary.publishedEntrypointCount, 0);
  assert.equal(report.discovery.summary.reachableSkillCount, 0);
  assert.equal(report.discovery.summary.notReachedSkillCount, 1);
  assert.equal(report.discovery.summary.unroutedSkillCount, 1);

  const publishedFocus = await captured(() =>
    main([
      "graph",
      root,
      "--view",
      "discovery",
      "--focus",
      "skill.published",
      "--format",
      "markdown",
    ]),
  );
  assert.match(
    publishedFocus.stdout,
    /No authoritative coverage gap is visible in this focused projection\. Repository-wide coverage remains incomplete/,
  );
  assert.doesNotMatch(
    publishedFocus.stdout,
    /None\. Every Discovery-eligible Skill is reachable/,
  );
});

test("descriptive Markdown reports evidence without unreachable defects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await writeSkill(
    root,
    "published",
    "skill.published",
    undefined,
    undefined,
    true,
  );
  await writeSkill(root, "unreached", "skill.unreached");

  const result = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "markdown"]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Mode: descriptive/);
  assert.match(
    result.stdout,
    /Descriptive coverage is review evidence, not a repository-wide completeness claim\./,
  );
  assert.doesNotMatch(result.stdout, /Authoritative coverage gaps/);
  assert.doesNotMatch(result.stdout, /DISCOVERY-UNREACHABLE-ELIGIBLE-SKILL/);
  assert.match(result.stdout, /## Unrouted Skills/);
});

test("Discovery Markdown and Mermaid cap long ID arrays deterministically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await writeSkill(
    root,
    "published",
    "skill.published",
    undefined,
    undefined,
    true,
  );
  for (let index = 0; index < 12; index += 1) {
    const suffix = index.toString().padStart(2, "0");
    await writeSkill(root, `unreached-${suffix}`, `skill.unreached-${suffix}`);
  }

  const markdown = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "markdown"]),
  );
  const firstMermaid = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "mermaid"]),
  );
  const secondMermaid = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "mermaid"]),
  );

  assert.equal(firstMermaid.stdout, secondMermaid.stdout);
  assert.match(
    markdown.stdout,
    /2 more omitted from Markdown output\. Use JSON for the complete ID array/,
  );
  assert.match(
    firstMermaid.stdout,
    /not-reached eligible Skill IDs: .*\(10 of 12 shown; total 12\)/,
  );
  assert.match(
    firstMermaid.stdout,
    /unrouted Skill IDs: .*\(10 of 12 shown; total 12\)/,
  );
});

test("authoritative unreachable warnings flow through scan, diagnostics v2, and review bundles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: true } })}\n`,
  );
  await writeSkill(
    root,
    "published",
    "skill.published",
    undefined,
    undefined,
    true,
  );
  await writeSkill(root, "unreached", "skill.unreached");

  const markdown = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "markdown"]),
  );
  const result = await scan(root);
  const diagnostic = result.diagnostics.find(
    (item) => item.code === DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
  );
  const diagnosticV2 = result.diagnosticsV2.find(
    (item) => item.code === DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
  );

  assert.equal(markdown.code, 0);
  assert.match(markdown.stdout, /## Authoritative coverage gaps/);
  assert.match(
    markdown.stdout,
    /skill\.unreached — skills\/unreached\/SKILL\.md/,
  );
  assert.equal(diagnostic?.severity, "warning");
  assert.equal(diagnosticV2?.location?.path, "skills/unreached/SKILL.md");
  assert.ok(
    diagnosticV2?.repairConstraints?.some(
      (item) =>
        item.kind === "must_not_change" && /fake continuation/.test(item.text),
    ),
  );
  assert.ok(
    diagnosticV2?.verificationSteps?.some(
      (item) => item.command === "renma graph . --view discovery --format json",
    ),
  );
  assert.ok(
    result.reviewBundles.some((bundle) =>
      bundle.diagnosticCodes.includes(
        DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
      ),
    ),
  );
  assert.doesNotMatch(JSON.stringify(result.trustGraph), /DISCOVERY-/);
});

test("explicit Discovery config false does not declare repository-wide adoption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: false } })}\n`,
  );
  const result = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "json"]),
  );
  const report = JSON.parse(result.stdout) as {
    discovery: {
      adoption: { state: string; repositoryWideAdopted: boolean };
    };
  };

  assert.equal(result.code, 0);
  assert.deepEqual(report.discovery.adoption, {
    state: "not-adopted",
    discoveryMetadataPresent: false,
    repositoryWideAdopted: false,
    publishedEntrypointCount: 0,
    reason: "no-discovery-metadata-or-repository-adoption",
    configPath: "renma.config.json",
  });
});

test("Discovery route diagnostics flow through scan and diagnostics v2", async (t) => {
  const root = await routeFixture(t);
  const result = await scan(root);
  const diagnostic = result.diagnostics.find(
    (item) => item.code === DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
  );
  const diagnosticV2 = result.diagnosticsV2.find(
    (item) => item.code === DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
  ) as DiagnosticV2 | undefined;

  assert.ok(diagnostic);
  assert.equal(diagnostic.severity, "warning");
  assert.equal(diagnostic.evidence?.path, "skills/source/SKILL.md");
  assert.equal(diagnostic.evidence?.startLine, 6);
  assert.equal(diagnosticV2?.repairPolicy, "preserve_semantics");
  assert.ok(
    diagnosticV2?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "must_preserve" &&
        /continuation relationship/.test(constraint.text),
    ),
  );
  assert.ok(
    diagnosticV2?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "must_not_change" &&
        /placeholder Skill/.test(constraint.text),
    ),
  );
  assert.ok(
    diagnosticV2?.verificationSteps?.some(
      (step) => step.command === "renma graph . --view discovery --format json",
    ),
  );
  assert.match(diagnosticV2?.llmHint ?? "", /real missing Skill/i);
  assert.doesNotMatch(JSON.stringify(result.trustGraph), /DISCOVERY-/);
});

test("route-cycle warnings propagate through scan, diagnostics v2, review bundles, graph, and Skill Index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await writeSkill(root, "a", "skill.a", ["skill.b"], undefined, true);
  await writeSkill(root, "b", "skill.b", ["skill.c", "skill.external"]);
  await writeSkill(root, "c", "skill.c", ["skill.a"]);
  await writeSkill(root, "external", "skill.external");

  const graphJson = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "json"]),
  );
  const graphMarkdown = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "markdown"]),
  );
  const skillIndexJson = await captured(() =>
    main(["skill-index", root, "--format", "json"]),
  );
  const skillIndexMarkdown = await captured(() =>
    main(["skill-index", root, "--format", "markdown"]),
  );
  const scanCommand = await captured(() =>
    main(["scan", root, "--format", "json"]),
  );
  const scanResult = await scan(root);
  const graphReport = JSON.parse(graphJson.stdout) as {
    discovery: {
      diagnostics: Array<{
        code: string;
        details: {
          cycleSkillIds: string[];
          routeCount: number;
          cycleRoutes: Array<{
            sourcePath: string;
            declarationIndex: number;
          }>;
        };
      }>;
      skills: Array<{
        id: string;
        linkedDiagnostics: Array<{ code: string }>;
      }>;
      routes: Array<{
        sourceId: string;
        normalizedTarget: string;
        linkedDiagnostics: Array<{ code: string }>;
      }>;
      routeCycles?: unknown;
      cycleCount?: unknown;
      cyclicSkillIds?: unknown;
    };
  };
  const indexReport = JSON.parse(skillIndexJson.stdout) as {
    schemaVersion: string;
    diagnostics: {
      repository: Array<{ code?: string }>;
      discovery: Array<{ code: string }>;
    };
    routeCycles?: unknown;
    cycleCount?: unknown;
    cyclicSkillIds?: unknown;
  };
  const diagnosticV2 = scanResult.diagnosticsV2.find(
    (item) => item.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
  );
  const reviewBundle = scanResult.reviewBundles.find((bundle) =>
    bundle.diagnosticCodes.includes(DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE),
  );
  const cycleDiagnostic = graphReport.discovery.diagnostics.find(
    (diagnostic) => diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
  )!;

  assert.equal(graphJson.code, 0);
  assert.equal(graphMarkdown.code, 0);
  assert.equal(skillIndexJson.code, 0);
  assert.equal(skillIndexMarkdown.code, 0);
  assert.equal(scanCommand.code, 0);
  assert.deepEqual(cycleDiagnostic.details.cycleSkillIds, [
    "skill.a",
    "skill.b",
    "skill.c",
  ]);
  assert.equal(cycleDiagnostic.details.routeCount, 3);
  assert.equal(graphReport.discovery.routeCycles, undefined);
  assert.equal(graphReport.discovery.cycleCount, undefined);
  assert.equal(graphReport.discovery.cyclicSkillIds, undefined);
  assert.equal(indexReport.schemaVersion, "renma.skill-index.v1");
  assert.equal(indexReport.routeCycles, undefined);
  assert.equal(indexReport.cycleCount, undefined);
  assert.equal(indexReport.cyclicSkillIds, undefined);
  assert.equal(
    indexReport.diagnostics.repository.some(
      (diagnostic) => diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
    ),
    false,
  );
  assert.ok(
    indexReport.diagnostics.discovery.some(
      (diagnostic) => diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
    ),
  );
  assert.match(graphMarkdown.stdout, /DISCOVERY-ROUTE-CYCLE/);
  assert.match(graphMarkdown.stdout, /static route evidence for review/);
  assert.match(skillIndexMarkdown.stdout, /DISCOVERY-ROUTE-CYCLE/);
  assert.ok(
    graphReport.discovery.skills
      .filter((skill) => ["skill.a", "skill.b", "skill.c"].includes(skill.id))
      .every((skill) =>
        skill.linkedDiagnostics.some(
          (diagnostic) =>
            diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
        ),
      ),
  );
  assert.equal(
    graphReport.discovery.skills
      .find((skill) => skill.id === "skill.external")
      ?.linkedDiagnostics.some(
        (diagnostic) =>
          diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
      ),
    false,
  );
  assert.ok(
    graphReport.discovery.routes
      .filter((route) => route.normalizedTarget !== "skill.external")
      .every((route) =>
        route.linkedDiagnostics.some(
          (diagnostic) =>
            diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
        ),
      ),
  );
  assert.equal(
    graphReport.discovery.routes
      .find((route) => route.normalizedTarget === "skill.external")
      ?.linkedDiagnostics.some(
        (diagnostic) =>
          diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
      ),
    false,
  );
  assert.deepEqual(diagnosticV2?.details?.cycleSkillIds, [
    "skill.a",
    "skill.b",
    "skill.c",
  ]);
  assert.ok(
    diagnosticV2?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "must_not_change" &&
        /arbitrary route/.test(constraint.text),
    ),
  );
  assert.deepEqual(
    diagnosticV2?.verificationSteps?.map((step) => step.command),
    [
      "renma graph . --view discovery --format json",
      "renma skill-index . --format json",
      "renma scan . --format json",
    ],
  );
  assert.deepEqual(reviewBundle?.affectedAssets, [
    "skill.a",
    "skill.b",
    "skill.c",
  ]);
  assert.deepEqual(reviewBundle?.affectedFiles, [
    "skills/a/SKILL.md",
    "skills/b/SKILL.md",
    "skills/c/SKILL.md",
  ]);
  assert.doesNotMatch(JSON.stringify(scanResult.trustGraph), /DISCOVERY-/);
});

test("a cycle introduced after base reaches Readiness while deferred reports remain unchanged", async () => {
  const root = await routeCycleIntroductionGitFixture();
  try {
    const scanReport = await scan(root);
    const graphResult = await captured(() =>
      main(["graph", root, "--view", "discovery", "--format", "json"]),
    );
    const skillIndexResult = await captured(() =>
      main(["skill-index", root, "--format", "json"]),
    );
    const graphReport = JSON.parse(graphResult.stdout) as {
      discovery: {
        diagnostics: Array<{
          code: string;
          details: {
            cycleSkillIds: string[];
            cycleSkills: Array<{ id: string; sourcePath: string }>;
            selfLoop: boolean;
            routeCount: number;
            cycleRoutes: Array<{
              sourceId: string;
              sourcePath: string;
              targetId: string;
              targetPath: string;
            }>;
          };
        }>;
      };
    };
    const skillIndexReport = JSON.parse(skillIndexResult.stdout) as {
      diagnostics: { discovery: Array<{ code: string }> };
    };
    const cycleDiagnostics = graphReport.discovery.diagnostics.filter(
      (diagnostic) => diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
    );

    assert.equal(graphResult.code, 0);
    assert.equal(skillIndexResult.code, 0);
    assert.equal(
      scanReport.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
      ).length,
      1,
    );
    assert.deepEqual(
      cycleDiagnostics.map((diagnostic) => ({
        cycleSkillIds: diagnostic.details.cycleSkillIds,
        cycleSkills: diagnostic.details.cycleSkills,
        selfLoop: diagnostic.details.selfLoop,
        routeCount: diagnostic.details.routeCount,
        cycleRoutes: diagnostic.details.cycleRoutes.map((route) => ({
          sourceId: route.sourceId,
          sourcePath: route.sourcePath,
          targetId: route.targetId,
          targetPath: route.targetPath,
        })),
      })),
      [
        {
          cycleSkillIds: ["skill.a", "skill.b"],
          cycleSkills: [
            { id: "skill.a", sourcePath: "skills/a/SKILL.md" },
            { id: "skill.b", sourcePath: "skills/b/SKILL.md" },
          ],
          selfLoop: false,
          routeCount: 2,
          cycleRoutes: [
            {
              sourceId: "skill.a",
              sourcePath: "skills/a/SKILL.md",
              targetId: "skill.b",
              targetPath: "skills/b/SKILL.md",
            },
            {
              sourceId: "skill.b",
              sourcePath: "skills/b/SKILL.md",
              targetId: "skill.a",
              targetPath: "skills/a/SKILL.md",
            },
          ],
        },
      ],
    );
    assert.equal(
      skillIndexReport.diagnostics.discovery.filter(
        (diagnostic) =>
          diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
      ).length,
      1,
    );

    const [
      semanticDiffReport,
      ciReportResult,
      readinessReport,
      trustGraphReport,
      bomReport,
    ] = await Promise.all([
      diff(root, { fromRef: "base", toRef: "HEAD" }),
      ciReport(root, { fromRef: "base", toRef: "HEAD" }),
      readiness(root),
      trustGraph(root),
      bom(root, {}, { omitGeneratedAt: true }),
    ]);

    assert.equal(
      semanticDiffReport.discovery.schemaVersion,
      "renma.skill-discovery-diff.v1",
    );
    assert.deepEqual(
      semanticDiffReport.discovery.cycles.added.map((cycle) => [
        cycle.skillIds,
        cycle.selfLoop,
      ]),
      [[["skill.a", "skill.b"], false]],
    );
    const semanticDiffMarkdown = formatDiff(semanticDiffReport, "markdown");
    assert.match(semanticDiffMarkdown, /^## Skill Discovery Changes$/m);
    assert.match(semanticDiffMarkdown, /^### Added cyclic components$/m);
    assert.match(semanticDiffMarkdown, /skill\.a, skill\.b/);
    assert.deepEqual(
      ciReportResult.skillDiscovery,
      semanticDiffReport.discovery,
    );
    assertDiscoveryFree(ciReportResult.diff);
    const ciMarkdown = formatCiReport(ciReportResult, "markdown");
    assert.match(ciMarkdown, /^## Skill Discovery Changes$/m);
    assert.match(ciMarkdown, /^### Added cyclic components$/m);
    assert.match(ciMarkdown, /skill\.a, skill\.b/);
    assert.equal(readinessReport.summary.skillDiscovery.cycleComponentCount, 1);
    assert.equal(
      readinessReport.checks.find(
        (check) => check.id === "discovery.cycle_review",
      )?.status,
      "warn",
    );
    assertDiscoveryFree(trustGraphReport);
    assertDiscoveryFree(bomReport);
    assert.equal(ciReportResult.status, "pass");
    assert.equal(ciReportResult.summary.findingsDelta, 0);
    assert.equal(ciReportResult.summary.highOrCriticalFindingsDelta, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("CI reports a neutral published entrypoint, route, and reachability change", async () => {
  const root = await healthyDiscoveryCiGitFixture();
  try {
    const direct = await diff(root, { fromRef: "base", toRef: "HEAD" });
    const compatible = await diffWithoutSkillDiscovery(root, {
      fromRef: "base",
      toRef: "HEAD",
    });
    const report = await ciReport(root, {
      fromRef: "base",
      toRef: "HEAD",
    });
    const markdown = formatCiReport(report, "markdown");
    const command = await captured(() =>
      runCiReportCommand(root, {
        fromRef: "base",
        toRef: "HEAD",
        format: "json",
      }),
    );

    assert.deepEqual(report.skillDiscovery, direct.discovery);
    assert.deepEqual(report.skillDiscovery.publishedEntrypoints.added, [
      { id: "skill.entry", path: "skills/entry/SKILL.md" },
    ]);
    assert.deepEqual(report.skillDiscovery.reachability.newlyReachable, [
      { id: "skill.target", path: "skills/target/SKILL.md" },
    ]);
    assert.equal(report.skillDiscovery.routes.added.length, 1);
    assert.equal("discovery" in report.diff, false);
    assert.equal("discovery" in compatible, false);
    assert.deepEqual(report.diff, compatible);
    assert.equal(report.status, "pass");
    assert.deepEqual(report.notes, ["No CI report regressions detected."]);
    assert.equal(command.code, 0);
    assert.match(markdown, /^## Skill Discovery Changes$/m);
    assert.match(markdown, /^### Added published entrypoints$/m);
    assert.match(markdown, /^### Newly reachable Skills$/m);
    assert.match(markdown, /^### Added routes$/m);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("CI keeps adopted-to-incomplete Discovery transitions observation-only", async () => {
  const root = await incompleteDiscoveryCiGitFixture();
  try {
    const report = await ciReport(root, {
      fromRef: "base",
      toRef: "HEAD",
    });
    const markdown = formatCiReport(report, "markdown");
    const command = await captured(() =>
      runCiReportCommand(root, {
        fromRef: "base",
        toRef: "HEAD",
        format: "markdown",
      }),
    );

    assert.deepEqual(report.skillDiscovery.adoption, {
      from: "adopted",
      to: "incomplete",
      changed: true,
    });
    assert.deepEqual(report.skillDiscovery.coverage, {
      from: "authoritative",
      to: "not-evaluated",
      changed: true,
    });
    assert.equal(report.status, "pass");
    assert.deepEqual(report.notes, ["No CI report regressions detected."]);
    assert.equal(command.code, 0);
    assert.match(markdown, /- Adoption: adopted -> incomplete/);
    assert.match(markdown, /- Coverage: authoritative -> not-evaluated/);
    assert.doesNotMatch(markdown, /Review .*Discovery/i);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("CI displays newly not-reached Skills without changing policy", async () => {
  const root = await newlyNotReachedDiscoveryCiGitFixture();
  try {
    const report = await ciReport(root, {
      fromRef: "base",
      toRef: "HEAD",
    });
    const markdown = formatCiReport(report, "markdown");
    const command = await captured(() =>
      runCiReportCommand(root, {
        fromRef: "base",
        toRef: "HEAD",
        format: "json",
      }),
    );

    assert.deepEqual(report.skillDiscovery.reachability.newlyNotReached, [
      { id: "skill.target", path: "skills/target/SKILL.md" },
    ]);
    assert.equal(report.skillDiscovery.routes.removed.length, 1);
    assert.equal(report.status, "pass");
    assert.deepEqual(report.notes, ["No CI report regressions detected."]);
    assert.equal(command.code, 0);
    assert.match(markdown, /^### Newly not-reached Skills$/m);
    assert.match(markdown, /skill\.target/);
    assert.doesNotMatch(markdown, /Review .*not-reached/i);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("invalid canonical continuation declarations flow through scan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await mkdir(path.join(root, "skills", "source"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "source", "SKILL.md"),
    skillText("source", "skill.source", undefined, "[skill.target]"),
  );

  const result = await scan(root);
  const diagnostic = result.diagnostics.find(
    (item) =>
      item.code === DIAGNOSTIC_IDS.DISCOVERY_INVALID_CONTINUATION_DECLARATION,
  );

  assert.ok(diagnostic);
  assert.match(diagnostic.message, /must be a string/);
  assert.equal(
    diagnostic.details?.metadataKey,
    "metadata.renma.continues-with",
  );
  assert.match(diagnostic.llmHint ?? "", /Correct it[\s\S]*or remove/i);
});

test("publication warnings flow through scan, diagnostics v2, and review bundles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await mkdir(path.join(root, "skills", "source"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "source", "SKILL.md"),
    [
      "---",
      "name: source",
      "description: Review source inputs and produce deterministic evidence. Use when source workflow decisions need review; do not use for runtime selection or execution.",
      "metadata:",
      "  renma.id: skill.source",
      "  renma.published-entrypoint: true",
      "---",
      "# Source",
      "",
      "Review evidence and report completion.",
      "",
    ].join("\n"),
  );

  const result = await scan(root);
  const diagnostic = result.diagnostics.find(
    (item) =>
      item.code === DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT,
  );
  const diagnosticV2 = result.diagnosticsV2.find(
    (item) =>
      item.code === DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT,
  );

  assert.equal(diagnostic?.severity, "warning");
  assert.equal(diagnostic?.details?.rawMarkerValue, true);
  assert.equal(diagnosticV2?.repairPolicy, "preserve_semantics");
  assert.ok(
    diagnosticV2?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "must_not_change" &&
        /publish every structural root/.test(constraint.text),
    ),
  );
  assert.ok(
    result.reviewBundles.some((bundle) =>
      bundle.diagnosticCodes.includes(
        DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT,
      ),
    ),
  );
  assert.doesNotMatch(JSON.stringify(result.trustGraph), /DISCOVERY-/);
});

test("existing graph views remain route-free and invalid view help lists discovery", async (t) => {
  const root = await routeFixture(t);
  const full = await captured(() =>
    main(["graph", root, "--view", "full", "--format", "json"]),
  );
  const invalid = await captured(() =>
    main(["graph", root, "--view", "discover", "--format", "json"]),
  );
  const help = await captured(() => main(["graph", "--help"]));
  const report = JSON.parse(full.stdout) as {
    view: string;
    edges: Array<{ kind: string }>;
    diagnostics?: Array<{ code: string }>;
    discovery?: unknown;
  };

  assert.equal(full.code, 0);
  assert.equal(report.view, "full");
  assert.equal(report.discovery, undefined);
  assert.equal(
    report.diagnostics?.some((diagnostic) =>
      diagnostic.code.startsWith("DISCOVERY-"),
    ) ?? false,
    false,
  );
  assert.equal(
    report.edges.some((edge) => edge.kind === "continues_with"),
    false,
  );
  assert.equal(invalid.code, 2);
  assert.match(
    invalid.stderr,
    /summary, workflow, full, layered, lens, composition, impact, discovery/,
  );
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--view discovery --format markdown/);
  assert.match(help.stdout, /optional for discovery/);
});

test("authoritative incomplete Discovery reaches Readiness and direct diff while deferred reports remain unchanged", async () => {
  const root = await authoritativeIncompleteGitFixture();
  try {
    const scanReport = await scan(root);
    const graphResult = await captured(() =>
      main(["graph", root, "--view", "discovery", "--format", "json"]),
    );
    const graphReport = JSON.parse(graphResult.stdout) as {
      discovery: {
        coverage: { mode: string; complete: boolean };
        notReachedDiscoveryEligibleSkillIds: string[];
      };
    };

    assert.ok(
      scanReport.diagnostics.some(
        (diagnostic) =>
          diagnostic.code ===
          DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
      ),
    );
    assert.equal(graphResult.code, 0);
    assert.deepEqual(graphReport.discovery.coverage, {
      scope: "repository",
      sourceEntrypointIds: ["skill.published"],
      eligibleSkillCount: 2,
      reachableSkillCount: 1,
      notReachedSkillCount: 1,
      mode: "authoritative",
      reason: "repository-wide-discovery-adopted",
      complete: false,
    });
    assert.deepEqual(
      graphReport.discovery.notReachedDiscoveryEligibleSkillIds,
      ["skill.unreached"],
    );

    const [
      readinessReport,
      semanticDiffReport,
      ciReportResult,
      trustGraphReport,
      bomReport,
    ] = await Promise.all([
      readiness(root),
      diff(root, { fromRef: "base", toRef: "HEAD" }),
      ciReport(root, { fromRef: "base", toRef: "HEAD" }),
      trustGraph(root),
      bom(root, {}, { omitGeneratedAt: true }),
    ]);

    assert.equal(
      readinessReport.summary.skillDiscovery.notReachedSkillCount,
      1,
    );
    assert.equal(
      readinessReport.checks.find((check) => check.id === "discovery.coverage")
        ?.status,
      "warn",
    );
    assert.deepEqual(semanticDiffReport.discovery.adoption, {
      from: "partial",
      to: "adopted",
      changed: true,
    });
    assert.deepEqual(semanticDiffReport.discovery.coverage, {
      from: "descriptive",
      to: "authoritative",
      changed: true,
    });
    assert.deepEqual(semanticDiffReport.discovery.reachability, {
      newlyReachable: [],
      newlyNotReached: [],
    });
    assert.deepEqual(
      ciReportResult.skillDiscovery,
      semanticDiffReport.discovery,
    );
    assertDiscoveryFree(ciReportResult.diff);
    assertDiscoveryFree(trustGraphReport);
    assertDiscoveryFree(bomReport);
    assert.equal(ciReportResult.status, "pass");
    assert.equal(ciReportResult.summary.findingsDelta, 0);
    assert.equal(ciReportResult.summary.highOrCriticalFindingsDelta, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function routeFixture(t: test.TestContext): Promise<string> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-discovery-cli-",
    testContext: t,
  });
  const { root } = fixture;
  await writeSkill(root, "source", "skill.source", [
    "skill.target",
    "skill.missing",
    "skill.old",
  ]);
  await writeSkill(root, "target", "skill.target");
  await writeSkill(root, "old", "skill.old", undefined, "deprecated");
  return root;
}

async function authoritativeIncompleteGitFixture(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-discovery-deferred-"),
  );
  await writeFile(path.join(root, "renma.config.json"), "{}\n");
  await writeSkill(
    root,
    "published",
    "skill.published",
    undefined,
    undefined,
    true,
  );
  await writeSkill(root, "unreached", "skill.unreached");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "renma@example.test"]);
  await git(root, ["config", "user.name", "Renma Test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "base"]);
  await git(root, ["tag", "base"]);
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: true } })}\n`,
  );
  await git(root, ["add", "renma.config.json"]);
  await git(root, ["commit", "-m", "adopt discovery"]);
  return root;
}

async function routeCycleIntroductionGitFixture(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-discovery-cycle-diff-"),
  );
  await writeSkill(root, "a", "skill.a", ["skill.b"]);
  await writeSkill(root, "b", "skill.b");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "renma@example.test"]);
  await git(root, ["config", "user.name", "Renma Test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "base"]);
  await git(root, ["tag", "base"]);
  await writeSkill(root, "b", "skill.b", ["skill.a"]);
  await git(root, ["add", "skills/b/SKILL.md"]);
  await git(root, ["commit", "-m", "introduce route cycle"]);
  return root;
}

async function healthyDiscoveryCiGitFixture(): Promise<string> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-discovery-ci-healthy-",
  });
  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  await fixture.skill("root", {
    id: "skill.root",
    publishedEntrypoint: true,
    continuesWith: ["skill.entry"],
  });
  await fixture.skill("entry", { id: "skill.entry" });
  await fixture.skill("target", { id: "skill.target" });
  await fixture.initializeGit();
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base"]);
  await fixture.git(["tag", "base"]);
  await fixture.skill("entry", {
    id: "skill.entry",
    publishedEntrypoint: true,
    continuesWith: ["skill.target"],
  });
  await fixture.git(["add", "skills/entry/SKILL.md"]);
  await fixture.git(["commit", "-m", "add published continuation"]);
  return fixture.root;
}

async function incompleteDiscoveryCiGitFixture(): Promise<string> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-discovery-ci-incomplete-",
  });
  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  await fixture.skill("entry", {
    id: "skill.entry",
    publishedEntrypoint: true,
  });
  await fixture.initializeGit();
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base"]);
  await fixture.git(["tag", "base"]);
  await fixture.skill("entry", { id: "skill.entry" });
  await fixture.git(["add", "skills/entry/SKILL.md"]);
  await fixture.git(["commit", "-m", "remove published entrypoint"]);
  return fixture.root;
}

async function newlyNotReachedDiscoveryCiGitFixture(): Promise<string> {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-discovery-ci-not-reached-",
  });
  await fixture.writeConfig({ skill_discovery: { adopted: true } });
  await fixture.skill("entry", {
    id: "skill.entry",
    publishedEntrypoint: true,
    continuesWith: ["skill.target"],
  });
  await fixture.skill("target", { id: "skill.target" });
  await fixture.initializeGit();
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base"]);
  await fixture.git(["tag", "base"]);
  await fixture.skill("entry", {
    id: "skill.entry",
    publishedEntrypoint: true,
  });
  await fixture.git(["add", "skills/entry/SKILL.md"]);
  await fixture.git(["commit", "-m", "remove continuation"]);
  return fixture.root;
}

async function writeSkill(
  root: string,
  name: string,
  id: string,
  routes?: string[],
  status?: "experimental" | "stable" | "deprecated" | "archived",
  published = false,
  owner?: string,
): Promise<void> {
  await RepositoryFixture.at(root).skill(name, {
    id,
    ...(routes ? { continuesWith: routes } : {}),
    ...(status ? { status } : {}),
    ...(published ? { publishedEntrypoint: true } : {}),
    ...(owner ? { owner } : {}),
  });
}

async function writeBrokenLens(root: string): Promise<void> {
  await RepositoryFixture.at(root).contextLens("lenses/testing/broken.md", {
    id: "lens.testing.broken",
    owner: "qa-platform",
    body: "# Broken Lens\n\nThis fixture intentionally omits required lens fields.\n",
  });
}

function skillText(
  name: string,
  id: string,
  routes?: string[],
  rawRouteValue?: string,
  status?: "experimental" | "stable" | "deprecated" | "archived",
  published = false,
  owner?: string,
): string {
  return [
    "---",
    `name: ${name}`,
    `description: Review ${name} inputs and produce deterministic evidence. Use when ${name} workflow decisions need review; do not use for runtime selection or execution.`,
    "metadata:",
    `  renma.id: ${id}`,
    ...(routes
      ? [`  renma.continues-with: '${JSON.stringify(routes)}'`]
      : rawRouteValue
        ? [`  renma.continues-with: ${rawRouteValue}`]
        : []),
    ...(status ? [`  renma.status: ${status}`] : []),
    ...(owner ? [`  renma.owner: ${owner}`] : []),
    ...(published ? ['  renma.published-entrypoint: "true"'] : []),
    "---",
    `# ${name}`,
    "",
    "Review evidence and report completion.",
    "",
  ].join("\n");
}

async function captured(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function assertDiscoveryFree(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /DISCOVERY-/);
  assert.doesNotMatch(
    serialized,
    /"(?:discovery|routeCycles|cycleCount|cyclicSkillIds|cycleSkillIds|cycleSkills|selfLoop|cycleRoutes)"\s*:/i,
  );
  assert.doesNotMatch(serialized, /"reachability"\s*:/);
  assert.doesNotMatch(serialized, /"coverage"\s*:/);
  assert.doesNotMatch(
    serialized,
    /"(?:publishedEntrypointIds|reachableDiscoveryEligibleSkillIds|notReachedDiscoveryEligibleSkillIds|unroutedSkillIds)"\s*:/,
  );
  assert.doesNotMatch(
    serialized,
    /publishedEntrypoint|published_entrypoint|published-entrypoint/,
  );
}

async function git(cwd: string, args: string[]): Promise<string> {
  return RepositoryFixture.at(cwd).git(args);
}
