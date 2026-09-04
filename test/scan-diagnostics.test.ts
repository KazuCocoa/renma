import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createScanDiagnostics,
  createReviewBundles,
} from "../src/scan-diagnostics.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { formatJson } from "../src/report.js";
import { scan } from "../src/scanner.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";
import type {
  DiagnosticV2,
  Finding,
  ReviewBundle,
} from "../src/types/diagnostics.js";

test("typed Finding guidance flows directly into scan diagnostics", () => {
  const finding: Finding = {
    id: "TEST-TYPED-GUIDANCE",
    title: "Typed guidance test",
    category: "maintenance",
    severity: "low",
    confidence: "high",
    evidence: {
      path: "contexts/test.md",
      startLine: 1,
      endLine: 1,
      snippet: "test",
    },
    whyItMatters: "Typed repair semantics must not depend on prose wording.",
    remediation: "Apply the typed guidance.",
    repairConstraints: [
      {
        kind: "allowed_change",
        text: "Preserve this wording while testing an explicitly different kind.",
      },
    ],
    verificationSteps: [
      {
        text: "Run renma catalog, despite the explicitly authored command.",
        command: "npm test",
        expected: "The authored expectation remains authoritative.",
      },
    ],
  };

  const [diagnostic] = createScanDiagnostics({
    findings: [finding],
    diagnostics: [],
  });
  assert.ok(
    diagnostic?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "allowed_change" &&
        constraint.text.startsWith("Preserve this wording"),
    ),
  );
  assert.ok(
    diagnostic?.verificationSteps?.some(
      (step) =>
        step.command === "npm test" &&
        step.expected === "The authored expectation remains authoritative.",
    ),
  );
});

test("scan findings expose typed guidance without legacy arrays", async () => {
  const result = await scan(await duplicateContextFixture());
  let guidedFindingCount = 0;

  for (const finding of result.findings) {
    if (!finding.repairConstraints && !finding.verificationSteps) continue;
    guidedFindingCount += 1;
    assert.equal("constraints" in finding, false, finding.id);
    assert.ok(finding.repairConstraints?.every((item) => item.text));
    assert.ok(finding.verificationSteps?.every((item) => item.text));
  }

  assert.ok(guidedFindingCount > 0);
});

test("scan JSON includes canonical LLM-actionable diagnostic metadata", async () => {
  const root = await duplicateContextFixture();

  const report = JSON.parse(formatJson(await scan(root))) as {
    diagnostics: DiagnosticV2[];
  };
  const duplicate = report.diagnostics.find(
    (diagnostic) => diagnostic.code === "META-DUPLICATE-ASSET-ID",
  );

  assert.equal(duplicate?.version, 2);
  assert.equal(duplicate?.severity, "warning");
  assert.equal(duplicate?.repairPolicy, "preserve_semantics");
  assert.equal(duplicate?.location?.path, "contexts/alpha/overview.md");
  assert.equal(duplicate?.location?.startLine, 2);
  assert.ok(
    duplicate?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "must_preserve" &&
        /Fix the underlying semantic issue/.test(constraint.text),
    ),
  );
  assert.ok(
    duplicate?.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "must_not_change" &&
        /Do not remove, weaken, relocate, or bypass declarations/.test(
          constraint.text,
        ),
    ),
  );
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
  assert.equal(duplicate?.details?.assetId, "context.demo.duplicate");
  assert.equal(
    (duplicate?.details?.facts as Record<string, unknown> | undefined)?.assetId,
    "context.demo.duplicate",
  );
});

test("network allow-list diagnostics include preserve-semantics repair policy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-scan-diagnostics-"));
  await mkdir(path.join(root, "skills", "network"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "network", "SKILL.md"),
    canonicalSkillFixture(
      "skills/network/SKILL.md",
      `---
allowed_data: disclosed
network_allowed: true
approved_network_destinations: github.com
---
# Network

Fetch https://api.example.com/status.
`,
    ),
  );

  const result = await scan(root);
  const diagnostic = result.diagnostics.find(
    (item) => item.code === "SEC-UNAPPROVED-NETWORK-DESTINATION",
  );

  assert.ok(diagnostic);
  assert.equal(diagnostic.repairPolicy, "preserve_semantics");
  assert.match(
    diagnostic.details?.remediation as string,
    /actual required domains/,
  );
  assert.match(
    diagnostic.llmHint ?? "",
    /Enumerate the actual required domains/,
  );
  assert.ok(
    diagnostic.repairConstraints?.some((constraint) =>
      /Do not replace specific domains with broad wildcards/.test(
        constraint.text,
      ),
    ),
  );
  assert.ok(
    diagnostic.repairConstraints?.some((constraint) =>
      /TODO with supporting references/.test(constraint.text),
    ),
  );
  assert.doesNotMatch(diagnostic.llmHint ?? "", /or remove the instruction/i);
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

test("review bundles use structured duplicate id facts before prose", async () => {
  const root = await duplicateContextFixture();
  const result = await scan(root);
  const bundles = createReviewBundles(
    scrubProse(result.diagnostics, "META-DUPLICATE-ASSET-ID"),
  );

  const duplicateBundle = bundleWithCode(bundles, "META-DUPLICATE-ASSET-ID");

  assert.equal(duplicateBundle.id, "duplicate-id:context.demo.duplicate");
  assert.deepEqual(duplicateBundle.affectedAssets, ["context.demo.duplicate"]);
  assert.deepEqual(duplicateBundle.affectedFiles, [
    "contexts/alpha/overview.md",
    "contexts/beta/overview.md",
  ]);
});

test("unknown reference bundles use structured source and target facts", async () => {
  const root = await unknownReferenceFixture();
  const result = await scan(root);
  const bundles = createReviewBundles(
    scrubProse(result.diagnostics, "META-UNKNOWN-REFERENCE"),
  );

  const bundle = bundleWithCode(bundles, "META-UNKNOWN-REFERENCE");

  assert.equal(bundle.id, "unknown-reference:skills/demo/skill.md");
  assert.ok(bundle.affectedAssets?.includes("skill.demo"));
  assert.ok(bundle.affectedAssets?.includes("context.demo.missing"));
  assert.deepEqual(bundle.affectedFiles, ["skills/demo/SKILL.md"]);
});

test("Context Lens target bundles use structured source and target facts", async () => {
  const root = await contextLensMissingTargetFixture();
  const result = await scan(root);
  const bundles = createReviewBundles(
    scrubProse(result.diagnostics, "CONTEXT-LENS-TARGET-NOT-FOUND"),
  );

  const bundle = bundleWithCode(bundles, "CONTEXT-LENS-TARGET-NOT-FOUND");

  assert.equal(bundle.id, "unknown-reference:lenses/testing/spec-review.md");
  assert.ok(bundle.affectedAssets?.includes("context.testing.missing"));
  assert.deepEqual(bundle.affectedFiles, ["lenses/testing/spec-review.md"]);
});

test("revoked dependency and route diagnostics use dependency-review bundles", () => {
  for (const code of [
    DIAGNOSTIC_IDS.META_REQUIRED_REVOKED_DEPENDENCY,
    DIAGNOSTIC_IDS.META_OPTIONAL_REVOKED_DEPENDENCY,
    DIAGNOSTIC_IDS.DISCOVERY_REVOKED_ROUTE_TARGET,
  ]) {
    const bundle = bundleWithCode(
      createReviewBundles([
        {
          version: 2,
          code,
          severity: "error",
          message: "Revoked dependency requires review.",
          location: { path: "skills/source/SKILL.md" },
          details: { sourcePath: "skills/source/SKILL.md" },
        },
      ]),
      code,
    );

    assert.match(bundle.id, /^dependency-review:/, code);
    assert.doesNotMatch(bundle.id, /^code-review:/, code);
  }
});

test("suppressed findings are omitted from diagnostics v2 and review bundles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-scan-diagnostics-"));
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
    result.diagnostics.some(
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
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-scan-diagnostics-"));
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

async function unknownReferenceFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-scan-diagnostics-"));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    canonicalSkillFixture(
      "skills/demo/SKILL.md",
      `---
id: skill.demo
description: Use this skill for demo workflows when routing, preflight, verification, examples, and context references all need checking.
requires_context:
  - context.demo.missing
---
# Demo

Use this skill when validating demo references.

## Do Not Use For
Do not use for production changes.

## Preflight
Collect the demo target.

## Examples
Input: demo.
Output: result.

## Verification
Run the demo check.
`,
    ),
  );
  return root;
}

async function contextLensMissingTargetFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-scan-diagnostics-"));
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "lenses", "testing", "spec-review.md"),
    `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.missing
---
# Spec Review Lens

Review testing context boundaries.
`,
  );
  return root;
}

function scrubProse(
  diagnostics: DiagnosticV2[],
  targetCode: string,
): DiagnosticV2[] {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.code !== targetCode) return diagnostic;
    return {
      ...diagnostic,
      message: "Diagnostic wording changed.",
      llmHint: "Guidance wording changed without structured identifiers.",
      ...(diagnostic.location
        ? { location: { ...diagnostic.location, snippet: "redacted" } }
        : {}),
    };
  });
}

function bundleWithCode(bundles: ReviewBundle[], code: string): ReviewBundle {
  const bundle = bundles.find((candidate) =>
    candidate.diagnosticCodes.includes(code),
  );
  assert.ok(bundle, `expected review bundle for ${code}`);
  return bundle;
}
