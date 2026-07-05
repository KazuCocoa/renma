import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

test("buildCatalog warns when deprecated context lacks superseded_by", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/old-boundary-analysis.md",
        "context",
        contextAsset({
          id: "context.testing.old-boundary-analysis",
          status: "deprecated",
        }),
      ),
    ),
  ]);

  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.message ===
        "Deprecated shared context asset is missing superseded_by metadata.",
    ),
  );
});

test("buildCatalog warns when superseded_by points to itself", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/boundary-analysis.md",
        "context",
        contextAsset({
          id: "context.testing.boundary-analysis",
          status: "deprecated",
          supersededBy: ["context.testing.boundary-analysis"],
        }),
      ),
    ),
  ]);

  assert.ok(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("superseded_by references itself"),
    ),
  );
});

test("buildCatalog warns when superseded_by target is inactive", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/old-boundary-analysis.md",
        "context",
        contextAsset({
          id: "context.testing.old-boundary-analysis",
          status: "deprecated",
          supersededBy: ["context.testing.new-boundary-analysis"],
        }),
      ),
    ),
    parseDocument(
      artifact(
        "contexts/testing/new-boundary-analysis.md",
        "context",
        contextAsset({
          id: "context.testing.new-boundary-analysis",
          status: "archived",
        }),
      ),
    ),
  ]);

  assert.ok(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("resolves to a archived asset"),
    ),
  );
});

test("buildCatalog warns when superseded_by chain forms a cycle", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/old-a.md",
        "context",
        contextAsset({
          id: "context.testing.old-a",
          status: "deprecated",
          supersededBy: ["context.testing.old-b"],
        }),
      ),
    ),
    parseDocument(
      artifact(
        "contexts/testing/old-b.md",
        "context",
        contextAsset({
          id: "context.testing.old-b",
          status: "deprecated",
          supersededBy: ["context.testing.old-a"],
        }),
      ),
    ),
  ]);

  assert.ok(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("superseded_by chain forms a cycle"),
    ),
  );
});

function contextAsset(options: {
  id: string;
  status: "experimental" | "stable" | "deprecated" | "archived";
  supersededBy?: string[];
}): string {
  const supersededByLines = options.supersededBy
    ?.map((id) => `  - ${id}`)
    .join("\n");
  const supersededBy = supersededByLines
    ? `superseded_by:\n${supersededByLines}\n`
    : "";

  return `---
id: ${options.id}
owner: qa-platform
status: ${options.status}
${supersededBy}when_to_use:
  - Reviewing test design knowledge
when_not_to_use:
  - Non-test-design guidance
---
# Test Context

Reusable testing guidance.
`;
}

function artifact(path: string, kind: ArtifactKind, content: string): Artifact {
  return {
    path,
    absolutePath: `/tmp/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    content,
  };
}
