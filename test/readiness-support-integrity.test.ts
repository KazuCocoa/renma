import assert from "node:assert/strict";
import { chmod, symlink, unlink } from "node:fs/promises";
import test, { type TestContext } from "node:test";

import { buildBomReport } from "../src/commands/bom.js";
import {
  readiness,
  readinessFromRepositorySnapshot,
  type ReadinessCheck,
  type ReadinessReport,
} from "../src/commands/readiness.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";
import { RepositoryFixture } from "./repository-fixture.js";

const SUPPORT_PATH = "skills/demo/references/runtime.txt";
const DEFAULT_EXCLUDES = ["node_modules", "dist", ".git"];

test("Readiness passes explicitly referenced support that was inspected", async (t) => {
  const fixture = await supportFixture(t);
  await fixture.write(SUPPORT_PATH, "Review the repository evidence.\n");

  const report = await readiness(fixture.root);
  const check = supportIntegrityCheck(report);

  assert.equal(check.status, "pass");
  assert.equal(check.evidence, undefined);
});

test("Readiness derives support integrity from one prepared repository snapshot", async (t) => {
  const fixture = await supportFixture(t);
  await fixture.write(SUPPORT_PATH, "Review the repository evidence.\n");
  const snapshot = await collectRepositorySnapshot(fixture.root);

  await unlink(fixture.resolve(SUPPORT_PATH));

  assert.equal(
    supportIntegrityCheck(readinessFromRepositorySnapshot(snapshot)).status,
    "pass",
  );
  assert.equal(
    supportIntegrityCheck(await readiness(fixture.root)).status,
    "fail",
  );
});

test("Readiness fails every authoritative static-support inspection blocker", async (t) => {
  const cases: readonly SupportBlockerCase[] = [
    {
      name: "missing",
      expectedState: "missing",
      expectedFindingId: "SUPPORT-MISSING-PATH",
      setup: async () => undefined,
    },
    {
      name: "symlink",
      expectedState: "symlink",
      setup: async (fixture, target) => {
        await fixture.write("outside.txt", "external\n");
        await fixture.write("skills/demo/references/.keep", "fixture\n");
        await symlink("../../../outside.txt", fixture.resolve(target));
      },
    },
    {
      name: "excluded",
      config: { exclude: [...DEFAULT_EXCLUDES, SUPPORT_PATH] },
      expectedState: "excluded",
      setup: async (fixture, target) => {
        await fixture.write(target, "excluded\n");
      },
    },
    {
      name: "unreadable",
      expectedState: "unreadable",
      skip: process.getuid?.() === 0 ? "root can read mode-000 files" : false,
      setup: async (fixture, target) => {
        await chmod(await fixture.write(target, "private\n"), 0o000);
      },
    },
    {
      name: "oversize",
      config: { max_file_size_bytes: 1_000 },
      expectedState: "oversize",
      setup: async (fixture, target) => {
        await fixture.write(target, "x".repeat(1_100));
      },
    },
    {
      name: "deep",
      target: "skills/demo/references/nested/runtime.txt",
      config: { max_depth: 3 },
      expectedState: "deep",
      setup: async (fixture, target) => {
        await fixture.write(target, "deep\n");
      },
    },
    {
      name: "unsupported",
      config: { globs: ["skills/**/SKILL.md"] },
      expectedState: "unsupported",
      setup: async (fixture, target) => {
        await fixture.write(target, "unsupported by configured globs\n");
      },
    },
  ];

  for (const fixtureCase of cases) {
    await t.test(
      fixtureCase.name,
      { skip: fixtureCase.skip },
      async (caseContext) => {
        const target = fixtureCase.target ?? SUPPORT_PATH;
        const fixture = await supportFixture(
          caseContext,
          fixtureCase.config,
          target,
        );
        await fixtureCase.setup(fixture, target);

        const report = await readiness(fixture.root);
        const check = supportIntegrityCheck(report);

        assert.equal(check.status, "fail");
        assert.equal(report.level, "not_ready");
        assert.deepEqual(
          check.evidence?.map(({ id, path, message }) => ({
            ...(id ? { id } : {}),
            path,
            state: message?.match(/^\[([^\]]+)\]/)?.[1],
          })),
          [
            {
              ...(fixtureCase.expectedFindingId
                ? { id: fixtureCase.expectedFindingId }
                : {}),
              path: target,
              state: fixtureCase.expectedState,
            },
          ],
        );
      },
    );
  }
});

test("unrelated inspection blockers do not fail Skill support integrity", async (t) => {
  const fixture = await supportFixture(t, { max_file_size_bytes: 1_000 }, null);
  const unrelatedPath = "contexts/testing/oversize.md";
  await fixture.write(unrelatedPath, "x".repeat(1_100));
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const scanResult = scanFromRepositorySnapshot(snapshot);

  assert.ok(
    scanResult.inspectionCoverage.blockingIssues.some(
      (issue) =>
        issue.path === unrelatedPath &&
        issue.details?.expectationSource !== "static-support-reference",
    ),
  );
  assert.equal(
    supportIntegrityCheck(readinessFromRepositorySnapshot(snapshot)).status,
    "pass",
  );
});

test("unreferenced blocked Skill-local files do not gain support authority", async (t) => {
  const cases = [
    {
      name: "symlink",
      setup: async (fixture: RepositoryFixture) => {
        await fixture.write("outside.txt", "external\n");
        await fixture.write("skills/demo/references/.keep", "fixture\n");
        await symlink("../../../outside.txt", fixture.resolve(SUPPORT_PATH));
      },
    },
    {
      name: "oversize",
      config: { max_file_size_bytes: 1_000 },
      setup: async (fixture: RepositoryFixture) => {
        await fixture.write(SUPPORT_PATH, "x".repeat(1_100));
      },
    },
    {
      name: "excluded",
      config: { exclude: [...DEFAULT_EXCLUDES, SUPPORT_PATH] },
      setup: async (fixture: RepositoryFixture) => {
        await fixture.write(SUPPORT_PATH, "excluded\n");
      },
    },
  ] as const;

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (caseContext) => {
      const fixture = await supportFixture(
        caseContext,
        "config" in fixtureCase ? fixtureCase.config : undefined,
        null,
      );
      await fixtureCase.setup(fixture);

      assert.equal(
        supportIntegrityCheck(await readiness(fixture.root)).status,
        "pass",
      );
    });
  }
});

test("support finding suppression cannot manufacture inspection completeness", async (t) => {
  const cases = [
    {
      name: "missing",
      findingId: "SUPPORT-MISSING-PATH",
      setup: async () => undefined,
    },
    {
      name: "symlink",
      findingId: "SUPPORT-SYMLINK-PATH",
      setup: async (fixture: RepositoryFixture) => {
        await fixture.write("outside.txt", "external\n");
        await fixture.write("skills/demo/references/.keep", "fixture\n");
        await symlink("../../../outside.txt", fixture.resolve(SUPPORT_PATH));
      },
    },
  ] as const;

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (caseContext) => {
      const fixture = await supportFixture(caseContext, {
        suppressions: [
          {
            id: fixtureCase.findingId,
            paths: ["skills/demo/SKILL.md"],
            reason: "Readiness suppression-resistance fixture",
            expires: "never",
          },
        ],
      });
      await fixtureCase.setup(fixture);
      const snapshot = await collectRepositorySnapshot(fixture.root);
      const scanResult = scanFromRepositorySnapshot(snapshot);
      const report = readinessFromRepositorySnapshot(snapshot);

      assert.equal(
        scanResult.findings.some(
          (finding) => finding.id === fixtureCase.findingId,
        ),
        false,
      );
      assert.ok(
        scanResult.suppressedFindings.some(
          ({ finding }) => finding.id === fixtureCase.findingId,
        ),
      );
      assert.equal(supportIntegrityCheck(report).status, "fail");
      assert.equal(report.level, "not_ready");
    });
  }
});

test("Skill support integrity evidence uses deterministic UTF-16 path order", async (t) => {
  const excludedPath = "skills/demo/references/A.txt";
  const oversizePath = "skills/demo/references/a.txt";
  const missingPath = "skills/demo/references/z.txt";
  const fixture = await supportFixture(
    t,
    {
      exclude: [...DEFAULT_EXCLUDES, excludedPath],
      max_file_size_bytes: 1_000,
    },
    [oversizePath, missingPath, excludedPath],
  );
  await fixture.write(excludedPath, "excluded\n");
  await fixture.write(oversizePath, "x".repeat(1_100));

  const evidence = supportIntegrityCheck(
    await readiness(fixture.root),
  ).evidence;

  assert.deepEqual(
    evidence?.map(({ path, message }) => [
      path,
      message?.match(/^\[([^\]]+)\]/)?.[1],
    ]),
    [
      [excludedPath, "excluded"],
      [oversizePath, "oversize"],
      [missingPath, "missing"],
    ],
  );
});

test("BOM v3 embeds corrected support integrity without another schema change", async (t) => {
  const fixture = await supportFixture(t, { max_file_size_bytes: 1_000 });
  await fixture.write(SUPPORT_PATH, "x".repeat(1_100));
  const snapshot = await collectRepositorySnapshot(fixture.root);

  const readinessReport = readinessFromRepositorySnapshot(snapshot);
  const bomReport = buildBomReport(snapshot, { omitGeneratedAt: true });

  assert.equal(bomReport.schemaVersion, "renma.repository-context-bom.v3");
  assert.deepEqual(
    supportIntegrityCheckFromChecks(bomReport.readiness.checks),
    supportIntegrityCheck(readinessReport),
  );
  assert.equal(
    supportIntegrityCheckFromChecks(bomReport.readiness.checks).status,
    "fail",
  );
});

interface SupportBlockerCase {
  name: string;
  target?: string;
  config?: Record<string, unknown>;
  expectedState: string;
  expectedFindingId?: string;
  skip?: string | boolean;
  setup: (fixture: RepositoryFixture, target: string) => Promise<unknown>;
}

async function supportFixture(
  testContext: TestContext,
  config?: Record<string, unknown>,
  referencedPaths: string | readonly string[] | null = SUPPORT_PATH,
): Promise<RepositoryFixture> {
  const fixture = await RepositoryFixture.create({ testContext });
  if (config) await fixture.writeConfig(config);
  const references =
    referencedPaths === null
      ? []
      : typeof referencedPaths === "string"
        ? [referencedPaths]
        : referencedPaths;
  await fixture.skill("demo", {
    owner: "platform",
    status: "stable",
    body: [
      "# Demo",
      "",
      "## Required inputs",
      "",
      "Provide the repository under review.",
      "",
      ...references.map(
        (target) =>
          `Read \`${target.slice("skills/demo/".length)}\` before continuing.`,
      ),
      "",
      "## Completion criteria",
      "",
      "Complete when repository evidence has been reviewed.",
      "",
      "## Verification",
      "",
      "Run the deterministic repository scan.",
    ].join("\n"),
  });
  return fixture;
}

function supportIntegrityCheck(report: ReadinessReport): ReadinessCheck {
  return supportIntegrityCheckFromChecks(report.checks);
}

function supportIntegrityCheckFromChecks(
  checks: readonly ReadinessCheck[],
): ReadinessCheck {
  const check = checks.find(
    (candidate) => candidate.id === "skills.support_integrity",
  );
  assert.ok(check);
  return check;
}
