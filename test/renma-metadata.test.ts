import assert from "node:assert/strict";
import test from "node:test";

import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import type { Artifact } from "../src/types.js";

test("canonical Renma metadata takes precedence over legacy fields and preserves evidence", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review. Do not use for production work.
owner: legacy-owner
requires_context:
  - context.legacy
metadata:
  renma.owner: canonical-owner
  renma.requires-context: '["context.canonical"]'
---
# Demo
`;
  const document = parseDocument(artifact(content));
  const result = parseAssetMetadata(document);

  assert.equal(result.metadata.owner, "canonical-owner");
  assert.deepEqual(result.metadata.requiresContext, ["context.canonical"]);
  assert.equal(
    document.metadataFields.requires_context?.startLine,
    document.metadataFields["metadata.renma.requires-context"]?.startLine,
  );
  assert.equal(
    result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RENMA-METADATA-CONFLICTING-SOURCES",
    ).length,
    2,
  );
});

function artifact(content: string): Artifact {
  return {
    path: "skills/demo/SKILL.md",
    absolutePath: "/tmp/skills/demo/SKILL.md",
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    content,
  };
}
