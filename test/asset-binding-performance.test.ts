import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import { inspectAssetBindings } from "../src/public-asset-bindings.js";

// Count source accesses instead of imposing a wall-clock limit on shared CI.
// The regression read and rescanned the entire source for every ordinary node.
test("catalog binding analysis reads unbound source a bounded number of times", () => {
  const reads = [100, 1000].map((paragraphs) => {
    const content =
      "---\nid: ctx.test\nversion: '1'\n---\n" +
      Array.from(
        { length: paragraphs },
        (_, index) =>
          `Paragraph ${index}: **ordinary words** and [an ordinary link](https://example.com).\n\n`,
      ).join("");
    const document = parseDocument({
      path: "contexts/test.md",
      absolutePath: "contexts/test.md",
      kind: "context",
      content,
      sizeBytes: Buffer.byteLength(content),
      contentClassification: "text",
      markdownParserEligible: true,
    });
    let sourceReads = 0;
    Object.defineProperty(document.artifact, "content", {
      get() {
        sourceReads++;
        return content;
      },
    });
    const { assetBindings } = buildCatalog([document]);
    assert.deepEqual(assetBindings.documents[0]!.references, []);
    assert.equal(assetBindings.documents[0]!.identity.evidence.raw, content);
    assert.equal(
      assetBindings.documents[0]!.identity.evidence.sha256,
      createHash("sha256").update(content).digest("hex"),
    );
    return sourceReads;
  });
  assert.equal(
    reads[0],
    reads[1],
    "ordinary nodes must not trigger additional full-source reads",
  );
  assert.ok(reads[1]! < 100, `unexpected repeated source reads: ${reads[1]}`);
});

test("many bound references retain original offsets and lines across the document", () => {
  const header =
    "---\nid: ctx.a\nversion: '1'\nrequires_context: [ctx.b]\nasset_bindings:\n - {alias: b, target: ctx.b, version: '1'}\n---\n";
  const count = 1000;
  const body = Array.from(
    { length: count },
    (_, index) =>
      `😀 [B](renma-asset:b)${index === count - 1 ? "" : index % 2 ? "\r\n" : "\r"}`,
  ).join("");
  const content = header + body;
  const bytes = Buffer.from(content);
  const source = inspectAssetBindings([
    { path: "contexts/a.md", bytes },
    {
      path: "contexts/b.md",
      bytes: Buffer.from("---\nid: ctx.b\nversion: '1'\n---\n"),
    },
  ]).documents[0]!;
  assert.equal(source.declarationValid, true);
  assert.equal(source.bindings[0]!.satisfied, true);
  assert.equal(source.references.length, count);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  for (const [index, reference] of source.references.entries()) {
    const destination = reference.destination!;
    assert.equal(destination.raw, "renma-asset:b");
    assert.equal(
      content.slice(destination.start, destination.end),
      destination.raw,
    );
    assert.equal(destination.startLine, 8 + index);
    assert.equal(destination.endLine, 8 + index);
    assert.equal(destination.sha256, sha256);
    assert.equal(reference.evidence.raw, "[B](renma-asset:b)");
  }
});
