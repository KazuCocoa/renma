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
    { length: 25 },
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
  assert.ok((finding?.evidence.endLine ?? 0) > 24);
  assert.match(finding?.whyItMatters ?? "", /token use/);
  assert.match(finding?.remediation ?? "", /compact deterministic index/);
  assert.match(finding?.llmHint ?? "", /Shorten metadata/);
});

test("scan reports overlong block-list metadata items", async () => {
  const root = await fixtureRoot();
  const longRoutingItem =
    "Use this when reviewing product specifications that involve many services, implicit ownership boundaries, nested exception cases, downstream QA planning details, release risk tradeoffs, and ambiguous acceptance criteria that should live in the body instead.";
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
