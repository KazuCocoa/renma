import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

test("parseAssetMetadata captures context lens metadata", () => {
  const document = parseDocument(
    artifact(
      "lenses/testing/spec-review-boundary-values.md",
      "context_lens",
      `---
id: lens.testing.spec-review.boundary-values
type: context_lens
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
focus:
  - ambiguity
  - missing boundary
expected_outputs:
  - unresolved questions
  - risk notes
---
# Spec Review Boundary Lens
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.equal(result.metadata.type, "context_lens");
  assert.equal(result.metadata.purpose, "spec_review");
  assert.deepEqual(result.metadata.appliesTo, [
    "context.testing.boundary-value-analysis",
  ]);
  assert.deepEqual(result.metadata.focus, ["ambiguity", "missing boundary"]);
  assert.deepEqual(result.metadata.expectedOutputs, [
    "unresolved questions",
    "risk notes",
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test("buildCatalog catalogs context lens assets and applies_to edges", () => {
  const { catalog, diagnostics } = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
when_to_use:
  - Designing boundary-focused tests
when_not_to_use:
  - Exploratory notes unrelated to limits
---
# Boundary Value Analysis
`,
      ),
    ),
    parseDocument(
      artifact(
        "lenses/testing/spec-review-boundary-values.md",
        "context_lens",
        `---
id: lens.testing.spec-review.boundary-values
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Boundary Lens
`,
      ),
    ),
  ]);

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    catalog.entries.map((entry) => [entry.id, entry.kind]),
    [
      ["context.testing.boundary-value-analysis", "context"],
      ["lens.testing.spec-review.boundary-values", "context_lens"],
    ],
  );
  assert.ok(
    catalog.dependencies.some(
      (dependency) =>
        dependency.from === "lens.testing.spec-review.boundary-values" &&
        dependency.kind === "applies_to" &&
        dependency.to === "context.testing.boundary-value-analysis",
    ),
  );
});

test("buildCatalog treats type context_lens under contexts as a lens", () => {
  const { catalog } = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/spec-review-lens.md",
        "context",
        `---
id: lens.testing.spec-review
type: context_lens
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Lens
`,
      ),
    ),
  ]);

  assert.equal(catalog.entries[0]?.kind, "context_lens");
  assert.equal(catalog.entries[0]?.id, "lens.testing.spec-review");
});

test("buildCatalog keeps skill files as skills when type is context_lens", () => {
  const { catalog } = buildCatalog([
    parseDocument(
      artifact(
        "skills/testing/spec-review/SKILL.md",
        "skill",
        `---
id: skill.testing.spec-review
type: context_lens
owner: qa-platform
status: experimental
requires_lens:
  - lens.testing.spec-review
---
# Spec Review
`,
      ),
    ),
  ]);

  assert.equal(catalog.entries[0]?.kind, "skill");
  assert.equal(catalog.entries[0]?.id, "skill.testing.spec-review");
});

test("buildCatalog creates skill to lens dependency edges", () => {
  const { catalog } = buildCatalog([
    parseDocument(
      artifact(
        "skills/testing/spec-review/SKILL.md",
        "skill",
        `---
id: skill.testing.spec-review
requires_lens:
  - lens.testing.spec-review.boundary-values
optional_lens:
  - lens.testing.failure-analysis.symptoms
---
# Spec Review
`,
      ),
    ),
  ]);

  assert.deepEqual(
    catalog.dependencies.map((dependency) => ({
      from: dependency.from,
      to: dependency.to,
      kind: dependency.kind,
    })),
    [
      {
        from: "skill.testing.spec-review",
        to: "lens.testing.spec-review.boundary-values",
        kind: "requires",
      },
      {
        from: "skill.testing.spec-review",
        to: "lens.testing.failure-analysis.symptoms",
        kind: "optional",
      },
    ],
  );
});

test("buildCatalog warns about missing context lens wiring metadata", () => {
  const { diagnostics } = buildCatalog([
    parseDocument(
      artifact(
        "lenses/testing/spec-review.md",
        "context_lens",
        `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
---
# Spec Review Lens
`,
      ),
    ),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("missing purpose metadata"),
    ),
  );
  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("missing applies_to metadata"),
    ),
  );
});

test("buildCatalog validates lens references and applied contexts", () => {
  const { diagnostics } = buildCatalog([
    parseDocument(
      artifact(
        "skills/testing/spec-review/SKILL.md",
        "skill",
        `---
id: skill.testing.spec-review
requires_lens:
  - lens.testing.missing
---
# Spec Review
`,
      ),
    ),
    parseDocument(
      artifact(
        "lenses/testing/spec-review.md",
        "context_lens",
        `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.missing
---
# Spec Review Lens
`,
      ),
    ),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes('"lens.testing.missing"'),
    ),
  );
  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes('"context.testing.missing"'),
    ),
  );
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
