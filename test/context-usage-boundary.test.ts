import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import { scan } from "../src/scanner.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

test("buildCatalog warns when active shared context lacks usage-boundary metadata", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
---
# Boundary Value Analysis
`,
      ),
    ),
  ]);

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Shared context asset is missing when_to_use metadata.",
      "Shared context asset is missing when_not_to_use metadata.",
    ],
  );
  assert.equal(
    result.diagnostics[0]?.evidence?.snippet,
    "frontmatter missing when_to_use",
  );
  assert.equal(
    result.diagnostics[1]?.evidence?.snippet,
    "frontmatter missing when_not_to_use",
  );
});

test("buildCatalog detects placeholder usage-boundary metadata", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
when_to_use:
  - TODO: define positive scope
when_not_to_use: TBD
---
# Boundary Value Analysis
`,
      ),
    ),
  ]);

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Shared context asset usage-boundary metadata contains placeholder values in when_to_use.",
      "Shared context asset usage-boundary metadata contains placeholder values in when_not_to_use.",
    ],
  );
  assert.equal(result.diagnostics[0]?.evidence?.startLine, 6);
  assert.match(result.diagnostics[0]?.evidence?.snippet ?? "", /TODO/);
  assert.equal(result.diagnostics[1]?.evidence?.startLine, 7);
  assert.match(result.diagnostics[1]?.evidence?.snippet ?? "", /TBD/);
});

test("buildCatalog does not require usage boundaries for inactive shared context", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/old-boundary-value-analysis.md",
        "context",
        `---
id: context.testing.old-boundary-value-analysis
owner: qa-platform
status: deprecated
---
# Old Boundary Value Analysis
`,
      ),
    ),
  ]);

  assert.deepEqual(result.diagnostics, []);
});

test("scan emits stable usage-boundary finding ids", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "testing", "boundary-value-analysis.md"),
    `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
when_to_use:
  - TODO
---
# Boundary Value Analysis
`,
  );

  const result = await scan(root);
  const findingIds = result.findings.map((finding) => finding.id);

  assert.ok(findingIds.includes("META-CONTEXT-PLACEHOLDER-USAGE-BOUNDARY"));
  assert.ok(findingIds.includes("META-CONTEXT-MISSING-WHEN-NOT-TO-USE"));
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-context-usage-boundary-"));
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
