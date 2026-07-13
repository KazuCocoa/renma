import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { validateAgentSkill } from "../src/agent-skills.js";
import { buildCatalog } from "../src/catalog.js";
import { buildBomReport } from "../src/commands/bom.js";
import { graphFromRepositorySnapshot } from "../src/commands/graph.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";
import { parseOperationalSecurityPolicy } from "../src/security-policy.js";
import { buildTrustGraph } from "../src/trust-graph.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

test("canonical Skill metadata normalizes every governance field", () => {
  const document = skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.id: " skill.demo "
  renma.title: " Demo Review "
  renma.version: " 1.2.3 "
  renma.owner: " qa-platform "
  renma.status: " stable "
  renma.purpose: " Review demo inputs. "
  renma.last-reviewed-at: " 2026-07-01 "
  renma.review-cycle: " P90D "
  renma.expires-at: " 2026-12-31 "
  renma.tags: '["testing","review"]'
  renma.when-to-use: '["specification review"]'
  renma.when-not-to-use: '[]'
  renma.requires-context: '["context.testing.boundaries"]'
  renma.optional-context: '[]'
  renma.requires-lens: '["lens.testing.spec-review"]'
  renma.optional-lens: '[]'
  renma.conflicts: '["skill.testing.old-review"]'
  renma.superseded-by: '["skill.testing.next-review"]'
---
# Demo
`);

  const result = parseAssetMetadata(document);

  assert.deepEqual(result.metadata, {
    id: "skill.demo",
    title: "Demo Review",
    version: "1.2.3",
    owner: "qa-platform",
    status: "stable",
    purpose: "Review demo inputs.",
    lastReviewedAt: "2026-07-01",
    reviewCycle: "P90D",
    expiresAt: "2026-12-31",
    tags: ["testing", "review"],
    whenToUse: ["specification review"],
    whenNotToUse: [],
    requiresContext: ["context.testing.boundaries"],
    optionalContext: [],
    conflicts: ["skill.testing.old-review"],
    supersededBy: ["skill.testing.next-review"],
    requiresLens: ["lens.testing.spec-review"],
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.metadataFields.status?.key, "renma.status");
  assert.equal(result.metadataFields.status?.startLine, 9);
  assert.equal(result.metadataFields.status?.endLine, 9);
  assert.equal(result.metadataFields.status?.raw, '  renma.status: " stable "');
  assert.equal(
    result.metadataFields.requires_context?.raw,
    "  renma.requires-context: '[\"context.testing.boundaries\"]'",
  );
});

test("canonical Skill list metadata accepts only JSON string arrays", () => {
  const cases = [
    {
      label: "malformed JSON and comma syntax",
      line: "  renma.tags: testing,review",
      reason: /valid JSON/,
    },
    {
      label: "non-array JSON",
      line: `  renma.tags: '{"tag":"testing"}'`,
      reason: /JSON array/,
    },
    {
      label: "non-string member",
      line: `  renma.tags: '["testing",1]'`,
      reason: /only string array members/,
    },
    {
      label: "native YAML array",
      line: "  renma.tags: [testing, review]",
      reason: /Agent Skills metadata must be a mapping/,
      specificationInvalid: true,
    },
  ];

  for (const fixture of cases) {
    const document = skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
${fixture.line}
---
# Demo
`);
    const result = parseAssetMetadata(document);

    assert.deepEqual(result.metadata.tags, [], fixture.label);
    if (fixture.specificationInvalid) {
      assert.deepEqual(result.diagnostics, [], fixture.label);
      assert.ok(
        validateAgentSkill(document).issues.some((issue) =>
          fixture.reason.test(issue.message),
        ),
        fixture.label,
      );
      continue;
    }
    assert.equal(result.diagnostics.length, 1, fixture.label);
    assert.match(
      result.diagnostics[0]?.message ?? "",
      /Invalid metadata\.renma\.tags/,
      fixture.label,
    );
    assert.match(
      result.diagnostics[0]?.message ?? "",
      fixture.reason,
      fixture.label,
    );
    assert.equal(result.diagnostics[0]?.evidence?.startLine, 5, fixture.label);
    assert.equal(
      result.diagnostics[0]?.evidence?.snippet,
      fixture.line,
      fixture.label,
    );
  }
});

test("canonical Skill diagnostics retain exact child evidence and stable wording", () => {
  const result = parseAssetMetadata(
    skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.status: unsupported
  renma.last-reviewed-at: 2026-02-31
  renma.review-cycle: P3M
  renma.expires-at: tomorrow
---
# Demo
`),
  );

  assert.equal(result.metadata.status, undefined);
  const expectations = [
    ["Invalid status", 5, "  renma.status: unsupported"],
    ["Invalid last_reviewed_at", 6, "  renma.last-reviewed-at: 2026-02-31"],
    ["Invalid review_cycle", 7, "  renma.review-cycle: P3M"],
    ["Invalid expires_at", 8, "  renma.expires-at: tomorrow"],
  ] as const;

  for (const [message, line, snippet] of expectations) {
    const diagnostic = result.diagnostics.find((candidate) =>
      candidate.message.startsWith(message),
    );
    assert.ok(diagnostic, message);
    assert.equal(diagnostic.evidence?.startLine, line);
    assert.equal(diagnostic.evidence?.endLine, line);
    assert.equal(diagnostic.evidence?.snippet, snippet);
  }
});

test("canonical empty text values retain existing optional-field semantics", () => {
  const result = parseAssetMetadata(
    skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.id: "   "
  renma.title: "   "
  renma.version: "   "
  renma.owner: "   "
  renma.status: "   "
  renma.purpose: "   "
  renma.last-reviewed-at: "   "
  renma.review-cycle: "   "
  renma.expires-at: "   "
---
# Demo
`),
  );

  assert.equal(result.metadata.id, undefined);
  assert.equal(result.metadata.title, undefined);
  assert.equal(result.metadata.version, undefined);
  assert.equal(result.metadata.owner, undefined);
  assert.equal(result.metadata.status, undefined);
  assert.equal(result.metadata.purpose, undefined);
  assert.equal(result.metadata.lastReviewedAt, undefined);
  assert.equal(result.metadata.reviewCycle, undefined);
  assert.equal(result.metadata.expiresAt, undefined);
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0]?.message ?? "", /^Invalid status/);
});

test("hybrid Skills fail closed instead of selecting canonical or legacy metadata", () => {
  const document = skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
id: skill.legacy
version: 0.9.0
owner: legacy-team
tags: legacy, merged
requires_context: context.legacy
metadata:
  renma.id: skill.canonical
  renma.owner: canonical-team
  renma.tags: '["canonical"]'
  renma.requires-context: '["context.canonical"]'
---
# Demo
`);
  const result = parseAssetMetadata(document);

  assert.equal(validateAgentSkill(document).format, "hybrid");
  assert.equal(result.metadata.id, undefined);
  assert.equal(result.metadata.owner, undefined);
  assert.equal(result.metadata.version, undefined);
  assert.deepEqual(result.metadata.tags, []);
  assert.deepEqual(result.metadata.requiresContext, []);
  assert.equal(result.metadataFields.owner, undefined);
  assert.equal(result.metadataFields.version, undefined);
});

test("invalid canonical metadata never falls back to a hybrid legacy value", () => {
  const result = parseAssetMetadata(
    skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
tags: legacy, fallback
metadata:
  renma.tags: testing,review
---
# Demo
`),
  );

  assert.deepEqual(result.metadata.tags, []);
  assert.deepEqual(result.diagnostics, []);
});

test("duplicate canonical keys are diagnosed and not guessed operationally", () => {
  const document = skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.owner: first-team
  renma.owner: second-team
---
# Demo
`);

  const result = parseAssetMetadata(document);
  const validation = validateAgentSkill(document);

  assert.equal(result.metadata.owner, undefined);
  assert.equal(result.metadataFields.owner, undefined);
  assert.ok(
    validation.issues.some((issue) =>
      issue.message.includes(
        'Agent Skills metadata key "renma.owner" is declared more than once.',
      ),
    ),
  );
});

test("duplicate top-level metadata mappings are ignored operationally", () => {
  const document = skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
id: skill.legacy
owner: legacy-team
status: stable
requires_context: context.legacy
metadata:
  renma.id: skill.first
  renma.owner: first-team
  renma.status: stable
  renma.requires-context: '["context.first"]'
metadata:
  renma.id: skill.second
  renma.owner: second-team
  renma.status: deprecated
  renma.requires-context: '["context.second"]'
---
# Demo
`);

  const result = parseAssetMetadata(document);
  const validation = validateAgentSkill(document);
  const { catalog, diagnostics } = buildCatalog([document]);
  const entry = catalog.entries[0];
  const trustGraph = buildTrustGraph({ catalog });
  const assetEdges = trustGraph.edges.filter(
    (edge) => edge.from === "asset:skills/demo/SKILL.md",
  );

  assert.equal(result.metadata.id, undefined);
  assert.equal(result.metadata.owner, undefined);
  assert.equal(result.metadata.status, undefined);
  assert.deepEqual(result.metadata.requiresContext, []);
  assert.equal(result.metadataFields.id, undefined);
  assert.equal(result.metadataFields.owner, undefined);
  assert.equal(result.metadataFields.status, undefined);
  assert.equal(result.metadataFields.requires_context, undefined);
  assert.equal(entry?.id, "skills/demo/SKILL.md");
  assert.deepEqual(catalog.dependencies, []);
  assert.equal(
    assetEdges.some((edge) =>
      ["owned_by", "has_lifecycle_status", "declares_dependency"].includes(
        edge.type,
      ),
    ),
    false,
  );

  const operationalDiagnostic = result.diagnostics.find((diagnostic) =>
    diagnostic.message.startsWith(
      "Canonical Agent Skills metadata is ambiguous",
    ),
  );
  assert.ok(operationalDiagnostic);
  assert.equal(operationalDiagnostic.evidence?.startLine, 13);
  assert.equal(operationalDiagnostic.evidence?.endLine, 17);
  assert.match(
    operationalDiagnostic.evidence?.snippet ?? "",
    /^metadata:\n {2}renma\.id: skill\.second/m,
  );
  assert.ok(
    diagnostics.some(
      (diagnostic) => diagnostic.message === operationalDiagnostic.message,
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "AS-SKILL-DUPLICATE-FIELD" && issue.field === "metadata",
    ),
  );
});

test("structurally unsafe canonical frontmatter never selects partial or legacy values", () => {
  const cases = [
    {
      label: "unclosed frontmatter",
      content: `---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
owner: legacy-team
metadata:
  renma.owner: canonical-team
`,
    },
    {
      label: "YAML parser error",
      content: `---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
owner: legacy-team
metadata:
  renma.owner: canonical-team
broken: [unterminated
---
# Demo
`,
    },
    {
      label: "non-mapping metadata",
      content: `---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
owner: legacy-team
metadata: canonical-team
---
# Demo
`,
    },
    {
      label: "non-mapping root",
      content: `---
- invalid-root
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
owner: legacy-team
---
# Demo
`,
    },
  ];

  for (const fixture of cases) {
    const result = parseAssetMetadata(skillDocument(fixture.content));
    assert.equal(result.metadata.owner, undefined, fixture.label);
    assert.equal(result.metadataFields.owner, undefined, fixture.label);
  }
});

test("Renma authoring warnings do not block structurally valid canonical metadata", () => {
  const document = skillDocument(`---
name: demo
description: Review demo inputs carefully.
metadata:
  renma.owner: qa-platform
---
# Demo
`);

  const validation = validateAgentSkill(document);
  const result = parseAssetMetadata(document);

  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.category === "renma-authoring" && issue.severity === "warning",
    ),
  );
  assert.equal(result.metadata.owner, "qa-platform");
  assert.equal(result.metadataFields.owner?.raw, "  renma.owner: qa-platform");
});

test("multiline canonical values preserve complete operational evidence", () => {
  const result = parseAssetMetadata(
    skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.tags: >-
    ["testing","review"]
  renma.purpose: >-
    Review the specification
    before implementation.
---
# Demo
`),
  );

  assert.deepEqual(result.metadata.tags, ["testing", "review"]);
  assert.equal(
    result.metadata.purpose,
    "Review the specification before implementation.",
  );
  assert.equal(result.metadataFields.tags?.startLine, 5);
  assert.equal(result.metadataFields.tags?.endLine, 6);
  assert.equal(
    result.metadataFields.tags?.raw,
    `  renma.tags: >-\n    ["testing","review"]`,
  );
  assert.equal(result.metadataFields.purpose?.startLine, 7);
  assert.equal(result.metadataFields.purpose?.endLine, 9);
  assert.equal(
    result.metadataFields.purpose?.raw,
    "  renma.purpose: >-\n    Review the specification\n    before implementation.",
  );
  assert.deepEqual(result.diagnostics, []);
});

test("invalid multiline canonical lists retain their complete value evidence", () => {
  const result = parseAssetMetadata(
    skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.tags: |-
    ["testing",1]
---
# Demo
`),
  );

  assert.deepEqual(result.metadata.tags, []);
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0]?.message ?? "", /string array members/);
  assert.equal(result.diagnostics[0]?.evidence?.startLine, 5);
  assert.equal(result.diagnostics[0]?.evidence?.endLine, 6);
  assert.equal(
    result.diagnostics[0]?.evidence?.snippet,
    `  renma.tags: |-\n    ["testing",1]`,
  );
});

test("pre-0.16-only Skill metadata is migration input, not operational metadata", () => {
  const document = skillDocument(`---
id: skill.demo
owner: legacy-team
tags: testing, review
requires_context:
  - context.testing.boundaries
---
# Demo
`);
  const result = parseAssetMetadata(document);
  const validation = validateAgentSkill(document);

  assert.equal(validation.format, "renma-legacy");
  assert.equal(validation.migrationRecommended, true);
  assert.equal(result.metadata.id, undefined);
  assert.equal(result.metadata.owner, undefined);
  assert.deepEqual(result.metadata.tags, []);
  assert.deepEqual(result.metadata.requiresContext, []);
});

test("non-Skill assets keep top-level Renma metadata behavior", () => {
  const document = parseDocument(
    artifact(
      "contexts/testing/boundaries.md",
      "context",
      `---
id: context.testing.boundaries
title: Testing Boundaries
owner: context-team
status: stable
tags: testing, boundaries
requires_context:
  - context.testing.base
token_budget_override: 6000
token_budget_rationale: "This is a single ordered workflow."
token_budget_reviewed_at: "2026-07-12"
metadata:
  renma.id: context.ignored
  renma.owner: ignored-team
  renma.tags: '["ignored"]'
---
# Boundaries
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.equal(result.metadata.id, "context.testing.boundaries");
  assert.equal(result.metadata.title, undefined);
  assert.equal(result.metadata.owner, "context-team");
  assert.equal(result.metadata.status, "stable");
  assert.deepEqual(result.metadata.tags, ["testing", "boundaries"]);
  assert.deepEqual(result.metadata.requiresContext, ["context.testing.base"]);
  assert.equal(result.metadata.tokenBudgetOverride, 6000);
  assert.equal(
    result.metadata.tokenBudgetRationale,
    "This is a single ordered workflow.",
  );
  assert.equal(result.metadata.tokenBudgetReviewedAt, "2026-07-12");
  assert.equal(result.metadataFields.owner?.raw, "owner: context-team");
});

test("catalog and Trust Graph use canonical child evidence aliases", () => {
  const { catalog } = buildCatalog([
    skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.id: skill.demo
  renma.owner: qa-platform
  renma.status: stable
  renma.requires-context: '["context.testing.boundaries"]'
---
# Demo
`),
    parseDocument(
      artifact(
        "contexts/testing/boundaries.md",
        "context",
        `---
id: context.testing.boundaries
owner: qa-platform
status: stable
---
# Boundaries
`,
      ),
    ),
  ]);

  const skill = catalog.entries.find((entry) => entry.kind === "skill");
  const dependency = catalog.dependencies.find(
    (candidate) => candidate.from === "skill.demo",
  );
  const trustGraph = buildTrustGraph({ catalog });
  const ownershipEdge = trustGraph.edges.find(
    (edge) => edge.from === "asset:skill.demo" && edge.type === "owned_by",
  );
  const lifecycleEdge = trustGraph.edges.find(
    (edge) =>
      edge.from === "asset:skill.demo" && edge.type === "has_lifecycle_status",
  );

  assert.equal(skill?.metadataFields.owner?.key, "renma.owner");
  assert.equal(skill?.metadataFields.owner?.startLine, 6);
  assert.equal(
    dependency?.evidence?.snippet,
    `  renma.requires-context: '["context.testing.boundaries"]'`,
  );
  assert.equal(
    ownershipEdge?.evidence?.[0]?.snippet,
    "  renma.owner: qa-platform",
  );
  assert.equal(lifecycleEdge?.evidence?.[0]?.snippet, "  renma.status: stable");
});

test("canonical list items retain the existing metadata budget diagnostic", () => {
  const longBoundary = "x".repeat(257);
  const { diagnostics } = buildCatalog([
    skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
metadata:
  renma.when-to-use: '["${longBoundary}"]'
---
# Demo
`),
  ]);
  const diagnostic = diagnostics.find((candidate) =>
    candidate.message.includes("Metadata list item is too long in when_to_use"),
  );

  assert.ok(diagnostic);
  assert.equal(diagnostic.evidence?.startLine, 5);
  assert.equal(
    diagnostic.evidence?.snippet,
    `  renma.when-to-use: '["${longBoundary}"]'`,
  );
});

test("ignored hybrid list metadata cannot emit operational budget diagnostics", () => {
  const ignoredLegacyBoundary = "x".repeat(141);
  const { catalog, diagnostics } = buildCatalog([
    skillDocument(`---
name: demo
description: Review demo inputs. Use when a demo needs deterministic review.
when_to_use:
  - ${ignoredLegacyBoundary}
metadata:
  renma.when-to-use: '["canonical"]'
---
# Demo
`),
  ]);

  assert.deepEqual(catalog.entries[0]?.metadata.whenToUse, []);
  assert.equal(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("Metadata list item is too long"),
    ),
    false,
  );
});

test("repository release-prep is fully canonical with tag-trigger policy", async () => {
  const relativePath = "skills/release-prep/SKILL.md";
  const absolutePath = path.resolve(relativePath);
  const content = await readFile(absolutePath, "utf8");
  const document = parseDocument({
    path: relativePath,
    absolutePath,
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  });
  const result = parseAssetMetadata(document);
  const validation = validateAgentSkill(document);
  const policy = parseOperationalSecurityPolicy(document);
  const { catalog } = buildCatalog([document]);
  const snapshot = await collectRepositorySnapshot(path.resolve("."));
  const graph = graphFromRepositorySnapshot(snapshot);
  const scan = scanFromRepositorySnapshot(snapshot, {
    evaluationDate: "2026-07-11",
  });
  const bom = buildBomReport(snapshot, {
    omitGeneratedAt: true,
    evaluationDate: "2026-07-11",
  });

  assert.equal(validation.format, "agent-skills");
  assert.equal(validation.valid, true);
  assert.equal(validation.migrationRecommended, false);
  assert.deepEqual(validation.legacyFields, []);
  assert.deepEqual(validation.issues, []);
  assert.equal(result.metadata.id, "skill.release-prep");
  assert.equal(result.metadata.title, "Release Prep");
  assert.equal(result.metadata.version, "0.1.0");
  assert.equal(result.metadata.owner, "maintainers");
  assert.equal(result.metadata.status, "stable");
  assert.deepEqual(result.metadata.tags, [
    "release",
    "maintenance",
    "dogfooding",
  ]);
  assert.deepEqual(result.metadata.requiresContext, ["context.release.prep"]);
  assert.deepEqual(
    catalog.dependencies.map((dependency) => ({
      from: dependency.from,
      to: dependency.to,
      kind: dependency.kind,
    })),
    [
      {
        from: "skill.release-prep",
        to: "context.release.prep",
        kind: "requires",
      },
    ],
  );
  assert.deepEqual(policy.allowedData, ["public"]);
  assert.equal(policy.networkAllowed, true);
  assert.equal(policy.externalUploadAllowed, true);
  assert.equal(policy.secretsAllowed, false);
  assert.equal(policy.humanApprovalRequired, true);
  assert.deepEqual(policy.forbiddenInputs, [
    "secrets",
    "credentials",
    "tokens",
  ]);

  const graphNode = graph.nodes.find(
    (node) => node.id === "skill.release-prep",
  );
  assert.equal(graphNode?.id, "skill.release-prep");
  assert.equal(graphNode?.kind, "skill");
  assert.equal(graphNode?.sourcePath, relativePath);
  assert.equal(graphNode?.ownership.effectiveOwner, "maintainers");
  assert.equal(graphNode?.status, "stable");
  assert.deepEqual(graphNode?.tags, ["release", "maintenance", "dogfooding"]);
  assert.equal(graphNode?.contentClassification, "text");
  assert.equal(graphNode?.markdownParserEligible, true);
  assert.equal(graphNode?.sizeBytes, Buffer.byteLength(content));
  assert.match(graphNode?.contentHash ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.from === "skill.release-prep" &&
        edge.to === "context.release.prep" &&
        edge.kind === "requires" &&
        edge.resolved &&
        edge.targetPath === "contexts/release/prep.md",
    ),
  );

  const bomAsset = bom.assets.find(
    (asset) => asset.id === "skill.release-prep",
  );
  assert.ok(bomAsset);
  assert.ok(bomAsset.ownership);
  assert.equal(bomAsset.ownership.effectiveOwner, "maintainers");
  assert.equal(bomAsset.status, "stable");
  assert.equal(bomAsset.version, "0.1.0");
  assert.deepEqual(bomAsset.tags, ["dogfooding", "maintenance", "release"]);
  assert.deepEqual(bomAsset.lifecycle, { status: "stable" });
  assert.ok(
    bomAsset.dependencies.some(
      (dependency) =>
        dependency.kind === "requires" &&
        dependency.to === "context.release.prep" &&
        dependency.resolved,
    ),
  );

  const trustEdges = scan.trustGraph?.edges.filter(
    (edge) => edge.from === "asset:skill.release-prep",
  );
  assert.ok(
    trustEdges?.some(
      (edge) => edge.type === "owned_by" && edge.to === "owner:maintainers",
    ),
  );
  assert.ok(
    trustEdges?.some(
      (edge) =>
        edge.type === "has_lifecycle_status" &&
        edge.to === "lifecycle_status:stable",
    ),
  );
  assert.ok(
    trustEdges?.some(
      (edge) =>
        edge.type === "declares_dependency" &&
        edge.properties?.declaredTarget === "context.release.prep",
    ),
  );
  assert.ok(
    trustEdges?.some(
      (edge) =>
        edge.type === "has_effective_policy" &&
        edge.properties?.hasLocalPolicyMetadata === true,
    ),
  );

  assert.equal(scan.securityPolicyInventory?.totalPolicyAssets, 2);
  assert.equal(scan.securityPolicyInventory?.assetsWithLocalPolicyMetadata, 2);
  assert.deepEqual(scan.securityPolicyInventory?.networkAllowed, {
    true: 2,
    false: 0,
    unspecified: 0,
  });
  assert.deepEqual(scan.securityPolicyInventory?.externalUploadAllowed, {
    true: 2,
    false: 0,
    unspecified: 0,
  });
  assert.deepEqual(scan.securityPolicyInventory?.secretsAllowed, {
    true: 0,
    false: 2,
    unspecified: 0,
  });
  assert.deepEqual(scan.securityPolicyInventory?.humanApprovalRequired, {
    true: 2,
    false: 0,
    unspecified: 0,
  });
  assert.equal(
    scan.findings.some(
      (finding) =>
        finding.evidence.path === relativePath && finding.id.startsWith("SEC-"),
    ),
    false,
  );
  assert.deepEqual(
    scan.findings.filter((finding) => finding.evidence.path === relativePath),
    [],
  );
});

function skillDocument(content: string) {
  return parseDocument(artifact("skills/demo/SKILL.md", "skill", content));
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
