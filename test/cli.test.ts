import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { compareUtf16CodeUnits } from "../src/canonical-json.js";
import { main } from "../src/cli.js";
import { COMMAND_HELP, commandOptionNames } from "../src/cli-help.js";
import { buildInspectOutline } from "../src/commands/inspect.js";
import { CONTEXT_LENS_DIAGNOSTIC_CODES } from "../src/context-lens.js";
import { classifyAssetPath } from "../src/discovery.js";
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
  assert.equal(
    result.securityPolicyInventory?.assetsWithLocalPolicyMetadata,
    0,
  );
  assert.equal(result.securityPolicyInventory?.assetsWithoutEffectivePolicy, 1);
});

test("scan reports skills/demo/skill.md as migration-only", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(path.join(root, "skills", "demo", "skill.md"), "# Demo\n");

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 0);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 0);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "LAYOUT-HISTORICAL-SKILL-ENTRYPOINT" &&
        diagnostic.path === "skills/demo/skill.md",
    ),
  );
});

test("scan reports skills/demo/foo.skill.md as migration-only", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "foo.skill.md"),
    "# Demo\n",
  );

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 0);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 0);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "LAYOUT-HISTORICAL-SKILL-ENTRYPOINT" &&
        diagnostic.path === "skills/demo/foo.skill.md",
    ),
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
    result.securityPolicyInventory?.assetsWithoutEffectivePolicyList.map(
      (asset) => [asset.path, asset.kind],
    ),
    [[".agents/skills/demo/SKILL.md", "skill"]],
  );
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.id === "SEC-MISSING-POLICY-METADATA" &&
        finding.evidence.path === ".agents/skills/demo/SKILL.md",
    ),
    false,
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
  assert.equal(
    result.securityPolicyInventory?.assetsWithoutEffectivePolicyList.length,
    1,
  );

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
  const actualSkillLikePaths = (await readdir(root))
    .filter(
      (file) =>
        file === "SKILL.md" ||
        file === "skill.md" ||
        file.endsWith(".skill.md"),
    )
    .sort(compareUtf16CodeUnits);
  assert.deepEqual(
    guidanceDiagnostics.map((diagnostic) => diagnostic.path),
    actualSkillLikePaths,
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

test("top-level layout diagnostics preserve exact walked filename casing", async () => {
  for (const filename of ["SKILL.md", "skill.md", "foo.skill.md"]) {
    const root = await fixture();
    await writeFile(path.join(root, filename), "# Skill note\n");
    const result = await scan(root);
    assert.deepEqual(
      result.diagnostics
        .filter(
          (diagnostic) =>
            diagnostic.code === "LAYOUT-SKILL-LIKE-FILE-OUTSIDE-SKILLS-DIR",
        )
        .map((diagnostic) => diagnostic.path),
      [filename],
    );
  }
});

test("skill-like files outside explicit skill directories are not classified as skills", async () => {
  const root = await fixture();
  await mkdir(path.join(root, ".agents"), { recursive: true });
  await writeFile(path.join(root, ".agents", "foo.skill.md"), "# Agent note\n");

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.equal(result.securityPolicyInventory?.assetKinds.skill, 0);
  assert.equal(result.securityPolicyInventory?.assetKinds.agent, 1);
  assert.equal(
    result.securityPolicyInventory?.assetsWithoutEffectivePolicyList.length,
    1,
  );
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

test("CLI explicitly loads JSONC configuration", async () => {
  const root = await fixture();
  const configPath = path.join(root, "review.jsonc");
  await writeFile(
    configPath,
    `{
  // Preserve why this review uses JSON output.
  "format": "json"
}
`,
  );

  const result = await withCapturedConsole(() =>
    main(["scan", root, "--config", configPath]),
  );
  const report = JSON.parse(result.stdout) as {
    configPath?: string;
    format: string;
  };

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.equal(report.configPath, "review.jsonc");
  assert.equal(report.format, "json");
});

test("CLI reports concise JSONC syntax locations without stack traces", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    '{\n  // rationale\n  "format":\n}\n',
  );

  const result = await withCapturedConsole(() => main(["scan", root]));

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /renma\.config\.jsonc is not valid JSONC at line 4, column 1: ValueExpected/,
  );
  assert.doesNotMatch(result.stderr, /\n\s+at\s+|node:internal/);
});

test("commands fail closed with one aggregate across config scopes", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      layout: { tool_namespace: "appium" },
      quality: { wrongQualityKey: 1, anotherWrongQualityKey: 2 },
      metadata: { unexpected: true },
      scan_boundary: { foo: true },
      executable_surface: { bar: true },
      security: {
        profiles: {
          restricted: {
            humanApprovalRequired: true,
          },
          release: {
            allowedData: ["repo-local-files"],
          },
        },
      },
      skill_discovery: { enabled: true, mystery: true },
    }),
  );
  const commands = [
    ["scan", root, "--json"],
    ["scan", root, "--json", "--strict"],
    ["readiness", root, "--format", "json"],
  ];

  for (const args of commands) {
    const result = await withCapturedConsole(() => main(args));

    assert.equal(result.code, 2, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(
      result.stderr.match(/Unsupported configuration keys found in /gu)?.length,
      1,
      args.join(" "),
    );
    assert.ok(
      result.stderr.includes(
        `Unsupported configuration keys found in ${path.join(root, "renma.config.json")}:`,
      ),
      args.join(" "),
    );
    assert.match(result.stderr, /Top-level configuration:[\s\S]*"layout"/);
    assert.match(result.stderr, /quality:[\s\S]*"anotherWrongQualityKey"/);
    assert.match(result.stderr, /metadata:[\s\S]*"unexpected"/);
    assert.match(result.stderr, /scan_boundary:[\s\S]*"foo"/);
    assert.match(result.stderr, /executable_surface:[\s\S]*"bar"/);
    assert.match(result.stderr, /security\.profiles\.release/);
    assert.match(result.stderr, /security\.profiles\.restricted/);
    assert.match(result.stderr, /humanApprovalRequired/);
    assert.match(result.stderr, /requires_human_approval/);
    assert.match(result.stderr, /"allowedData" -> use "allowed_data"/);
    assert.match(result.stderr, /skill_discovery:[\s\S]*"enabled"/);
    assert.doesNotMatch(
      result.stderr,
      /Renma scan|Findings:|strict_scan\.|SEC-|QUAL-/,
    );
    assert.doesNotMatch(result.stderr, /\n\s+at\s+|node:internal/);
  }
});

test("CLI attributes aggregate key errors to an explicit config path", async () => {
  const root = await fixture();
  const configPath = path.join(root, "review-policy.jsonc");
  await writeFile(
    configPath,
    `{
  // Explicit review configuration.
  "layout": {},
  "quality": { "wrongQualityKey": 1 }
}\n`,
  );

  const result = await withCapturedConsole(() =>
    main(["scan", root, "--config", configPath, "--json"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.ok(
    result.stderr.includes(
      `Unsupported configuration keys found in ${configPath}:`,
    ),
  );
  assert.match(result.stderr, /Top-level configuration:[\s\S]*"layout"/);
  assert.match(result.stderr, /quality:[\s\S]*"wrongQualityKey"/);
  assert.doesNotMatch(
    result.stderr,
    /Renma scan|Findings:|strict_scan\.|SEC-|QUAL-/,
  );
  assert.doesNotMatch(result.stderr, /\n\s+at\s+|node:internal/);
});

test("CLI rejects executable explicit config extensions", async () => {
  const root = await fixture();
  const configPath = path.join(root, "renma.config.mjs");
  await writeFile(configPath, "export default {};\n");

  const result = await withCapturedConsole(() =>
    main(["scan", root, "--config", configPath]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /must use \.json or \.jsonc/);
  assert.match(result.stderr, /\.mjs.*not supported/);
  assert.doesNotMatch(result.stderr, /\n\s+at\s+|node:internal/);
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
    diagnostics: Array<{ code: string }>;
  };
  const secretFinding = report.diagnostics.find(
    (diagnostic) => diagnostic.code === "SEC-LITERAL-SECRET",
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
      diagnostics: Array<{ code: string }>;
    };
    const secretFinding = report.diagnostics.find(
      (diagnostic) => diagnostic.code === "SEC-LITERAL-SECRET",
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
    diagnostics: Array<{ code: string; severity: string; message: string }>;
  };
  const secretFinding = report.diagnostics.find(
    (diagnostic) => diagnostic.code === "SEC-LITERAL-SECRET",
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
    diagnostics: Array<{ code: string; message: string }>;
  };
  const secretFinding = report.diagnostics.find(
    (diagnostic) => diagnostic.code === "SEC-LITERAL-SECRET",
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
      pattern: /suppressions\[0\]:[\s\S]*"ticket" \(unknown\)/,
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

test("scan output keeps suppressed findings separate and visible as evidence", async () => {
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
    diagnostics: Array<{ code: string }>;
    suppressedDiagnostics: Array<{ diagnostic: { code: string } }>;
  };
  const secretFinding = report.diagnostics.find(
    (diagnostic) => diagnostic.code === "SEC-LITERAL-SECRET",
  );

  assert.equal(json.code, 0);
  assert.equal(secretFinding, undefined);
  assert.ok(
    report.suppressedDiagnostics.some(
      (item) => item.diagnostic.code === "SEC-LITERAL-SECRET",
    ),
  );

  const text = await withCapturedConsole(() => main(["scan", root]));

  assert.equal(text.code, 0);
  assert.match(text.stdout, /SUPPRESSED HIGH SEC-LITERAL-SECRET/);
  assert.match(text.stdout, /Fixture intentionally includes a fake secret/);
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
    path.join(root, "renma.config.json"),
    JSON.stringify({ failOn: "high" }),
  );

  const exitCode = await withCapturedConsole(() => main(["scan", root]));

  assert.equal(exitCode.code, 2);
  assert.match(exitCode.stderr, /"failOn" \(unknown\)/);
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
    diagnostics: Array<{ code: string }>;
  };

  assert.equal(exitCode.code, 1);
  assert.ok(
    report.diagnostics.some(
      (diagnostic) => diagnostic.code === "SEC-LITERAL-SECRET",
    ),
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
      "name: demo",
      "description: Use this skill for demo requests. Use when catalog metadata and dependency evidence need deterministic review.",
      "metadata:",
      "  renma.id: demo",
      "  renma.owner: qa-platform",
      "  renma.status: stable",
      "  renma.last-reviewed-at: 2026-06-28",
      "  renma.review-cycle: P90D",
      "  renma.expires-at: 2026-12-31",
      `  renma.tags: '["appium","android"]'`,
      `  renma.requires-context: '["demo.guide","testing.boundary-value-analysis"]'`,
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
  assert.deepEqual(
    report.catalog.dependencies.filter(
      (dependency) => dependency.kind === "requires",
    ),
    [
      {
        from: "demo",
        to: "demo.guide",
        kind: "requires",
        declaration: "requires_context",
        declarationIndex: 0,
        sourcePath: "skills/demo/SKILL.md",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: 12,
          endLine: 12,
          snippet: `  renma.requires-context: '["demo.guide","testing.boundary-value-analysis"]'`,
        },
      },
      {
        from: "demo",
        to: "testing.boundary-value-analysis",
        kind: "requires",
        declaration: "requires_context",
        declarationIndex: 1,
        sourcePath: "skills/demo/SKILL.md",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: 12,
          endLine: 12,
          snippet: `  renma.requires-context: '["demo.guide","testing.boundary-value-analysis"]'`,
        },
      },
    ],
  );
  assert.ok(
    report.catalog.dependencies.some(
      (dependency) =>
        dependency.kind === "owns_local_resource" &&
        dependency.to === "demo.guide",
    ),
  );

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

test("CLI prints a platform-neutral semantic split prompt", async () => {
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
  assert.match(prompt.stdout, /# Renma Task: Suggest Semantic Reference Split/);
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
    schemaVersion: string;
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
  assert.equal(
    semanticSplitReviewBundle.schemaVersion,
    "renma.semantic-split-suggestion.v1",
  );
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
      "~~~~powershell\n",
      "$env:ANDROID_HOME\n",
      "~~~~\n",
      "\n",
      "## macOS/Linux\n",
      "Use a shell export.\n",
      "![Environment diagram](assets/environment.png)\n",
    ].join(""),
  );

  const outlineResult = await withCapturedConsole(() =>
    main(["inspect", source, "--format", "json"]),
  );
  assert.equal(outlineResult.code, 0);
  const outline = JSON.parse(outlineResult.stdout) as {
    schemaVersion: string;
    codeFences: Array<{ range: string }>;
    frontmatterRange: string;
    headings: Array<{ preview: string[]; range: string; text: string }>;
    links: Array<{ line: number; target: string }>;
  };
  assert.equal(outline.schemaVersion, "renma.inspect-outline.v1");
  assert.equal(outline.frontmatterRange, "L1-L3");
  assert.deepEqual(
    outline.headings.map((heading) => heading.text),
    ["Guide", "Windows", "macOS/Linux"],
  );
  assert.equal(outline.codeFences[0]?.range, "L11-L13");
  assert.deepEqual(outline.headings[1]?.preview, ["L0009: Use PowerShell."]);
  assert.deepEqual(outline.links, [
    { line: 17, target: "assets/environment.png" },
  ]);

  const sliceResult = await withCapturedConsole(() =>
    main(["inspect", source, "--lines", "L8-L9", "--format", "text"]),
  );
  assert.equal(sliceResult.code, 0);
  assert.match(sliceResult.stdout, /L0008: ## Windows/);
  assert.match(sliceResult.stdout, /L0009: Use PowerShell\./);

  const sliceJsonResult = await withCapturedConsole(() =>
    main(["inspect", source, "--lines", "L8-L9", "--format", "json"]),
  );
  assert.equal(sliceJsonResult.code, 0);
  assert.equal(
    (JSON.parse(sliceJsonResult.stdout) as { schemaVersion: string })
      .schemaVersion,
    "renma.inspect-slice.v1",
  );
});

test("inspect does not report whitespace thematic breaks as frontmatter", async () => {
  const root = await fixture();
  const directory = path.join(root, "contexts", "release");
  await mkdir(directory, { recursive: true });

  for (const [filename, firstLine] of [
    ["indented.md", " ---"],
    ["trailing.md", "--- "],
  ] as const) {
    const source = path.join(directory, filename);
    await writeFile(
      source,
      `${firstLine}
# Visible heading

[visible guide](docs/visible.md)

---
# Another heading
`,
    );
    const outline = await buildInspectOutline(source);

    assert.equal(outline.classification.kind, "context", firstLine);
    assert.equal(outline.frontmatterRange, null, firstLine);
    assert.deepEqual(
      outline.headings.map((heading) => [heading.text, heading.line]),
      [
        ["Visible heading", 2],
        ["Another heading", 7],
      ],
      firstLine,
    );
    assert.deepEqual(
      outline.links,
      [{ line: 4, target: "docs/visible.md" }],
      firstLine,
    );
  }
});

test("inspect uses the Agent Skills frontmatter contract for canonical entrypoints", async () => {
  const root = await fixture();
  const directory = path.join(root, "skills", "demo");
  const source = path.join(directory, "SKILL.md");
  await mkdir(directory, { recursive: true });
  await writeFile(
    source,
    [
      "\uFEFF --- ",
      "name: demo",
      "description: Use when reviewing demo inputs.",
      "--- \t",
      "# Agent body",
      "",
    ].join("\n"),
  );

  const outline = await buildInspectOutline(source);

  assert.equal(outline.classification.kind, "skill");
  assert.equal(outline.frontmatterRange, "L1-L4");
  assert.deepEqual(
    outline.headings.map((heading) => [heading.text, heading.line]),
    [["Agent body", 5]],
  );
});

test("inspect does not classify historical entrypoints as Skills", async () => {
  for (const entrypoint of ["skill.md", "foo.skill.md"]) {
    const root = await fixture();
    const directory = path.join(root, "skills", "demo");
    const source = path.join(directory, entrypoint);
    await mkdir(directory, { recursive: true });
    await writeFile(
      source,
      [
        "\uFEFF --- ",
        "name: demo",
        "description: Use when reviewing demo inputs.",
        "--- \t",
        "# Historical body",
        "",
        "[body guide](docs/body.md)",
        "",
      ].join("\n"),
    );

    const outline = await buildInspectOutline(source);

    assert.equal(outline.classification.kind, "unknown", entrypoint);
    assert.equal(outline.frontmatterRange, "L1-L4", entrypoint);
    assert.deepEqual(
      outline.headings.map((heading) => [heading.text, heading.line]),
      [["Historical body", 5]],
      entrypoint,
    );
    assert.deepEqual(
      outline.links,
      [{ line: 7, target: "docs/body.md" }],
      entrypoint,
    );
  }
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
name: spec-review
description: Review specifications with a declared lens. Use when boundary analysis needs deterministic context.
metadata:
  renma.id: skill.testing.spec-review
  renma.owner: qa-platform
  renma.status: experimental
  renma.requires-lens: '["lenses/testing/spec-review-boundary-values.md"]'
---
# Spec Review
`,
  );
  await writeFile(
    path.join(root, "skills", "testing", "exploratory", "SKILL.md"),
    `---
name: exploratory
description: Review exploratory specifications with an optional lens. Use when boundary analysis may add useful context.
metadata:
  renma.id: skill.testing.exploratory
  renma.owner: qa-platform
  renma.status: experimental
  renma.optional-lens: '["lens.testing.spec-review.boundary-values"]'
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
  assert.match(help.stdout, /renma guide skill/);
  assert.match(help.stdout, /renma scan \. --fail-on high/);
  assert.match(
    help.stdout,
    /use suggest-metadata only for metadata retrofit or Skill migration work/,
  );
  assert.match(help.stdout, /renma catalog \. --format markdown/);
  assert.match(help.stdout, /renma graph \. --format markdown/);
  assert.match(help.stdout, /Start here: new skill/);
  assert.match(
    help.stdout,
    /renma scaffold skill skills\/<name>\/SKILL\.md --owner <owner>/,
  );
  assert.match(
    help.stdout,
    /scan -> inspect evidence -> smallest intended patch -> validate again -> human review/,
  );
  assert.match(
    help.stdout,
    /complete the focused workflow; use platform-native Skill authoring guidance only within Renma boundaries/,
  );
  const existingWorkflow = help.stdout.slice(
    help.stdout.indexOf("Start here: existing repository"),
    help.stdout.indexOf("Start here: new skill"),
  );
  assert.match(existingWorkflow, /renma scan \. --fail-on high/);
  assert.match(
    existingWorkflow,
    /use renma guide skill only when intentionally reconsidering asset boundaries/,
  );
  assert.ok(
    existingWorkflow.indexOf("renma scan . --fail-on high") <
      existingWorkflow.indexOf("renma guide skill"),
  );
  assert.match(help.stdout, /renma scan \. --fail-on high/);
  assert.match(help.stdout, /Renma does not call an LLM/);
  assert.match(help.stdout, /Renma does not select runtime context/);
  assert.match(help.stdout, /Renma does not assemble prompts/);
  assert.match(help.stdout, /Renma does not execute agents/);
  assert.match(help.stdout, /Renma does not collect runtime telemetry/);
  assert.match(
    help.stdout,
    /Renma does not automatically perform large semantic rewrites/,
  );
  assert.match(help.stdout, /Skill: focused workflow/);
  assert.match(
    help.stdout,
    /Context: independently maintained knowledge, including authoritative sources of truth/,
  );
  assert.match(
    help.stdout,
    /Context Lens: purpose-specific interpretation of declared Context/,
  );
  assert.match(
    help.stdout,
    /https:\/\/github\.com\/KazuCocoa\/renma\/blob\/main\/docs\/authoring-guide\.md/,
  );
  assert.match(
    help.stdout,
    /https:\/\/github\.com\/KazuCocoa\/renma\/blob\/main\/docs\/context-lens\.md/,
  );
  assert.match(help.stdout, /Exit codes/);
  assert.match(help.stdout, /0  Command completed successfully/);
  assert.match(
    help.stdout,
    /1  Command completed, but the requested Renma policy\/status gate did not pass/,
  );
  assert.match(
    help.stdout,
    /A valid report remains on stdout; inspect its findings\/status and act on them/,
  );
  assert.match(
    help.stdout,
    /2  Caller-correctable invocation, configuration, target, or comparison-ref error/,
  );
  assert.match(help.stdout, /correct the input, and retry/);
  assert.match(help.stdout, /3  Unexpected Renma internal failure/);
  assert.match(help.stdout, /do not treat it as a policy finding/);
  assert.match(
    help.stdout,
    /stdout for completed results \(0\/1\) and stderr for errors \(2\/3\)/,
  );
  assert.doesNotMatch(help.stdout, /Authoring Guide: docs\//);
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
    if ("exitBehavior" in command) {
      assert.match(result.stdout, /Exit behavior/);
    } else {
      assert.doesNotMatch(result.stdout, /Exit behavior/);
    }
    assert.match(result.stdout, /Typical next steps/);
    assert.match(result.stdout, /Options/);
  }
});

test("policy-producing command help explains command-specific exit behavior", async () => {
  const cases = [
    {
      command: "scan",
      patterns: [
        /0: No finding reaches the active threshold; in strict mode, strict evaluation passes/,
        /1: The active finding threshold is reached, or strict evaluation fails/,
        /valid scan report is still emitted to stdout on exit 1/i,
        /Exit 2 and 3 follow the global CLI contract/,
      ],
    },
    {
      command: "readiness",
      patterns: [
        /0: Readiness level is ready, including Ready with advisories/,
        /1: Readiness level is needs_attention or not_ready/,
        /readiness report is still emitted to stdout on exit 1/i,
        /Exit 2 and 3 follow the global CLI contract/,
      ],
    },
    {
      command: "diff",
      patterns: [
        /0: The requested comparison was generated successfully, regardless of whether the report contains changes or regressions/,
        /Diff does not use exit 1 merely because evidence changed/,
        /Exit 2 and 3 follow the global CLI contract/,
      ],
    },
    {
      command: "ci-report",
      patterns: [
        /default --fail-on-status fail, PASS and WARN exit 0; FAIL exits 1/,
        /--fail-on-status warn, PASS exits 0; WARN and FAIL exit 1/,
        /valid CI report is still emitted to stdout on exit 1/i,
        /Exit 2 and 3 follow the global CLI contract/,
      ],
    },
  ] as const;

  for (const { command, patterns } of cases) {
    const help = await withCapturedConsole(() => main([command, "--help"]));
    assert.equal(help.code, 0, command);
    assert.equal(help.stderr, "", command);
    assert.match(help.stdout, /Exit behavior/, command);
    for (const pattern of patterns) {
      assert.match(help.stdout, pattern, command);
    }
  }
});

test("command contracts reject unrelated options and invalid positional arity", async () => {
  const requiredPositionals: Partial<
    Record<(typeof COMMAND_HELP)[number]["name"], string[]>
  > = {
    inspect: ["README.md"],
    guide: ["skill"],
    scaffold: ["context", "contexts/demo.md"],
    "suggest-metadata": ["README.md"],
    "suggest-semantic-split": ["README.md"],
  };

  for (const command of COMMAND_HELP) {
    const allowed = commandOptionNames(command.name);
    const unrelated = allowed.includes("owner") ? "focus" : "owner";
    const unsupported = await withCapturedConsole(() =>
      main([command.name, `--${unrelated}`, "unexpected"]),
    );
    assert.equal(unsupported.code, 2, command.name);
    assert.equal(unsupported.stdout, "", command.name);
    assert.match(
      unsupported.stderr,
      new RegExp(`${command.name} does not support --${unrelated}`),
      command.name,
    );
    assert.match(
      unsupported.stderr,
      new RegExp(`renma ${command.name} --help`),
    );

    const positionals = requiredPositionals[command.name] ?? ["."];
    const invalidArity = await withCapturedConsole(() =>
      main([command.name, ...positionals, "extra-positional"]),
    );
    assert.equal(invalidArity.code, 2, command.name);
    assert.equal(invalidArity.stdout, "", command.name);
    assert.match(
      invalidArity.stderr,
      /unexpected positional argument/,
      command.name,
    );
  }
});

test("command help lists every accepted command option", async () => {
  for (const command of COMMAND_HELP) {
    const result = await withCapturedConsole(() =>
      main([command.name, "--help"]),
    );
    assert.equal(result.code, 0, command.name);
    assert.equal(result.stderr, "", command.name);
    for (const option of commandOptionNames(command.name)) {
      assert.match(
        result.stdout,
        new RegExp(`--${option}\\b`),
        `${command.name}: ${option}`,
      );
    }
  }
});

test("expected inspect and semantic-split target errors are concise usage errors", async () => {
  const root = await fixture();
  const cases = [
    ["inspect", "does-not-exist.md"],
    ["inspect", root],
    ["inspect", "README.md", "--lines", "nope"],
    ["suggest-semantic-split", "does-not-exist.md"],
    ["suggest-semantic-split", root],
  ];

  for (const argv of cases) {
    const result = await withCapturedConsole(() => main(argv));
    assert.equal(result.code, 2, argv.join(" "));
    assert.equal(result.stdout, "", argv.join(" "));
    assert.match(result.stderr, /Run `renma .* --help` for usage/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s+/);
    assert.doesNotMatch(result.stderr, /node:internal/);
  }
});

test("positive integer options require complete positive decimal strings", async () => {
  for (const option of ["--max-source-bytes", "--max-context-bytes"]) {
    for (const value of ["0", "-1", "1.5", "12x", "x12", "NaN", "Infinity"]) {
      const result = await withCapturedConsole(() =>
        main(["suggest-semantic-split", "README.md", `${option}=${value}`]),
      );
      assert.equal(result.code, 2, `${option} ${value}`);
      assert.match(result.stderr, /must be a positive integer/);
    }
  }
});

test("representative command help shows relevant boundaries and options", async () => {
  const cases = [
    {
      name: "init",
      argv: ["init", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma init \[root\]/,
        /initializes repository-level Renma configuration/,
        /does not create Skills or Context Assets/,
        /concise renma\.config\.jsonc/,
        /never modified, even when it is empty, malformed, or customized/,
        /multiple conventional files.*ambiguity/i,
        /repositories can use Renma defaults without running init/i,
      ],
      excludes: [/--owner/, /--config/, /--json/],
    },
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
        /incomplete applicable security analysis/,
        /applicable YAML frontmatter-comment analysis that could not be completed safely/,
        /other unsupported or non-analyzable security-analysis states fatal/,
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
        /UTC evaluation date/,
        /does not remove freshness metadata/,
        /normalize absolute root or configPath values/,
        /portable across runners/,
      ],
      excludes: [/--focus/, /--fail-on/, /deterministic JSON/],
    },
    {
      name: "diff",
      argv: ["diff", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma diff \[path\] \(--from <ref> \| --base <ref>\) \[--to <ref>\] \[options\]/,
        /--base <ref>/,
        /Defaults to HEAD for diff and ci-report/,
        /not arbitrary source hunks/,
        /Output format: json or markdown\. Defaults to json\./,
      ],
      excludes: [/--focus/, /--fail-on/],
    },
    {
      name: "ci-report",
      argv: ["ci-report", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma ci-report \[path\] \(--from <ref> \| --base <ref>\) \[--to <ref>\] \[options\]/,
        /--base <ref>/,
        /Defaults to HEAD for diff and ci-report/,
        /pull-request-oriented summary/,
        /Output format: json or markdown\. Defaults to markdown\./,
        /PASS and WARN exit 0; FAIL exits 1/,
        /--fail-on-status <status>/,
      ],
      excludes: [/--focus/, /--fail-on <level>/],
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
      name: "guide",
      argv: ["guide", "--help"],
      includes: [
        /renma guide <topic> \[options\]/,
        /skill is the only supported topic/i,
        /Output format: prompt or json\. Defaults to prompt\./,
        /written only to stdout/,
        /performs no filesystem or network operations/,
        /renma guide skill --format json/,
      ],
      excludes: [/--owner/, /--config/, /--focus/],
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
        /own exact generated Skill and Context starter markers as High findings/,
        /does not certify general semantic completeness/,
        /renma guide skill to establish the smallest asset structure/,
        /platform-native Skill authoring guidance only to refine semantics within those boundaries/,
        /Skill is a focused workflow entrypoint/,
        /Context is independently maintained knowledge/,
        /Context Lens is purpose-specific interpretation of declared Context/,
        /generic persona storage, a prompt template, or a runtime routing rule/,
        /no existing Context Asset needs purpose-specific interpretation/,
        /replace every placeholder purpose, applies_to target, focus, and expected output/,
        /applies_to must resolve to real Context Assets/,
        /https:\/\/github\.com\/KazuCocoa\/renma\/blob\/main\/docs\/authoring-guide\.md/,
        /https:\/\/github\.com\/KazuCocoa\/renma\/blob\/main\/docs\/context-lens\.md/,
        /renma scan \. --fail-on high --strict/,
        /Domain knowledge must come from evidence or human input/,
        /Set owner metadata on the scaffold\. Required when --format file is used\./,
      ],
      excludes: [
        /--focus/,
        /--json/,
        /Filter ownership/,
        /Use docs\/authoring-guide\.md/,
      ],
    },
    {
      name: "suggest-metadata",
      argv: ["suggest-metadata", "/path/that/does/not/exist", "--help"],
      includes: [
        /renma suggest-metadata <file> \[options\]/,
        /Pre-0\.16 Renma Skill targets use the one-way migration path to Agent Skills/,
        /Output format: prompt or json\. Defaults to prompt\./,
        /prints to stdout and does not edit the target file/,
        /Explicitly provide an owner candidate/,
        /Renma must not infer an owner when this option is absent/,
        /Preserve existing Markdown body and semantics/,
        /metadata review is only one part of authoring review; use platform-native Skill authoring guidance/,
        /renma scan \. --fail-on high/,
        /Inferring an owner without evidence/,
      ],
      excludes: [/--focus/, /--omit-generated-at/, /renma guide skill/],
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
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Created .+SKILL\.md\n\nNext steps:/);
  assert.match(
    result.stdout,
    /`renma guide skill` authoring gate already established/,
  );
  assert.match(
    result.stdout,
    /Use `renma guide skill` again only when intentionally reconsidering/,
  );
  assert.match(
    result.stdout,
    /smallest non-redundant intended asset structure/,
  );
  assert.match(result.stdout, /renma scan \. --fail-on high/);
  assert.match(
    result.stdout,
    /7\. Have a human review meaningful semantic changes and unresolved decisions before merging\.\n$/,
  );
  const content = await readFile(target, "utf8");
  assert.match(content, /^name: spec-review$/m);
  assert.match(content, /^description: .*Use when /m);
  assert.match(content, /^metadata:$/m);
  assert.match(content, /^ {2}renma\.id: 'testing\.spec-review'$/m);
  assert.match(content, /^ {2}renma\.title: 'Spec Review'$/m);
  assert.match(content, /^ {2}renma\.owner: 'qa-platform'$/m);
  assert.match(content, /^ {2}renma\.status: experimental$/m);
  assert.match(
    content,
    /^ {2}renma\.tags: '\["testing","spec-review","qa"\]'$/m,
  );
  assert.match(content, /^ {2}renma\.requires-context: '\[\]'$/m);
  assert.doesNotMatch(content, /^requires_context:/m);
  assert.match(content, /^## Purpose$/m);
  assert.match(content, /^## Required Inputs$/m);
  assert.match(content, /^## Context References$/m);
  assert.match(content, /^## Constraints$/m);
  assert.match(
    content,
    /stop and report requests that require different runtime task context/,
  );
  assert.match(
    content,
    /reviewable workflow guidance instead of prompt material/,
  );
  assert.match(
    content,
    /description is a discovery and routing surface, not an execution surface/,
  );
  assert.match(content, /clearly non-operational unsafe-example/);
  assert.doesNotMatch(
    content,
    /rm\s+-rf|upload the \.env|continue without approval/i,
  );
  assert.doesNotMatch(content, /Renma can verify/);

  const scanResult = await scan(root);
  assert.equal(scanResult.agentSkills.results[0]?.format, "agent-skills");
  assert.equal(scanResult.agentSkills.results[0]?.valid, true);
  assert.equal(scanResult.agentSkills.results[0]?.migrationRecommended, false);
  assert.equal(scanResult.agentSkills.results[0]?.warningCount, 0);
  assert.equal(
    scanResult.findings.some((finding) => finding.id.startsWith("SEC-")),
    false,
  );
  assert.equal(
    scanResult.findings.some(
      (finding) => finding.id === "QUAL-MISSING-NEGATIVE-ROUTING",
    ),
    false,
  );

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
  assert.doesNotMatch(result.stdout, /standard Skill authoring guidance/);
  assert.doesNotMatch(result.stdout, /Next steps:/);
  const content = await readFile(target, "utf8");
  assert.match(content, /^id: lens\.testing\.spec-review\.boundary-values$/m);
  assert.match(content, /^type: context_lens$/m);
  assert.match(content, /^title: Spec Review Boundary Values Lens$/m);
  assert.match(content, /^owner: qa-platform$/m);
  assert.match(content, /^status: experimental$/m);
  assert.match(content, /^tags:\n {2}- testing\n {2}- spec-review$/m);
  assert.match(content, /^purpose: replace_with_repository_grounded_purpose$/m);
  assert.match(
    content,
    /^applies_to:\n {2}- context\.example\.replace-with-existing-context$/m,
  );
  assert.match(
    content,
    /^focus:\n {2}- replace with a concrete interpretation criterion$/m,
  );
  assert.match(
    content,
    /^expected_outputs:\n {2}- replace with a concrete expected output$/m,
  );
  assert.match(content, /frontmatter placeholder/);
  assert.match(content, /not universal Lens recommendations/);
  assert.match(content, /requires real Context Assets to interpret/);
  assert.match(content, /persona-only wording is insufficient/);
  assert.match(content, /focused task, ordered workflow/);
  assert.match(content, /Detailed domain knowledge belongs in context assets/);
  assert.match(content, /must not become a prompt template/);
  assert.match(content, /questions to ask, risks and checks to emphasize/);
  assert.match(content, /every `applies_to` target resolves/);
  assert.match(content, /renma scan \. --fail-on high/);
  assert.match(content, /renma catalog \. --format markdown/);
  assert.match(
    content,
    /renma graph \. --focus lens\.testing\.spec-review\.boundary-values --format mermaid/,
  );
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

test("scaffold context file output omits Skill-specific next steps", async () => {
  const root = await fixture();
  const target = path.join(root, "contexts", "testing", "boundary.md");

  const result = await withCapturedConsole(() =>
    main(["scaffold", "context", target, "--owner", "qa-platform"]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `Created ${target}\n`);
  assert.doesNotMatch(result.stdout, /Next steps:/);
  assert.doesNotMatch(result.stdout, /standard Skill authoring guidance/);
  assert.equal(
    (await scan(root)).securityPolicyInventory?.assetKinds.context,
    1,
  );
});

test("scaffold targets conform to normal asset classification paths", async () => {
  const cases = [
    {
      kind: "context",
      relativePath: "contexts/testing/canonical.md",
      expectedKind: "context",
    },
    {
      kind: "context_lens",
      relativePath: "lenses/testing/canonical.md",
      expectedKind: "context_lens",
    },
    {
      kind: "context_lens",
      relativePath: "contexts/testing/typed-lens.md",
      expectedKind: "context_lens",
    },
  ] as const;

  for (const fixtureCase of cases) {
    const classification = classifyAssetPath(fixtureCase.relativePath, {
      ...(fixtureCase.kind === "context_lens"
        ? { metadataType: "context_lens" }
        : {}),
    });
    assert.equal(classification.kind, fixtureCase.expectedKind);

    const result = await withCapturedConsole(() =>
      main([
        "scaffold",
        fixtureCase.kind,
        fixtureCase.relativePath,
        "--format",
        "json",
        "--owner",
        "qa-platform",
      ]),
    );
    assert.equal(result.code, 0, fixtureCase.relativePath);
    assert.ok(
      result.stdout.includes(
        `"path": ${JSON.stringify(fixtureCase.relativePath)}`,
      ),
      fixtureCase.relativePath,
    );
  }
});

test("scaffold rejects targets that normal discovery cannot classify as requested", async () => {
  const cases = [
    ["context", "docs/not-context.md", /Context scaffolds require/],
    ["context", "lenses/not-context.md", /Context scaffolds require/],
    ["context", "context/testing/legacy.md", /Context scaffolds require/],
    ["context", "contexts/not-markdown.txt", /Markdown target/],
    ["context_lens", "docs/not-lens.md", /Context Lens scaffolds require/],
    ["context_lens", "skills/demo/lens.md", /Context Lens scaffolds require/],
    ["context_lens", "lenses/not-markdown.txt", /Markdown target/],
  ] as const;

  for (const [kind, target, expectedError] of cases) {
    const result = await withCapturedConsole(() =>
      main(["scaffold", kind, target, "--format", "json"]),
    );
    assert.equal(result.code, 2, target);
    assert.match(result.stderr, expectedError, target);
    assert.equal(result.stdout, "", target);
  }
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

test("scaffold rejects canonical-looking targets under reserved Skill-support directories", async () => {
  const root = await fixture();
  for (const relativeTarget of [
    "skills/SKILL.md",
    "skills/examples/SKILL.md",
    "skills/demo/references/new/SKILL.md",
    ".agents/skills/SKILL.md",
    ".agents/skills/profiles/SKILL.md",
    ".agents/skills/demo/assets/new/SKILL.md",
  ]) {
    const target = path.join(root, ...relativeTarget.split("/"));
    const result = await withCapturedConsole(() =>
      main(["scaffold", "skill", target, "--owner", "qa-platform"]),
    );

    assert.equal(result.code, 2, relativeTarget);
    assert.match(result.stderr, /without reserved Skill-support segments/);
    await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
  }
});

test("scaffold resolves a marked repository below an ancestor skills directory", async () => {
  const workspace = await fixture();
  const repository = path.join(workspace, "skills", "project");
  await mkdir(path.join(repository, ".git"), { recursive: true });

  for (const fixture of [
    {
      relativePath: "skills/demo/SKILL.md",
      id: "skill.demo",
      name: "demo",
    },
    {
      relativePath: ".agents/skills/agent-demo/SKILL.md",
      id: "skill.agent-demo",
      name: "agent-demo",
    },
  ]) {
    const target = path.join(repository, ...fixture.relativePath.split("/"));
    const result = await withCapturedConsole(() =>
      main([
        "scaffold",
        "skill",
        target,
        "--id",
        fixture.id,
        "--owner",
        "qa-platform",
      ]),
    );

    assert.equal(result.code, 0, fixture.relativePath);
    assert.equal(result.stderr, "", fixture.relativePath);
    assert.match(
      await readFile(target, "utf8"),
      new RegExp(`^name: ${fixture.name}$`, "m"),
      fixture.relativePath,
    );
  }

  const scanResult = await scan(repository);
  for (const sourcePath of [
    "skills/demo/SKILL.md",
    ".agents/skills/agent-demo/SKILL.md",
  ]) {
    const validation = scanResult.agentSkills.results.find(
      ({ path: candidatePath }) => candidatePath === sourcePath,
    );
    assert.equal(validation?.format, "agent-skills", sourcePath);
    assert.equal(validation?.valid, true, sourcePath);
  }
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
    schemaVersion: string;
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
  assert.deepEqual(Object.keys(bundle), [
    "schemaVersion",
    "kind",
    "path",
    "id",
    "title",
    "owner",
    "tags",
    "resources",
    "format",
    "content",
    "prompt",
  ]);
  assert.equal(bundle.schemaVersion, "renma.scaffold.v1");
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
  assert.match(
    bundle.content,
    /^purpose: replace_with_repository_grounded_purpose$/m,
  );
  assert.match(bundle.prompt, /Create a Renma context_lens asset/);
  assert.match(bundle.prompt, /use `applies_to`/);
  assert.match(bundle.prompt, /runtime selectors/);
  assert.match(bundle.prompt, /placeholder, not a universal recommendation/);
  assert.match(bundle.prompt, /existing Context Asset ID or path/);
  assert.match(bundle.prompt, /If there is no Context Asset to interpret/);
  assert.match(bundle.prompt, /persona-only wording is insufficient/);
  assert.match(bundle.prompt, /focused task and workflow in the Skill/);
  assert.match(
    bundle.prompt,
    /independently maintained or source-authoritative knowledge in Context Assets/,
  );
});

test("scaffold context_lens prompt requires repository-grounded semantics", async () => {
  const result = await withCapturedConsole(() =>
    main([
      "scaffold",
      "context_lens",
      "lenses/testing/quality-review.md",
      "--format",
      "prompt",
      "--owner",
      "qa-platform",
    ]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Replace the scaffold `purpose`/);
  assert.match(result.stdout, /Replace every `applies_to` placeholder/);
  assert.match(result.stdout, /Replace all `focus` and `expected_outputs`/);
  assert.match(result.stdout, /verify that each target resolves/);
  assert.match(result.stdout, /persona may frame the Lens/);
  assert.match(
    result.stdout,
    /Keep the focused task and workflow in the Skill/,
  );
  assert.match(result.stdout, /renma scan \. --fail-on high/);
  assert.match(result.stdout, /renma catalog \. --format markdown/);
  assert.match(
    result.stdout,
    /renma graph \. --focus lens\.testing\.quality-review --format mermaid/,
  );
});

test("scaffold skill JSON keeps its field shape and includes the human-review boundary", async () => {
  const target = "skills/testing/json-review/SKILL.md";
  const result = await withCapturedConsole(() =>
    main([
      "scaffold",
      "skill",
      target,
      "--owner",
      "qa-platform",
      "--format",
      "json",
    ]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const bundle = JSON.parse(result.stdout) as Record<string, unknown> & {
    prompt: string;
  };
  assert.deepEqual(Object.keys(bundle), [
    "schemaVersion",
    "kind",
    "path",
    "id",
    "title",
    "owner",
    "tags",
    "resources",
    "format",
    "content",
    "prompt",
  ]);
  assert.equal(bundle.schemaVersion, "renma.scaffold.v1");
  assert.match(
    bundle.prompt,
    /Have a human review meaningful semantic changes before merging/,
  );
  await assert.rejects(readFile(target, "utf8"));
});

test("scaffold prompt emits platform-neutral authoring instructions", async () => {
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
  assert.match(result.stdout, /Move knowledge into a Context Asset/);
  assert.match(result.stdout, /Do not choose runtime task context/);
  assert.match(result.stdout, /Do not assemble prompts for live model calls/);
  assert.doesNotMatch(result.stdout, /Do not call external services/);
  assert.match(
    result.stdout,
    /Scaffold generation performs no network operations/,
  );
  assert.match(
    result.stdout,
    /finished Skill may access a reviewed external source only when its authored workflow and effective security policy explicitly permit it/,
  );
  assert.match(result.stdout, /Markdown URL does not grant network permission/);
  assert.match(result.stdout, /Do not infer permissive values/);
  assert.match(result.stdout, /Correctness importance alone is not sufficient/);
  assert.match(
    result.stdout,
    /renma graph \. --focus testing\.spec-review --format mermaid/,
  );
  assert.doesNotMatch(result.stdout, /does\.not\.exist/);
  assert.match(result.stdout, /Do not invent owners/);
  assert.match(result.stdout, /renma guide skill/);
  assert.match(result.stdout, /smallest non-redundant Renma asset graph/);
  assert.match(
    result.stdout,
    /platform-native Skill authoring guidance only to refine/,
  );
  assert.match(
    result.stdout,
    /trigger description, instructions, workflow, constraints, completion criteria/,
  );
  assert.match(
    result.stdout,
    /description is a discovery and routing surface, not an execution surface/,
  );
  assert.match(result.stdout, /clearly non-operational unsafe-example/);
  assert.match(result.stdout, /renma scan \. --fail-on high/);
  assert.match(
    result.stdout,
    /Do not weaken security policy or add suppressions/,
  );
  assert.match(
    result.stdout,
    /Have a human review meaningful semantic changes before merging/,
  );
  await assert.rejects(readFile(target, "utf8"));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-"));
  await mkdir(path.join(root, ".git"));
  return root;
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
