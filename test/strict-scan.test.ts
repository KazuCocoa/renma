import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import test from "node:test";

import { main } from "../src/cli.js";
import { runScanCommand } from "../src/commands/scan.js";
import { scan } from "../src/scanner.js";
import {
  evaluateStrictScan,
  STRICT_SCAN_MATCH_IDS,
} from "../src/strict-scan.js";
import { RepositoryFixture } from "./repository-fixture.js";

test("strict scan rejects a specification-invalid canonical Agent Skill", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "skills/invalid/SKILL.md",
    [
      "---",
      "name: Invalid Name",
      "description: Invalid portable identity for a strict-scan fixture.",
      "---",
      "# Invalid",
      "",
    ].join("\n"),
  );

  const normal = await captureStdout(() =>
    main(["scan", fixture.root, "--fail-on", "high", "--format", "json"]),
  );
  const strict = await captureStdout(() =>
    main([
      "scan",
      fixture.root,
      "--fail-on",
      "high",
      "--format",
      "json",
      "--strict",
    ]),
  );
  const json = JSON.parse(strict.stdout) as {
    agentSkills: { invalidSkillCount: number; results: unknown[] };
  };

  assert.equal(normal.code, 0);
  assert.equal(strict.code, 1);
  assert.equal(json.agentSkills.invalidSkillCount, 1);
  assert.equal(json.agentSkills.results.length, 1);
});

test("strict scan rejects a real error diagnostic without redefining normal scan", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.contextLens("lenses/broken.md", {
    id: "lens.broken",
    owner: "qa",
    purpose: "Review missing context evidence.",
    appliesTo: ["context.missing"],
    focus: ["coverage"],
    expectedOutputs: ["review summary"],
  });

  const result = await scan(fixture.root, {
    failOn: "high",
    format: "json",
  });
  const evaluation = evaluateStrictScan(result);
  const normal = await captureStdout(() =>
    runScanCommand(fixture.root, { failOn: "high", format: "json" }),
  );
  const strict = await captureStdout(() =>
    runScanCommand(
      fixture.root,
      { failOn: "high", format: "json" },
      { strict: true },
    ),
  );

  assert.ok(result.diagnostics.some((item) => item.severity === "error"));
  assert.ok(
    evaluation.matches.some(
      (match) => match.id === STRICT_SCAN_MATCH_IDS.ERROR_DIAGNOSTIC,
    ),
  );
  assert.equal(normal.code, 0);
  assert.equal(strict.code, 1);
});

test("symlink Skill is not followed and is explicit blocking coverage evidence", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write("target.md", "# Outside Skill entrypoint\n");
  await fixture.write("skills/example/.keep", "fixture\n");
  await symlink("../../target.md", fixture.resolve("skills/example/SKILL.md"));

  const jsonRun = await captureStdout(() =>
    runScanCommand(
      fixture.root,
      { failOn: "high", format: "json" },
      { strict: true },
    ),
  );
  const textRun = await captureStdout(() =>
    runScanCommand(fixture.root, { failOn: "high", format: "text" }),
  );
  const json = JSON.parse(jsonRun.stdout) as {
    scannedFileCount: number;
    inspectionCoverage: {
      blockingIssues: Array<{ path: string; state: string }>;
    };
  };

  assert.equal(jsonRun.code, 1);
  assert.equal(json.scannedFileCount, 0);
  assert.deepEqual(
    json.inspectionCoverage.blockingIssues.map(({ path, state }) => ({
      path,
      state,
    })),
    [{ path: "skills/example/SKILL.md", state: "symlink" }],
  );
  assert.match(
    textRun.stdout,
    /expected agent-facing content could not be inspected/,
  );
  assert.match(textRun.stdout, /skills\/example\/SKILL\.md: symlink/);
});

test("oversized canonical Skill is a blocking coverage issue", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.writeConfig({ max_file_size_bytes: 64 });
  await fixture.write(
    "skills/oversized/SKILL.md",
    `---\nname: oversized\ndescription: ${"x".repeat(100)}\n---\n# Oversized\n`,
  );

  const result = await scan(fixture.root, { failOn: "high" });
  const command = await captureStdout(() =>
    runScanCommand(
      fixture.root,
      { failOn: "high", format: "json" },
      { strict: true },
    ),
  );

  assert.equal(command.code, 1);
  assert.deepEqual(
    result.inspectionCoverage.blockingIssues.map((issue) => [
      issue.path,
      issue.state,
    ]),
    [["skills/oversized/SKILL.md", "oversize"]],
  );
});

test("depth-limited canonical Skill is a blocking coverage issue", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.writeConfig({ max_depth: 2 });
  await fixture.skill("depth-limited");

  const result = await scan(fixture.root, { failOn: "high" });
  const command = await captureStdout(() =>
    runScanCommand(
      fixture.root,
      { failOn: "high", format: "json" },
      { strict: true },
    ),
  );

  assert.equal(command.code, 1);
  assert.deepEqual(
    result.inspectionCoverage.blockingIssues.map((issue) => [
      issue.path,
      issue.state,
    ]),
    [["skills/depth-limited/SKILL.md", "deep"]],
  );
});

test("strict coverage does not turn an ordinary skipped file into a failure", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.writeConfig({ max_file_size_bytes: 16 });
  await fixture.write("tools/blob.bin", new Uint8Array(32));

  const result = await scan(fixture.root, { failOn: "high" });
  const command = await captureStdout(() =>
    runScanCommand(
      fixture.root,
      { failOn: "high", format: "json" },
      { strict: true },
    ),
  );

  assert.equal(result.inspectionCoverage.blockingIssues.length, 0);
  assert.equal(command.code, 0);
});

test("strict scan preserves a trusted active suppression", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.writeConfig({
    suppressions: [
      {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Reviewed fake credential fixture.",
        expires: "never",
      },
    ],
  });
  await fixture.skill("demo", {
    owner: "qa",
    body: '# Demo\n\napi_key = "abcd1234abcd1234"\n',
  });

  const result = await scan(fixture.root, { failOn: "high" });
  const command = await captureStdout(() =>
    runScanCommand(
      fixture.root,
      { failOn: "high", format: "json" },
      { strict: true },
    ),
  );

  assert.ok(
    result.suppressedFindings.some(
      (item) => item.finding.id === "SEC-LITERAL-SECRET",
    ),
  );
  assert.ok(!result.findings.some((item) => item.id === "SEC-LITERAL-SECRET"));
  assert.equal(command.code, 0);
});

test("strict evaluator keeps below-threshold active findings non-blocking", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.skill("advisory", {
    body: "# Advisory\n\nShort workflow.\n",
  });
  const result = await scan(fixture.root, { failOn: "high" });
  const evaluation = evaluateStrictScan(result);
  const command = await captureStdout(() =>
    runScanCommand(
      fixture.root,
      { failOn: "high", format: "json" },
      { strict: true },
    ),
  );

  assert.ok(result.findings.some((finding) => finding.severity === "medium"));
  assert.ok(
    !evaluation.matches.some(
      (match) => match.id === STRICT_SCAN_MATCH_IDS.FINDING_THRESHOLD,
    ),
  );
  assert.equal(command.code, 0);
});

async function captureStdout(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string }> {
  const originalWrite = process.stdout.write;
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await callback(), stdout };
  } finally {
    process.stdout.write = originalWrite;
  }
}
