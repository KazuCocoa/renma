import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

test("buildCatalog warns when canonical context contains role-prompt wording", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/tools/appium/assistant-role.md",
        "context",
        contextAsset("You are an Appium assistant for setup guidance."),
      ),
    ),
  ]);

  const diagnostic = result.diagnostics.find((candidate) =>
    candidate.message.includes("prompt or runtime-selection wording"),
  );

  assert.equal(
    diagnostic?.message,
    'Shared context asset contains prompt or runtime-selection wording "role prompt".',
  );
  assert.equal(diagnostic?.evidence?.startLine, 12);
  assert.match(diagnostic?.evidence?.snippet ?? "", /assistant/);
});

test("buildCatalog warns when canonical context contains runtime-selection wording", () => {
  const result = buildCatalog([
    parseDocument(
      artifact(
        "contexts/tools/appium/runtime-routing.md",
        "context",
        contextAsset("Always load this context before Appium setup work."),
      ),
    ),
  ]);

  const diagnostic = result.diagnostics.find((candidate) =>
    candidate.message.includes("prompt or runtime-selection wording"),
  );

  assert.equal(
    diagnostic?.message,
    'Shared context asset contains prompt or runtime-selection wording "runtime context selection".',
  );
  assert.equal(diagnostic?.evidence?.startLine, 12);
  assert.match(diagnostic?.evidence?.snippet ?? "", /Always load/);
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
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
