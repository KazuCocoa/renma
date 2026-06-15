import assert from "node:assert/strict";
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
    whenToUse: ["tests", "reviews"],
    whenNotToUse: ["production deploys"],
    requiresContext: ["product.overview", "environment"],
    optionalContext: ["incidents"],
    conflicts: ["android"],
  });
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

test("buildCatalog creates deterministic entries for skills and context", () => {
  const documents = [
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
    ["demo", "demo.guide"],
  );
  assert.equal(result.catalog.entries[0]?.sourcePath, "skills/demo/SKILL.md");
});

function artifact(
  path: string,
  kind: ArtifactKind,
  content: string,
): Artifact {
  return {
    path,
    absolutePath: `/tmp/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    content,
  };
}
