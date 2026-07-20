import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { bom } from "../src/commands/bom.js";
import { readiness } from "../src/commands/readiness.js";
import { trustGraph } from "../src/commands/trust-graph.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { scan } from "../src/scanner.js";
import type { DiagnosticV2 } from "../src/types.js";

test("graph --view discovery JSON exposes the dedicated route contract", async () => {
  const root = await routeFixture();
  const result = await captured(() =>
    main(["graph", root, "--view", "discovery", "--format", "json"]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout) as {
    view: string;
    edgeCount: number;
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
});

test("graph --view discovery Markdown explains static routing and repairs", async () => {
  const root = await routeFixture();
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

test("graph --view discovery Mermaid separates usable and unusable declarations", async () => {
  const root = await routeFixture();
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
  assert.match(first.stdout, /%% declaration skills\/source\/SKILL.md index 0/);
  assert.match(first.stdout, /%% Diagnostics:/);
  assert.match(first.stdout, /does not execute Skills/);
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

test("focused Discovery uses exact Skill ID or source path and direct routes", async () => {
  const root = await routeFixture();
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

test("Discovery route diagnostics flow through scan and diagnostics v2", async () => {
  const root = await routeFixture();
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

test("existing graph views remain route-free and invalid view help lists discovery", async () => {
  const root = await routeFixture();
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

test("deferred Readiness, Trust Graph, and BOM projections do not adopt Discovery", async () => {
  const root = await routeFixture();
  const [readinessReport, trustGraphReport, bomReport] = await Promise.all([
    readiness(root),
    trustGraph(root),
    bom(root, {}, { omitGeneratedAt: true }),
  ]);

  assert.doesNotMatch(JSON.stringify(readinessReport), /DISCOVERY-/);
  assert.doesNotMatch(JSON.stringify(trustGraphReport), /DISCOVERY-/);
  assert.doesNotMatch(JSON.stringify(bomReport), /DISCOVERY-/);
});

async function routeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-discovery-cli-"));
  await writeSkill(root, "source", "skill.source", [
    "skill.target",
    "skill.missing",
    "skill.old",
  ]);
  await writeSkill(root, "target", "skill.target");
  await writeSkill(root, "old", "skill.old", undefined, "deprecated");
  return root;
}

async function writeSkill(
  root: string,
  name: string,
  id: string,
  routes?: string[],
  status?: "experimental" | "stable" | "deprecated" | "archived",
): Promise<void> {
  await mkdir(path.join(root, "skills", name), { recursive: true });
  await writeFile(
    path.join(root, "skills", name, "SKILL.md"),
    skillText(name, id, routes, undefined, status),
  );
}

function skillText(
  name: string,
  id: string,
  routes?: string[],
  rawRouteValue?: string,
  status?: "experimental" | "stable" | "deprecated" | "archived",
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
