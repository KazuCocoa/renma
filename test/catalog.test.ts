import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

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
    [
      "Shared context asset is missing an id.",
      "Shared context asset is missing an owner.",
    ],
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
  const { catalog } = buildCatalog([
    parseDocument(artifact("skills/demo/SKILL.md", "skill", skillContent)),
  ]);

  assert.equal(catalog.assets, catalog.entries);
  assert.equal(
    catalog.entries[0]?.contentHash,
    `sha256:${createHash("sha256").update(skillContent).digest("hex")}`,
  );
  assert.deepEqual(
    catalog.dependencies.map((dependency) => ({
      from: dependency.from,
      to: dependency.to,
      kind: dependency.kind,
      sourcePath: dependency.sourcePath,
      evidence: dependency.evidence,
    })),
    [
      {
        from: "demo",
        to: "environment",
        kind: "requires",
        sourcePath: "skills/demo/SKILL.md",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: 1,
          endLine: 1,
          snippet: "frontmatter dependency metadata",
        },
      },
      {
        from: "demo",
        to: "product.overview",
        kind: "requires",
        sourcePath: "skills/demo/SKILL.md",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: 1,
          endLine: 1,
          snippet: "frontmatter dependency metadata",
        },
      },
      {
        from: "demo",
        to: "incidents",
        kind: "optional",
        sourcePath: "skills/demo/SKILL.md",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: 1,
          endLine: 1,
          snippet: "frontmatter dependency metadata",
        },
      },
      {
        from: "demo",
        to: "android",
        kind: "conflicts",
        sourcePath: "skills/demo/SKILL.md",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: 1,
          endLine: 1,
          snippet: "frontmatter dependency metadata",
        },
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

function artifact(path: string, kind: ArtifactKind, content: string): Artifact {
  return {
    path,
    absolutePath: `/tmp/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    content,
  };
}
