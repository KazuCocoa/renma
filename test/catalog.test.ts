import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import type { Artifact, ArtifactKind } from "../src/types.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";

test("parseAssetMetadata normalizes supported frontmatter", () => {
  const document = parseDocument(
    artifact(
      "skills/demo/SKILL.md",
      "skill",
      `---
id: demo
version: 1.2.3
owner: qa-platform
status: stable
when_to_use: tests, reviews
when_not_to_use: production deploys
requires_context: product.overview, environment
optional_context: incidents
conflicts: android
---
# Demo
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.deepEqual(result.metadata, {
    id: "demo",
    version: "1.2.3",
    owner: "qa-platform",
    status: "stable",
    tags: [],
    whenToUse: ["tests", "reviews"],
    whenNotToUse: ["production deploys"],
    requiresContext: ["product.overview", "environment"],
    optionalContext: ["incidents"],
    conflicts: ["android"],
    supersededBy: [],
  });
  assert.deepEqual(result.diagnostics, []);
});

test("parseAssetMetadata parses freshness metadata", () => {
  const document = parseDocument(
    artifact(
      "contexts/testing/boundary-value-analysis.md",
      "context",
      `---
id: context.testing.boundary-value-analysis
owner: qa-platform
last_reviewed_at: 2026-06-28
review_cycle: P90D
expires_at: 2026-12-31
---
# Boundary Value Analysis
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.equal(result.metadata.lastReviewedAt, "2026-06-28");
  assert.equal(result.metadata.reviewCycle, "P90D");
  assert.equal(result.metadata.expiresAt, "2026-12-31");
  assert.deepEqual(result.diagnostics, []);
});

test("parseAssetMetadata reports invalid freshness date evidence", () => {
  const document = parseDocument(
    artifact(
      "contexts/testing/boundary-value-analysis.md",
      "context",
      `---
id: context.testing.boundary-value-analysis
owner: qa-platform
last_reviewed_at: 2026-02-31
expires_at: tomorrow
---
# Boundary Value Analysis
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.equal(result.diagnostics.length, 2);
  const lastReviewedAt = result.diagnostics.find((diagnostic) =>
    diagnostic.message.includes("last_reviewed_at"),
  );
  assert.equal(lastReviewedAt?.evidence?.startLine, 4);
  assert.match(lastReviewedAt?.evidence?.snippet ?? "", /2026-02-31/);
  const expiresAt = result.diagnostics.find((diagnostic) =>
    diagnostic.message.includes("expires_at"),
  );
  assert.equal(expiresAt?.evidence?.startLine, 5);
  assert.match(expiresAt?.evidence?.snippet ?? "", /tomorrow/);
});

test("parseAssetMetadata reports invalid review_cycle evidence", () => {
  const document = parseDocument(
    artifact(
      "contexts/testing/boundary-value-analysis.md",
      "context",
      `---
id: context.testing.boundary-value-analysis
owner: qa-platform
review_cycle: P3M
---
# Boundary Value Analysis
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0]?.message ?? "", /review_cycle/);
  assert.equal(result.diagnostics[0]?.evidence?.startLine, 4);
  assert.match(result.diagnostics[0]?.evidence?.snippet ?? "", /P3M/);
});

test("parseAssetMetadata captures superseded_by references", () => {
  const document = parseDocument(
    artifact(
      "skills/demo/references/guide.md",
      "reference",
      `---
id: demo.guide
status: deprecated
superseded_by: contexts/tools/demo/guide.md, contexts/tools/demo/checklist.md
---
# Guide
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.deepEqual(result.metadata.supersededBy, [
    "contexts/tools/demo/guide.md",
    "contexts/tools/demo/checklist.md",
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test("parseAssetMetadata reports invalid lifecycle status", () => {
  const document = parseDocument(
    artifact(
      "skills/demo/SKILL.md",
      "skill",
      `---
status: permanent
---
# Demo
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.equal(result.metadata.status, undefined);
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0]?.message ?? "", /Invalid status/);
});

test("parseAssetMetadata supports simple block-list frontmatter", () => {
  const document = parseDocument(
    artifact(
      "skills/testing/spec-review/SKILL.md",
      "skill",
      `---
id: skill.testing.spec-review
tags:
  - testing
  - spec-review
  - qa
status: stable
requires_context:
  - context.testing.boundary-value-analysis
  - context.testing.negative-testing
optional_context:
  - context.domain.payment.idempotency
conflicts:
  - archived.testing.old-review
---

# Spec Review
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.deepEqual(result.metadata.tags, ["testing", "spec-review", "qa"]);
  assert.deepEqual(result.metadata.requiresContext, [
    "context.testing.boundary-value-analysis",
    "context.testing.negative-testing",
  ]);
  assert.deepEqual(result.metadata.optionalContext, [
    "context.domain.payment.idempotency",
  ]);
  assert.deepEqual(result.metadata.conflicts, ["archived.testing.old-review"]);
});

test("parseAssetMetadata keeps comma-separated list metadata working", () => {
  const document = parseDocument(
    artifact(
      "skills/testing/spec-review/SKILL.md",
      "skill",
      `---
id: skill.testing.spec-review
tags: testing, spec-review, qa
requires_context: context.testing.boundary-value-analysis, context.testing.negative-testing
---

# Spec Review
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.deepEqual(result.metadata.tags, ["testing", "spec-review", "qa"]);
  assert.deepEqual(result.metadata.requiresContext, [
    "context.testing.boundary-value-analysis",
    "context.testing.negative-testing",
  ]);
});

test("buildCatalog warns when shared context assets lack governance metadata", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        "# Boundary Value Analysis\n",
      ),
    ),
  ]);

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.message),
    ["Asset is missing an id.", "Asset is missing an owner."],
  );
});

test("buildCatalog creates deterministic entries for skills and context", () => {
  const documents = [
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: testing.boundary-value-analysis
owner: qa-platform
---
# Boundary Value Analysis
`,
      ),
    ),
    parseDocument(
      artifact(
        "skills/demo/references/guide.md",
        "reference",
        `---
id: demo.guide
owner: qa-platform
---
# Guide
`,
      ),
    ),
    parseDocument(
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        `---
id: demo
requires_context: demo.guide
---
# Demo
`,
      ),
    ),
  ];

  const result = buildCatalog(documents);

  assert.deepEqual(
    result.catalog.entries.map((entry) => entry.id),
    ["demo", "testing.boundary-value-analysis", "demo.guide"],
  );
  assert.deepEqual(
    result.catalog.entries.map((entry) => entry.kind),
    ["skill", "context", "reference"],
  );
  assert.equal(result.catalog.entries[0]?.sourcePath, "skills/demo/SKILL.md");
});

test("buildCatalog emits normalized asset hashes and dependency edges", () => {
  const skillContent = `---
id: demo
requires_context: product.overview, environment
optional_context: incidents
conflicts: android
---
# Demo
`;
  const skillArtifact = artifact("skills/demo/SKILL.md", "skill", skillContent);
  const { catalog } = buildCatalog([parseDocument(skillArtifact)]);

  assert.equal(catalog.assets, catalog.entries);
  assert.equal(
    catalog.entries[0]?.contentHash,
    `sha256:${createHash("sha256").update(skillArtifact.content).digest("hex")}`,
  );
  assert.deepEqual(
    catalog.dependencies.map((dependency) => ({
      from: dependency.from,
      to: dependency.to,
      kind: dependency.kind,
      sourcePath: dependency.sourcePath,
    })),
    [
      {
        from: "demo",
        to: "environment",
        kind: "requires",
        sourcePath: "skills/demo/SKILL.md",
      },
      {
        from: "demo",
        to: "product.overview",
        kind: "requires",
        sourcePath: "skills/demo/SKILL.md",
      },
      {
        from: "demo",
        to: "incidents",
        kind: "optional",
        sourcePath: "skills/demo/SKILL.md",
      },
      {
        from: "demo",
        to: "android",
        kind: "conflicts",
        sourcePath: "skills/demo/SKILL.md",
      },
    ],
  );
});

test("buildCatalog creates dependency edges from block-list metadata", () => {
  const skillContent = `---
id: skill.testing.spec-review
owner: qa-platform
status: experimental
tags:
  - testing
  - spec-review
requires_context:
  - context.testing.boundary-value-analysis
optional_context:
  - context.testing.negative-testing
conflicts:
  - archived.testing.old-review
---
# Spec Review
`;
  const { catalog } = buildCatalog([
    parseDocument(
      artifact("skills/testing/spec-review/SKILL.md", "skill", skillContent),
    ),
  ]);

  assert.deepEqual(catalog.entries[0]?.metadata.tags, [
    "testing",
    "spec-review",
  ]);

  const dependencies = new Map(
    catalog.dependencies.map((dependency) => [dependency.to, dependency.kind]),
  );
  assert.equal(
    dependencies.get("context.testing.boundary-value-analysis"),
    "requires",
  );
  assert.equal(
    dependencies.get("context.testing.negative-testing"),
    "optional",
  );
  assert.equal(dependencies.get("archived.testing.old-review"), "conflicts");
});

test("parseDocument records frontmatter field evidence", () => {
  const document = parseDocument(
    artifact(
      "skills/demo/SKILL.md",
      "context",
      `---
id: skill.demo
requires_context:
  - context.demo.required
---
# Demo
`,
    ),
  );

  assert.deepEqual(document.metadata.requires_context, [
    "context.demo.required",
  ]);
  assert.equal(document.metadataFields.requires_context?.startLine, 3);
  assert.equal(document.metadataFields.requires_context?.endLine, 4);
  assert.equal(
    document.metadataFields.requires_context?.raw,
    "requires_context:\n  - context.demo.required",
  );
  assert.equal(document.metadataListItems.requires_context?.[0]?.startLine, 4);
  assert.equal(
    document.metadataListItems.requires_context?.[0]?.raw,
    "  - context.demo.required",
  );
});

test("buildCatalog uses metadata field evidence on dependency edges", () => {
  const { catalog } = buildCatalog([
    parseDocument(
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        `---
id: skill.demo
requires_context:
  - context.demo.required
---
# Demo
`,
      ),
    ),
    parseDocument(
      artifact(
        "context/demo/required.md",
        "context",
        `---
id: context.demo.required
owner: qa-platform
status: stable
---
# Required
`,
      ),
    ),
  ]);

  assert.equal(catalog.dependencies[0]?.evidence?.startLine, 6);
  assert.equal(catalog.dependencies[0]?.evidence?.endLine, 6);
  assert.equal(
    catalog.dependencies[0]?.evidence?.snippet,
    `  renma.requires-context: '["context.demo.required"]'`,
  );
});

test("buildCatalog validates dependency targets", () => {
  const { diagnostics } = buildCatalog([
    parseDocument(
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        `---
id: skill.demo
optional_context:
  - context.demo.missing
  - context.demo.old
---
# Demo
`,
      ),
    ),
    parseDocument(
      artifact(
        "context/demo/old.md",
        "context",
        `---
id: context.demo.old
owner: qa-platform
status: deprecated
---
# Old
`,
      ),
    ),
  ]);

  const unknown = diagnostics.find((diagnostic) =>
    diagnostic.message.includes("does not match a catalog entry"),
  );
  assert.equal(unknown?.evidence?.startLine, 6);
  assert.equal(unknown?.evidence?.endLine, 6);

  const inactive = diagnostics.find((diagnostic) =>
    diagnostic.message.includes("targets a deprecated asset"),
  );
  assert.equal(inactive?.evidence?.startLine, 6);
  assert.equal(inactive?.evidence?.endLine, 6);
});

test("buildCatalog suppresses generic missing-target diagnostics for conflicts", () => {
  const { catalog, diagnostics } = buildCatalog([
    parseDocument(
      artifact(
        "skills/demo/SKILL.md",
        "skill",
        `---
id: skill.demo
requires_context:
  - context.demo.required-missing
optional_context:
  - context.demo.optional-missing
conflicts:
  - context.demo.conflict-missing
---
# Demo
`,
      ),
    ),
  ]);

  assert.ok(
    catalog.dependencies.some(
      (dependency) =>
        dependency.kind === "conflicts" &&
        dependency.to === "context.demo.conflict-missing",
    ),
  );

  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.message ===
        'Asset conflicts target "context.demo.conflict-missing" does not match a catalog entry.',
    ),
  );
  assert.ok(
    !diagnostics.some(
      (diagnostic) =>
        diagnostic.message ===
        'Metadata dependency "context.demo.conflict-missing" from "skill.demo" does not match a catalog entry.',
    ),
  );
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.message ===
        'Metadata dependency "context.demo.required-missing" from "skill.demo" does not match a catalog entry.',
    ),
  );
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.message ===
        'Metadata dependency "context.demo.optional-missing" from "skill.demo" does not match a catalog entry.',
    ),
  );
});

function artifact(path: string, kind: ArtifactKind, content: string): Artifact {
  const operationalContent =
    kind === "skill" ? canonicalSkillFixture(path, content) : content;
  return {
    path,
    absolutePath: `/tmp/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(operationalContent),
    contentClassification: "text",
    markdownParserEligible: true,
    content: operationalContent,
  };
}
