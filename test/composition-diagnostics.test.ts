import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";

test("scan emits actionable declared-composition diagnostics and Lens freshness findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-composition-scan-"));
  await mkdir(path.join(root, "skills", "review"), { recursive: true });
  await mkdir(path.join(root, "contexts"), { recursive: true });
  await mkdir(path.join(root, "lenses"), { recursive: true });

  await writeFile(
    path.join(root, "skills", "review", "SKILL.md"),
    [
      "---",
      "name: review",
      "description: Review declared composition. Use when composition governance needs deterministic evidence.",
      "metadata:",
      "  renma.id: skill.review",
      "  renma.owner: maintainers",
      '  renma.requires-context: \'["context.a","context.y","lens.wrong-kind"]\'',
      "  renma.optional-context: '[\"context.c\"]'",
      "  renma.requires-lens: '[\"lens.review\"]'",
      "---",
      "# Review",
      "",
      "## Required inputs",
      "Provide the repository.",
      "",
      "## Completion criteria",
      "Report the findings.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "contexts", "a.md"),
    contextDocument("context.a", [
      "requires_context:",
      "  - context.b",
      "  - context.b",
    ]),
  );
  await writeFile(
    path.join(root, "contexts", "b.md"),
    contextDocument("context.b", ["requires_context: context.a"]),
  );
  await writeFile(
    path.join(root, "contexts", "c.md"),
    contextDocument("context.c", ["requires_context: context.d"]),
  );
  await writeFile(
    path.join(root, "contexts", "d.md"),
    contextDocument("context.d", ["requires_context: context.c"]),
  );
  await writeFile(
    path.join(root, "contexts", "x.md"),
    contextDocument("context.x", ["conflicts: context.y"]),
  );
  await writeFile(
    path.join(root, "contexts", "y.md"),
    contextDocument("context.y", []),
  );
  await writeFile(
    path.join(root, "lenses", "review.md"),
    lensDocument("lens.review", "context.x", [
      "last_reviewed_at: 2026-01-01",
      "review_cycle: P30D",
      "expires_at: 2026-06-01",
    ]),
  );
  await writeFile(
    path.join(root, "lenses", "wrong-kind.md"),
    lensDocument("lens.wrong-kind", "context.x", []),
  );

  const result = scanFromRepositorySnapshot(
    await collectRepositorySnapshot(root),
    { evaluationDate: "2026-07-15" },
  );
  const findingsById = new Map<string, typeof result.findings>();
  for (const finding of result.findings) {
    findingsById.set(finding.id, [
      ...(findingsById.get(finding.id) ?? []),
      finding,
    ]);
  }

  assert.equal(
    findingsById.get(DIAGNOSTIC_IDS.META_DEPENDENCY_TARGET_KIND_MISMATCH)
      ?.length,
    1,
  );
  assert.equal(
    findingsById.get(DIAGNOSTIC_IDS.META_DUPLICATE_DECLARED_DEPENDENCY)?.length,
    1,
  );
  assert.equal(
    findingsById.get(DIAGNOSTIC_IDS.COMPOSITION_REQUIRED_CYCLE)?.length,
    1,
  );
  assert.equal(
    findingsById.get(DIAGNOSTIC_IDS.COMPOSITION_OPTIONAL_CYCLE)?.length,
    1,
  );
  assert.equal(
    findingsById.get(DIAGNOSTIC_IDS.COMPOSITION_DECLARED_CONFLICT)?.length,
    1,
  );
  assert.ok(
    findingsById
      .get(DIAGNOSTIC_IDS.MAINT_ASSET_EXPIRED)
      ?.some((finding) => finding.evidence.path === "lenses/review.md"),
  );
  assert.ok(
    findingsById
      .get(DIAGNOSTIC_IDS.MAINT_ASSET_REVIEW_OVERDUE)
      ?.some((finding) => finding.evidence.path === "lenses/review.md"),
  );

  const mismatch = findingsById.get(
    DIAGNOSTIC_IDS.META_DEPENDENCY_TARGET_KIND_MISMATCH,
  )?.[0];
  assert.equal(mismatch?.details?.expectedTargetKind, "context");
  assert.equal(mismatch?.details?.actualTargetKind, "context_lens");
  assert.ok(mismatch?.llmHint);
  assert.ok(mismatch?.constraints?.length);
  assert.ok(mismatch?.verificationSteps?.length);

  const duplicate = findingsById.get(
    DIAGNOSTIC_IDS.META_DUPLICATE_DECLARED_DEPENDENCY,
  )?.[0];
  assert.deepEqual(
    (
      duplicate?.details?.occurrences as Array<{
        evidence: { startLine: number };
      }>
    ).map((occurrence) => occurrence.evidence.startLine),
    [8, 9],
  );
});

function contextDocument(id: string, metadata: string[]): string {
  return [
    "---",
    `id: ${id}`,
    "owner: maintainers",
    "status: stable",
    "when_to_use: composition tests",
    "when_not_to_use: unrelated tests",
    ...metadata,
    "---",
    `# ${id}`,
    "",
    "Composition test context.",
    "",
  ].join("\n");
}

function lensDocument(id: string, target: string, metadata: string[]): string {
  return [
    "---",
    `id: ${id}`,
    "type: context_lens",
    "owner: maintainers",
    "status: stable",
    "purpose: Review composition evidence.",
    `applies_to: ${target}`,
    ...metadata,
    "---",
    `# ${id}`,
    "",
    "Review the declared Context.",
    "",
  ].join("\n");
}
