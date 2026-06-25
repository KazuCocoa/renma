import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
      "QUAL-MISSING-REQUIRED-INPUTS",
      "QUAL-MISSING-COMPLETION-CRITERIA",
      "QUAL-MISSING-VERIFICATION",
      "SEC-MISSING-POLICY-METADATA",
      "SEC-DESTRUCTIVE-COMMAND",
    ],
  );
  assert.equal(
    result.findings.find((finding) => finding.id === "SEC-DESTRUCTIVE-COMMAND")
      ?.evidence.path,
    "skills/demo/SKILL.md",
  );
});

test("local support examples are scanned and must be reachable from the skill", async () => {
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
    result.findings.some(
      (finding) => finding.id === "SUPPORT-MISSING-REACHABILITY-GUIDANCE",
    ),
  );
  assert.ok(
    result.findings.some(
      (finding) => finding.id === "SUPPORT-UNREACHABLE-EXAMPLE",
    ),
  );
});

test("reachable local support examples do not report unreachable example findings", async () => {
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

## Local Support Guidance
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
      (finding) => finding.id === "SUPPORT-MISSING-REACHABILITY-GUIDANCE",
    ),
  );
  assert.ok(
    !result.findings.some(
      (finding) => finding.id === "SUPPORT-UNREACHABLE-EXAMPLE",
    ),
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
        startLine: 6,
        endLine: 6,
        snippet:
          "requires_context: demo.guide, testing.boundary-value-analysis",
      },
    },
    {
      from: "demo",
      to: "testing.boundary-value-analysis",
      kind: "requires",
      sourcePath: "skills/demo/SKILL.md",
      evidence: {
        path: "skills/demo/SKILL.md",
        startLine: 6,
        endLine: 6,
        snippet:
          "requires_context: demo.guide, testing.boundary-value-analysis",
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
      "Reference environment setup guidance for relevant requests.\n",
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
  assert.match(prompt.stdout, /Use deterministic inspection helpers/);
  assert.match(prompt.stdout, /renma inspect .* --format json/);
  assert.match(prompt.stdout, /renma inspect .* --lines L10-L42 --format text/);
  assert.match(prompt.stdout, /Name files by meaning, not by part number/);
  assert.match(prompt.stdout, /L0003: macOS\/Linux users/);
  assert.match(prompt.stdout, /Reference environment setup/);
  assert.match(
    prompt.stdout,
    /"usageHint": "when SKILL\.md should reference this file"/,
  );
  assert.match(
    prompt.stdout,
    /"skillGuidanceUpdate": "brief SKILL\.md usage and reference guidance"/,
  );
  assert.doesNotMatch(prompt.stdout, /routingHint|routingUpdate/);

  const json = await withCapturedConsole(() =>
    main(["suggest-semantic-split", source, "--format", "json"]),
  );
  const semanticSplitReviewBundle = JSON.parse(json.stdout) as {
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
  assert.equal(semanticSplitReviewBundle.mode, "codex-semantic-split-prompt");
  assert.equal(semanticSplitReviewBundle.mutatesFiles, false);
  assert.match(
    semanticSplitReviewBundle.helperCommands.outline,
    /renma inspect /,
  );
  assert.equal(
    semanticSplitReviewBundle.source.outline.headings[0]?.text,
    "Android setup",
  );
  assert.ok(
    semanticSplitReviewBundle.context.siblingFiles.some((file) =>
      file.path.endsWith("references/index.md"),
    ),
  );
});

test("CLI inspect command prints compact outlines and exact slices", async () => {
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
    main(["inspect", source, "--format", "json"]),
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
    main(["inspect", source, "--lines", "L8-L9", "--format", "text"]),
  );
  assert.equal(sliceResult.code, 0);
  assert.match(sliceResult.stdout, /L0008: ## Windows/);
  assert.match(sliceResult.stdout, /L0009: Use PowerShell\./);
});

test("help and invalid commands have expected exit codes", async () => {
  const help = await withCapturedConsole(() => main(["--help"]));
  const invalid = await withCapturedConsole(() => main(["wat"]));

  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: renma scan/);
  assert.match(
    help.stdout,
    /scaffold\s+Create deterministic authoring scaffolds and prompts/,
  );
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Unknown command "wat"/);
});

test("scaffold skill writes deterministic file output", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "skills",
    "testing",
    "spec-review",
    "SKILL.md",
  );

  const result = await withCapturedConsole(() =>
    main([
      "scaffold",
      "skill",
      target,
      "--owner",
      "qa-platform",
      "--title",
      "Spec Review",
      "--tags",
      "testing,spec-review,qa",
    ]),
  );

  assert.equal(result.code, 0);
  const content = await readFile(target, "utf8");
  assert.match(content, /^id: testing.spec-review$/m);
  assert.match(content, /^title: Spec Review$/m);
  assert.match(content, /^owner: qa-platform$/m);
  assert.match(content, /^status: experimental$/m);
  assert.match(content, /^tags:\n {2}- testing\n {2}- spec-review\n {2}- qa$/m);
  assert.match(content, /^requires_context:$/m);
  assert.match(content, /^## Purpose$/m);
  assert.match(content, /^## Required Inputs$/m);
  assert.match(content, /^## Context References$/m);
  assert.match(content, /^## Constraints$/m);
  assert.match(content, /Do not choose runtime task context/);
  assert.match(content, /Do not assemble prompts for live model calls/);
  assert.doesNotMatch(content, /Renma can verify/);

  const catalogResult = await withCapturedConsole(() =>
    main(["catalog", root, "--format", "json"]),
  );
  assert.equal(catalogResult.code, 0);
  const catalog = JSON.parse(catalogResult.stdout) as {
    catalog: { entries: Array<{ id: string; metadata: { tags: string[] } }> };
  };
  assert.deepEqual(catalog.catalog.entries[0]?.metadata.tags, [
    "testing",
    "spec-review",
    "qa",
  ]);
});

test("scaffold refuses to overwrite an existing file", async () => {
  const root = await fixture();
  const target = path.join(root, "contexts", "testing", "boundary.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "already here");

  const result = await withCapturedConsole(() =>
    main(["scaffold", "context", target, "--owner", "qa-platform"]),
  );

  assert.equal(result.code, 2);
  assert.match(result.stderr, /EEXIST/);
});

test("scaffold file mode requires owner", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "skills",
    "testing",
    "missing-owner",
    "SKILL.md",
  );

  const result = await withCapturedConsole(() =>
    main(["scaffold", "skill", target]),
  );

  assert.equal(result.code, 2);
  assert.match(result.stderr, /requires --owner/);
});

test("scaffold context can emit json", async () => {
  const result = await withCapturedConsole(() =>
    main([
      "scaffold",
      "context",
      "contexts/testing/boundary-value-analysis.md",
      "--format",
      "json",
      "--owner",
      "qa-platform",
    ]),
  );

  assert.equal(result.code, 0);
  const bundle = JSON.parse(result.stdout) as {
    kind: string;
    id: string;
    title: string;
    owner: string;
    content: string;
  };
  assert.equal(bundle.kind, "context");
  assert.equal(bundle.id, "context.testing.boundary-value-analysis");
  assert.equal(bundle.title, "Boundary Value Analysis");
  assert.equal(bundle.owner, "qa-platform");
  assert.match(
    bundle.content,
    /^id: context\.testing\.boundary-value-analysis$/m,
  );
  assert.match(bundle.content, /^## Summary$/m);
  assert.match(bundle.content, /^## Scope$/m);
  assert.match(bundle.content, /^## Guidance$/m);
  assert.match(bundle.content, /^## Constraints$/m);
  assert.match(
    bundle.content,
    /Do not duplicate large source material when a reference is enough/,
  );
  assert.doesNotMatch(bundle.content, /^## Applies To$/m);
});

test("scaffold prompt emits Codex-ready authoring instructions", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "skills",
    "testing",
    "spec-review",
    "SKILL.md",
  );
  const result = await withCapturedConsole(() =>
    main([
      "scaffold",
      "skill",
      target,
      "--format",
      "prompt",
      "--owner",
      "qa-platform",
    ]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Create a Renma skill asset/);
  assert.match(result.stdout, /id: `testing.spec-review`/);
  assert.match(
    result.stdout,
    /Move durable domain, testing, platform, product, or tool knowledge/,
  );
  assert.match(result.stdout, /Do not choose runtime task context/);
  assert.match(result.stdout, /Do not assemble prompts for live model calls/);
  assert.match(result.stdout, /Do not call external services/);
  assert.match(
    result.stdout,
    /renma graph \. --focus testing\.spec-review --format mermaid/,
  );
  assert.doesNotMatch(result.stdout, /does\.not\.exist/);
  assert.match(result.stdout, /Do not invent owners/);
  await assert.rejects(readFile(target, "utf8"));
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
