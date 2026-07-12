import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import {
  formatReadinessJson,
  formatReadinessMarkdown,
  type ReadinessReport,
} from "../src/commands/readiness.js";
import { loadConfig } from "../src/config.js";
import { zeroContextLensSummary } from "../src/context-lens.js";
import { scan } from "../src/scanner.js";
import { zeroSecurityPolicyInventorySummary } from "../src/security-policy-inventory.js";
import { zeroSecurityPostureSummary } from "../src/security-posture.js";
import type { Finding } from "../src/types.js";

test("layout config validation errors exit with usage code", async () => {
  const cases: Array<{
    name: string;
    config: unknown;
    message: RegExp;
  }> = [
    {
      name: "invalid layout shape",
      config: { layout: [] },
      message: /layout must be an object/,
    },
    {
      name: "unknown layout key",
      config: { layout: { namespace: "mobile" } },
      message: /Unknown layout config key "namespace"/,
    },
    {
      name: "empty tool namespace",
      config: { layout: { tool_namespace: "" } },
      message: /layout\.tool_namespace must be a non-empty string/,
    },
    {
      name: "non-string tool namespace",
      config: { layout: { tool_namespace: 12 } },
      message: /layout\.tool_namespace must be a non-empty string/,
    },
    {
      name: "non-string workflow alias",
      config: { layout: { workflow_aliases: { setup: 12 } } },
      message: /layout\.workflow_aliases\.setup must be a string/,
    },
  ];

  for (const item of cases) {
    const root = await fixture(
      `renma-config-${item.name.replaceAll(" ", "-")}-`,
    );
    await writeFile(
      path.join(root, "renma.config.json"),
      JSON.stringify(item.config),
    );

    const result = await withCapturedConsole(() => main(["scan", root]));

    assert.equal(result.code, 2, item.name);
    assert.match(result.stderr, item.message, item.name);
  }
});

test("generic layout keeps valid Skill-local support in place", async () => {
  const root = await fixture("renma-layout-generic-");
  await writeSkillSupport(root, "setup", "Demo");

  const report = await scan(root);
  assert.equal(
    report.findings.some(
      (finding) => finding.id === "LAYOUT-DISALLOWED-SKILL-ASSET",
    ),
    false,
  );
});

test("configured layout aliases do not force local support promotion", async () => {
  const root = await fixture("renma-layout-namespaced-");
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
  await writeSkillSupport(root, "device-setup");

  const report = await scan(root);
  assert.equal(
    report.findings.some(
      (finding) => finding.id === "LAYOUT-DISALLOWED-SKILL-ASSET",
    ),
    false,
  );
});

test("layout fields remain normalized compatibility-only input", async () => {
  const root = await fixture("renma-layout-compatibility-");
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

  const { config } = await loadConfig(root, {});
  assert.equal(config.layout.toolNamespace, "mobile");
  assert.deepEqual(config.layout.workflowAliases, {
    "device-setup": "real-device",
  });
});

test("readiness markdown limits findings while JSON stays complete", () => {
  const report = readinessReportWithFindings(55);

  const markdown = formatReadinessMarkdown(report);
  const json = JSON.parse(formatReadinessJson(report)) as ReadinessReport;

  assert.match(markdown, /## Findings/);
  assert.match(
    markdown,
    /- TEST-001 \[medium\/quality\] skills\/demo\/SKILL\.md:1-2/,
  );
  assert.match(markdown, / {2}- Remediation: Fix finding 1\./);
  assert.match(
    markdown,
    / {2}- LLM hint: Prefer a small deterministic patch\./,
  );
  assert.match(
    markdown,
    /\.\.\. 5 more findings omitted from markdown output\. Use --json for the full report\./,
  );
  assert.doesNotMatch(markdown, /TEST-051/);
  assert.equal(json.findings?.length, 55);
});

async function fixture(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSkillSupport(
  root: string,
  workflow: string,
  title = workflow,
): Promise<void> {
  await mkdir(path.join(root, "skills", workflow, "references"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", workflow, "profiles"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", workflow, "examples"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", workflow, "scripts"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", workflow, "SKILL.md"),
    `---\nid: ${workflow}\nowner: platform\nstatus: stable\n---\n# ${title}\nUse when setting up tooling.\n`,
  );
  await writeFile(
    path.join(root, "skills", workflow, "references", "foo.md"),
    "# Reference\n",
  );
  await writeFile(
    path.join(root, "skills", workflow, "profiles", "foo.md"),
    "# Profile\n",
  );
  await writeFile(
    path.join(root, "skills", workflow, "examples", "foo.md"),
    "# Example\n",
  );
  await writeFile(
    path.join(root, "skills", workflow, "scripts", "foo.mjs"),
    "console.log('ok');\n",
  );
}

function readinessReportWithFindings(count: number): ReadinessReport {
  return {
    root: "/tmp/renma",
    scannedFileCount: 1,
    score: 100,
    level: "ready",
    summary: {
      totalAssets: 1,
      ownedAssets: 1,
      unownedAssets: 0,
      ownershipCoveragePercent: 100,
      nodeCount: 1,
      edgeCount: 0,
      resolvedEdges: 0,
      unresolvedEdges: 0,
      graphResolutionPercent: 100,
      diagnosticCounts: {
        error: 0,
        warning: 0,
        info: 0,
      },
      workflow: {
        skillEntrypoints: 0,
        checks: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        readinessPercent: 100,
      },
      contextLens: zeroContextLensSummary(),
      securityPosture: zeroSecurityPostureSummary(),
      securityPolicyInventory: zeroSecurityPolicyInventorySummary(),
    },
    checks: [
      {
        id: "diagnostics.errors",
        title: "Diagnostic errors",
        status: "pass",
        severity: "info",
        summary: "No error diagnostics were reported.",
      },
    ],
    findings: Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      return {
        id: `TEST-${String(number).padStart(3, "0")}`,
        title: `Test finding ${number}`,
        category: "quality",
        severity: "medium",
        confidence: "high",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: number,
          endLine: number === 1 ? 2 : number,
          snippet: `Finding ${number}`,
        },
        whyItMatters: `Finding ${number} matters.`,
        remediation: `Fix finding ${number}.`,
        ...(number === 1
          ? { llmHint: "Prefer a small deterministic patch." }
          : {}),
      } satisfies Finding;
    }),
  };
}

async function withCapturedConsole(
  run: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  let stdout = "";
  let stderr = "";
  console.log = (...args: unknown[]) => {
    stdout += `${args.join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    stderr += `${args.join(" ")}\n`;
  };
  try {
    return { code: await run(), stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
