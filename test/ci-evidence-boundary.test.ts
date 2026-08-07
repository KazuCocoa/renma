import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  ciReport,
  formatCiReport,
  runCiReportCommand,
} from "../src/commands/ci-report.js";
import { scan } from "../src/scanner.js";
import { SCAN_BOUNDARY_CI_MATCH_IDS } from "../src/scan-boundary-ci-policy.js";

const execFile = promisify(execFileCallback);
const DEFAULT_EXCLUDE = ["node_modules", "dist", ".git"];

for (const narrowedGlobs of [[], ["skills/public/**/SKILL.md"]]) {
  test(`CI inspects a hidden HIGH finding when target globs become ${narrowedGlobs.length === 0 ? "empty" : "narrow"}`, async () => {
    const repo = await createRepo({ globs: ["skills/**/SKILL.md"] });
    try {
      await writeSkill(repo, "skills/evil/SKILL.md", secretBody());
      await writeConfig(repo, { globs: narrowedGlobs });
      await commit(repo, "hide evil with globs");

      const targetLocal = await scan(repo, { format: "json" });
      const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });
      const command = await captureStdout(() =>
        runCiReportCommand(repo, {
          fromRef: "base",
          toRef: "HEAD",
          format: "markdown",
        }),
      );

      assert.ok(
        !targetLocal.findings.some(
          (finding) => finding.id === "SEC-LITERAL-SECRET",
        ),
      );
      assert.ok(
        report.diff.findings.added.some(
          (finding) =>
            finding.id === "SEC-LITERAL-SECRET" &&
            finding.evidence?.path === "skills/evil/SKILL.md",
        ),
      );
      assert.equal(report.status, "fail");
      assert.equal(command.code, 1);
      assert.ok(
        report.scanBoundaryPolicy.matches.some(
          (match) => match.id === SCAN_BOUNDARY_CI_MATCH_IDS.GLOB_REMOVED,
        ),
      );
      assert.equal(
        report.scanBoundaryPolicy.effectiveBoundary?.coverageModel,
        "target_path_endpoint_coverage_union",
      );
      assert.ok(
        report.scanBoundaryPolicy.effectiveBoundary?.inspectedPaths.includes(
          "skills/evil/SKILL.md",
        ),
      );
      assert.match(command.stdout, /^## Scan Boundary Weakening$/m);
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });
}

test("CI ignores a target-only exclusion when collecting enforcement evidence", async () => {
  const repo = await createRepo({ globs: ["skills/**/SKILL.md"] });
  try {
    await writeSkill(repo, "skills/private/evil/SKILL.md", secretBody());
    await writeConfig(repo, {
      globs: ["skills/**/SKILL.md"],
      exclude: [...DEFAULT_EXCLUDE, "skills/private"],
    });
    await commit(repo, "hide evil with exclusion");

    const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });

    assert.equal(report.status, "fail");
    assert.ok(
      report.diff.findings.added.some(
        (finding) => finding.evidence?.path === "skills/private/evil/SKILL.md",
      ),
    );
    assert.ok(
      report.scanBoundaryPolicy.matches.some(
        (match) => match.id === SCAN_BOUNDARY_CI_MATCH_IDS.EXCLUSION_ADDED,
      ),
    );
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("CI ignores reduced depth and file-size limits when they hide target evidence", async () => {
  const cases = [
    {
      name: "depth",
      path: "skills/a/b/c/evil/SKILL.md",
      base: { max_depth: 20 },
      target: { max_depth: 3 },
      matchId: SCAN_BOUNDARY_CI_MATCH_IDS.MAX_DEPTH_REDUCED,
    },
    {
      name: "file size",
      path: "skills/evil/SKILL.md",
      base: { max_file_size_bytes: 20_000 },
      target: { max_file_size_bytes: 100 },
      matchId: SCAN_BOUNDARY_CI_MATCH_IDS.MAX_FILE_SIZE_REDUCED,
    },
  ] as const;

  for (const item of cases) {
    const repo = await createRepo({
      globs: ["skills/**/SKILL.md"],
      ...item.base,
    });
    try {
      await writeSkill(repo, item.path, secretBody());
      await writeConfig(repo, {
        globs: ["skills/**/SKILL.md"],
        ...item.target,
      });
      await commit(repo, `hide evil with reduced ${item.name}`);

      const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });

      assert.equal(report.status, "fail", item.name);
      assert.ok(
        report.diff.findings.added.some(
          (finding) => finding.evidence?.path === item.path,
        ),
        item.name,
      );
      assert.ok(
        report.scanBoundaryPolicy.matches.some(
          (match) => match.id === item.matchId,
        ),
        item.name,
      );
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  }
});

test("a target-only suppression remains visible and cannot erase enforcement evidence", async () => {
  const repo = await createRepo(
    { globs: ["skills/**/SKILL.md"] },
    secretBody(),
  );
  try {
    await writeConfig(repo, {
      globs: ["skills/**/SKILL.md"],
      suppressions: [suppression(["skills/demo/**"], "never")],
    });
    await commit(repo, "suppress unchanged high finding");

    const targetLocal = await scan(repo, { format: "json" });
    const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });
    const markdown = formatCiReport(report, "markdown");

    assert.equal(targetLocal.findings.some(isLiteralSecret), false);
    assert.equal(
      targetLocal.suppressedFindings.some((item) =>
        isLiteralSecret(item.finding),
      ),
      true,
    );
    assert.equal(report.status, "fail");
    assert.equal(report.summary.findingsDelta, 0);
    assert.equal(report.diff.findings.suppressed.to.length > 0, true);
    assert.equal(
      report.scanBoundaryPolicy.effectiveBoundary?.activeSuppressions.length,
      0,
    );
    assert.ok(
      report.scanBoundaryPolicy.matches.some(
        (match) => match.id === SCAN_BOUNDARY_CI_MATCH_IDS.SUPPRESSION_ADDED,
      ),
    );
    assert.doesNotMatch(
      markdown,
      /(?:^|\n)- Scan findings decreased\.(?:\n|$)/,
    );
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("finding reduction beside a new suppression is not praised as remediation", async () => {
  const repo = await createRepo(
    { globs: ["skills/**/SKILL.md"] },
    secretBody(),
  );
  try {
    await writeSkill(repo, "skills/demo/SKILL.md", "");
    await writeConfig(repo, {
      globs: ["skills/**/SKILL.md"],
      suppressions: [suppression(["skills/demo/**"], "never")],
    });
    await commit(repo, "remove finding while adding suppression");

    const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });

    assert.ok(report.summary.findingsDelta < 0);
    assert.equal(report.status, "fail");
    assert.ok(
      report.notes.includes(
        "Scan findings decreased alongside a scan-boundary weakening; this is not treated as verified remediation.",
      ),
    );
    assert.ok(!report.notes.includes("Scan findings decreased."));
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("suppression path and lifetime expansion are reviewable and fail closed", async () => {
  const repo = await createRepo(
    {
      globs: ["skills/**/SKILL.md"],
      suppressions: [suppression(["skills/other/**"], "2090-01-01")],
    },
    secretBody(),
  );
  try {
    await writeConfig(repo, {
      globs: ["skills/**/SKILL.md"],
      suppressions: [
        suppression(["skills/other/**", "skills/demo/**"], "never"),
      ],
    });
    await commit(repo, "expand suppression");

    const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });

    assert.equal(report.status, "fail");
    assert.deepEqual(
      report.scanBoundaryPolicy.matches.map((match) => match.id),
      [
        SCAN_BOUNDARY_CI_MATCH_IDS.SUPPRESSION_ADDED,
        SCAN_BOUNDARY_CI_MATCH_IDS.SUPPRESSION_LIFETIME_EXTENDED,
      ],
    );
    assert.equal(
      report.scanBoundaryPolicy.effectiveBoundary?.activeSuppressions.length,
      0,
    );
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("obvious boundary tightening does not fail solely for becoming safer", async () => {
  const repo = await createRepo({
    globs: ["skills/**/SKILL.md"],
    exclude: [...DEFAULT_EXCLUDE, "skills/private"],
    max_depth: 5,
    max_file_size_bytes: 1_000,
    suppressions: [suppression(["skills/other/**"], "never")],
  });
  try {
    await writeConfig(repo, {
      globs: ["skills/**/SKILL.md", "README.md"],
      exclude: DEFAULT_EXCLUDE,
      max_depth: 20,
      max_file_size_bytes: 20_000,
      suppressions: [suppression(["skills/other/**"], "2090-01-01")],
    });
    await commit(repo, "tighten evidence boundary");

    const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });

    assert.equal(report.scanBoundaryPolicy.matchCount, 0);
    assert.equal(report.scanBoundaryPolicy.outcome, "pass");
    assert.notEqual(report.status, "fail");
    assert.ok(
      report.diff.scanBoundary.changes.every(
        (change) => change.direction === "tightening",
      ),
    );
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("target cannot combine weakening with fail-to-off to bypass the gate", async () => {
  const repo = await createRepo({
    globs: ["skills/**/SKILL.md"],
    scan_boundary: { ci_policy: "fail" },
  });
  try {
    await writeSkill(repo, "skills/evil/SKILL.md", secretBody());
    await writeConfig(repo, {
      globs: [],
      scan_boundary: { ci_policy: "off" },
    });
    await commit(repo, "attempt boundary gate bypass");

    const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });

    assert.equal(report.status, "fail");
    assert.deepEqual(report.scanBoundaryPolicy.configured, {
      from: "fail",
      to: "off",
      effective: "fail",
    });
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

async function createRepo(
  config: Record<string, unknown>,
  demoExtra = "",
): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "renma-ci-boundary-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  await writeConfig(repo, config);
  await writeSkill(repo, "skills/demo/SKILL.md", demoExtra);
  await commit(repo, "base");
  await git(repo, ["tag", "base"]);
  return repo;
}

async function writeConfig(
  repo: string,
  config: Record<string, unknown>,
): Promise<void> {
  await writeFile(join(repo, "renma.config.json"), JSON.stringify(config));
}

async function writeSkill(
  repo: string,
  relativePath: string,
  extraBody: string,
): Promise<void> {
  const directory = join(repo, ...relativePath.split("/").slice(0, -1));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(repo, relativePath),
    [
      "---",
      `id: ${relativePath.replaceAll("/", ".").toLowerCase()}`,
      "name: Boundary fixture",
      "owner: security",
      "status: stable",
      "description: Use this Skill for deterministic boundary fixture review when scan evidence and verification are required.",
      "---",
      "# Boundary Fixture",
      "",
      "## Do Not Use For",
      "",
      "Do not use for unrelated work.",
      "",
      "## Instructions",
      "",
      "1. Inspect the fixture.",
      "2. Verify the result.",
      "",
      "## Required Inputs",
      "",
      "- Repository state.",
      "",
      "## Completion Criteria",
      "",
      "- Evidence is recorded.",
      "",
      "## Examples",
      "",
      "Input: a fixture. Output: a result.",
      "",
      "## Preflight",
      "",
      "Confirm the fixture exists.",
      "",
      "## Verification",
      "",
      "Run `renma scan`.",
      extraBody,
      "",
    ].join("\n"),
  );
}

function secretBody(): string {
  return '\napi_key = "abcd1234abcd1234"\n';
}

function suppression(paths: string[], expires: string) {
  return {
    id: "SEC-LITERAL-SECRET",
    paths,
    reason: "Adversarial fixture",
    expires,
  };
}

function isLiteralSecret(finding: { id: string }): boolean {
  return finding.id === "SEC-LITERAL-SECRET";
}

async function commit(repo: string, message: string): Promise<void> {
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", message]);
}

async function git(repo: string, args: string[]): Promise<void> {
  await execFile("git", ["-C", repo, ...args]);
}

async function captureStdout(
  action: () => Promise<number>,
): Promise<{ code: number; stdout: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await action(), stdout: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}
