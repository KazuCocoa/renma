import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { scan } from "../src/scanner.js";

test("scan discovers default artifacts and emits deterministic findings", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    "# Demo\n\nRun `rm -rf /tmp/demo`.\n",
  );

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.deepEqual(
    result.findings.map((finding) => finding.id),
    [
      "QUAL-MISSING-DESCRIPTION",
      "QUAL-MISSING-NEGATIVE-ROUTING",
      "QUAL-MISSING-ROUTING-CLARITY",
      "QUAL-MISSING-EXAMPLES",
      "QUAL-MISSING-PREFLIGHT",
      "QUAL-MISSING-VERIFICATION",
      "SEC-DESTRUCTIVE-COMMAND",
    ],
  );
  assert.equal(result.findings.at(-1)?.evidence.path, "skills/demo/SKILL.md");
});

test("context examples are scanned and must be routed by the skill", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo", "examples"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    `---
name: "demo"
description: "Use this skill for demo tasks when a short deterministic fixture needs verification, routing clarity, examples, preflight checks, and safety confirmation."
---
# Demo

## Do Not Use For
Do not use for production work.

## Instructions
1. First capture preflight context.
2. Verify the result with a test.

## Examples
Demo input -> demo output.
`,
  );
  await writeFile(
    path.join(root, "skills", "demo", "examples", "happy-path.md"),
    "# Happy Path\n\nInput -> output.\n",
  );

  const result = await scan(root);

  assert.ok(
    result.findings.some((finding) => finding.id === "CTX-MISSING-ROUTING-MAP"),
  );
  assert.ok(
    result.findings.some((finding) => finding.id === "CTX-UNUSED-EXAMPLE"),
  );
});

test("routed context examples do not report unused example findings", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo", "examples"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    `---
name: "demo"
description: "Use this skill for demo tasks when a short deterministic fixture needs verification, routing clarity, examples, preflight checks, and safety confirmation."
---
# Demo

## Context Selection
- For the happy path, load examples/happy-path.md.

## Do Not Use For
Do not use for production work.

## Instructions
1. First capture preflight context.
2. Verify the result with a test.

## Examples
Demo input -> demo output.
`,
  );
  await writeFile(
    path.join(root, "skills", "demo", "examples", "happy-path.md"),
    "# Happy Path\n\nInput -> output.\n",
  );

  const result = await scan(root);

  assert.ok(
    !result.findings.some(
      (finding) => finding.id === "CTX-MISSING-ROUTING-MAP",
    ),
  );
  assert.ok(
    !result.findings.some((finding) => finding.id === "CTX-UNUSED-EXAMPLE"),
  );
});

test("config loads fail_on and CLI override takes precedence", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({ fail_on: "critical", format: "json" }),
  );
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    '# Demo\n\npassword = "supersecretvalue"\n',
  );

  const fromConfig = await scan(root);
  const fromCli = await scan(root, { failOn: "medium" });

  assert.equal(fromConfig.exitThreshold, "critical");
  assert.equal(fromConfig.format, "json");
  assert.equal(fromCli.exitThreshold, "medium");
  assert.equal(fromConfig.configPath, "renma.config.json");
});

test("CLI honors format from config", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({ format: "json" }),
  );

  const exitCode = await withCapturedConsole(() => main(["scan", root]));
  const report = JSON.parse(exitCode.stdout) as { format: string };

  assert.equal(exitCode.code, 0);
  assert.equal(report.format, "json");
});

test("invalid config field is a usage error in CLI", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, ".renma.json"),
    JSON.stringify({ failOn: "high" }),
  );

  const exitCode = await withCapturedConsole(() => main(["scan", root]));

  assert.equal(exitCode.code, 2);
  assert.match(exitCode.stderr, /Unknown config field "failOn"/);
});

test("CLI reports JSON and fail-on exit code", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    '# Demo\n\napi_key = "abcd1234abcd1234"\n',
  );

  const exitCode = await withCapturedConsole(() =>
    main(["scan", root, "--json", "--fail-on", "high"]),
  );
  const report = JSON.parse(exitCode.stdout) as {
    findings: Array<{ id: string }>;
  };

  assert.equal(exitCode.code, 1);
  assert.ok(
    report.findings.some((finding) => finding.id === "SEC-LITERAL-SECRET"),
  );
});

test("CLI prints catalog JSON and markdown", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo", "references"), {
    recursive: true,
  });
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    [
      "---",
      "id: demo",
      "owner: qa-platform",
      "status: stable",
      "tags: appium, android",
      "requires_context: demo.guide, testing.boundary-value-analysis",
      "---",
      "# Demo",
      "Use for demo requests.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "skills", "demo", "references", "guide.md"),
    "---\nid: demo.guide\nowner: qa-platform\n---\n# Guide\n",
  );
  await writeFile(
    path.join(root, "contexts", "testing", "boundary-value-analysis.md"),
    "---\nid: testing.boundary-value-analysis\nowner: qa-platform\nstatus: stable\n---\n# Boundary Value Analysis\n",
  );

  const json = await withCapturedConsole(() => main(["catalog", root]));
  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout) as {
    catalog: {
    assets: Array<{ id: string; kind: string; contentHash: string }>;
      dependencies: Array<{ from: string; to: string; kind: string }>;
    };
  };
  assert.deepEqual(
    report.catalog.assets.map((asset) => asset.id),
    ["demo", "testing.boundary-value-analysis", "demo.guide"],
  );
  assert.deepEqual(
    report.catalog.assets.map((asset) => asset.kind),
    ["skill", "context", "reference"],
  );
  assert.match(report.catalog.assets[0]?.contentHash ?? "", /^sha256:/);
  assert.deepEqual(report.catalog.dependencies, [
    {
      from: "demo",
      to: "demo.guide",
      kind: "requires",
      sourcePath: "skills/demo/SKILL.md",
      evidence: {
        path: "skills/demo/SKILL.md",
        startLine: 1,
        endLine: 1,
        snippet: "frontmatter dependency metadata",
      },
    },
    {
      from: "demo",
      to: "testing.boundary-value-analysis",
      kind: "requires",
      sourcePath: "skills/demo/SKILL.md",
      evidence: {
        path: "skills/demo/SKILL.md",
        startLine: 1,
        endLine: 1,
        snippet: "frontmatter dependency metadata",
      },
    },
  ]);

  const markdown = await withCapturedConsole(() =>
    main(["catalog", root, "--format", "markdown"]),
  );
  assert.equal(markdown.code, 0);
  assert.match(markdown.stdout, /# Renma Catalog/);
  assert.match(markdown.stdout, /### demo/);
  assert.match(markdown.stdout, /Dependencies: requires:demo\.guide/);
  assert.match(markdown.stdout, /Dependents: requires:demo/);
});

test("CLI prints a Codex semantic split prompt", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "setup");
  const referencesDir = path.join(skillDir, "references");
  await mkdir(referencesDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---\n",
      'name: "setup"\n',
      "---\n",
      "# Setup\n",
      "Route environment setup requests to the relevant reference.\n",
    ].join(""),
  );
  await writeFile(
    path.join(referencesDir, "index.md"),
    "# References\n\n- Android setup\n",
  );

  const source = path.join(referencesDir, "environment-setup-android.md");
  await writeFile(
    source,
    [
      "# Android setup\n",
      "\n",
      "macOS/Linux users should export ANDROID_HOME from a shell.\n",
      "\n",
      "Windows users should set persistent environment variables in PowerShell.\n",
    ].join(""),
  );

  const prompt = await withCapturedConsole(() =>
    main(["suggest-semantic-split", source]),
  );
  assert.equal(prompt.code, 0);
  assert.match(prompt.stdout, /# Codex Task: Suggest Semantic Reference Split/);
  assert.match(
    prompt.stdout,
    /Infer the best split direction as a human maintainer/,
  );
  assert.match(prompt.stdout, /Use deterministic context helpers/);
  assert.match(prompt.stdout, /renma context .* --format json/);
  assert.match(prompt.stdout, /renma context .* --lines L10-L42 --format text/);
  assert.match(prompt.stdout, /Name files by meaning, not by part number/);
  assert.match(prompt.stdout, /L0003: macOS\/Linux users/);
  assert.match(prompt.stdout, /Route environment setup/);

  const json = await withCapturedConsole(() =>
    main(["suggest-semantic-split", source, "--format", "json"]),
  );
  const contextPackage = JSON.parse(json.stdout) as {
    context: {
      siblingFiles: Array<{ path: string }>;
    };
    helperCommands: {
      outline: string;
      sliceExample: string;
    };
    mode: string;
    mutatesFiles: boolean;
    source: {
      outline: {
        headings: Array<{ range: string; text: string }>;
      };
    };
  };
  assert.equal(json.code, 0);
  assert.equal(contextPackage.mode, "codex-semantic-split-prompt");
  assert.equal(contextPackage.mutatesFiles, false);
  assert.match(contextPackage.helperCommands.outline, /renma context /);
  assert.equal(
    contextPackage.source.outline.headings[0]?.text,
    "Android setup",
  );
  assert.ok(
    contextPackage.context.siblingFiles.some((file) =>
      file.path.endsWith("references/index.md"),
    ),
  );
});

test("CLI context command prints compact outlines and exact slices", async () => {
  const root = await fixture();
  const source = path.join(root, "guide.md");
  await writeFile(
    source,
    [
      "---\n",
      "name: guide\n",
      "---\n",
      "# Guide\n",
      "\n",
      "Shared setup note.\n",
      "\n",
      "## Windows\n",
      "Use PowerShell.\n",
      "\n",
      "```powershell\n",
      "$env:ANDROID_HOME\n",
      "```\n",
      "\n",
      "## macOS/Linux\n",
      "Use a shell export.\n",
    ].join(""),
  );

  const outlineResult = await withCapturedConsole(() =>
    main(["context", source, "--format", "json"]),
  );
  assert.equal(outlineResult.code, 0);
  const outline = JSON.parse(outlineResult.stdout) as {
    codeFences: Array<{ range: string }>;
    frontmatterRange: string;
    headings: Array<{ range: string; text: string }>;
  };
  assert.equal(outline.frontmatterRange, "L1-L3");
  assert.deepEqual(
    outline.headings.map((heading) => heading.text),
    ["Guide", "Windows", "macOS/Linux"],
  );
  assert.equal(outline.codeFences[0]?.range, "L11-L13");

  const sliceResult = await withCapturedConsole(() =>
    main(["context", source, "--lines", "L8-L9", "--format", "text"]),
  );
  assert.equal(sliceResult.code, 0);
  assert.match(sliceResult.stdout, /L0008: ## Windows/);
  assert.match(sliceResult.stdout, /L0009: Use PowerShell\./);
});

test("help and invalid commands have expected exit codes", async () => {
  const help = await withCapturedConsole(() => main(["--help"]));
  const invalid = await withCapturedConsole(() => main(["inspect"]));

  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: renma scan/);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Unknown command "inspect"/);
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-"));
}

async function withCapturedConsole(
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
