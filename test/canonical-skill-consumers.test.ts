import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildBomReport } from "../src/commands/bom.js";
import { graphFromRepositorySnapshot } from "../src/commands/graph.js";
import { buildInspectOutline } from "../src/commands/inspect.js";
import { ownership } from "../src/commands/ownership.js";
import { buildReadinessReport } from "../src/commands/readiness.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";

test("canonical and pre-0.16 Skill metadata are operationally equivalent", async () => {
  const [legacyRoot, canonicalRoot] = await Promise.all([
    operationalFixture("legacy"),
    operationalFixture("canonical"),
  ]);

  const [legacy, canonical] = await Promise.all([
    operationalConsumerView(legacyRoot),
    operationalConsumerView(canonicalRoot),
  ]);

  assert.deepEqual(canonical.catalog, legacy.catalog);
  assert.deepEqual(canonical.ownership, legacy.ownership);
  assert.deepEqual(canonical.graph, legacy.graph);
  assert.deepEqual(canonical.readiness, legacy.readiness);
  assert.deepEqual(canonical.bom, legacy.bom);
  assert.deepEqual(canonical.trustGraph, legacy.trustGraph);
  assert.deepEqual(canonical.inspect, legacy.inspect);
  assert.deepEqual(canonical.lifecycleFindings, legacy.lifecycleFindings);
  assert.equal(
    canonical.findingIds.includes("MAINT-SKILL-CONTEXT-REFERENCE-NOT-DECLARED"),
    false,
  );
  assert.equal(
    canonical.findingIds.includes("MAINT-ORPHANED-CONTEXT-ASSET"),
    false,
  );
  assert.equal(
    canonical.findingIds.includes("MAINT-ORPHANED-CONTEXT-LENS"),
    false,
  );
});

test("canonical Skill supersession drives existing metadata-based rules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-superseded-skill-"));
  await writeRepositoryFile(
    root,
    "skills/old/SKILL.md",
    `---
name: old
description: Preserve an old review route. Use only when auditing superseded repository guidance.
metadata:
  renma.id: skill.old
  renma.status: deprecated
  renma.superseded-by: '["contexts/testing/replacement.md"]'
---
# Old Review

This route is superseded by reviewed shared context.
`,
  );
  await writeRepositoryFile(
    root,
    "contexts/testing/replacement.md",
    `---
id: context.testing.replacement
owner: qa-platform
status: stable
when_to_use: reviewed replacements
when_not_to_use: legacy audits
---
# Replacement

Use this reviewed replacement context.
`,
  );
  await writeRepositoryFile(
    root,
    "contexts/testing/consumer.md",
    `---
id: context.testing.consumer
owner: qa-platform
status: stable
when_to_use: repository review
when_not_to_use: runtime execution
---
# Consumer

The historical route is documented at skills/old/SKILL.md.
`,
  );

  const result = scanFromRepositorySnapshot(
    await collectRepositorySnapshot(root),
    { evaluationDate: "2026-07-11" },
  );
  const finding = result.findings.find(
    (candidate) =>
      candidate.id === "MAINT-ASSET-REFERENCES-SUPERSEDED-ASSET" &&
      candidate.evidence.path === "contexts/testing/consumer.md",
  );

  assert.ok(finding);
  assert.deepEqual(finding.details, {
    source: "context.testing.consumer",
    target: "skill.old",
    referenceKind: "body_reference",
    sourcePath: "contexts/testing/consumer.md",
    targetPath: "skills/old/SKILL.md",
    targetStatus: "deprecated",
    replacementTargets: ["contexts/testing/replacement.md"],
  });
});

test("canonical missing-dependency guidance uses operational metadata syntax", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-missing-context-"));
  await writeRepositoryFile(
    root,
    "skills/demo/SKILL.md",
    `---
name: demo
description: Review demo inputs. Use when deterministic repository context is required.
metadata:
  renma.id: skill.demo
---
# Demo

Read contexts/testing/boundaries.md before reporting the result.
`,
  );
  await writeRepositoryFile(
    root,
    "contexts/testing/boundaries.md",
    `---
id: context.testing.boundaries
owner: qa-platform
status: stable
when_to_use: specification review
when_not_to_use: runtime execution
---
# Boundaries

Review deterministic boundaries.
`,
  );

  const result = scanFromRepositorySnapshot(
    await collectRepositorySnapshot(root),
    { evaluationDate: "2026-07-11" },
  );
  const finding = result.findings.find(
    (candidate) =>
      candidate.id === "MAINT-SKILL-CONTEXT-REFERENCE-NOT-DECLARED",
  );

  assert.ok(finding);
  assert.match(finding.remediation, /metadata\.renma\.requires-context/);
  assert.match(finding.remediation, /JSON-array string/);
  assert.match(finding.llmHint ?? "", /metadata\.renma\.requires-context/);
  assert.match(finding.llmHint ?? "", /pre-0\.16-only Skills/);
});

test("duplicate canonical metadata mappings never select operational values", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-duplicate-metadata-"),
  );
  await writeRepositoryFile(
    root,
    "skills/demo/SKILL.md",
    `---
name: demo
description: Review demo inputs. Use when deterministic repository context is required.
owner: legacy-team
metadata:
  renma.id: skill.first
  renma.owner: first-team
  renma.status: stable
  renma.requires-context: '["context.testing.boundaries"]'
metadata:
  renma.id: skill.second
  renma.owner: second-team
  renma.status: archived
  renma.requires-context: '["context.testing.other"]'
---
# Demo
`,
  );
  await writeRepositoryFile(
    root,
    "contexts/testing/boundaries.md",
    `---
id: context.testing.boundaries
owner: qa-platform
status: stable
when_to_use: specification review
when_not_to_use: runtime execution
---
# Boundaries
`,
  );

  const snapshot = await collectRepositorySnapshot(root);
  const graph = graphFromRepositorySnapshot(snapshot);
  const scan = scanFromRepositorySnapshot(snapshot, {
    evaluationDate: "2026-07-11",
  });
  const bom = buildBomReport(snapshot, {
    omitGeneratedAt: true,
    evaluationDate: "2026-07-11",
  });
  const ownershipReport = await ownership(root, {}, { includeOwned: true });
  const fallbackId = "skills/demo/SKILL.md";
  const asset = snapshot.catalog.assets.find(
    (candidate) => candidate.sourcePath === fallbackId,
  );

  assert.ok(asset);
  assert.equal(asset.id, fallbackId);
  assert.equal(asset.metadata.id, undefined);
  assert.equal(asset.metadata.owner, undefined);
  assert.equal(asset.metadata.status, undefined);
  assert.deepEqual(asset.metadata.requiresContext, []);
  assert.equal(
    snapshot.catalog.dependencies.some(
      (dependency) => dependency.from === fallbackId,
    ),
    false,
  );

  const ambiguity = snapshot.catalogDiagnostics.find((diagnostic) =>
    /canonical Agent Skills metadata is ambiguous/i.test(diagnostic.message),
  );
  assert.ok(ambiguity);
  assert.equal(ambiguity.evidence?.startLine, 10);
  assert.match(ambiguity.evidence?.snippet ?? "", /^metadata:/m);
  assert.match(ambiguity.evidence?.snippet ?? "", /renma\.owner: second-team/);

  assert.equal(ownershipReport.totalAssets, 2);
  assert.equal(ownershipReport.ownedAssets, 1);
  assert.equal(ownershipReport.unownedAssets, 1);
  assert.equal(
    ownershipReport.unownedAssetList?.some(
      (unowned) => unowned.id === fallbackId,
    ),
    true,
  );

  const graphNode = graph.nodes.find((node) => node.id === fallbackId);
  assert.ok(graphNode);
  assert.equal(graphNode.owner, undefined);
  assert.equal(graphNode.status, undefined);
  assert.equal(
    graph.edges.some((edge) => edge.from === fallbackId),
    false,
  );

  const bomAsset = bom.assets.find((candidate) => candidate.id === fallbackId);
  assert.ok(bomAsset);
  assert.equal(bomAsset.owner, undefined);
  assert.equal(bomAsset.status, undefined);
  assert.deepEqual(bomAsset.dependencies, []);

  const trustNodeId = `asset:${fallbackId}`;
  const trustNode = scan.trustGraph?.nodes.find(
    (node) => node.id === trustNodeId,
  );
  assert.ok(trustNode);
  assert.equal(trustNode.properties?.owner, undefined);
  assert.equal(trustNode.properties?.status, undefined);
  assert.equal(
    scan.trustGraph?.edges.some(
      (edge) =>
        edge.from === trustNodeId &&
        [
          "owned_by",
          "has_lifecycle_status",
          "declares_dependency",
          "references",
        ].includes(edge.type),
    ),
    false,
  );
});

async function operationalConsumerView(root: string) {
  const snapshot = await collectRepositorySnapshot(root);
  const graph = graphFromRepositorySnapshot(snapshot);
  const scan = scanFromRepositorySnapshot(snapshot, {
    evaluationDate: "2026-07-11",
  });
  const readiness = buildReadinessReport(
    graph,
    scan.findings,
    scan.diagnostics,
    scan.contextLens,
    scan.securityPolicyInventory,
  );
  const bom = buildBomReport(snapshot, {
    omitGeneratedAt: true,
    evaluationDate: "2026-07-11",
  });
  const ownershipReport = await ownership(root, {}, { includeOwned: true });
  const inspect = await buildInspectOutline(
    path.join(root, "skills", "demo", "SKILL.md"),
  );

  return {
    catalog: {
      entries: snapshot.catalog.entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        sourcePath: entry.sourcePath,
        metadata: entry.metadata,
        ...(entry.kind === "skill"
          ? {
              requiredContext: entry.requiredContext,
              optionalContext: entry.optionalContext,
              requiredLens: entry.requiredLens,
              optionalLens: entry.optionalLens,
              conflicts: entry.conflicts,
            }
          : {}),
      })),
      dependencies: snapshot.catalog.dependencies.map((dependency) => ({
        from: dependency.from,
        to: dependency.to,
        kind: dependency.kind,
        sourcePath: dependency.sourcePath,
      })),
    },
    ownership: {
      totalAssets: ownershipReport.totalAssets,
      ownedAssets: ownershipReport.ownedAssets,
      unownedAssets: ownershipReport.unownedAssets,
      coveragePercent: ownershipReport.coveragePercent,
      byKind: ownershipReport.byKind,
      owners: ownershipReport.owners,
      ownedAssetList: ownershipReport.ownedAssetList,
      unownedAssetList: ownershipReport.unownedAssetList,
    },
    graph: {
      nodes: graph.nodes,
      edges: graph.edges,
    },
    readiness: {
      score: readiness.score,
      level: readiness.level,
      summary: {
        totalAssets: readiness.summary.totalAssets,
        ownedAssets: readiness.summary.ownedAssets,
        unownedAssets: readiness.summary.unownedAssets,
        ownershipCoveragePercent: readiness.summary.ownershipCoveragePercent,
        nodeCount: readiness.summary.nodeCount,
        edgeCount: readiness.summary.edgeCount,
        resolvedEdges: readiness.summary.resolvedEdges,
        unresolvedEdges: readiness.summary.unresolvedEdges,
        graphResolutionPercent: readiness.summary.graphResolutionPercent,
        workflow: readiness.summary.workflow,
      },
      checks: readiness.checks.map((check) => ({
        id: check.id,
        status: check.status,
        severity: check.severity,
      })),
    },
    bom: {
      summary: {
        assetCount: bom.summary.assetCount,
        dependencyCount: bom.summary.dependencyCount,
        resolvedDependencyCount: bom.summary.resolvedDependencyCount,
        unresolvedDependencyCount: bom.summary.unresolvedDependencyCount,
        ownedAssetCount: bom.summary.ownedAssetCount,
        unownedAssetCount: bom.summary.unownedAssetCount,
        readinessScore: bom.summary.readinessScore,
        readinessLevel: bom.summary.readinessLevel,
      },
      assets: bom.assets.map((asset) => ({
        ...omitKeys(asset, ["contentHash"]),
        diagnostics: asset.diagnostics.map((diagnostic) => ({
          severity: diagnostic.severity,
          message: diagnostic.message,
        })),
      })),
      dependencies: bom.dependencies,
    },
    trustGraph: {
      nodes: scan.trustGraph?.nodes
        .filter((node) => node.type !== "diagnostic")
        .map((node) => {
          const normalizedNode = omitKeys(node, ["evidence"]);
          const properties = omitKeys(node.properties ?? {}, ["contentHash"]);
          return {
            ...normalizedNode,
            ...(node.properties ? { properties } : {}),
          };
        }),
      edges: scan.trustGraph?.edges
        .filter((edge) => edge.type !== "has_diagnostic")
        .map((edge) => omitKeys(edge, ["id", "evidence"]))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
    },
    inspect: inspect.asset,
    lifecycleFindings: scan.findings
      .filter(
        (finding) =>
          finding.evidence.path === "skills/demo/SKILL.md" &&
          (finding.id === "MAINT-ASSET-EXPIRED" ||
            finding.id === "MAINT-ASSET-REVIEW-OVERDUE"),
      )
      .map((finding) => ({
        id: finding.id,
        title: finding.title,
        details: finding.details,
      })),
    findingIds: scan.findings.map((finding) => finding.id),
  };
}

async function operationalFixture(
  format: "legacy" | "canonical",
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `renma-${format}-`));
  await writeRepositoryFile(
    root,
    "skills/demo/SKILL.md",
    format === "legacy" ? legacySkill() : canonicalSkill(),
  );
  await writeRepositoryFile(
    root,
    "contexts/testing/boundaries.md",
    `---
id: context.testing.boundaries
owner: qa-platform
status: stable
when_to_use: specification review
when_not_to_use: runtime execution
---
# Testing Boundaries

Use this shared context to review deterministic testing boundaries.
`,
  );
  await writeRepositoryFile(
    root,
    "lenses/testing/spec-review.md",
    `---
id: lens.testing.spec-review
type: context_lens
owner: qa-platform
status: stable
purpose: Interpret testing boundaries for specification review.
applies_to: context.testing.boundaries
---
# Specification Review Lens

Interpret testing boundary context for specification reviews.
`,
  );
  return root;
}

function legacySkill(): string {
  return `---
description: Review demo specifications. Use when deterministic boundary and lens analysis is required before implementation.
id: skill.demo
title: Demo Review
version: 1.2.3
owner: qa-platform
status: stable
purpose: Review demo specifications before implementation.
last_reviewed_at: 2025-01-01
review_cycle: P90D
expires_at: 2025-12-31
tags: testing, review
when_to_use: specification review
when_not_to_use: runtime execution
requires_context: contexts/testing/boundaries.md
requires_lens: lens.testing.spec-review
---
${skillBody()}`;
}

function canonicalSkill(): string {
  return `---
name: demo
description: Review demo specifications. Use when deterministic boundary and lens analysis is required before implementation.
metadata:
  renma.id: skill.demo
  renma.title: Demo Review
  renma.version: 1.2.3
  renma.owner: qa-platform
  renma.status: stable
  renma.purpose: Review demo specifications before implementation.
  renma.last-reviewed-at: 2025-01-01
  renma.review-cycle: P90D
  renma.expires-at: 2025-12-31
  renma.tags: '["testing","review"]'
  renma.when-to-use: '["specification review"]'
  renma.when-not-to-use: '["runtime execution"]'
  renma.requires-context: '["contexts/testing/boundaries.md"]'
  renma.requires-lens: '["lens.testing.spec-review"]'
---
${skillBody()}`;
}

function skillBody(): string {
  return `# Demo Review

## When to Use

Use this skill for deterministic specification review.

## When Not to Use

Do not use this skill for runtime execution.

## Required Inputs

Required inputs: the specification and permission to read repository context.

## Instructions

Read contexts/testing/boundaries.md and apply the specification review lens.

## Completion Criteria

The workflow is complete when boundary findings and verification evidence are reported.

## Verification

Verify all declared context and lens relationships resolve in the graph.
`;
}

async function writeRepositoryFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

function omitKeys<T extends object>(
  value: T,
  keys: readonly string[],
): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  );
}
