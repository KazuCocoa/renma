import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { readiness } from "../src/commands/readiness.js";
import { buildScaffoldBundle } from "../src/commands/scaffold.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import {
  RENMA_SCAFFOLD_PLACEHOLDER_MARKERS,
  RENMA_SCAFFOLD_PLACEHOLDERS,
  type RenmaScaffoldPlaceholderKind,
  type RenmaScaffoldPlaceholderName,
} from "../src/scaffold-placeholders.js";
import { scan } from "../src/scanner.js";

const PLACEHOLDER_ID = DIAGNOSTIC_IDS.QUAL_RENMA_SCAFFOLD_PLACEHOLDER;

test("untouched Skill and Context scaffolds retain precise High placeholder evidence", async (t) => {
  const skillRoot = await repositoryFixture(t);
  const skillPath = await writeScaffold(skillRoot, "skill");
  const skillResult = await scan(skillRoot);
  const skillFindings = skillResult.findings.filter(
    (finding) => finding.id === PLACEHOLDER_ID,
  );

  assert.equal(skillFindings.length, 6);
  assert.ok(skillFindings.every((finding) => finding.severity === "high"));
  assert.deepEqual(
    skillFindings.map((finding) => finding.details?.placeholder),
    [
      "description",
      "purpose",
      "requiredInput",
      "inspectInstruction",
      "reviewInstruction",
      "expectedOutput",
    ],
  );
  const description = skillFindings.find(
    (finding) => finding.details?.placeholder === "description",
  );
  assert.equal(description?.evidence.path, "skills/demo/SKILL.md");
  assert.equal(description?.evidence.startLine, 3);
  assert.equal(
    description?.evidence.snippet,
    `description: ${RENMA_SCAFFOLD_PLACEHOLDERS.skill.description}`,
  );
  assert.match(await readFile(skillPath, "utf8"), /## Required Inputs/);

  const contextRoot = await repositoryFixture(t);
  await writeScaffold(contextRoot, "context");
  const contextFindings = (await scan(contextRoot)).findings.filter(
    (finding) => finding.id === PLACEHOLDER_ID,
  );
  assert.deepEqual(
    contextFindings.map((finding) => [
      finding.details?.placeholder,
      finding.severity,
      finding.evidence.snippet,
    ]),
    [
      ["summary", "high", RENMA_SCAFFOLD_PLACEHOLDERS.context.summary],
      ["appliesWhen", "high", RENMA_SCAFFOLD_PLACEHOLDERS.context.appliesWhen],
      [
        "doesNotApplyWhen",
        "high",
        RENMA_SCAFFOLD_PLACEHOLDERS.context.doesNotApplyWhen,
      ],
    ],
  );
});

test("partially edited scaffolds report the one exact marker that remains", async (t) => {
  for (const fixture of [
    { kind: "skill" as const, remaining: "purpose" as const },
    { kind: "context" as const, remaining: "doesNotApplyWhen" as const },
  ]) {
    const root = await repositoryFixture(t);
    const target = await writeScaffold(root, fixture.kind);
    const content = await readFile(target, "utf8");
    await writeFile(
      target,
      replaceScaffoldMarkers(content, fixture.kind, fixture.remaining),
    );

    const findings = (await scan(root)).findings.filter(
      (finding) => finding.id === PLACEHOLDER_ID,
    );
    assert.equal(findings.length, 1, fixture.kind);
    assert.equal(findings[0]?.details?.placeholder, fixture.remaining);
    assert.equal(findings[0]?.evidence.snippet, markerText(fixture.remaining));
  }
});

test("completed scaffolds and near-neighbor prose do not match Renma residue", async (t) => {
  for (const kind of ["skill", "context"] as const) {
    const completedRoot = await repositoryFixture(t);
    const completedTarget = await writeScaffold(completedRoot, kind);
    const generated = await readFile(completedTarget, "utf8");
    await writeFile(completedTarget, replaceScaffoldMarkers(generated, kind));
    assert.equal(
      (await scan(completedRoot)).findings.some(
        (finding) => finding.id === PLACEHOLDER_ID,
      ),
      false,
      `${kind} completed`,
    );

    const neighborRoot = await repositoryFixture(t);
    const neighborTarget = await writeScaffold(neighborRoot, kind);
    let neighbor = await readFile(neighborTarget, "utf8");
    for (const marker of RENMA_SCAFFOLD_PLACEHOLDER_MARKERS.filter(
      (candidate) => candidate.kind === kind,
    )) {
      neighbor = neighbor.replace(
        marker.text,
        `${marker.text} This adjacent author-owned sentence changes the exact marker.`,
      );
    }
    await writeFile(neighborTarget, neighbor);
    assert.equal(
      (await scan(neighborRoot)).findings.some(
        (finding) => finding.id === PLACEHOLDER_ID,
      ),
      false,
      `${kind} near neighbor`,
    );
  }
});

test("strict High scan fails in JSON and text for an untouched scaffold", async (t) => {
  const root = await repositoryFixture(t);
  await capture(() => main(["init", root]));
  await capture(() =>
    main([
      "scaffold",
      "skill",
      path.join(root, "skills", "demo", "SKILL.md"),
      "--owner",
      "maintainers",
    ]),
  );

  const json = await capture(() =>
    main(["scan", root, "--fail-on", "high", "--strict", "--format", "json"]),
  );
  assert.equal(json.code, 1);
  const parsed = JSON.parse(json.stdout) as {
    findings: Array<{
      id: string;
      evidence: { path: string; startLine: number; snippet: string };
    }>;
  };
  const finding = parsed.findings.find(({ id }) => id === PLACEHOLDER_ID);
  assert.equal(finding?.evidence.path, "skills/demo/SKILL.md");
  assert.ok((finding?.evidence.startLine ?? 0) > 0);
  assert.match(finding?.evidence.snippet ?? "", /^description:/);

  const text = await capture(() =>
    main(["scan", root, "--fail-on", "high", "--strict", "--format", "text"]),
  );
  assert.equal(text.code, 1);
  assert.match(text.stdout, /HIGH QUAL-RENMA-SCAFFOLD-PLACEHOLDER/);
  assert.match(text.stdout, /skills\/demo\/SKILL\.md:3/);
  assert.match(text.stdout, /evidence: description:/);
});

test("Readiness blocks untouched Skill and Context scaffolds and projects workflow residue", async (t) => {
  const skillRoot = await repositoryFixture(t);
  await writeScaffold(skillRoot, "skill");
  const skill = await readiness(skillRoot);
  assert.ok(skill.score < 100);
  assert.equal(skill.level, "not_ready");
  assert.equal(
    skill.checks.find((check) => check.id === "assets.scaffold_completeness")
      ?.status,
    "fail",
  );
  for (const id of [
    "workflow.clarity",
    "workflow.required_inputs",
    "workflow.completion_criteria",
  ]) {
    assert.equal(
      skill.checks.find((check) => check.id === id)?.status,
      "warn",
      id,
    );
  }

  const contextRoot = await repositoryFixture(t);
  await writeScaffold(contextRoot, "context");
  const context = await readiness(contextRoot);
  assert.equal(context.score, 80);
  assert.equal(context.level, "not_ready");
  const check = context.checks.find(
    (candidate) => candidate.id === "assets.scaffold_completeness",
  );
  assert.equal(check?.status, "fail");
  assert.equal(check?.evidence?.length, 3);
});

async function repositoryFixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-scaffold-marker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function writeScaffold(
  root: string,
  kind: RenmaScaffoldPlaceholderKind,
): Promise<string> {
  const target =
    kind === "skill"
      ? path.join(root, "skills", "demo", "SKILL.md")
      : path.join(root, "contexts", "demo.md");
  const bundle = buildScaffoldBundle({
    kind,
    targetPath: target,
    format: "file",
    owner: "maintainers",
  });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bundle.content);
  return target;
}

function replaceScaffoldMarkers(
  content: string,
  kind: RenmaScaffoldPlaceholderKind,
  remaining?: RenmaScaffoldPlaceholderName,
): string {
  const replacements: Record<string, string> = {
    description:
      "Review release evidence and produce a bounded report. Use when maintainers validate a release candidate; do not use for unrelated implementation work.",
    purpose:
      "Review the requested release evidence and prepare a deterministic maintainer handoff.",
    requiredInput:
      "- The target version, comparison tag, and repository checkout.",
    inspectInstruction:
      "1. Inspect the target version, comparison tag, and repository checkout.",
    reviewInstruction:
      "2. Run the documented checks and compare their observable results.",
    expectedOutput:
      "3. Return the changed artifacts, check results, and remaining blockers; completion requires every named check to pass.",
    summary:
      "This asset records the maintained release-validation boundaries for Renma consumers.",
    appliesWhen:
      "- Release preparation or consumer installation examples are under review.",
    doesNotApplyWhen:
      "- Runtime package selection or unrelated dependency maintenance is requested.",
  };
  let result = content;
  for (const marker of RENMA_SCAFFOLD_PLACEHOLDER_MARKERS.filter(
    (candidate) => candidate.kind === kind && candidate.name !== remaining,
  )) {
    result = result.replace(marker.text, replacements[marker.name] ?? "");
  }
  return result;
}

function markerText(name: RenmaScaffoldPlaceholderName): string {
  const marker = RENMA_SCAFFOLD_PLACEHOLDER_MARKERS.find(
    (candidate) => candidate.name === name,
  );
  assert.ok(marker);
  return marker.text;
}

async function capture(
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
