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
import { diff, formatDiff } from "../src/commands/diff.js";
import { EXECUTABLE_SURFACE_CI_MATCH_IDS } from "../src/executable-surface-ci-policy.js";
import { SCAN_BOUNDARY_CI_MATCH_IDS } from "../src/scan-boundary-ci-policy.js";

const execFile = promisify(execFileCallback);

test("warn mode changes semantic CI status while preserving the exit threshold", async (t) => {
  const repo = await executableCiRepo(t, "warn");
  await addExecutable(repo, "tools/new.mjs");
  await commit(repo, "add executable surface");

  const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });
  const defaultThreshold = await captureStdout(() =>
    runCiReportCommand(repo, {
      fromRef: "base",
      toRef: "HEAD",
      format: "json",
    }),
  );
  const warnThreshold = await captureStdout(() =>
    runCiReportCommand(repo, {
      fromRef: "base",
      toRef: "HEAD",
      format: "json",
      failOnStatus: "warn",
    }),
  );

  assert.equal(report.status, "warn");
  assert.equal(report.executableSurfacePolicy.outcome, "warn");
  assert.deepEqual(report.executableSurfacePolicy.configured, {
    from: "warn",
    to: "warn",
    effective: "warn",
  });
  assert.deepEqual(
    report.executableSurfacePolicy.matches.map((match) => match.id),
    [EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED],
  );
  assert.equal(defaultThreshold.code, 0);
  assert.equal(warnThreshold.code, 1);
});

test("fail mode makes an added executable surface fail CI", async (t) => {
  const repo = await executableCiRepo(t, "fail");
  await addExecutable(repo, "tools/new.mjs");
  await commit(repo, "add executable surface");

  const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });
  const command = await captureStdout(() =>
    runCiReportCommand(repo, {
      fromRef: "base",
      toRef: "HEAD",
      format: "markdown",
    }),
  );

  assert.equal(report.status, "fail");
  assert.equal(report.executableSurfacePolicy.outcome, "fail");
  assert.equal(command.code, 1);
  assert.match(command.stdout, /^## Executable Surface CI Policy$/m);
  assert.match(
    command.stdout,
    /`executable_surface_ci\.surface_added`: `tools\/new\.mjs`/,
  );
});

test("target cannot weaken fail to off in the same executable-surface PR", async (t) => {
  const repo = await executableCiRepo(t, "fail");
  await writeConfig(repo, {
    globs: ["README.md", "tools/**/*"],
    executable_surface: { ci_policy: "off" },
  });
  await addExecutable(repo, "tools/new.mjs");
  await commit(repo, "attempt executable policy bypass");

  const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });

  assert.equal(report.status, "fail");
  assert.deepEqual(report.executableSurfacePolicy.configured, {
    from: "fail",
    to: "off",
    effective: "fail",
  });
  assert.equal(report.executableSurfacePolicy.outcome, "fail");
  assert.ok(
    report.executableSurfacePolicy.matches.some(
      (match) =>
        match.id === EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED &&
        match.kind === "surface" &&
        match.path === "tools/new.mjs",
    ),
  );
});

test("CI enforcement-view executable evidence survives target scan narrowing", async (t) => {
  const repo = await executableCiRepo(t, "fail");
  await writeConfig(repo, {
    globs: ["README.md"],
    executable_surface: { ci_policy: "off" },
  });
  await addExecutable(repo, "tools/new-helper.mjs");
  await commit(repo, "hide executable and weaken policy");

  const direct = await diff(repo, { fromRef: "base", toRef: "HEAD" });
  const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });

  assert.equal(
    direct.executableSurface.addedSurfacePaths.includes("tools/new-helper.mjs"),
    false,
  );
  assert.ok(
    report.diff.executableSurface.addedSurfacePaths.includes(
      "tools/new-helper.mjs",
    ),
  );
  assert.ok(
    report.executableSurfacePolicy.matches.some(
      (match) =>
        match.id === EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED &&
        match.kind === "surface" &&
        match.path === "tools/new-helper.mjs",
    ),
  );
  assert.deepEqual(report.executableSurfacePolicy.configured, {
    from: "fail",
    to: "off",
    effective: "fail",
  });
  assert.equal(report.executableSurfacePolicy.outcome, "fail");
  assert.ok(
    report.scanBoundaryPolicy.matches.some(
      (match) => match.id === SCAN_BOUNDARY_CI_MATCH_IDS.GLOB_REMOVED,
    ),
  );
  assert.equal(report.status, "fail");
});

test("direct diff remains observation-only when executable policy is configured", async (t) => {
  const repo = await executableCiRepo(t, "fail");
  await addExecutable(repo, "tools/new.mjs");
  await commit(repo, "add executable surface");

  const report = await diff(repo, { fromRef: "base", toRef: "HEAD" });
  const json = JSON.parse(formatDiff(report, "json")) as Record<
    string,
    unknown
  >;
  const markdown = formatDiff(report, "markdown");

  assert.deepEqual(report.executableSurface.addedSurfacePaths, [
    "tools/new.mjs",
  ]);
  assert.equal("status" in json, false);
  assert.equal("executableSurfacePolicy" in json, false);
  assert.doesNotMatch(markdown, /Executable Surface CI Policy/);
});

test("off mode retains matches as informational and says the gate is disabled", async (t) => {
  const repo = await executableCiRepo(t, "off");
  await addExecutable(repo, "tools/new.mjs");
  await commit(repo, "add informational executable surface");

  const report = await ciReport(repo, { fromRef: "base", toRef: "HEAD" });
  const markdown = formatCiReport(report, "markdown");

  assert.equal(report.status, "pass");
  assert.equal(report.executableSurfacePolicy.outcome, "pass");
  assert.equal(report.executableSurfacePolicy.matchCount, 1);
  assert.ok(
    report.notes.includes(
      "Executable-surface CI policy is off; 1 matching change remains informational.",
    ),
  );
  assert.ok(!report.notes.includes("No CI report regressions detected."));
  assert.match(markdown, /- Effective: off/);
  assert.match(markdown, /- Outcome: PASS/);
});

async function executableCiRepo(
  t: test.TestContext,
  mode: "off" | "warn" | "fail",
): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "renma-executable-ci-"));
  t.after(() => rm(repo, { force: true, recursive: true }));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  await writeFile(join(repo, "README.md"), "# Executable CI fixture\n");
  await writeConfig(repo, {
    globs: ["README.md", "tools/**/*"],
    executable_surface: { ci_policy: mode },
  });
  await commit(repo, "base");
  await git(repo, ["tag", "base"]);
  return repo;
}

async function writeConfig(
  repo: string,
  config: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    join(repo, "renma.config.json"),
    `${JSON.stringify(config)}\n`,
  );
}

async function addExecutable(
  repo: string,
  relativePath: string,
): Promise<void> {
  const absolutePath = join(repo, ...relativePath.split("/"));
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, "export const value = 1;\n");
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
