import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { readiness } from "../src/commands/readiness.js";
import {
  classifyRepositorySkillEntrypointPath,
  classifyRepositorySkillPath,
} from "../src/discovery.js";
import { scan } from "../src/scanner.js";

const CANONICAL_SKILL_PATHS = [
  "skills/demo/SKILL.md",
  "skills/testing/demo/SKILL.md",
  ".agents/skills/demo/SKILL.md",
  ".agents/skills/testing/demo/SKILL.md",
] as const;

test("canonical Skill path model is equivalent across roots and nesting depths", () => {
  for (const skillPath of CANONICAL_SKILL_PATHS) {
    const entrypoint = classifyRepositorySkillEntrypointPath(skillPath);
    const classified = classifyRepositorySkillPath(skillPath);
    const skillDirectory = path.posix.dirname(skillPath);

    assert.equal(entrypoint?.kind, "canonical", skillPath);
    assert.equal(classified?.kind, "entrypoint", skillPath);
    if (classified?.kind !== "entrypoint") continue;
    assert.equal(classified.skillDirectory, skillDirectory, skillPath);
    assert.equal(classified.skillName, "demo", skillPath);
    assert.deepEqual(
      classified.domainPath,
      skillPath.includes("/testing/") ? ["testing"] : [],
      skillPath,
    );

    for (const supportDirectory of [
      "assets",
      "examples",
      "profiles",
      "references",
      "scripts",
    ] as const) {
      const support = classifyRepositorySkillPath(
        `${skillDirectory}/${supportDirectory}/local.md`,
      );
      assert.equal(
        support?.kind,
        "support",
        `${skillPath}: ${supportDirectory}`,
      );
      if (support?.kind !== "support") continue;
      assert.equal(support.skillDirectory, skillDirectory, skillPath);
      assert.equal(
        support.supportDirectory,
        supportDirectory,
        `${skillPath}: ${supportDirectory}`,
      );
      assert.equal(
        support.relativeToSkillDirectory,
        `${supportDirectory}/local.md`,
      );
    }
  }
});

test("nested canonical Skills participate in workflow and thin-Skill readiness checks", async () => {
  for (const skillPath of CANONICAL_SKILL_PATHS) {
    const root = await fixture();
    await writeRepoFile(root, skillPath, incompleteProceduralSkill());

    const scanResult = await scan(root);
    const ids = new Set(
      scanResult.findings
        .filter((finding) => finding.evidence.path === skillPath)
        .map((finding) => finding.id),
    );
    for (const expected of [
      "QUAL-MISSING-ROUTING-CLARITY",
      "QUAL-MISSING-REQUIRED-INPUTS",
      "QUAL-MISSING-COMPLETION-CRITERIA",
      "LAYOUT-SKILL-NOT-THIN",
      "LAYOUT-SKILL-EXECUTABLE-COMMAND",
    ]) {
      assert.equal(ids.has(expected), true, `${skillPath}: ${expected}`);
    }

    const report = await readiness(root);
    assert.equal(report.level, "not_ready", skillPath);
    assert.equal(report.score, 55, skillPath);
    for (const checkId of [
      "workflow.clarity",
      "workflow.required_inputs",
      "workflow.completion_criteria",
      "layout.skills_thin",
    ]) {
      assert.equal(
        report.checks.find((check) => check.id === checkId)?.status,
        "warn",
        `${skillPath}: ${checkId}`,
      );
    }

    const cli = await withCapturedOutput(() =>
      main(["readiness", root, "--json"]),
    );
    assert.equal(cli.code, 1, skillPath);
    assert.equal(JSON.parse(cli.stdout).level, "not_ready", skillPath);
  }
});

test("complete nested canonical Skills remain ready and appear in workflow graphs", async () => {
  for (const skillPath of CANONICAL_SKILL_PATHS) {
    const root = await fixture();
    await writeRepoFile(root, skillPath, completeSkill());

    const report = await readiness(root);
    assert.equal(report.level, "ready", skillPath);
    assert.equal(report.score, 100, skillPath);

    const graph = await withCapturedOutput(() =>
      main(["graph", root, "--view", "workflow", "--json"]),
    );
    assert.equal(graph.code, 0, skillPath);
    assert.equal(
      JSON.parse(graph.stdout).nodes.some(
        (node: { sourcePath: string }) => node.sourcePath === skillPath,
      ),
      true,
      skillPath,
    );
  }
});

test("nested Skill-local references resolve their actual parent Skill", async () => {
  for (const skillPath of CANONICAL_SKILL_PATHS) {
    const root = await fixture();
    const skillDirectory = path.posix.dirname(skillPath);
    await writeRepoFile(root, skillPath, completeSkill("references/legacy.md"));
    await writeRepoFile(
      root,
      `${skillDirectory}/references/legacy.md`,
      [
        "---",
        "id: reference.demo.legacy",
        "status: deprecated",
        "superseded_by:",
        "  - contexts/testing/shared.md",
        "---",
        "# Legacy local note",
        "",
        "Use the shared Context Asset as the maintained source of truth.",
        "",
      ].join("\n"),
    );
    await writeRepoFile(
      root,
      "contexts/testing/shared.md",
      [
        "---",
        "id: context.testing.shared",
        "owner: qa-platform",
        "status: stable",
        "when_to_use:",
        "  - Reviewing the nested Skill fixture",
        "when_not_to_use:",
        "  - Unrelated workflows",
        "---",
        "# Shared Context",
        "",
        "Maintained fixture knowledge.",
        "",
      ].join("\n"),
    );

    const result = await scan(root);
    assert.equal(
      result.findings.some(
        (finding) =>
          finding.id === "MAINT-SKILL-REFERENCES-SUPERSEDED-ASSET" &&
          finding.evidence.path === skillPath,
      ),
      true,
      skillPath,
    );
    assert.equal(
      result.findings.some(
        (finding) => finding.id === "LAYOUT-DISALLOWED-SKILL-ASSET",
      ),
      false,
      skillPath,
    );
  }
});

function incompleteProceduralSkill(): string {
  return [
    "---",
    "name: demo",
    "description: Analyze deterministic fixture material and report observations for maintainers across repository governance scenarios without defining when this entrypoint should be selected.",
    "metadata:",
    "  renma.id: skill.demo",
    "  renma.owner: qa-platform",
    `  renma.allowed-data: '["repo-local-files"]'`,
    '  renma.network-allowed: "false"',
    '  renma.external-upload-allowed: "false"',
    '  renma.secrets-allowed: "false"',
    "---",
    "# Demo",
    "",
    "## Procedure",
    "",
    "Detailed guidance ".repeat(240),
    "",
    "```bash",
    "node tools/demo.mjs",
    "```",
    "",
  ].join("\n");
}

function completeSkill(localReference?: string): string {
  return [
    "---",
    "name: demo",
    "description: Review deterministic nested Skill fixtures. Use when repository governance behavior needs verification; do not use for runtime routing, prompt assembly, or automatic file changes.",
    "metadata:",
    "  renma.id: skill.demo",
    "  renma.owner: qa-platform",
    `  renma.allowed-data: '["repo-local-files"]'`,
    '  renma.network-allowed: "false"',
    '  renma.external-upload-allowed: "false"',
    '  renma.secrets-allowed: "false"',
    "---",
    "# Demo",
    "",
    "## Required Inputs And Preflight",
    "",
    "Required inputs are the fixture root and permission to read local files.",
    "",
    "## Workflow",
    "",
    "Review the fixture and record deterministic evidence.",
    ...(localReference
      ? ["", `Read the [local support note](${localReference}).`]
      : []),
    "",
    "## When Not To Use",
    "",
    "Use a runtime-specific workflow for execution or prompt assembly.",
    "",
    "## Example",
    "",
    "Input: nested fixture. Output: deterministic evidence.",
    "",
    "## Completion Criteria",
    "",
    "Complete when the evidence is recorded and verified for human review.",
    "",
    "## Verification",
    "",
    "Verify the scan and readiness results.",
    "",
  ].join("\n");
}

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-nested-skill-"));
}

async function writeRepoFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function withCapturedOutput(
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
