import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { main } from "../src/cli.js";
import { catalog, formatCatalogJson } from "../src/commands/catalog.js";
import { PUBLIC_JSON_SCHEMA_VERSIONS } from "../src/commands/public-json-schema-versions.js";

const FIXTURE_ROOT = path.resolve("test/fixtures/public-json-baseline");
const EXPECTED_ROOT = path.resolve("test/fixtures/public-json-expected");

const BASELINE_CASES = [
  {
    contract: "scan",
    name: "scan",
    argv: ["scan", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    contract: "catalog",
    name: "catalog",
    argv: ["catalog", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    contract: "graph",
    name: "graph",
    argv: ["graph", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    contract: "skill-index",
    name: "skill-index",
    argv: ["skill-index", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    contract: "readiness",
    name: "readiness",
    argv: ["readiness", FIXTURE_ROOT, "--format", "json"],
    code: 1,
  },
  {
    contract: "bom",
    name: "bom",
    argv: ["bom", FIXTURE_ROOT, "--format", "json", "--omit-generated-at"],
    code: 0,
  },
] as const;

const EXTENDED_BASELINE_CASES = [
  {
    contract: "ownership",
    name: "ownership",
    argv: ["ownership", FIXTURE_ROOT, "--format", "json"],
    code: 0,
  },
  {
    contract: "inspect outline",
    name: "inspect-outline",
    argv: [
      "inspect",
      path.join(FIXTURE_ROOT, "skills/review/SKILL.md"),
      "--format",
      "json",
    ],
    code: 0,
  },
  {
    contract: "inspect --lines",
    name: "inspect-slice",
    argv: [
      "inspect",
      path.join(FIXTURE_ROOT, "skills/review/SKILL.md"),
      "--lines",
      "L1-L8",
      "--format",
      "json",
    ],
    code: 0,
  },
  {
    contract: "guide skill",
    name: "guide-skill",
    argv: ["guide", "skill", "--format", "json"],
    code: 0,
  },
  {
    contract: "scaffold",
    name: "scaffold",
    argv: [
      "scaffold",
      "context",
      path.join(FIXTURE_ROOT, "contexts/new-contract.md"),
      "--owner",
      "qa-platform",
      "--format",
      "json",
    ],
    code: 0,
  },
  {
    contract: "suggest-metadata",
    name: "suggest-metadata",
    argv: [
      "suggest-metadata",
      path.join(FIXTURE_ROOT, "contexts/valid.md"),
      "--owner",
      "qa-platform",
      "--format",
      "json",
    ],
    code: 0,
  },
  {
    contract: "suggest-semantic-split",
    name: "suggest-semantic-split",
    argv: [
      "suggest-semantic-split",
      path.join(FIXTURE_ROOT, "skills/review/SKILL.md"),
      "--format",
      "json",
    ],
    code: 0,
  },
] as const;

const GOLDEN_ASSURED_CONTRACTS = [
  ...BASELINE_CASES.map(({ contract }) => contract),
  ...EXTENDED_BASELINE_CASES.map(({ contract }) => contract),
  "diff",
  "ci-report",
] as const;

test("representative public JSON matches fixed compatibility baselines", async () => {
  const outputs = new Map<string, string>();
  const packageJson = record(
    JSON.parse(await readFile(path.resolve("package.json"), "utf8")),
  );
  const packageVersion = packageJson.version;
  assert.equal(typeof packageVersion, "string");
  if (typeof packageVersion !== "string") {
    throw new TypeError("package.json version must be a string");
  }

  for (const item of BASELINE_CASES) {
    const expected = await readFile(
      path.join(EXPECTED_ROOT, `${item.name}.golden`),
      "utf8",
    );
    const actual = await captureProcessOutput(() => main([...item.argv]));
    const versionNormalizedStdout: string =
      item.name === "bom"
        ? assertAndNormalizeBomGeneratorVersion(actual.stdout, packageVersion)
        : actual.stdout;
    const normalizedStdout = normalizeJsonRoot(
      versionNormalizedStdout,
      FIXTURE_ROOT,
    );

    assert.equal(actual.code, item.code, `${item.name} exit code`);
    assert.equal(actual.stderr, "", `${item.name} stderr`);
    assert.equal(normalizedStdout, expected, `${item.name} stdout`);
    outputs.set(item.name, normalizedStdout);
  }

  assert.deepEqual(
    Object.fromEntries(
      [...outputs].map(([name, output]) => [
        name,
        record(JSON.parse(output)).schemaVersion,
      ]),
    ),
    {
      scan: "renma.scan.v1",
      catalog: "renma.catalog.v1",
      graph: "renma.graph.v1",
      "skill-index": "renma.skill-index.v1",
      readiness: "renma.readiness.v2",
      bom: "renma.repository-context-bom.v3",
    },
  );

  const catalogOutput = parseOutput(outputs, "catalog");
  const catalogDiagnostics = arrayOfRecords(catalogOutput.diagnostics);
  assert.ok(
    catalogDiagnostics.some(
      (diagnostic) => diagnostic.message === "Asset is missing an owner.",
    ),
  );
  assert.ok(catalogDiagnostics.every((diagnostic) => !("code" in diagnostic)));

  const scanOutput = parseOutput(outputs, "scan");
  const securityAnalysisCoverage = record(scanOutput.securityAnalysisCoverage);
  assert.equal(
    securityAnalysisCoverage.schemaVersion,
    "renma.security-analysis-coverage.v1",
  );
  assert.equal(arrayOfRecords(securityAnalysisCoverage.artifacts).length, 7);
  const findingIds = arrayOfRecords(scanOutput.findings).map(
    (finding) => finding.id,
  );
  assert.ok(findingIds.includes("META-INVALID-STATUS"));
  assert.ok(findingIds.includes("META-CONTEXT-MISSING-WHEN-TO-USE"));
  assert.ok(findingIds.includes("META-CONTEXT-PLACEHOLDER-USAGE-BOUNDARY"));
  assert.ok(findingIds.includes("META-UNKNOWN-DEPENDENCY"));
  assert.ok(findingIds.includes("MAINT-REFERENCE-DEPRECATED-ASSET"));
  assert.ok(
    arrayOfRecords(scanOutput.findings).every(
      (finding) =>
        record(finding.evidence).path !== "contexts/missing-owner.md",
    ),
  );

  const diagnosticV2Codes = arrayOfRecords(scanOutput.diagnosticsV2).map(
    (diagnostic) => diagnostic.code,
  );
  for (const findingId of findingIds) {
    assert.ok(diagnosticV2Codes.includes(findingId), String(findingId));
  }

  const bomOutput = parseOutput(outputs, "bom");
  const executableSurfaceInventory = record(
    bomOutput.executableSurfaceInventory,
  );
  assert.equal(
    executableSurfaceInventory.schema,
    "renma.executable-surface-inventory.v1",
  );
  assert.ok(Array.isArray(executableSurfaceInventory.surfaces));
  assert.ok(Array.isArray(executableSurfaceInventory.invocations));
  assert.equal(typeof executableSurfaceInventory.summary, "object");
  const executableSummary = record(executableSurfaceInventory.summary);
  assert.equal(executableSummary.invocationsWithEffectivePolicyEvidence, 0);
  assert.deepEqual(executableSummary.invocationPolicyEvidenceRelations, {
    sourceArtifact: 0,
    owningSkill: 0,
  });

  const readinessOutput = parseOutput(outputs, "readiness");
  const readinessSummary = record(readinessOutput.summary);
  assert.equal(readinessSummary.totalAssets, 7);
  assert.equal(readinessSummary.ownershipCoveragePercent, 86);
  assert.equal(readinessSummary.graphResolutionPercent, 86);
  assert.deepEqual(record(readinessSummary.skillDiscovery), {
    adoptionState: "adopted",
    publishedEntrypointCount: 1,
    routeEligibleSkillCount: 1,
    reachableSkillCount: 1,
    notReachedSkillCount: 0,
    unroutedSkillCount: 0,
    usableRouteCount: 0,
    unusableRouteCount: 0,
    unresolvedRouteCount: 0,
    cycleComponentCount: 0,
  });
  assert.deepEqual(
    arrayOfRecords(readinessOutput.checks)
      .slice(-5)
      .map((check) => check.id),
    [
      "discovery.publication",
      "discovery.route_validity",
      "discovery.coverage",
      "discovery.unrouted_skills",
      "discovery.cycle_review",
    ],
  );
  const compactDiscovery = JSON.stringify(readinessSummary.skillDiscovery);
  assert.doesNotMatch(
    compactDiscovery,
    /"(?:skills|routes|diagnostics|publishedEntrypointIds|reachableDiscoveryEligibleSkillIds|notReachedDiscoveryEligibleSkillIds|unroutedSkillIds)"/,
  );
  assert.doesNotMatch(
    outputs.get("readiness") ?? "",
    /OMIT_FROM_CATALOG_FINDINGS|diagnosticIdentity/,
  );
});

test("remaining stable public JSON matches fixed compatibility baselines", async () => {
  const packageVersion = await readPackageVersion();

  for (const item of EXTENDED_BASELINE_CASES) {
    const actual = await captureProcessOutput(() => main([...item.argv]));
    const normalizedStdout = normalizeExtendedCompatibilityOutput(
      item.contract,
      actual.stdout,
      packageVersion,
    );

    assert.equal(actual.code, item.code, `${item.name} exit code`);
    assert.equal(actual.stderr, "", `${item.name} stderr`);
    await assertOrUpdateGolden(item.name, normalizedStdout);
    assert.equal(
      record(JSON.parse(normalizedStdout)).schemaVersion,
      PUBLIC_JSON_SCHEMA_VERSIONS.stable[item.contract],
      `${item.name} schemaVersion`,
    );
  }
});

test("revision-based stable public JSON matches fixed compatibility baselines", async (t) => {
  const root = await revisionFixture(t);
  const cases = [
    {
      contract: "diff",
      name: "diff",
      argv: [
        "diff",
        root,
        "--from",
        "contract-base",
        "--to",
        "contract-head",
        "--format",
        "json",
      ],
      code: 0,
    },
    {
      contract: "ci-report",
      name: "ci-report",
      argv: [
        "ci-report",
        root,
        "--from",
        "contract-base",
        "--to",
        "contract-head",
        "--format",
        "json",
        "--fail-on-status",
        "fail",
      ],
      code: 0,
    },
  ] as const;

  for (const item of cases) {
    const actual = await captureProcessOutput(() => main([...item.argv]));
    const normalizedStdout = normalizeJsonRoot(actual.stdout, root);

    assert.equal(actual.code, item.code, `${item.name} exit code`);
    assert.equal(actual.stderr, "", `${item.name} stderr`);
    await assertOrUpdateGolden(item.name, normalizedStdout);
    const document = record(JSON.parse(normalizedStdout));
    assert.equal(document.root, "<ROOT>", `${item.name} normalized root`);
    assert.equal(
      document.schemaVersion,
      PUBLIC_JSON_SCHEMA_VERSIONS.stable[item.contract],
      `${item.name} schemaVersion`,
    );
  }
});

test("every stable public JSON contract has an explicit compatibility assurance", async () => {
  const goldenContracts = [...GOLDEN_ASSURED_CONTRACTS].sort();
  const stableContracts = Object.keys(
    PUBLIC_JSON_SCHEMA_VERSIONS.stable,
  ).sort();
  const trustGraphContractTest = await readFile(
    "test/trust-graph.test.ts",
    "utf8",
  );
  const trustGraphSchema = await readFile(
    "docs/schemas/trust-graph-v2.schema.json",
    "utf8",
  );

  assert.deepEqual(stableContracts, [...goldenContracts, "trust-graph"].sort());
  assert.match(
    trustGraphContractTest,
    /Trust Graph v2 complete JSON contract is frozen/u,
  );
  assert.equal(
    record(JSON.parse(trustGraphSchema)).$id,
    "https://github.com/KazuCocoa/renma/blob/main/docs/schemas/trust-graph-v2.schema.json",
  );
  assert.equal(
    PUBLIC_JSON_SCHEMA_VERSIONS.stable["trust-graph"],
    "renma.trustGraph.v2",
    "retain the published stable Trust Graph spelling",
  );
});

test("compatibility root normalization handles native and portable Windows paths", () => {
  const windowsRoot = String.raw`C:\work\renma-fixture`;
  const portableWindowsRoot = windowsRoot.replaceAll("\\", "/");
  const output = `${JSON.stringify(
    {
      root: windowsRoot,
      nativePath: `${windowsRoot}\\skills\\review\\SKILL.md`,
      portablePath: `${portableWindowsRoot}/contexts/valid.md`,
      prompt: `${portableWindowsRoot}/skills/review/SKILL.md then run scripts\\check.ps1`,
      multiple: `${windowsRoot}\\contexts\\one.md and ${windowsRoot}\\contexts\\two.md`,
      surrounded: `run scripts\\before.ps1; inspect ${windowsRoot}\\skills\\review\\SKILL.md; then run scripts\\after.ps1`,
      unrelated: String.raw`powershell.exe -File scripts\check.ps1`,
    },
    null,
    2,
  )}\n`;

  assert.equal(
    normalizeJsonRoot(output, windowsRoot),
    `${JSON.stringify(
      {
        root: "<ROOT>",
        nativePath: "<ROOT>/skills/review/SKILL.md",
        portablePath: "<ROOT>/contexts/valid.md",
        prompt: String.raw`<ROOT>/skills/review/SKILL.md then run scripts\check.ps1`,
        multiple: "<ROOT>/contexts/one.md and <ROOT>/contexts/two.md",
        surrounded: String.raw`run scripts\before.ps1; inspect <ROOT>/skills/review/SKILL.md; then run scripts\after.ps1`,
        unrelated: String.raw`powershell.exe -File scripts\check.ps1`,
      },
      null,
      2,
    )}\n`,
  );
});

test("compatibility root normalization canonicalizes only root-derived display quoting", () => {
  const windowsRoot = String.raw`D:\a\renma\renma\test\fixtures\public-json-baseline`;
  const portableWindowsRoot = windowsRoot.replaceAll("\\", "/");
  const output = `${JSON.stringify(
    {
      path: `${portableWindowsRoot}/contexts/valid.md`,
      nextActions: [
        {
          kind: "inspect-target",
          invocation: {
            command: "renma",
            args: [
              "inspect",
              `${windowsRoot}\\contexts\\valid.md`,
              "--format",
              "json",
            ],
            display: `renma inspect '${windowsRoot}\\contexts\\valid.md' --format json`,
          },
        },
        {
          kind: "verify",
          invocation: {
            command: "renma",
            args: [
              "scan",
              windowsRoot,
              "--fail-on",
              "high",
              "--format",
              "json",
            ],
            display: `renma scan '${windowsRoot}' --fail-on high --format json`,
          },
        },
      ],
      quotedProse: `Keep '${windowsRoot}' quoted here.`,
      unrelatedDisplay: String.raw`renma inspect 'scripts\check.ps1' --format json`,
    },
    null,
    2,
  )}\n`;

  assert.equal(
    normalizeJsonRoot(output, windowsRoot),
    `${JSON.stringify(
      {
        path: "<ROOT>/contexts/valid.md",
        nextActions: [
          {
            kind: "inspect-target",
            invocation: {
              command: "renma",
              args: ["inspect", "<ROOT>/contexts/valid.md", "--format", "json"],
              display: "renma inspect <ROOT>/contexts/valid.md --format json",
            },
          },
          {
            kind: "verify",
            invocation: {
              command: "renma",
              args: ["scan", "<ROOT>", "--fail-on", "high", "--format", "json"],
              display: "renma scan <ROOT> --fail-on high --format json",
            },
          },
        ],
        quotedProse: "Keep '<ROOT>' quoted here.",
        unrelatedDisplay: String.raw`renma inspect 'scripts\check.ps1' --format json`,
      },
      null,
      2,
    )}\n`,
  );
});

test("public JSON fixtures and goldens are pinned to LF across Git checkouts", () => {
  const result = spawnSync(
    "git",
    [
      "check-attr",
      "eol",
      "--",
      "test/fixtures/public-json-baseline/contexts/valid.md",
      "test/fixtures/public-json-expected/scan.golden",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/u), [
    "test/fixtures/public-json-baseline/contexts/valid.md: eol: lf",
    "test/fixtures/public-json-expected/scan.golden: eol: lf",
  ]);
});

test("CLI JSON output matches direct command serialization", async () => {
  const expected = formatCatalogJson(await catalog(FIXTURE_ROOT));
  const actual = await captureProcessOutput(() =>
    main(["catalog", FIXTURE_ROOT, "--format", "json"]),
  );

  assert.equal(actual.code, 0);
  assert.equal(actual.stderr, "");
  assert.equal(actual.stdout, expected);
});

function parseOutput(
  outputs: ReadonlyMap<string, string>,
  name: string,
): Record<string, unknown> {
  return record(JSON.parse(outputs.get(name) ?? "null"));
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function assertAndNormalizeBomGeneratorVersion(
  stdout: string,
  packageVersion: string,
): string {
  const bomOutput = record(JSON.parse(stdout));
  const generator = record(bomOutput.generator);
  assert.equal(generator.name, "renma");
  assert.equal(typeof generator.version, "string");
  assert.equal(generator.version, packageVersion);

  const versionLine = `    "version": ${JSON.stringify(packageVersion)}`;
  const generatorBlock = [
    '  "generator": {',
    '    "name": "renma",',
    versionLine,
    "  },",
  ].join("\n");
  assert.equal(
    stdout.split(generatorBlock).length,
    2,
    "BOM stdout must contain exactly one expected generator block",
  );
  return stdout.replace(
    generatorBlock,
    generatorBlock.replace(versionLine, '    "version": "<VERSION>"'),
  );
}

async function readPackageVersion(): Promise<string> {
  const packageJson = record(
    JSON.parse(await readFile(path.resolve("package.json"), "utf8")),
  );
  assert.equal(typeof packageJson.version, "string");
  return packageJson.version as string;
}

function normalizeExtendedCompatibilityOutput(
  contract: (typeof EXTENDED_BASELINE_CASES)[number]["contract"],
  stdout: string,
  packageVersion: string,
): string {
  const pathNormalized = normalizeJsonRoot(stdout, FIXTURE_ROOT);
  if (contract !== "guide skill") return pathNormalized;

  const guide = record(JSON.parse(pathNormalized));
  assert.equal(guide.renmaVersion, packageVersion);
  guide.renmaVersion = "<VERSION>";
  return `${JSON.stringify(guide, null, 2)}\n`;
}

function normalizeJsonRoot(stdout: string, root: string): string {
  return `${JSON.stringify(normalizeJsonValue(JSON.parse(stdout), root), null, 2)}\n`;
}

function normalizeJsonValue(
  value: unknown,
  root: string,
  fieldName?: string,
): unknown {
  if (typeof value === "string") {
    return normalizeCheckoutRootInString(value, root, fieldName === "display");
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item, root));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeJsonValue(item, root, key),
      ]),
    );
  }
  return value;
}

const WINDOWS_ROOT_PATH_BOUNDARY_RE = /[\s`"'<>|?*()\[\]{};,:=&#]/u;

function normalizeCheckoutRootInString(
  value: string,
  root: string,
  canonicalizeDisplayQuote = false,
): string {
  if (root.length === 0) return value;

  const rootSpellings = [root];
  const portableRoot = root.replaceAll("\\", "/");
  if (portableRoot !== root) rootSpellings.push(portableRoot);
  if (!rootSpellings.some((spelling) => value.includes(spelling))) return value;

  let cursor = 0;
  let normalized = "";
  while (cursor < value.length) {
    const occurrence = nextCheckoutRootOccurrence(value, cursor, rootSpellings);
    if (!occurrence) return normalized + value.slice(cursor);

    const rootEnd = occurrence.start + occurrence.spelling.length;
    const suffix = root.includes("\\")
      ? normalizeWindowsRootPathSuffix(value, rootEnd)
      : { value: "", end: rootEnd };
    const removeDisplayQuotes =
      canonicalizeDisplayQuote &&
      root.includes("\\") &&
      value[occurrence.start - 1] === "'" &&
      value[suffix.end] === "'";

    normalized += value.slice(
      cursor,
      removeDisplayQuotes ? occurrence.start - 1 : occurrence.start,
    );
    normalized += `<ROOT>${suffix.value}`;
    cursor = suffix.end + (removeDisplayQuotes ? 1 : 0);
  }
  return normalized;
}

function nextCheckoutRootOccurrence(
  value: string,
  start: number,
  rootSpellings: readonly string[],
): { start: number; spelling: string } | undefined {
  let next: { start: number; spelling: string } | undefined;
  for (const spelling of rootSpellings) {
    const occurrenceStart = value.indexOf(spelling, start);
    if (occurrenceStart >= 0 && (!next || occurrenceStart < next.start)) {
      next = { start: occurrenceStart, spelling };
    }
  }
  return next;
}

function normalizeWindowsRootPathSuffix(
  value: string,
  start: number,
): { value: string; end: number } {
  let cursor = start;
  let normalized = "";

  while (value[cursor] === "\\" || value[cursor] === "/") {
    normalized += "/";
    cursor += 1;

    const segmentStart = cursor;
    while (
      cursor < value.length &&
      value[cursor] !== "\\" &&
      value[cursor] !== "/" &&
      !WINDOWS_ROOT_PATH_BOUNDARY_RE.test(value[cursor] ?? "")
    ) {
      cursor += 1;
    }
    normalized += value.slice(segmentStart, cursor);

    if (value[cursor] !== "\\" && value[cursor] !== "/") break;
  }

  return { value: normalized, end: cursor };
}

async function assertOrUpdateGolden(
  name: string,
  actual: string,
): Promise<void> {
  const target = path.join(EXPECTED_ROOT, `${name}.golden`);
  if (process.env.UPDATE_PUBLIC_JSON_GOLDENS === "1") {
    await writeFile(target, actual);
    return;
  }
  assert.equal(actual, await readFile(target, "utf8"), `${name} stdout`);
}

async function revisionFixture(t: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "renma-json-contract-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(FIXTURE_ROOT, root, { recursive: true });
  git(root, "init");
  git(root, "config", "user.name", "Renma Contract Test");
  git(root, "config", "user.email", "renma-contract@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "core.filemode", "false");
  git(root, "add", "--all");
  git(root, "commit", "-m", "contract base");
  git(root, "tag", "contract-base");

  const contextPath = path.join(root, "contexts/valid.md");
  const original = await readFile(contextPath, "utf8");
  await writeFile(
    contextPath,
    original.replace(
      "Stable shared review context.",
      "Stable shared review context with explicit compatibility evidence.",
    ),
  );
  git(root, "add", "--all");
  git(root, "commit", "-m", "contract head");
  git(root, "tag", "contract-head");
  return root;
}

function git(root: string, ...args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
  );
}

async function captureProcessOutput(
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
