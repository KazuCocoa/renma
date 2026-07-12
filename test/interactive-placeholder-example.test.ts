import assert from "node:assert/strict";
import { access, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { catalog } from "../src/commands/catalog.js";
import { readiness } from "../src/commands/readiness.js";
import { scan } from "../src/scanner.js";

const EXAMPLE_ROOT = path.join(
  process.cwd(),
  "examples",
  "interactive-placeholder",
);
const TOOL_PATH = path.join(EXAMPLE_ROOT, "tools", "placeholder-demo.mjs");
const TOOL_GUIDE_PATH = path.join(EXAMPLE_ROOT, "tools", "README.md");
const SKILL_PATH = path.join(
  EXAMPLE_ROOT,
  "skills",
  "replace-placeholder",
  "SKILL.md",
);
const TEMPLATE_PATH = path.join(EXAMPLE_ROOT, "assets", "template.txt");
const OUTPUT_PATH = path.join(EXAMPLE_ROOT, "workspace", "output.txt");

test("interactive-placeholder is a clean, ready thin Agent Skill example", async () => {
  const [scanResult, catalogResult, readinessReport] = await Promise.all([
    scan(EXAMPLE_ROOT),
    catalog(EXAMPLE_ROOT),
    readiness(EXAMPLE_ROOT),
  ]);

  assert.equal(scanResult.diagnostics.length, 0);
  assert.equal(scanResult.agentSkills.totalSkillCount, 1);
  assert.equal(scanResult.agentSkills.validSkillCount, 1);
  assert.equal(scanResult.agentSkills.invalidSkillCount, 0);
  assert.equal(scanResult.agentSkills.results[0]?.format, "agent-skills");
  assert.equal(scanResult.agentSkills.results[0]?.valid, true);
  assert.equal(scanResult.agentSkills.warningCount, 0);
  assert.deepEqual(scanResult.agentSkills.results[0]?.issues, []);
  assert.ok(
    catalogResult.catalog.assets.some(
      (asset) => asset.id === "skill.example.replace-placeholder",
    ),
  );
  assert.deepEqual(scanResult.findings, []);
  assert.equal(readinessReport.level, "ready");
  assert.equal(readinessReport.score, 100);

  for (const checkId of [
    "workflow.clarity",
    "workflow.required_inputs",
    "workflow.completion_criteria",
    "layout.skills_thin",
    "paths.helper_commands",
  ]) {
    assert.equal(
      readinessReport.checks.find((check) => check.id === checkId)?.status,
      "pass",
      `${checkId} should pass for the interactive example.`,
    );
  }

  assert.equal(
    readinessReport.checks.every((check) => check.status === "pass"),
    true,
    "Every readiness check should pass for the onboarding example.",
  );

  const skill = await readFile(SKILL_PATH, "utf8");
  assert.match(skill, /\[local tool guide\]\(\.\.\/\.\.\/tools\/README\.md\)/);
  await assert.doesNotReject(access(TOOL_GUIDE_PATH));
});

test("placeholder CLI safely prepares, applies, inspects, and resets", async () => {
  const originalTemplate = await readFile(TEMPLATE_PATH, "utf8");
  await removeOutput();

  try {
    const missingInspect = runTool("inspect");
    assert.notEqual(missingInspect.status, 0);
    assert.match(missingInspect.stderr, /run prepare first/);

    const prepared = runTool("prepare");
    assert.equal(prepared.status, 0);
    assert.match(prepared.stdout, /replacement value is missing/);
    assert.equal(await readFile(OUTPUT_PATH, "utf8"), originalTemplate);

    const waiting = runTool("inspect");
    assert.equal(waiting.status, 0);
    assert.match(waiting.stdout, /<placeholder> remains/);

    for (const invalidValue of [
      "",
      "has space",
      "slash/value",
      "a".repeat(33),
      "../outside",
    ]) {
      const invalid = runTool("apply", invalidValue);
      assert.notEqual(invalid.status, 0, invalidValue);
      assert.match(invalid.stderr, /Invalid value/);
      assert.equal(await readFile(OUTPUT_PATH, "utf8"), originalTemplate);
    }

    const outsidePath = path.join(
      EXAMPLE_ROOT,
      "..",
      `outside-${process.pid}.txt`,
    );
    const escaped = runTool("apply", "SafeValue", outsidePath);
    assert.notEqual(escaped.status, 0);
    assert.match(escaped.stderr, /Invalid arguments/);
    await assert.rejects(access(outsidePath));

    const applied = runTool("apply", "Safe_Value-17");
    assert.equal(applied.status, 0);
    const output = await readFile(OUTPUT_PATH, "utf8");
    assert.equal(output, "Hello, Safe_Value-17!\n");
    assert.doesNotMatch(output, /<placeholder>/);

    const complete = runTool("inspect");
    assert.equal(complete.status, 0);
    assert.match(complete.stdout, /State: complete\. Hello, Safe_Value-17!/);

    const absentPlaceholder = runTool("apply", "SecondValue");
    assert.notEqual(absentPlaceholder.status, 0);
    assert.match(absentPlaceholder.stderr, /has no <placeholder>/);

    const reset = runTool("prepare");
    assert.equal(reset.status, 0);
    assert.equal(await readFile(OUTPUT_PATH, "utf8"), originalTemplate);
    assert.equal(await readFile(TEMPLATE_PATH, "utf8"), originalTemplate);

    const repeated = runTool("apply", "Repeat_17");
    assert.equal(repeated.status, 0);
    assert.equal(await readFile(OUTPUT_PATH, "utf8"), "Hello, Repeat_17!\n");

    const secondReset = runTool("prepare");
    assert.equal(secondReset.status, 0);
    assert.equal(await readFile(OUTPUT_PATH, "utf8"), originalTemplate);
  } finally {
    await removeOutput();
    assert.equal(await readFile(TEMPLATE_PATH, "utf8"), originalTemplate);
    await assert.rejects(access(OUTPUT_PATH));
  }
});

function runTool(...args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [TOOL_PATH, ...args], {
    cwd: EXAMPLE_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function removeOutput(): Promise<void> {
  try {
    await unlink(OUTPUT_PATH);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
}
