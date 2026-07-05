import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

test("buildCatalog warns when canonical context contains vague wording", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/tools/appium/webdriveragent.md",
        "context",
        contextAsset("WDA is often involved in iOS session startup failures."),
      ),
    ),
  ]);

  const diagnostic = result.diagnostics.find((candidate) =>
    candidate.message.includes("contains vague wording"),
  );

  assert.equal(
    diagnostic?.message,
    'Shared context asset contains vague wording "often".',
  );
  assert.equal(diagnostic?.evidence?.startLine, 12);
  assert.match(diagnostic?.evidence?.snippet ?? "", /often/);
});

test("buildCatalog warns when canonical context contains undated currentness wording", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/tools/appium/drivers.md",
        "context",
        contextAsset("Recently Appium driver installation guidance changed."),
      ),
    ),
  ]);

  const diagnostic = result.diagnostics.find((candidate) =>
    candidate.message.includes("contains currentness wording"),
  );

  assert.equal(
    diagnostic?.message,
    'Shared context asset contains currentness wording "recently" without an explicit date or version.',
  );
  assert.equal(diagnostic?.evidence?.startLine, 12);
  assert.match(diagnostic?.evidence?.snippet ?? "", /Recently/);
});

test("buildCatalog does not warn on dated or versioned currentness wording", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/tools/appium/drivers.md",
        "context",
        contextAsset("Recently, as of 2026-07-01, driver guidance changed."),
      ),
    ),
    parseDocument(
      artifact(
        "contexts/tools/appium/server.md",
        "context",
        contextAsset("The latest Appium 2.8 behavior is covered here."),
      ),
    ),
  ]);

  assert.ok(
    !result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("contains currentness wording"),
    ),
  );
});

function contextAsset(body: string): string {
  return `---
id: context.tools.appium.example
owner: mobile-platform
status: stable
when_to_use:
  - Reviewing Appium automation behavior
when_not_to_use:
  - Non-Appium automation behavior
---
# Appium Example

${body}
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
