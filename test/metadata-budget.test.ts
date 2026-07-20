import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scan } from "../src/scanner.js";

const metadataBudgetFindingIds = new Set([
  "META-FRONTMATTER-TOO-LARGE",
  "META-LIST-ITEM-TOO-LONG",
]);

test("scan reports oversized frontmatter metadata", async () => {
  const root = await fixtureRoot();
  const extraFields = Array.from(
    { length: 50 },
    (_, index) => `routing_note_${index + 1}: keep metadata compact`,
  ).join("\n");
  await writeAsset(
    root,
    "skills/metadata-fat/SKILL.md",
    `---
id: skill.metadata-fat
owner: qa-platform
status: stable
${extraFields}
---
# Metadata Fat

Use this skill when reviewing metadata budgets.
Do not use for runtime context selection.

## Preflight
Collect the target asset path.

## Examples
Input: one asset. Output: metadata budget findings.

## Verification
Run renma scan.
`,
  );

  const result = await scan(root);
  const finding = result.findings.find(
    (candidate) => candidate.id === "META-FRONTMATTER-TOO-LARGE",
  );

  assert.equal(finding?.severity, "low");
  assert.equal(finding?.confidence, "high");
  assert.equal(finding?.evidence.path, "skills/metadata-fat/SKILL.md");
  assert.equal(finding?.evidence.startLine, 1);
  assert.ok((finding?.evidence.endLine ?? 0) > 48);
  assert.match(finding?.whyItMatters ?? "", /token use/);
  assert.match(finding?.remediation ?? "", /compact deterministic index/);
  assert.match(finding?.llmHint ?? "", /Shorten metadata/);
});

test("scan reports overlong block-list metadata items", async () => {
  const root = await fixtureRoot();
  const longRoutingItem =
    "Use this when reviewing product specifications that involve many services, implicit ownership boundaries, nested exception cases, downstream QA planning details, release risk tradeoffs, and ambiguous acceptance criteria that should live in the body instead, with additional prose that intentionally exceeds the Renma metadata advisory.";
  await writeAsset(
    root,
    "skills/metadata-list/SKILL.md",
    `---
name: metadata-list
description: Review metadata list length. Use when routing metadata needs deterministic budget checks.
metadata:
  renma.id: skill.metadata-list
  renma.owner: qa-platform
  renma.status: stable
  renma.when-to-use: '${JSON.stringify([longRoutingItem])}'
---
# Metadata List

Use this skill when reviewing metadata list length.
Do not use for runtime context selection.

## Preflight
Collect the target asset path.

## Examples
Input: one asset. Output: metadata list item findings.

## Verification
Run renma scan.
`,
  );

  const result = await scan(root);
  const finding = result.findings.find(
    (candidate) => candidate.id === "META-LIST-ITEM-TOO-LONG",
  );

  assert.equal(finding?.severity, "low");
  assert.equal(finding?.confidence, "high");
  assert.equal(finding?.evidence.path, "skills/metadata-list/SKILL.md");
  assert.equal(finding?.evidence.startLine, 8);
  assert.match(
    finding?.evidence.snippet ?? "",
    /reviewing product specifications/,
  );
  assert.match(finding?.whyItMatters ?? "", /catalog noise/);
  assert.match(finding?.remediation ?? "", /routing prose/);
});

test("scan does not report compact metadata budget findings", async () => {
  const root = await fixtureRoot();
  await writeAsset(
    root,
    "skills/metadata-compact/SKILL.md",
    `---
name: metadata-compact
description: Review compact metadata budgets. Use when routing metadata needs deterministic validation.
metadata:
  renma.id: skill.metadata-compact
  renma.owner: qa-platform
  renma.status: stable
  renma.tags: '["qa"]'
  renma.when-to-use: '["Metadata budget review"]'
---
# Metadata Compact

Use this skill when checking concise metadata.
Do not use for runtime context selection.

## Preflight
Collect the target asset path.

## Examples
Input: one asset. Output: no metadata budget findings.

## Verification
Run renma scan.
`,
  );

  const result = await scan(root);
  const ids = result.findings.map((finding) => finding.id);

  assert.equal(
    ids.some((id) => metadataBudgetFindingIds.has(id)),
    false,
  );
});

test("scan budgets continuation targets individually instead of repeating the field", async () => {
  const root = await fixtureRoot();
  const routes = Array.from(
    { length: 12 },
    (_, index) => `skill.short-target-${index.toString().padStart(2, "0")}`,
  );
  await writeAsset(
    root,
    "skills/continuation-budget/SKILL.md",
    `---
name: continuation-budget
description: Review continuation metadata budgets. Use when explicit Skill routes need deterministic size checks.
metadata:
  renma.id: skill.continuation-budget
  renma.continues-with: '${JSON.stringify(routes)}'
---
# Continuation Budget

Review the declared continuation targets.
`,
  );

  const result = await scan(root);
  const continuationFindings = result.findings.filter(
    (finding) =>
      finding.id === "META-LIST-ITEM-TOO-LONG" &&
      finding.details?.field === "continues_with",
  );

  assert.ok(JSON.stringify(routes).length > 256);
  assert.deepEqual(continuationFindings, []);
});

test("scan emits at most one advisory for one overlong continuation target", async () => {
  const root = await fixtureRoot();
  const longTarget =
    "Continue with the specialized review workflow only after collecting every relevant request constraint, confirming ownership, documenting ambiguity, preserving source evidence, recording the human decision, and verifying the final handoff conditions in enough narrative detail to exceed the per-item metadata budget without resembling an ID or path.";
  await writeAsset(
    root,
    "skills/continuation-budget/SKILL.md",
    `---
name: continuation-budget
description: Review continuation metadata budgets. Use when explicit Skill routes need deterministic size checks.
metadata:
  renma.id: skill.continuation-budget
  renma.continues-with: '${JSON.stringify([longTarget])}'
---
# Continuation Budget

Review the declared continuation target.
`,
  );

  const result = await scan(root);
  const continuationFindings = result.findings.filter(
    (finding) =>
      finding.id === "META-LIST-ITEM-TOO-LONG" &&
      finding.details?.field === "continues_with",
  );

  assert.ok(longTarget.length > 256);
  assert.equal(continuationFindings.length, 1);
  assert.equal(continuationFindings[0]?.severity, "low");
  assert.equal(continuationFindings[0]?.evidence.startLine, 6);
});

async function fixtureRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-metadata-budget-"));
}

async function writeAsset(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
