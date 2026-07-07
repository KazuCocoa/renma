import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatJson } from "../src/report.js";
import { scan } from "../src/scanner.js";
import type { DiagnosticV2, ReviewBundle } from "../src/types.js";

test("scan JSON includes LLM-actionable diagnostics v2 metadata", async () => {
  const root = await duplicateContextFixture();

  const report = JSON.parse(formatJson(await scan(root))) as {
    diagnosticsV2: DiagnosticV2[];
  };
  const duplicate = report.diagnosticsV2.find(
    (diagnostic) => diagnostic.code === "META-DUPLICATE-ASSET-ID",
  );

  assert.equal(duplicate?.version, 2);
  assert.equal(duplicate?.severity, "warning");
  assert.equal(duplicate?.location?.path, "contexts/alpha/overview.md");
  assert.equal(duplicate?.location?.startLine, 2);
  assert.ok(
    duplicate?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "must_preserve" &&
        /Preserve existing references/.test(constraint.text),
    ),
  );
  assert.ok(
    duplicate?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "must_not_change" &&
        /Do not rename every duplicate blindly/.test(constraint.text),
    ),
  );
  assert.ok(
    duplicate?.verificationSteps?.some((step) => step.command === "renma scan"),
  );
  assert.ok(
    duplicate?.verificationSteps?.some(
      (step) => step.command === "renma catalog",
    ),
  );
  assert.match(duplicate?.llmHint ?? "", /context\.demo\.duplicate/);
});

test("review bundles group related diagnostics deterministically", async () => {
  const root = await duplicateContextFixture();

  const first = await scan(root);
  const second = await scan(root);

  assert.deepEqual(first.reviewBundles, second.reviewBundles);

  const duplicateBundle = bundleWithCode(
    first.reviewBundles,
    "META-DUPLICATE-ASSET-ID",
  );
  assert.equal(duplicateBundle.id, "duplicate-id:context.demo.duplicate");
  assert.equal(duplicateBundle.severity, "warning");
  assert.deepEqual(duplicateBundle.diagnosticCodes, [
    "META-DUPLICATE-ASSET-ID",
  ]);
  assert.deepEqual(duplicateBundle.affectedAssets, ["context.demo.duplicate"]);
  assert.deepEqual(duplicateBundle.affectedFiles, [
    "contexts/alpha/overview.md",
    "contexts/beta/overview.md",
  ]);
  assert.ok(
    duplicateBundle.suggestedReviewOrder?.includes(
      "Choose canonical id before editing references.",
    ),
  );

  const orphanBundle = bundleWithCode(
    first.reviewBundles,
    "MAINT-ORPHANED-CONTEXT-ASSET",
  );
  assert.equal(orphanBundle.id, "orphaned-context-assets");
  assert.deepEqual(orphanBundle.affectedFiles, [
    "contexts/alpha/overview.md",
    "contexts/beta/overview.md",
  ]);
  assert.match(orphanBundle.llmHint ?? "", /do not delete automatically/i);
});

test("suppressed findings are omitted from diagnostics v2 and review bundles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-diagnostics-v2-"));
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
        },
      ],
    }),
  );
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    '# Demo\n\napi_key = "abcd1234abcd1234"\n',
  );

  const result = await scan(root);

  assert.equal(
    result.diagnosticsV2.some(
      (diagnostic) => diagnostic.code === "SEC-LITERAL-SECRET",
    ),
    false,
  );
  assert.equal(
    result.reviewBundles.some((bundle) =>
      bundle.diagnosticCodes.includes("SEC-LITERAL-SECRET"),
    ),
    false,
  );
});

async function duplicateContextFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-diagnostics-v2-"));
  await mkdir(path.join(root, "contexts", "alpha"), { recursive: true });
  await mkdir(path.join(root, "contexts", "beta"), { recursive: true });
  const content = `---
id: context.demo.duplicate
owner: qa-platform
status: stable
when_to_use:
  - Reviewing duplicate context fixtures
when_not_to_use:
  - Production operational guidance
---
# Duplicate Context

Stable fixture body.
`;

  await writeFile(path.join(root, "contexts", "alpha", "overview.md"), content);
  await writeFile(path.join(root, "contexts", "beta", "overview.md"), content);
  return root;
}

function bundleWithCode(bundles: ReviewBundle[], code: string): ReviewBundle {
  const bundle = bundles.find((candidate) =>
    candidate.diagnosticCodes.includes(code),
  );
  assert.ok(bundle, `expected review bundle for ${code}`);
  return bundle;
}
