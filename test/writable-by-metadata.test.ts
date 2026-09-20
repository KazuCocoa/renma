import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { DEFAULT_QUALITY_PROFILE } from "../src/quality-profile.js";
import { loadConfig } from "../src/config.js";
import { buildCatalog } from "../src/catalog.js";
import { catalog, formatCatalogJson } from "../src/commands/catalog.js";
import { buildInspectOutline } from "../src/commands/inspect.js";
import { ownership } from "../src/commands/ownership.js";
import { readiness } from "../src/commands/readiness.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import { renderTextOutline } from "../src/renderers/inspect.js";
import { buildTrustGraph } from "../src/trust-graph.js";
import type { ArtifactKind } from "../src/types/artifact.js";

const principals = [
  "release-engineering",
  "opaque:principal",
  "release-engineering",
];
const skill = (declaration = "") => `---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.owner: qa-platform
${declaration}---
# Demo
Review the supplied inputs and report findings.
`;
const canonical = `  renma.writable-by: '[" release-engineering ","opaque:principal","release-engineering",""]'\n`;
const support = (declaration = "") => `---
${declaration}---
# Notes
Review notes.
`;
function document(content: string, kind: ArtifactKind = "skill") {
  const sourcePath =
    kind === "skill"
      ? "skills/demo/SKILL.md"
      : "skills/demo/references/notes.md";
  return parseDocument({
    path: sourcePath,
    absolutePath: `/tmp/${sourcePath}`,
    kind,
    content,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
  });
}

test("writable-by uses canonical list normalization and scalar field evidence", () => {
  const parsed = parseAssetMetadata(document(skill(canonical)));
  assert.deepEqual(parsed.metadata.writableBy, principals);
  assert.equal(parsed.metadata.owner, "qa-platform");
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.metadataFields.writable_by?.key, "renma.writable-by");
  assert.equal(parsed.metadataFields.writable_by?.startLine, 6);
  assert.equal(parsed.metadataFields.writable_by?.raw, canonical.trimEnd());
  // Canonical lists are scalar strings: existing conventions retain field evidence,
  // with no invented YAML sequence-item locations.
  assert.deepEqual(parsed.metadataListItems.writable_by, []);
});

test("non-Skill declarations retain field and individual YAML list-item evidence", () => {
  const parsed = parseAssetMetadata(
    document(
      support(
        `writable_by:\n  - release-engineering\n  - opaque:principal\n  - release-engineering\n`,
      ),
      "reference",
    ),
  );
  assert.deepEqual(parsed.metadata.writableBy, principals);
  assert.equal(parsed.metadataFields.writable_by?.startLine, 2);
  assert.deepEqual(
    parsed.metadataListItems.writable_by?.map((item) => [
      item.startLine,
      item.endLine,
      item.raw,
    ]),
    [
      [3, 3, "  - release-engineering"],
      [4, 4, "  - opaque:principal"],
      [5, 5, "  - release-engineering"],
    ],
  );
  assert.deepEqual(
    parseAssetMetadata(
      document(
        support("writable_by: release-engineering, opaque:principal\n"),
        "reference",
      ),
    ).metadata.writableBy,
    principals.slice(0, 2),
  );
});

test("omission and empty lists stay absent; malformed canonical lists reuse diagnostics", () => {
  for (const declaration of ["", "  renma.writable-by: '[]'\n"]) {
    const parsed = parseAssetMetadata(document(skill(declaration)));
    assert.equal(Object.hasOwn(parsed.metadata, "writableBy"), false);
    assert.deepEqual(parsed.diagnostics, []);
    assert.equal(JSON.stringify(parsed.metadata).includes("writableBy"), false);
  }
  for (const declaration of [
    "  renma.writable-by: '[42]'\n",
    "  renma.writable-by: invalid\n",
  ]) {
    const parsed = parseAssetMetadata(document(skill(declaration)));
    assert.equal(parsed.metadata.writableBy, undefined);
    assert.ok(
      parsed.diagnostics.some((d) => d.message.includes("renma.writable-by")),
    );
  }
  assert.equal(
    parseAssetMetadata(document(skill("  renma.writable-by: [native, yaml]\n")))
      .metadata.writableBy,
    undefined,
  );
});

test("writable_by is opt-in required metadata for Skills and non-Skills", () => {
  for (const kind of ["skill", "reference"] as const) {
    for (const present of [false, true]) {
      const doc = document(
        kind === "skill"
          ? skill(present ? canonical : "")
          : support(present ? "writable_by: [opaque:principal]\n" : ""),
        kind,
      );
      assert.equal(
        buildCatalog([doc]).diagnostics.some(
          (d) => d.code === "META-POLICY-REQUIRED-FIELD-MISSING",
        ),
        false,
      );
      const result = buildCatalog([doc], undefined, undefined, {
        policy: {
          ciPolicy: "fail",
          required: ["writable_by"],
          requiredSource: "repository_configuration",
        },
      });
      const findings = result.diagnostics.filter(
        (d) => d.code === "META-POLICY-REQUIRED-FIELD-MISSING",
      );
      assert.equal(findings.length, present ? 0 : 1);
      if (!present)
        assert.equal(
          findings[0]?.details?.expectedSerializedKey,
          kind === "skill" ? "metadata.renma.writable-by" : "writable_by",
        );
    }
  }
});

test("catalog and inspection expose declarations without changing ownership, inheritance, trust edges, or readiness", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-writable-by-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "skills/demo/references"), { recursive: true });
  await writeFile(path.join(root, "renma.config.jsonc"), "{}");
  const target = path.join(root, "skills/demo/SKILL.md");
  await writeFile(target, skill());
  await writeFile(
    path.join(root, "skills/demo/references/notes.md"),
    "# Notes\nReview notes.\n",
  );
  await writeFile(
    path.join(root, "renma.config.jsonc"),
    JSON.stringify({ metadata: { required: ["writable_by"] } }),
  );
  const configured = await loadConfig(root, {});
  assert.deepEqual(configured.config.metadata.required, ["writable_by"]);
  await writeFile(path.join(root, "renma.config.jsonc"), "{}");
  const beforeCatalog = await catalog(root);
  const beforeOwnership = await ownership(root);
  const beforeReadiness = await readiness(root);
  await writeFile(target, skill(canonical));
  const after = await catalog(root);
  const wire = JSON.parse(formatCatalogJson(after));
  assert.equal(wire.schemaVersion, "renma.catalog.v1");
  assert.deepEqual(
    wire.catalog.entries.find(
      (entry: { kind: string }) => entry.kind === "skill",
    ).metadata.writableBy,
    principals,
  );
  const outline = await buildInspectOutline(target);
  assert.deepEqual(outline.asset?.writableBy, principals);
  assert.match(
    renderTextOutline(outline),
    /Writable by \(declared\): release-engineering, opaque:principal, release-engineering/,
  );
  assert.deepEqual(await ownership(root), beforeOwnership);
  assert.deepEqual(
    after.catalog.assets.map((a) => a.ownership),
    beforeCatalog.catalog.assets.map((a) => a.ownership),
  );
  const reference = after.catalog.assets.find((a) => a.kind === "reference");
  assert.equal(reference?.ownership.effectiveOwner, "qa-platform");
  assert.equal(reference?.metadata.writableBy, undefined);
  assert.deepEqual(
    buildTrustGraph({ catalog: after.catalog }).edges,
    buildTrustGraph({ catalog: beforeCatalog.catalog }).edges,
  );
  const afterReadiness = await readiness(root);
  assert.equal(afterReadiness.score, beforeReadiness.score);
  assert.equal(afterReadiness.level, beforeReadiness.level);
  assert.deepEqual(after.diagnostics, beforeCatalog.diagnostics);
});

test("opaque modification principals are exempt from prose budgets in every encoding", () => {
  // The colon deliberately avoids the generic ID-shaped value exemption.
  const principal = `principal:${"x".repeat(DEFAULT_QUALITY_PROFILE.metadataListItemMaxChars)}`;
  const declarations = [
    document(skill(`  renma.writable-by: '${JSON.stringify([principal])}'\n`)),
    document(support(`writable_by:\n  - ${principal}\n`), "reference"),
    document(support(`writable_by: ${principal}\n`), "reference"),
  ];
  for (const declaration of declarations) {
    const result = buildCatalog([declaration]);
    assert.deepEqual(result.catalog.entries[0]?.metadata.writableBy, [
      principal,
    ]);
    assert.equal(
      result.diagnostics.some(
        (d) => d.code === DIAGNOSTIC_IDS.META_LIST_ITEM_TOO_LONG,
      ),
      false,
      declaration.artifact.content,
    );
  }

  const prose = `Use this when ${"x".repeat(DEFAULT_QUALITY_PROFILE.metadataListItemMaxChars)}`;
  for (const declaration of [
    document(support(`when_to_use:\n  - ${prose}\n`), "reference"),
    document(skill(`  renma.tags: '${JSON.stringify([prose])}'\n`)),
  ]) {
    const result = buildCatalog([declaration]);
    assert.ok(
      result.diagnostics.some(
        (d) => d.code === DIAGNOSTIC_IDS.META_LIST_ITEM_TOO_LONG,
      ),
    );
  }
});
