import assert from "node:assert/strict";
import test from "node:test";

import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import type { Artifact } from "../src/types.js";

test("normal Skill metadata ignores historical top-level fields", () => {
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

  assert.equal(result.metadata.owner, undefined);
  assert.deepEqual(result.metadata.requiresContext, []);
  assert.equal(document.metadataFields.requires_context, undefined);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(document.metadata["metadata.renma.owner"], undefined);
  assert.equal(document.metadata.requires_context, undefined);
});

test("legacy-only Skill metadata is not operational", () => {
  const content = `---
id: skill.demo
owner: qa-platform
requires_context:
  - context.demo
---
# Demo
`;
  const result = parseAssetMetadata(parseDocument(artifact(content)));

  assert.equal(result.metadata.id, undefined);
  assert.equal(result.metadata.owner, undefined);
  assert.deepEqual(result.metadata.requiresContext, []);
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
