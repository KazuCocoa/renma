import assert from "node:assert/strict";
import test from "node:test";

import {
  EXECUTABLE_SURFACE_INVENTORY_SCHEMA,
  summarizeExecutableSurfaceInventory,
  type ExecutableSurfaceEntry,
  type ExecutableSurfaceInventory,
  type ExecutableSurfaceInvocation,
} from "../src/executable-surface-inventory.js";
import {
  formatExecutableSurfaceInventoryText,
  formatJson,
  formatText,
} from "../src/report.js";
import type { ScanResult } from "../src/types/scan-result.js";

const FP_A = fingerprint("a");
const FP_B = fingerprint("b");
const INVENTORY_FP = fingerprint("f");

test("healthy Appium-like scan text is one concise line without surface paths", () => {
  const surfaces = Array.from({ length: 13 }, (_, index) =>
    repositoryTool(`tools/check-${String(index + 1).padStart(2, "0")}.mjs`, {
      invocationCount: index === 0 ? 12 : 0,
      withPolicyEvidence: index === 0 ? 12 : 0,
      fingerprints: index === 0 ? [FP_A] : [],
      staticallyReferenced: index < 12,
    }),
  );
  const invocations = Array.from({ length: 12 }, (_, index) =>
    invocation({
      sourcePath: `skills/demo/references/run-${String(index + 1).padStart(2, "0")}.md`,
      line: index + 1,
      target: surfaces[0]!.path,
      fingerprints: [FP_A],
    }),
  );
  const result = scanResult(inventory(surfaces, invocations));

  const rendered = formatText(result);
  assert.match(
    rendered,
    /^Executable surfaces: 13; static reachability 1 direct, 0 transitive; invocations 12\/12 resolved; invocation-context policy evidence 12\/12$/m,
  );
  assert.doesNotMatch(rendered, /Executable Surface (Inventory|Review)/);
  assert.doesNotMatch(rendered, /tools\/check-/);
  assert.equal(rendered, formatText(result));
});

test("zero surfaces render one deterministic zero summary", () => {
  assert.deepEqual(formatExecutableSurfaceInventoryText(inventory([], [])), [
    "Executable surfaces: 0",
  ]);
});

test("surfaces without recognized invocations stay compact", () => {
  const surfaces = Array.from({ length: 13 }, (_, index) =>
    repositoryTool(`tools/uninvoked-${index + 1}.mjs`, {
      staticallyReferenced: index < 12,
    }),
  );
  const lines = formatExecutableSurfaceInventoryText(inventory(surfaces, []));

  assert.deepEqual(lines, [
    "Executable surfaces: 13; no recognized invocations; 0 transitively reachable",
  ]);
  assert.doesNotMatch(lines.join("\n"), /tools\/uninvoked-/);
});

for (const resolution of ["missing", "unsafe", "unscoped"] as const) {
  test(`${resolution} invocation triggers bounded expanded review evidence`, () => {
    const problematic = invocation({
      resolution,
      sourcePath: "skills/demo/references/run.md",
      line: 17,
      target: "tools/missing.mjs",
      fingerprints: [FP_A],
    });
    const lines = formatExecutableSurfaceInventoryText(
      inventory([], [problematic]),
    ).join("\n");

    assert.match(lines, /^Executable Surface Review$/m);
    assert.match(
      lines,
      /skills\/demo\/references\/run\.md:L17 node tools\/missing\.mjs/,
    );
    assert.match(lines, new RegExp(`resolution ${resolution}`));
  });
}

test("noncanonical invocation and surface trigger expanded review", () => {
  const candidate = repositoryTool("scripts/noncanonical.mjs", {
    scope: "noncanonical",
    invocationCount: 1,
    withPolicyEvidence: 1,
  });
  const lines = formatExecutableSurfaceInventoryText(
    inventory(
      [candidate],
      [
        invocation({
          resolution: "noncanonical",
          target: candidate.path,
          fingerprints: [FP_A],
        }),
      ],
    ),
  ).join("\n");

  assert.match(lines, /^Executable Surface Review$/m);
  assert.match(lines, /scripts\/noncanonical\.mjs \[noncanonical/);
  assert.match(lines, /resolution noncanonical/);
});

test("unavailable invocation triggers expanded review", () => {
  const lines = formatExecutableSurfaceInventoryText(
    inventory(
      [],
      [
        invocation({
          resolution: "unsupported",
          target: "tools/check.exe",
          fingerprints: [FP_A],
        }),
      ],
    ),
  ).join("\n");

  assert.match(lines, /^Executable Surface Review$/m);
  assert.match(lines, /resolution unsupported/);
});

test("unreachable Skill-local surface triggers expanded review", () => {
  const unreachable = repositoryTool("skills/demo/scripts/run.mjs", {
    scope: "skill-local",
    reachableFromOwningSkill: false,
  });
  const lines = formatExecutableSurfaceInventoryText(
    inventory([unreachable], []),
  ).join("\n");

  assert.match(lines, /^Executable Surface Review$/m);
  assert.match(lines, /skills\/demo\/scripts\/run\.mjs/);
  assert.match(lines, /reachability unreachable/);
});

test("invocation without context-policy evidence triggers neutral expanded review", () => {
  const candidate = repositoryTool("tools/check.mjs", {
    invocationCount: 1,
  });
  const lines = formatExecutableSurfaceInventoryText(
    inventory(
      [candidate],
      [invocation({ target: candidate.path, fingerprints: [] })],
    ),
  ).join("\n");

  assert.match(lines, /^Executable Surface Review$/m);
  assert.match(lines, /invocation-context policy evidence without/);
  assert.doesNotMatch(lines, /unprotected|noncompliant|violation/i);
});

test("multiple effective fingerprints trigger expanded review without printing them", () => {
  const candidate = repositoryTool("tools/check.mjs", {
    invocationCount: 1,
    withPolicyEvidence: 1,
    fingerprints: [FP_A, FP_B],
  });
  const lines = formatExecutableSurfaceInventoryText(
    inventory(
      [candidate],
      [invocation({ target: candidate.path, fingerprints: [FP_A, FP_B] })],
    ),
  ).join("\n");

  assert.match(lines, /^Executable Surface Review$/m);
  assert.match(lines, /policy-variants 2/);
  assert.doesNotMatch(lines, /sha256:[a-f0-9]{64}/);
});

test("repository-tool surface-policy absence does not trigger expanded review", () => {
  const candidate = repositoryTool("tools/check.mjs", {
    invocationCount: 1,
    withPolicyEvidence: 1,
  });
  assert.equal(candidate.securityPolicy.hasEffectivePolicy, false);

  const lines = formatExecutableSurfaceInventoryText(
    inventory(
      [candidate],
      [invocation({ target: candidate.path, fingerprints: [FP_A] })],
    ),
  );
  assert.deepEqual(lines, [
    "Executable surfaces: 1; static reachability 1 direct, 0 transitive; invocations 1/1 resolved; invocation-context policy evidence 1/1",
  ]);
});

test("expanded review omits healthy unrelated surfaces", () => {
  const healthy = repositoryTool("tools/healthy.mjs", {
    invocationCount: 1,
    withPolicyEvidence: 1,
  });
  const review = repositoryTool("tools/review.mjs", {
    invocationCount: 1,
  });
  const lines = formatExecutableSurfaceInventoryText(
    inventory(
      [healthy, review],
      [
        invocation({ target: healthy.path, fingerprints: [FP_A] }),
        invocation({
          sourcePath: "skills/review/SKILL.md",
          target: review.path,
          fingerprints: [],
        }),
      ],
    ),
  ).join("\n");

  assert.match(lines, /tools\/review\.mjs/);
  assert.doesNotMatch(lines, /tools\/healthy\.mjs/);
});

test("expanded invocation evidence is bounded and deterministically ordered", () => {
  const invocations = Array.from({ length: 12 }, (_, index) =>
    invocation({
      resolution: "missing",
      sourcePath: `skills/demo/references/run-${String(12 - index).padStart(2, "0")}.md`,
      line: 12 - index,
      target: `tools/missing-${12 - index}.mjs`,
      fingerprints: [FP_A],
    }),
  );
  const inventoryValue = inventory([], invocations);
  const first = formatExecutableSurfaceInventoryText(inventoryValue).join("\n");

  assert.equal(
    first,
    formatExecutableSurfaceInventoryText(inventoryValue).join("\n"),
  );
  assert.match(first, /2 more not shown; use scan JSON for complete evidence/);
  assert.ok(first.indexOf("run-01.md") < first.indexOf("run-10.md"));
  assert.doesNotMatch(first, /run-11\.md|run-12\.md/);
});

test("text projection leaves complete scan JSON, findings, and exit behavior unchanged", () => {
  const inventoryValue = inventory(
    [],
    [invocation({ resolution: "missing", fingerprints: [FP_A] })],
  );
  const result = scanResult(inventoryValue);
  const before = structuredClone(result);
  const jsonBefore = formatJson(result);

  formatText(result);

  assert.deepEqual(result, before);
  assert.equal(formatJson(result), jsonBefore);
  assert.deepEqual(
    JSON.parse(jsonBefore).executableSurfaceInventory,
    inventoryValue,
  );
  assert.deepEqual(result.findings, []);
  assert.equal(result.exitThreshold, "high");
});

function inventory(
  surfaces: ExecutableSurfaceEntry[],
  invocations: ExecutableSurfaceInvocation[],
): ExecutableSurfaceInventory {
  return {
    schema: EXECUTABLE_SURFACE_INVENTORY_SCHEMA,
    summary: summarizeExecutableSurfaceInventory(surfaces, invocations),
    surfaces,
    invocations,
    dependencies: [],
  };
}

interface SurfaceOptions {
  scope?: ExecutableSurfaceEntry["scope"];
  invocationCount?: number;
  withPolicyEvidence?: number;
  fingerprints?: string[];
  staticallyReferenced?: boolean;
  reachableFromOwningSkill?: boolean;
}

function repositoryTool(
  surfacePath: string,
  options: SurfaceOptions = {},
): ExecutableSurfaceEntry {
  const scope = options.scope ?? "repository-tool";
  const invocationCount = options.invocationCount ?? 0;
  const withPolicyEvidence = options.withPolicyEvidence ?? 0;
  const fingerprints = [...(options.fingerprints ?? [])].sort();
  return {
    path: surfacePath,
    scope,
    origins: ["discovered-script"],
    artifactKind: "script",
    contentClassification: "text",
    interpreterHints: ["node"],
    ...(scope === "skill-local"
      ? {
          owningSkill: {
            skillDirectory: "skills/demo",
            entrypointPath: "skills/demo/SKILL.md",
          },
          reachableFromOwningSkill: options.reachableFromOwningSkill ?? true,
          ...(options.reachableFromOwningSkill === false
            ? {}
            : { reachabilityDepth: 1 }),
        }
      : {}),
    staticallyReferenced: options.staticallyReferenced ?? invocationCount > 0,
    staticallyInvoked: invocationCount > 0,
    referenceCount: invocationCount,
    invocationCount,
    securityPolicy: {
      hasEffectivePolicy: false,
      policySources: [],
    },
    invocationGovernance: {
      invocationsWithEffectivePolicyEvidence: withPolicyEvidence,
      invocationsWithoutEffectivePolicyEvidence:
        invocationCount - withPolicyEvidence,
      distinctEffectivePolicyFingerprints: fingerprints,
    },
    dependencyEvidence: {
      incomingResolvedDependencyCount: 0,
      outgoingResolvedDependencyCount: 0,
      staticInvocationReachability:
        invocationCount > 0 ? "direct" : "unreached",
      ...(invocationCount > 0 ? { minimumInvocationDependencyDepth: 0 } : {}),
    },
    fingerprint: INVENTORY_FP,
  };
}

interface InvocationOptions {
  resolution?: ExecutableSurfaceInvocation["resolution"];
  sourcePath?: string;
  line?: number;
  target?: string;
  fingerprints?: string[];
}

function invocation(
  options: InvocationOptions = {},
): ExecutableSurfaceInvocation {
  const fingerprints = [...(options.fingerprints ?? [FP_A])].sort();
  const sourcePath = options.sourcePath ?? "skills/demo/SKILL.md";
  const target = options.target ?? "tools/check.mjs";
  const policyEvidence =
    fingerprints.length === 0
      ? []
      : fingerprints.map((policyFingerprint, index) => ({
          relation:
            index === 0
              ? ("source-artifact" as const)
              : ("owning-skill" as const),
          path: index === 0 ? sourcePath : "skills/demo/owner/SKILL.md",
          hasEffectivePolicy: true,
          policySources: ["local" as const],
          fingerprint: policyFingerprint,
        }));
  return {
    sourcePath,
    line: options.line ?? 7,
    snippet: `node ${target}`,
    launcher: "node",
    rawTarget: target,
    normalizedTarget: target,
    sourceSkillDirectory: "skills/demo",
    resolution: options.resolution ?? "resolved",
    targetPathState: options.resolution === "missing" ? "absent" : "parsed",
    occurrenceOrdinal: 1,
    governance: {
      owningSkillResolution: "resolved",
      policyEvidence,
      hasEffectivePolicyEvidence: fingerprints.length > 0,
      distinctEffectivePolicyFingerprints: fingerprints,
      fingerprint: INVENTORY_FP,
    },
  };
}

function scanResult(
  executableSurfaceInventory: ExecutableSurfaceInventory,
): ScanResult {
  return {
    root: "/repo",
    scanBoundary: {
      schemaVersion: "renma.scan-boundary.v1",
      configPath: null,
      globs: [],
      exclude: [],
      maxFileSizeBytes: 1,
      maxDepth: 1,
      activeSuppressions: [],
    },
    inspectionCoverage: {
      schemaVersion: "renma.inspection-coverage.v1",
      expectedPathCount: 0,
      inspectedPathCount: 0,
      complete: true,
      inspectedPaths: [],
      blockingIssues: [],
    },
    securityAnalysisCoverage: {
      schemaVersion: "renma.security-analysis-coverage.v1",
      artifacts: [],
    },
    scannedFileCount: 13,
    format: "text",
    agentSkills: {
      specification: "https://agentskills.io/specification",
      profile: "agentskills.io/specification@2026-07-12",
      totalSkillCount: 0,
      validSkillCount: 0,
      invalidSkillCount: 0,
      canonicalSkillCount: 0,
      legacySkillCount: 0,
      hybridSkillCount: 0,
      warningCount: 0,
      results: [],
    },
    executableSurfaceInventory,
    findings: [],
    suppressedFindings: [],
    rawDiagnostics: [],
    diagnostics: [],
    reviewBundles: [],
    exitThreshold: "high",
  };
}

function fingerprint(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
