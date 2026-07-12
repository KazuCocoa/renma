import assert from "node:assert/strict";
import test from "node:test";
import { conflictDiagnostics } from "../src/catalog-conflicts.js";
import type { CatalogEntry } from "../src/model.js";

test("conflictDiagnostics warns when conflicts metadata references itself", () => {
  const diagnostics = conflictDiagnostics([
    contextEntry({
      id: "context.testing.boundary-analysis",
      conflicts: ["context.testing.boundary-analysis"],
    }),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("conflicts metadata references itself"),
    ),
  );
});

test("conflictDiagnostics warns when conflicts target is missing", () => {
  const diagnostics = conflictDiagnostics([
    contextEntry({
      id: "context.testing.boundary-analysis",
      conflicts: ["context.testing.missing"],
    }),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes('conflicts target "context.testing.missing"'),
    ),
  );
});

test("conflictDiagnostics warns when a skill requires conflicting contexts", () => {
  const diagnostics = conflictDiagnostics([
    contextEntry({
      id: "context.testing.boundary-analysis",
      conflicts: ["context.testing.fuzz-testing"],
    }),
    contextEntry({ id: "context.testing.fuzz-testing" }),
    skillEntry([
      "context.testing.boundary-analysis",
      "context.testing.fuzz-testing",
    ]),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("requires conflicting context assets"),
    ),
  );
});

function contextEntry(options: {
  id: string;
  conflicts?: string[];
}): CatalogEntry {
  return {
    id: options.id,
    kind: "context",
    sourcePath: `${options.id.replaceAll(".", "/")}.md`,
    contentHash: "sha256:test",
    sizeBytes: 0,
    contentClassification: "text",
    markdownParserEligible: true,
    ownership: {
      declaredOwner: "qa-platform",
      effectiveOwner: "qa-platform",
      source: "declared",
    },
    metadata: {
      id: options.id,
      owner: "qa-platform",
      status: "stable",
      tags: [],
      whenToUse: ["Reviewing test design knowledge"],
      whenNotToUse: ["Non-test-design guidance"],
      requiresContext: [],
      optionalContext: [],
      conflicts: options.conflicts ?? [],
      supersededBy: [],
    },
    metadataFields: {},
    metadataListItems: {},
  };
}

function skillEntry(requiredContext: string[]): CatalogEntry {
  return {
    id: "skill.testing.spec-review",
    kind: "skill",
    sourcePath: "skills/testing/spec-review/SKILL.md",
    contentHash: "sha256:test",
    sizeBytes: 0,
    contentClassification: "text",
    markdownParserEligible: true,
    ownership: {
      declaredOwner: "qa-platform",
      effectiveOwner: "qa-platform",
      source: "declared",
    },
    metadata: {
      id: "skill.testing.spec-review",
      owner: "qa-platform",
      status: "stable",
      tags: [],
      whenToUse: [],
      whenNotToUse: [],
      requiresContext: requiredContext,
      optionalContext: [],
      conflicts: [],
      supersededBy: [],
    },
    metadataFields: {},
    metadataListItems: {},
    requiredContext,
    optionalContext: [],
    requiredLens: [],
    optionalLens: [],
    conflicts: [],
  };
}
