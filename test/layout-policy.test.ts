import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { formatReadiness, readiness } from "../src/commands/readiness.js";
import { scan } from "../src/scanner.js";

test("valid Skill-local support is not categorically disallowed", async () => {
  const root = await fixture();
  await writeMarkdown(
    root,
    "skills/setup/SKILL.md",
    frontmatter({
      owner: "appium",
      name: "setup",
      description:
        "Route setup work and show the old helper command that still points at skill-local scripts.",
    }) +
      [
        "# Setup",
        "",
        "## Route",
        "",
        "Use this skill for setup.",
        "",
        "```bash",
        "node skills/setup/scripts/check-node-env.mjs",
        "```",
        "",
      ].join("\n"),
  );
  await writeMarkdown(
    root,
    "skills/setup/references/node/node-decision-logic.md",
    context("old.node.reference", "Old node reference."),
  );
  await writeMarkdown(
    root,
    "skills/setup/profiles/android.md",
    context("old.android.profile", "Old Android profile."),
  );
  await writeMarkdown(
    root,
    "skills/setup/examples/uiautomator2.md",
    context("old.uiautomator2.example", "Old UiAutomator2 example."),
  );
  await writeFileInRepo(
    root,
    "skills/setup/scripts/check-node-env.mjs",
    "console.log('ok');\n",
  );
  await writeMarkdown(
    root,
    "README.md",
    [
      "# Appium",
      "",
      "See skills/setup/references/node/node-decision-logic.md.",
      "See copy-paste prompt templates.",
      "",
    ].join("\n"),
  );

  const result = await scan(root);
  const ids = result.findings.map((finding) => finding.id);

  assert(!ids.includes("LAYOUT-DISALLOWED-SKILL-ASSET"));
  assert(!ids.includes("PATH-HELPER-COMMAND-SKILL-SCRIPTS"));
  assert(!ids.includes("LAYOUT-HELPER-NON_TOOLS"));
  assert(ids.includes("LAYOUT-SKILL-EXECUTABLE-COMMAND"));
  assert(ids.includes("DOCS-LAYOUT-INCONSISTENT"));

  const report = await readiness(root);
  assert.notEqual(report.level, "ready");
  assert(report.score < 100);
  assert.equal(
    report.checks.find((check) => check.id === "layout.disallowed_skill_assets")
      ?.status,
    "pass",
  );
  assert.equal(
    report.checks.find((check) => check.id === "paths.helper_commands")?.status,
    "pass",
  );
});

test("README and AGENTS may document valid Skill-local support paths", async () => {
  const root = await fixture();
  const snippets = [
    "skills/demo/references/spec.md",
    "skills/testing/demo/examples/happy-path.md",
    "skills/testing/demo/scripts/helper.mjs",
    ".agents/skills/demo/profiles/local.md",
    ".agents/skills/testing/demo/assets/template.md",
  ];
  await writeMarkdown(
    root,
    "README.md",
    `# Layout\n\n${snippets.join("\n")}\n`,
  );
  await writeMarkdown(
    root,
    "AGENTS.md",
    `# Agent layout\n\n${snippets.map((item) => `Use \`${item}\`.`).join("\n")}\n`,
  );

  const result = await scan(root);
  assert.equal(
    result.findings.some(
      (finding) => finding.id === "DOCS-LAYOUT-INCONSISTENT",
    ),
    false,
  );
});

test("genuinely stale repository documentation remains actionable", async () => {
  const root = await fixture();
  await writeMarkdown(
    root,
    "README.md",
    "# Legacy model\n\nUse copy-paste prompt templates for every workflow.\n",
  );

  const finding = (await scan(root)).findings.find(
    (candidate) => candidate.id === "DOCS-LAYOUT-INCONSISTENT",
  );
  assert(finding);
  assert.equal(
    finding.title,
    "Repository docs contradict the supported layout",
  );
});

test("helper commands resolve relative to every canonical Skill shape", async () => {
  const root = await fixture();
  const skillDirectories = [
    "skills/demo",
    "skills/testing/demo",
    ".agents/skills/demo",
    ".agents/skills/testing/demo",
  ];
  await writeFileInRepo(
    root,
    "tools/shared/existing.mjs",
    "console.log('shared');\n",
  );

  for (const skillDirectory of skillDirectories) {
    await writeFileInRepo(
      root,
      `${skillDirectory}/scripts/existing.mjs`,
      "console.log('local');\n",
    );
    await writeMarkdown(
      root,
      `${skillDirectory}/SKILL.md`,
      helperCommandDocument(skillDirectory),
    );
  }
  const referencePath =
    ".agents/skills/testing/demo/references/helper-commands.md";
  await writeMarkdown(
    root,
    referencePath,
    helperCommandDocument(".agents/skills/testing/demo"),
  );

  const result = await scan(root);
  for (const sourcePath of [
    ...skillDirectories.map((directory) => `${directory}/SKILL.md`),
    referencePath,
  ]) {
    const unresolved = result.findings.filter(
      (finding) =>
        finding.id === "PATH-HELPER-COMMAND-UNRESOLVED" &&
        finding.evidence.path === sourcePath,
    );
    assert.deepEqual(
      unresolved.map((finding) => finding.evidence.snippet),
      [
        "node scripts/missing.mjs",
        "node tools/shared/missing.mjs",
        "node ../scripts/escape.mjs",
      ],
      sourcePath,
    );
  }
  assert.equal(
    result.findings.some(
      (finding) => finding.id === "PATH-HELPER-COMMAND-NON_TOOLS",
    ),
    false,
  );
});

test("non-Skill documents do not guess a Skill-relative helper base", async () => {
  const root = await fixture();
  await writeMarkdown(
    root,
    "README.md",
    "# Commands\n\n```bash\nnode scripts/missing.mjs\n```\n",
  );

  const result = await scan(root);
  assert.equal(
    result.findings.some(
      (finding) => finding.id === "PATH-HELPER-COMMAND-UNRESOLVED",
    ),
    false,
  );
});

test("supported layout passes refactored appium repository shape", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      layout: {
        tool_namespace: "appium",
        workflow_aliases: {
          "appium-troubleshooting": "troubleshooting",
          "xcuitest-real-device-config": "real-device",
        },
      },
    }),
  );
  await writeMarkdown(
    root,
    "skills/setup/SKILL.md",
    [
      "---",
      "name: setup",
      "description: Route setup work to canonical contexts and helper scripts without owning procedure content while preserving deterministic usage guidance, non-goals, preflight checks, examples, and verification expectations.",
      "metadata:",
      "  renma.owner: appium",
      `  renma.requires-context: '["contexts/tools/appium/setup/routing.md"]'`,
      "---",
      "",
    ].join("\n") +
      [
        "# Appium Router Entry",
        "",
        "## Route",
        "",
        "## When to use",
        "Use this skill for setup routing.",
        "## DO NOT USE FOR",
        "Do not use this skill for runtime context selection or prompt assembly.",
        "## Preflight",
        "Before you begin, confirm the repository fixture and static context paths exist.",
        "## Required inputs",
        "Required inputs: setup request, repository root, and permission to read static contexts.",
        "## Example",
        "Input: setup request. Output: route to canonical context and helper scripts.",
        "## Completion criteria",
        "The workflow is complete when the setup request is routed to canonical context and helper script paths.",
        "## Verification",
        "Verify by running readiness and scan reports against the fixture.",
        "",
        "## When Not To Use",
        "",
        "do not use for troubleshooting; route to the troubleshooting skill.",
        "",
        "## Evidence",
        "",
        "Load the context and run only requested helpers.",
        "",
      ].join("\n"),
  );
  await writeMarkdown(
    root,
    "contexts/tools/appium/setup/routing.md",
    frontmatter({
      owner: "appium",
      id: "appium.setup.routing",
      optional_context:
        "contexts/setup/references/node/node-decision-logic.md, contexts/tools/appium/setup/examples/uiautomator2.md",
    }) +
      [
        "# Setup Routing",
        "",
        "Use `contexts/setup/references/node/node-decision-logic.md`.",
        "",
        "```bash",
        "node tools/setup/scripts/check-node-env.mjs",
        "```",
        "",
      ].join("\n"),
  );
  await writeMarkdown(
    root,
    "contexts/setup/references/node/node-decision-logic.md",
    context(
      "appium.setup.references.node.node-decision-logic",
      "Node reference.",
    ),
  );
  await writeMarkdown(
    root,
    "contexts/tools/appium/setup/examples/uiautomator2.md",
    context("appium.setup.examples.uiautomator2", "UiAutomator2 example."),
  );
  await writeFileInRepo(
    root,
    "tools/setup/scripts/check-node-env.mjs",
    "console.log('ok');\n",
  );
  await writeMarkdown(
    root,
    "README.md",
    [
      "# Appium",
      "",
      "Canonical contexts live under `contexts/`.",
      "Helper scripts live under `tools/`.",
      "",
    ].join("\n"),
  );
  await writeMarkdown(
    root,
    "AGENTS.md",
    [
      "# Agent Rules",
      "",
      "Load routed contexts under `contexts/` and helper scripts under `tools/`.",
      "",
    ].join("\n"),
  );

  const result = await scan(root);
  const layoutFindings = result.findings.filter((finding) =>
    isStrictLayoutFinding(finding.id),
  );
  assert.deepEqual(layoutFindings, []);

  const report = await readiness(root);
  assert.equal(report.level, "ready");
  assert.equal(report.score, 100);
  assert.equal(
    report.checks.find((check) => check.id === "layout.disallowed_skill_assets")
      ?.status,
    "pass",
  );
  assert.equal(
    report.checks.find((check) => check.id === "paths.helper_commands")?.status,
    "pass",
  );
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-layout-"));
}

async function writeMarkdown(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await writeFileInRepo(root, relativePath, content);
}

async function writeFileInRepo(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function frontmatter(values: Record<string, string>): string {
  return [
    "---",
    ...Object.entries(values).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
  ].join("\n");
}

function context(id: string, body: string): string {
  return `${frontmatter({ owner: "appium", id })}# ${id}\n\n${body}\n`;
}

function helperCommandDocument(skillDirectory: string): string {
  return [
    "# Helper commands",
    "",
    "```bash",
    "node scripts/existing.mjs",
    "node ./scripts/existing.mjs",
    "node scripts/missing.mjs",
    `node ${skillDirectory}/scripts/existing.mjs`,
    "node tools/shared/existing.mjs",
    "node tools/shared/missing.mjs",
    "node ../scripts/escape.mjs",
    "```",
    "",
  ].join("\n");
}

test("layout aliases do not force valid local support into shared roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-layout-config-"));
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      layout: {
        tool_namespace: "mobile",
        workflow_aliases: {
          "device-setup": "real-device",
        },
      },
    }),
  );
  await writeMarkdown(
    root,
    "skills/device-setup/references/setup.md",
    context("old.device.setup", "Device setup reference."),
  );
  await writeMarkdown(
    root,
    "skills/device-setup/scripts/check-device.mjs",
    "#!/usr/bin/env node\n",
  );

  const result = await scan(root);
  assert.equal(
    result.findings.some(
      (finding) => finding.id === "LAYOUT-DISALLOWED-SKILL-ASSET",
    ),
    false,
  );
  assert.equal(
    result.findings.some((finding) => finding.id === "LAYOUT-HELPER-NON_TOOLS"),
    false,
  );
});

test("appium aliases preserve valid local support", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-layout-appium-"));
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      layout: {
        tool_namespace: "appium",
        workflow_aliases: {
          "appium-troubleshooting": "troubleshooting",
          "xcuitest-real-device-config": "real-device",
        },
      },
    }),
  );
  await writeMarkdown(
    root,
    "skills/appium-troubleshooting/references/session-startup.md",
    context("old.appium.troubleshooting", "Troubleshooting reference."),
  );
  await writeMarkdown(
    root,
    "skills/xcuitest-real-device-config/scripts/check-real-device.mjs",
    "#!/usr/bin/env node\n",
  );

  const result = await scan(root);
  assert.equal(
    result.findings.some(
      (finding) => finding.id === "LAYOUT-DISALLOWED-SKILL-ASSET",
    ),
    false,
  );
  assert.equal(
    result.findings.some((finding) => finding.id === "LAYOUT-HELPER-NON_TOOLS"),
    false,
  );
});

test("readiness markdown includes layout findings as a repair brief", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-layout-markdown-"));
  await writeMarkdown(
    root,
    "skills/setup/SKILL.md",
    [
      "# Appium Setup",
      "",
      "Run the environment check:",
      "",
      "```bash",
      "node skills/setup/scripts/check-node-env.mjs",
      "```",
    ].join("\n"),
  );
  await writeMarkdown(
    root,
    "skills/setup/references/node/node-decision-logic.md",
    context("old.node.reference", "Node decision logic."),
  );
  await writeMarkdown(
    root,
    "skills/setup/scripts/check-node-env.mjs",
    "#!/usr/bin/env node\n",
  );

  const report = await readiness(root);
  const markdown = formatReadiness(report, "markdown");

  assert.match(markdown, /## Findings/);
  assert.match(markdown, /LAYOUT-SKILL-EXECUTABLE-COMMAND/);
  assert.doesNotMatch(markdown, /LAYOUT-DISALLOWED-SKILL-ASSET/);
  assert.doesNotMatch(markdown, /PATH-HELPER-COMMAND-SKILL-SCRIPTS/);
});

function isStrictLayoutFinding(id: string): boolean {
  return (
    id.startsWith("LAYOUT-") ||
    id.startsWith("PATH-HELPER-COMMAND") ||
    id === "DOCS-LAYOUT-INCONSISTENT"
  );
}
