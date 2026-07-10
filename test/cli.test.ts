import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { COMMAND_HELP } from "../src/cli-help.js";
import { CONTEXT_LENS_DIAGNOSTIC_CODES } from "../src/context-lens.js";
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
  assert.equal(result.securityPolicyInventory?.totalPolicyAssets, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 1);
  assert.equal(result.securityPolicyInventory?.assetsWithPolicyMetadata, 0);
  assert.equal(result.securityPolicyInventory?.assetsMissingPolicyMetadata, 1);
});

test("scan discovers skills/demo/skill.md entrypoint as a skill", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(path.join(root, "skills", "demo", "skill.md"), "# Demo\n");

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 1);
  assert.deepEqual(
    result.securityPolicyInventory?.missingPolicyAssets.map((asset) => [
      asset.path,
      asset.kind,
    ]),
    [["skills/demo/skill.md", "skill"]],
  );
  assert.equal(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "LAYOUT-SKILL-LIKE-FILE-OUTSIDE-SKILLS-DIR",
    ),
    false,
  );
});

test("scan discovers skills/demo/foo.skill.md entrypoint as a skill", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "foo.skill.md"),
    "# Demo\n",
  );

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 1);
  assert.deepEqual(
    result.securityPolicyInventory?.missingPolicyAssets.map((asset) => [
      asset.path,
      asset.kind,
    ]),
    [["skills/demo/foo.skill.md", "skill"]],
  );
});

test(".agents/skills entrypoints are classified as skills before generic agent docs", async () => {
  const root = await fixture();
  await mkdir(path.join(root, ".agents", "skills", "demo"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, ".agents", "skills", "demo", "SKILL.md"),
    "# Demo\n",
  );

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.agent, 0);
  assert.deepEqual(
    result.securityPolicyInventory?.missingPolicyAssets.map((asset) => [
      asset.path,
      asset.kind,
    ]),
    [[".agents/skills/demo/SKILL.md", "skill"]],
  );
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.id === "SEC-MISSING-POLICY-METADATA" &&
        finding.evidence.path === ".agents/skills/demo/SKILL.md",
    ),
  );
});

test("reserved skill-local support directories remain support paths, not skill names", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo", "examples"), {
    recursive: true,
  });
  await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "# Demo\n");
  await writeFile(
    path.join(root, "skills", "demo", "examples", "happy-path.md"),
    "# Happy Path\n\nInput -> output.\n",
  );

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 2);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.example, 1);
  assert.equal(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        "LAYOUT-SKILL-ENTRYPOINT-UNDER-RESERVED-SUPPORT-DIR",
    ),
    false,
  );
});

test("reserved support directory names are not classified as skills", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "examples"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "examples", "SKILL.md"),
    "# Example support note\n",
  );

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 0);
  assert.equal(result.securityPolicyInventory?.assetKinds.example, 1);
  assert.equal(result.securityPolicyInventory?.missingPolicyAssets.length, 0);

  const diagnostic = result.diagnostics.find(
    (item) =>
      item.code === "LAYOUT-SKILL-ENTRYPOINT-UNDER-RESERVED-SUPPORT-DIR" &&
      item.path === "skills/examples/SKILL.md",
  );
  assert.equal(diagnostic?.severity, "info");
  assert.match(
    diagnostic?.message ?? "",
    /path segment "examples" is reserved for skill-local support files/,
  );
  assert.match(
    diagnostic?.message ?? "",
    /Rename the skill directory if this file is intended to define a Renma skill/,
  );
  assert.match(
    diagnostic?.llmHint ?? "",
    /use `skills\/example-review\/SKILL\.md` instead of `skills\/examples\/SKILL\.md`/,
  );
  assert.equal(
    result.diagnostics.some(
      (item) =>
        item.code === "LAYOUT-SKILL-LIKE-FILE-OUTSIDE-SKILLS-DIR" &&
        item.path === "skills/examples/SKILL.md",
    ),
    false,
  );

  const diagnosticV2 = result.diagnosticsV2.find(
    (item) =>
      item.code === "LAYOUT-SKILL-ENTRYPOINT-UNDER-RESERVED-SUPPORT-DIR" &&
      item.location?.path === "skills/examples/SKILL.md",
  );
  assert.ok(diagnosticV2);
  assert.equal(
    Object.hasOwn(diagnosticV2, "repairPolicy"),
    false,
    "reserved support directory guidance must not require preserve-semantics repair",
  );
  assert.equal(diagnosticV2?.repairConstraints, undefined);
  assert.equal(diagnosticV2?.verificationSteps, undefined);
});

test("reserved support directory guidance applies under .agents/skills", async () => {
  const root = await fixture();
  await mkdir(path.join(root, ".agents", "skills", "examples"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, ".agents", "skills", "examples", "SKILL.md"),
    "# Example support note\n",
  );

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 0);
  assert.equal(result.securityPolicyInventory?.assetKinds.agent, 0);
  assert.equal(result.securityPolicyInventory?.assetKinds.example, 1);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
          "LAYOUT-SKILL-ENTRYPOINT-UNDER-RESERVED-SUPPORT-DIR" &&
        diagnostic.path === ".agents/skills/examples/SKILL.md" &&
        /path segment "examples" is reserved/.test(diagnostic.message),
    ),
  );
});

test("top-level skill-like files are layout guidance only, not skill assets", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "skill.md"), "# Skill note\n");
  await writeFile(path.join(root, "SKILL.md"), "# Upper skill note\n");
  await writeFile(path.join(root, "foo.skill.md"), "# Named skill note\n");

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 0);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 0);
  assert.equal(result.findings.length, 0);
  const guidanceDiagnostics = result.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "LAYOUT-SKILL-LIKE-FILE-OUTSIDE-SKILLS-DIR",
  );
  assert.deepEqual(
    guidanceDiagnostics.map((diagnostic) => [
      diagnostic.severity,
      diagnostic.path,
    ]),
    [
      ["info", "foo.skill.md"],
      ["info", "skill.md"],
      ["info", "SKILL.md"],
    ],
  );
  const skillMdDiagnostic = guidanceDiagnostics.find(
    (diagnostic) => diagnostic.path === "skill.md",
  );
  assert.match(
    skillMdDiagnostic?.message ?? "",
    /Renma only treats files under skills\/\*\* or \.agents\/skills\/\*\*/,
  );
  assert.match(
    skillMdDiagnostic?.llmHint ?? "",
    /No action is required unless this file is intended to be a Renma skill/,
  );
  const skillMdV2 = result.diagnosticsV2.find(
    (diagnostic) =>
      diagnostic.code === "LAYOUT-SKILL-LIKE-FILE-OUTSIDE-SKILLS-DIR" &&
      diagnostic.location?.path === "skill.md",
  );
  assert.ok(skillMdV2);
  assert.equal(
    Object.hasOwn(skillMdV2, "repairPolicy"),
    false,
    "guidance-only diagnostics must not require preserve-semantics repair",
  );
  assert.equal(skillMdV2?.repairConstraints, undefined);
  assert.equal(skillMdV2?.verificationSteps, undefined);
});

test("skill-like files outside explicit skill directories are not classified as skills", async () => {
  const root = await fixture();
  await mkdir(path.join(root, ".agents"), { recursive: true });
  await writeFile(path.join(root, ".agents", "foo.skill.md"), "# Agent note\n");

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 0);
  assert.equal(result.securityPolicyInventory?.assetKinds.agent, 1);
  assert.equal(result.securityPolicyInventory?.missingPolicyAssets.length, 0);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "LAYOUT-SKILL-LIKE-FILE-OUTSIDE-SKILLS-DIR" &&
        diagnostic.severity === "info" &&
        diagnostic.path === ".agents/foo.skill.md",
    ),
  );
});

test("scan does not select a skill root when neither explicit skill directory nor scanned artifacts exist", async () => {
  const root = await fixture();

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 0);
  assert.equal(
    result.diagnostics.some((diagnostic) =>
      diagnostic.code?.startsWith("LAYOUT-SKILL-LIKE"),
    ),
    false,
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

test("config suppressions remove findings without skipping scanned files", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      fail_on: "high",
      format: "json",
      suppressions: [
        {
          id: "SEC-LITERAL-SECRET",
          paths: ["skills/demo/**"],
          reason: "Fixture intentionally includes a fake secret.",
          expires: "2999-12-31",
        },
      ],
    }),
  );
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    '# Demo\n\napi_key = "abcd1234abcd1234"\n',
  );

  const exitCode = await withCapturedConsole(() => main(["scan", root]));
  const report = JSON.parse(exitCode.stdout) as {
    scannedFileCount: number;
    findings: Array<{ id: string }>;
  };
  const secretFinding = report.findings.find(
    (finding) => finding.id === "SEC-LITERAL-SECRET",
  );

  assert.equal(exitCode.code, 0);
  assert.equal(report.scannedFileCount, 1);
  assert.equal(secretFinding, undefined);
});

test("config suppressions require both matching id and path", async () => {
  const cases = [
    {
      name: "same id non-matching path",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/other/**"],
        reason: "Does not apply to demo.",
      },
      expectedCode: 1,
      present: true,
    },
    {
      name: "matching path different id",
      suppression: {
        id: "SEC-DESTRUCTIVE-COMMAND",
        paths: ["skills/demo/**"],
        reason: "Does not apply to literal secrets.",
      },
      expectedCode: 1,
      present: true,
    },
    {
      name: "matching id and path",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Fixture intentionally includes a fake secret.",
      },
      expectedCode: 0,
      present: false,
    },
  ];

  for (const item of cases) {
    const root = await fixture();
    await mkdir(path.join(root, "skills", "demo"), { recursive: true });
    await writeFile(
      path.join(root, "renma.config.json"),
      JSON.stringify({
        fail_on: "high",
        format: "json",
        suppressions: [item.suppression],
      }),
    );
    await writeFile(
      path.join(root, "skills", "demo", "SKILL.md"),
      '# Demo\n\napi_key = "abcd1234abcd1234"\n',
    );

    const exitCode = await withCapturedConsole(() => main(["scan", root]));
    const report = JSON.parse(exitCode.stdout) as {
      findings: Array<{ id: string }>;
    };
    const secretFinding = report.findings.find(
      (finding) => finding.id === "SEC-LITERAL-SECRET",
    );

    assert.equal(exitCode.code, item.expectedCode, item.name);
    assert.equal(secretFinding !== undefined, item.present, item.name);
  }
});

test("expired config suppressions do not suppress findings", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      fail_on: "high",
      format: "json",
      suppressions: [
        {
          id: "SEC-LITERAL-SECRET",
          paths: ["skills/demo/**"],
          reason: "Fixture intentionally includes a fake secret.",
          expires: "2000-01-01",
        },
      ],
    }),
  );
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    '# Demo\n\napi_key = "abcd1234abcd1234"\n',
  );

  const exitCode = await withCapturedConsole(() => main(["scan", root]));
  const report = JSON.parse(exitCode.stdout) as {
    diagnostics: Array<{ severity: string; message: string }>;
    findings: Array<{ id: string }>;
  };
  const secretFinding = report.findings.find(
    (finding) => finding.id === "SEC-LITERAL-SECRET",
  );

  assert.equal(exitCode.code, 1);
  assert.ok(secretFinding);
  assert.ok(
    report.diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "warning" &&
        /Suppression for SEC-LITERAL-SECRET expired on 2000-01-01/.test(
          diagnostic.message,
        ),
    ),
  );
});

test('config suppressions with expires "never" do not expire', async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      fail_on: "high",
      format: "json",
      suppressions: [
        {
          id: "SEC-LITERAL-SECRET",
          paths: ["skills/demo/**"],
          reason: "Permanent fixture exception.",
          expires: "never",
        },
      ],
    }),
  );
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    '# Demo\n\napi_key = "abcd1234abcd1234"\n',
  );

  const exitCode = await withCapturedConsole(() => main(["scan", root]));
  const report = JSON.parse(exitCode.stdout) as {
    diagnostics: Array<{ message: string }>;
    findings: Array<{ id: string }>;
  };
  const secretFinding = report.findings.find(
    (finding) => finding.id === "SEC-LITERAL-SECRET",
  );

  assert.equal(exitCode.code, 0);
  assert.equal(secretFinding, undefined);
  assert.ok(
    !report.diagnostics.some((diagnostic) =>
      /Suppression for SEC-LITERAL-SECRET expired/.test(diagnostic.message),
    ),
  );
});

test("config suppressions require an audit reason", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      suppressions: [{ id: "SEC-LITERAL-SECRET", paths: ["skills/demo/**"] }],
    }),
  );

  const exitCode = await withCapturedConsole(() => main(["scan", root]));

  assert.equal(exitCode.code, 2);
  assert.match(exitCode.stderr, /suppressions\[0\]\.reason/);
});

test("invalid suppression configs are rejected", async () => {
  const cases = [
    {
      name: "empty paths",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: [],
        reason: "Needs a scoped path.",
      },
      pattern: /suppressions\[0\]\.paths/,
    },
    {
      name: "missing paths",
      suppression: { id: "SEC-LITERAL-SECRET", reason: "Needs paths." },
      pattern: /suppressions\[0\]\.paths/,
    },
    {
      name: "missing id",
      suppression: { paths: ["skills/demo/**"], reason: "Needs id." },
      pattern: /suppressions\[0\]\.id/,
    },
    {
      name: "empty reason",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "",
      },
      pattern: /suppressions\[0\]\.reason/,
    },
    {
      name: "unknown key",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "No extra keys.",
        ticket: "SEC-123",
      },
      pattern: /Unknown suppression config key "ticket"/,
    },
    {
      name: "invalid expires",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Bad expires.",
        expires: "forever",
      },
      pattern: /suppressions\[0\]\.expires/,
    },
    {
      name: "none expires",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Bad expires.",
        expires: "none",
      },
      pattern: /suppressions\[0\]\.expires/,
    },
    {
      name: "empty expires",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Bad expires.",
        expires: "",
      },
      pattern: /suppressions\[0\]\.expires/,
    },
    {
      name: "null expires",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Bad expires.",
        expires: null,
      },
      pattern: /suppressions\[0\]\.expires/,
    },
    {
      name: "non-string expires",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Bad expires.",
        expires: 20260930,
      },
      pattern: /suppressions\[0\]\.expires/,
    },
    {
      name: "invalid calendar date",
      suppression: {
        id: "SEC-LITERAL-SECRET",
        paths: ["skills/demo/**"],
        reason: "Bad date.",
        expires: "2026-02-30",
      },
      pattern: /suppressions\[0\]\.expires must be a valid date/,
    },
  ];

  for (const item of cases) {
    const root = await fixture();
    await writeFile(
      path.join(root, "renma.config.json"),
      JSON.stringify({ suppressions: [item.suppression] }),
    );

    const exitCode = await withCapturedConsole(() => main(["scan", root]));

    assert.equal(exitCode.code, 2, item.name);
    assert.match(exitCode.stderr, item.pattern, item.name);
  }
});

test("scan output omits suppressed findings", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      fail_on: "high",
      suppressions: [
        {
          id: "SEC-LITERAL-SECRET",
          paths: ["skills/demo/**"],
          reason: "Fixture intentionally includes a fake secret.",
          expires: "2026-09-30",
        },
      ],
    }),
  );
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    '# Demo\n\napi_key = "abcd1234abcd1234"\n',
  );

  const json = await withCapturedConsole(() => main(["scan", root, "--json"]));
  const report = JSON.parse(json.stdout) as {
    findings: Array<{ id: string }>;
  };
  const secretFinding = report.findings.find(
    (finding) => finding.id === "SEC-LITERAL-SECRET",
  );

  assert.equal(json.code, 0);
  assert.equal(secretFinding, undefined);

  const text = await withCapturedConsole(() => main(["scan", root]));

  assert.equal(text.code, 0);
  assert.doesNotMatch(text.stdout, /SEC-LITERAL-SECRET/);
  assert.doesNotMatch(
    text.stdout,
    /Fixture intentionally includes a fake secret/,
  );
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
      "last_reviewed_at: 2026-06-28",
      "review_cycle: P90D",
      "expires_at: 2026-12-31",
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
      assets: Array<{
        id: string;
        kind: string;
        contentHash: string;
        metadata: {
          lastReviewedAt?: string;
          reviewCycle?: string;
          expiresAt?: string;
        };
      }>;
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
  assert.deepEqual(report.catalog.assets[0]?.metadata, {
    id: "demo",
    owner: "qa-platform",
    status: "stable",
    lastReviewedAt: "2026-06-28",
    reviewCycle: "P90D",
    expiresAt: "2026-12-31",
    tags: ["appium", "android"],
    whenToUse: [],
    whenNotToUse: [],
    requiresContext: ["demo.guide", "testing.boundary-value-analysis"],
    optionalContext: [],
    conflicts: [],
    supersededBy: [],
  });
  assert.deepEqual(report.catalog.dependencies, [
    {
      from: "demo",
      to: "demo.guide",
      kind: "requires",
      sourcePath: "skills/demo/SKILL.md",
      evidence: {
        path: "skills/demo/SKILL.md",
        startLine: 9,
        endLine: 9,
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
        startLine: 9,
        endLine: 9,
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
  assert.match(markdown.stdout, /Last reviewed: 2026-06-28/);
  assert.match(markdown.stdout, /Review cycle: P90D/);
  assert.match(markdown.stdout, /Expires: 2026-12-31/);
  assert.match(markdown.stdout, /Dependencies: requires:demo\.guide/);
  assert.match(markdown.stdout, /Dependents: requires:demo/);
});

test("CLI catalog includes blocking Context Lens diagnostics", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "testing", "boundary-value-analysis.md"),
    [
      "---",
      "id: context.testing.boundary-value-analysis",
      "owner: qa-platform",
      "status: stable",
      "---",
      "# Boundary Value Analysis",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "lenses", "testing", "spec-review.md"),
    [
      "---",
      "id: lens.testing.spec-review",
      "owner: qa-platform",
      "status: experimental",
      "applies_to:",
      "  - context.testing.boundary-value-analysis",
      "---",
      "# Spec Review Lens",
      "",
      "Review boundary context for ambiguity.",
      "",
    ].join("\n"),
  );

  const json = await withCapturedConsole(() =>
    main(["catalog", root, "--json"]),
  );
  const report = JSON.parse(json.stdout) as {
    contextLens: { invalidLensCount: number };
    diagnostics: Array<{ code?: string; severity: string }>;
  };

  assert.equal(json.code, 1);
  assert.equal(report.contextLens.invalidLensCount, 1);
  assert.ok(
    report.diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        diagnostic.code ===
          CONTEXT_LENS_DIAGNOSTIC_CODES.MISSING_REQUIRED_FIELD,
    ),
  );

  const markdown = await withCapturedConsole(() =>
    main(["catalog", root, "--format", "markdown"]),
  );
  assert.equal(markdown.code, 1);
  assert.match(
    markdown.stdout,
    /Context lens definition is missing required field "purpose"/,
  );
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

test("CLI inspect command prints context lens metadata and relationships", async () => {
  const root = await fixture();
  const lens = path.join(
    root,
    "lenses",
    "testing",
    "spec-review-boundary-values.md",
  );
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await mkdir(path.dirname(lens), { recursive: true });
  await mkdir(path.join(root, "skills", "testing", "spec-review"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", "testing", "exploratory"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "contexts", "testing", "boundary-value-analysis.md"),
    `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
when_to_use:
  - Designing tests around numeric, date, quantity, or limit boundaries
when_not_to_use:
  - Exploratory notes unrelated to limits
---
# Boundary Value Analysis
`,
  );
  await writeFile(
    lens,
    `---
id: lens.testing.spec-review.boundary-values
type: context_lens
title: Spec Review Boundary Values Lens
owner: qa-platform
status: experimental
tags:
  - testing
  - spec-review
purpose: spec_review
applies_to:
  - contexts/testing/boundary-value-analysis.md
focus:
  - ambiguity
  - missing boundary
expected_outputs:
  - unresolved questions
  - risk notes
---
# Spec Review Boundary Values Lens
`,
  );
  await writeFile(
    path.join(root, "skills", "testing", "spec-review", "SKILL.md"),
    `---
id: skill.testing.spec-review
owner: qa-platform
status: experimental
requires_lens:
  - lenses/testing/spec-review-boundary-values.md
---
# Spec Review
`,
  );
  await writeFile(
    path.join(root, "skills", "testing", "exploratory", "SKILL.md"),
    `---
id: skill.testing.exploratory
owner: qa-platform
status: experimental
optional_lens:
  - lens.testing.spec-review.boundary-values
---
# Exploratory Review
`,
  );

  const result = await withCapturedConsole(() =>
    main(["inspect", lens, "--format", "text"]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Kind: context_lens/);
  assert.match(result.stdout, /Context Lens:/);
  assert.match(result.stdout, /Detected: yes/);
  assert.match(result.stdout, /Lenses: 1\/1 valid \(0 invalid\)/);
  assert.match(result.stdout, /Representative diagnostic: \(none\)/);
  assert.match(
    result.stdout,
    /Definition paths: lenses\/testing\/spec-review-boundary-values\.md/,
  );
  assert.match(result.stdout, /Purpose: spec_review/);
  assert.match(
    result.stdout,
    /Applies to: contexts\/testing\/boundary-value-analysis\.md/,
  );
  assert.match(result.stdout, /Focus: ambiguity, missing boundary/);
  assert.match(
    result.stdout,
    /Expected outputs: unresolved questions, risk notes/,
  );
  assert.match(
    result.stdout,
    /skill\.testing\.spec-review requires_lens -> lenses\/testing\/spec-review-boundary-values\.md/,
  );
  assert.match(
    result.stdout,
    /skill\.testing\.exploratory optional_lens -> lens\.testing\.spec-review\.boundary-values/,
  );
  assert.match(
    result.stdout,
    /lens\.testing\.spec-review\.boundary-values applies_to -> contexts\/testing\/boundary-value-analysis\.md/,
  );
  assert.match(
    result.stdout,
    /skill\.testing\.spec-review -> lens\.testing\.spec-review\.boundary-values -> context\.testing\.boundary-value-analysis/,
  );

  const jsonResult = await withCapturedConsole(() =>
    main(["inspect", lens, "--format", "json"]),
  );
  assert.equal(jsonResult.code, 0);
  const outline = JSON.parse(jsonResult.stdout) as {
    contextLens: {
      detected: boolean;
      totalLensCount: number;
      validLensCount: number;
      invalidLensCount: number;
      diagnosticCounts: { error: number; warning: number; info: number };
      definitionPaths: string[];
    };
    asset: {
      inboundDependents: Array<{
        from: string;
        kind: string;
        resolved: boolean;
        sourcePath: string;
        targetId?: string;
        targetKind?: string;
        targetPath?: string;
        to: string;
      }>;
    } | null;
  };
  assert.equal(outline.contextLens.detected, true);
  assert.equal(outline.contextLens.totalLensCount, 1);
  assert.equal(outline.contextLens.validLensCount, 1);
  assert.equal(outline.contextLens.invalidLensCount, 0);
  assert.deepEqual(outline.contextLens.diagnosticCounts, {
    error: 0,
    warning: 0,
    info: 0,
  });
  assert.deepEqual(outline.contextLens.definitionPaths, [
    "lenses/testing/spec-review-boundary-values.md",
  ]);
  const pathBasedLensReference = outline.asset?.inboundDependents.find(
    (relationship) => relationship.from === "skill.testing.spec-review",
  );

  assert.deepEqual(pathBasedLensReference, {
    from: "skill.testing.spec-review",
    kind: "requires_lens",
    resolved: true,
    sourcePath: "skills/testing/spec-review/SKILL.md",
    targetId: "lens.testing.spec-review.boundary-values",
    targetKind: "context_lens",
    targetPath: "lenses/testing/spec-review-boundary-values.md",
    to: "lenses/testing/spec-review-boundary-values.md",
  });

  const skillResult = await withCapturedConsole(() =>
    main([
      "inspect",
      path.join(root, "skills", "testing", "spec-review", "SKILL.md"),
      "--format",
      "text",
    ]),
  );

  assert.equal(skillResult.code, 0);
  assert.match(skillResult.stdout, /Kind: skill/);
  assert.match(skillResult.stdout, /Relationships:/);
  assert.doesNotMatch(skillResult.stdout, /Applies to:/);
  assert.doesNotMatch(skillResult.stdout, /Focus:/);
  assert.doesNotMatch(skillResult.stdout, /Expected outputs:/);
});

test("global help lists workflows, boundaries, and distinguishable commands", async () => {
  const help = await withCapturedConsole(() => main(["--help"]));
  const invalid = await withCapturedConsole(() => main(["wat"]));
  const invalidHelp = await withCapturedConsole(() => main(["wat", "--help"]));
  const repeated = await withCapturedConsole(() => main(["--help"]));

  assert.equal(help.code, 0);
  assert.equal(help.stderr, "");
  assert.equal(help.stdout, repeated.stdout);
  assert.match(help.stdout, /Usage\n {2}renma <command> \[args\] \[options\]/);
  assert.match(help.stdout, /Start here: existing repository/);
  assert.match(help.stdout, /renma scan \./);
  assert.match(help.stdout, /renma catalog \. --format markdown/);
  assert.match(help.stdout, /renma graph \. --format markdown/);
  assert.match(help.stdout, /renma readiness \. --format markdown/);
  assert.match(help.stdout, /Start here: new skill/);
  assert.match(
    help.stdout,
    /renma scaffold skill skills\/<name>\/SKILL\.md --owner <owner>/,
  );
  assert.match(
    help.stdout,
    /inspect evidence -> prepare a reviewable patch -> human review -> rerun Renma/,
  );
  assert.match(help.stdout, /Renma does not call an LLM/);
  assert.match(help.stdout, /Renma does not select runtime context/);
  assert.match(help.stdout, /Renma does not assemble prompts/);
  assert.match(help.stdout, /Renma does not execute agents/);
  assert.match(help.stdout, /Renma does not collect runtime telemetry/);
  assert.match(
    help.stdout,
    /Renma does not automatically perform large semantic rewrites/,
  );
  for (const command of COMMAND_HELP) {
    assert.match(
      help.stdout,
      new RegExp(
        `${command.name.replaceAll("-", "\\-")}\\s+${escapeRegExp(
          command.question,
        )}`,
      ),
      command.name,
    );
  }
  assert.equal(
    new Set(COMMAND_HELP.map((command) => command.question)).size,
    COMMAND_HELP.length,
  );
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Unknown command "wat"/);
  assert.match(invalid.stderr, /Run renma --help for usage/);
  assert.equal(invalidHelp.code, 2);
  assert.match(invalidHelp.stderr, /Unknown command "wat"/);
});

test("command-specific help is deterministic and does not execute commands", async () => {
  for (const command of COMMAND_HELP) {
    const result = await withCapturedConsole(() =>
      main([command.name, "/path/that/does/not/exist", "--help"]),
    );
    const repeated = await withCapturedConsole(() =>
      main([command.name, "/path/that/does/not/exist", "--help"]),
    );

    assert.equal(result.code, 0, command.name);
    assert.equal(result.stderr, "", command.name);
    assert.equal(result.stdout, repeated.stdout, command.name);
    assert.match(result.stdout, new RegExp(escapeRegExp(command.usage)));
    assert.match(result.stdout, /Purpose/);
    assert.match(result.stdout, /Use when/);
    assert.match(result.stdout, /Do not use for/);
    assert.match(result.stdout, /Examples/);
    assert.match(result.stdout, /How to interpret the result/);
    assert.match(result.stdout, /Typical next steps/);
    assert.match(result.stdout, /Options/);
  }
});

test("representative command help shows relevant boundaries and options", async () => {
  const cases = [
    {
      name: "scan",
      argv: ["scan", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma scan \[path\] \[options\]/,
        /usually the first command/,
        /--fail-on <level>/,
        /Output format: text or json\. Defaults to text\./,
        /repair constraints/,
        /inventing owners, references, source-of-truth documents, or product rules/,
      ],
      excludes: [/--focus/, /--omit-generated-at/],
    },
    {
      name: "catalog",
      argv: ["catalog", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma catalog \[path\] \[options\]/,
        /IDs, kinds, owners, lifecycle states, hashes, tags/,
        /Output format: json or markdown\. Defaults to json\./,
        /inventory evidence/,
      ],
      excludes: [/--fail-on/, /--focus/],
    },
    {
      name: "graph",
      argv: ["graph", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma graph \[path\] \[options\]/,
        /Output format: json, markdown, or mermaid\. Defaults to json\./,
        /JSON defaults to the full view; non-JSON formats default to the summary view/,
        /--view <view>/,
        /--focus <asset-id-or-path>/,
        /does not select context for an LLM/,
        /does not prove that a dependency is semantically correct/,
      ],
      excludes: [/--fail-on/, /--omit-generated-at/],
    },
    {
      name: "trust-graph",
      argv: ["trust-graph", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma trust-graph \[path\] \[options\]/,
        /ownership, lifecycle, policy, references, dependencies, and diagnostics/,
        /Output format: json or markdown\. Defaults to json\./,
        /not a subjective trust score/,
        /does not certify that an asset is trustworthy/,
      ],
      excludes: [/--focus/, /--fail-on/],
    },
    {
      name: "readiness",
      argv: ["readiness", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma readiness \[path\] \[options\]/,
        /repository-level scorecard/,
        /Output format: json or markdown\. Defaults to json\./,
        /Scan gives concrete findings; readiness gives a broad repository summary/,
        /particular context asset at runtime/,
      ],
      excludes: [/--focus/, /--fail-on/],
    },
    {
      name: "ownership",
      argv: ["ownership", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma ownership \[path\] \[options\]/,
        /review owner coverage, unowned assets, and concentration/,
        /Output format: json or markdown\. Defaults to json\./,
        /Show owner-specific declared asset details while preserving repository-level coverage totals/,
      ],
      excludes: [/--focus/, /--fail-on/, /Set owner metadata on the scaffold/],
    },
    {
      name: "bom",
      argv: ["bom", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma bom \[path\] \[options\]/,
        /declared repository evidence snapshot/,
        /structured JSON generated from deterministic repository evidence/,
        /Output format: json or markdown\. Defaults to json\./,
        /--omit-generated-at/,
        /not a runtime usage report or telemetry/,
        /only removes the run-time generation timestamp/,
        /does not normalize repository metadata timestamps/,
        /does not normalize all environment-dependent paths/,
      ],
      excludes: [/--focus/, /--fail-on/, /deterministic JSON/],
    },
    {
      name: "diff",
      argv: ["diff", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma diff \[path\] --from <ref> --to <ref> \[options\]/,
        /not arbitrary source hunks/,
        /Output format: json or markdown\. Defaults to json\./,
      ],
      excludes: [/--focus/, /--fail-on/],
    },
    {
      name: "ci-report",
      argv: ["ci-report", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma ci-report \[path\] --from <ref> --to <ref> \[options\]/,
        /pull-request-oriented summary/,
        /Output format: json or markdown\. Defaults to markdown\./,
        /PASS and WARN exit 0; FAIL exits 1/,
      ],
      excludes: [/--focus/, /--fail-on/],
    },
    {
      name: "inspect",
      argv: ["inspect", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma inspect <file> \[options\]/,
        /compact outline or exact line slice/,
        /Output format: text or json\. Defaults to json\./,
        /--lines <range>/,
      ],
      excludes: [/--focus/, /--fail-on/, /--config/],
    },
    {
      name: "scaffold",
      argv: ["scaffold", "--help"],
      includes: [
        /renma scaffold <skill\|context\|context_lens> <path> \[options\]/,
        /starter structures/,
        /renma scaffold skill skills\/testing\/spec-review\/SKILL\.md/,
        /renma scaffold context contexts\/testing\/boundary-value-analysis\.md/,
        /renma scaffold context_lens lenses\/testing\/spec-review-boundary-values\.md/,
        /Output format: file, prompt, or json\. Defaults to file\./,
        /File mode writes the scaffold to the target path and requires --owner/,
        /Prompt and JSON modes print to stdout instead of creating the target file/,
        /File mode creates the scaffold file at the target path/,
        /refuses to overwrite existing files/,
        /starting structure, not a complete asset/,
        /Domain knowledge must come from evidence or human input/,
        /Set owner metadata on the scaffold\. Required when --format file is used\./,
      ],
      excludes: [/--fail-on/, /--focus/, /--json/, /Filter ownership/],
    },
    {
      name: "suggest-metadata",
      argv: ["suggest-metadata", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma suggest-metadata <file> \[options\]/,
        /metadata-focused retrofit/,
        /Output format: prompt or json\. Defaults to prompt\./,
        /prints to stdout and does not edit the target file/,
        /Explicitly provide an owner candidate/,
        /Renma must not infer an owner when this option is absent/,
        /Preserve existing Markdown body and semantics/,
        /Inferring an owner without evidence/,
      ],
      excludes: [/--focus/, /--omit-generated-at/],
    },
    {
      name: "suggest-semantic-split",
      argv: ["suggest-semantic-split", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma suggest-semantic-split <file> \[options\]/,
        /bounded source material/,
        /Output format: prompt or json\. Defaults to prompt\./,
        /prints to stdout and does not edit files/,
        /preserve meaning and references/,
        /--max-source-bytes <n>/,
        /--max-context-bytes <n>/,
      ],
      excludes: [/--focus/, /--omit-generated-at/, /--owner/],
    },
  ];

  for (const item of cases) {
    const result = await withCapturedConsole(() => main(item.argv));

    assert.equal(result.code, 0, item.name);
    assert.equal(result.stderr, "", item.name);
    for (const pattern of item.includes) {
      assert.match(result.stdout, pattern, item.name);
    }
    for (const pattern of item.excludes) {
      assert.doesNotMatch(result.stdout, pattern, item.name);
    }
  }
});

test("owner option help is command-specific", async () => {
  const ownership = await withCapturedConsole(() =>
    main(["ownership", "/path/that/does/not/exist", "--help"]),
  );
  const scaffold = await withCapturedConsole(() =>
    main(["scaffold", "--help"]),
  );
  const suggestMetadata = await withCapturedConsole(() =>
    main(["suggest-metadata", "/path/that/does/not/exist", "--help"]),
  );

  assert.equal(ownership.code, 0);
  assert.match(
    ownership.stdout,
    /Show owner-specific declared asset details while preserving repository-level coverage totals/,
  );
  assert.doesNotMatch(ownership.stdout, /Set owner metadata on the scaffold/);

  assert.equal(scaffold.code, 0);
  assert.match(
    scaffold.stdout,
    /Set owner metadata on the scaffold\. Required when --format file is used\./,
  );
  assert.doesNotMatch(scaffold.stdout, /Filter ownership/);

  assert.equal(suggestMetadata.code, 0);
  assert.match(
    suggestMetadata.stdout,
    /Explicitly provide an owner candidate\. Renma must not infer an owner when this option is absent\./,
  );
  assert.doesNotMatch(suggestMetadata.stdout, /declare scaffold ownership/);
});

test("CLI version reports package version", async () => {
  const version = await withCapturedConsole(() => main(["--version"]));
  const packageMetadata = JSON.parse(
    await readFile("package.json", "utf8"),
  ) as {
    version: string;
  };

  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), packageMetadata.version);
  assert.equal(version.stderr, "");
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

test("scaffold context_lens writes deterministic file output", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "lenses",
    "testing",
    "spec-review-boundary-values.md",
  );

  const result = await withCapturedConsole(() =>
    main([
      "scaffold",
      "context_lens",
      target,
      "--id",
      "lens.testing.spec-review.boundary-values",
      "--title",
      "Spec Review Boundary Values Lens",
      "--owner",
      "qa-platform",
      "--tags",
      "testing,spec-review",
    ]),
  );

  assert.equal(result.code, 0);
  const content = await readFile(target, "utf8");
  assert.match(content, /^id: lens\.testing\.spec-review\.boundary-values$/m);
  assert.match(content, /^type: context_lens$/m);
  assert.match(content, /^title: Spec Review Boundary Values Lens$/m);
  assert.match(content, /^owner: qa-platform$/m);
  assert.match(content, /^status: experimental$/m);
  assert.match(content, /^tags:\n {2}- testing\n {2}- spec-review$/m);
  assert.match(content, /^purpose: spec_review$/m);
  assert.match(content, /^applies_to:\n {2}- context\.example\.replace-me$/m);
  assert.match(content, /^focus:\n {2}- ambiguity\n {2}- missing boundary$/m);
  assert.match(
    content,
    /^expected_outputs:\n {2}- unresolved questions\n {2}- risk notes$/m,
  );
  assert.match(content, /purpose-oriented interpretation layer/);
  assert.match(content, /Detailed domain knowledge belongs in context assets/);
  assert.match(content, /must not become a prompt template/);
  assert.doesNotMatch(content, /^version:/m);

  const catalogResult = await withCapturedConsole(() =>
    main(["catalog", root, "--format", "json"]),
  );
  assert.equal(catalogResult.code, 1);
  const catalog = JSON.parse(catalogResult.stdout) as {
    catalog: { entries: Array<{ id: string; kind: string }> };
    diagnostics: Array<{ code?: string; severity: string }>;
  };
  assert.equal(
    catalog.catalog.entries[0]?.id,
    "lens.testing.spec-review.boundary-values",
  );
  assert.equal(catalog.catalog.entries[0]?.kind, "context_lens");
  assert.ok(
    catalog.diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        diagnostic.code === CONTEXT_LENS_DIAGNOSTIC_CODES.TARGET_NOT_FOUND,
    ),
  );
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

test("scaffold context_lens can emit json", async () => {
  const result = await withCapturedConsole(() =>
    main([
      "scaffold",
      "context_lens",
      "lenses/testing/spec-review-boundary-values.md",
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
    content: string;
    prompt: string;
  };
  assert.equal(bundle.kind, "context_lens");
  assert.equal(bundle.id, "lens.testing.spec-review-boundary-values");
  assert.match(bundle.content, /^type: context_lens$/m);
  assert.match(bundle.content, /^purpose: spec_review$/m);
  assert.match(bundle.prompt, /Create a Renma context_lens asset/);
  assert.match(bundle.prompt, /use `applies_to`/);
  assert.match(bundle.prompt, /runtime selectors/);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
