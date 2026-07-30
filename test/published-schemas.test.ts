import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Ajv2020,
  type AnySchemaObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { bom } from "../src/commands/bom.js";
import { trustGraph } from "../src/commands/trust-graph.js";
import type { TrustGraph, TrustGraphEdgeType } from "../src/trust-graph.js";

const BOM_SCHEMA_PATH = "docs/schemas/repository-context-bom-v2.schema.json";
const TRUST_GRAPH_SCHEMA_PATH = "docs/schemas/trust-graph-v2.schema.json";
const FIXED_GENERATED_AT = "2026-07-10T12:00:00.000Z";

test("published Draft 2020-12 schemas validate representative generated reports", async () => {
  const { validateBom, validateTrustGraph } = await validators();
  const target = path.resolve("examples/interactive-placeholder");
  const defaultBom = await bom(target);
  const omittedBom = await bom(target, {}, { omitGeneratedAt: true });
  const contextLensBom = await bom(path.resolve("examples/context-lens"));
  const graph = await representativeTrustGraph();

  assertValid(validateBom, defaultBom);
  assertValid(validateBom, omittedBom);
  assertValid(validateBom, contextLensBom);
  assert.equal(defaultBom.outputMode, "default");
  assert.equal(typeof defaultBom.generatedAt, "string");
  assert.equal(omittedBom.outputMode, "omit_generated_at");
  assert.equal("generatedAt" in omittedBom, false);
  assert.ok(contextLensBom.readiness.summary.contextLens.totalLensCount > 0);
  assert.equal(
    defaultBom.executableSurfaceInventory.schema,
    "renma.executable-surface-inventory.v1",
  );
  assert.ok(Array.isArray(defaultBom.executableSurfaceInventory.surfaces));
  assert.ok(Array.isArray(defaultBom.executableSurfaceInventory.invocations));
  assert.equal(
    typeof defaultBom.executableSurfaceInventory.summary
      .invocationsWithEffectivePolicyEvidence,
    "number",
  );
  assert.deepEqual(
    defaultBom.executableSurfaceInventory.summary
      .invocationPolicyEvidenceRelations,
    {
      sourceArtifact: 0,
      owningSkill: 0,
    },
  );

  const withoutConfigPath = structuredClone(defaultBom);
  delete withoutConfigPath.configPath;
  assertValid(validateBom, withoutConfigPath);

  const olderV2WithoutExecutableSurfaceInventory = structuredClone(defaultBom);
  delete (
    olderV2WithoutExecutableSurfaceInventory as Partial<typeof defaultBom>
  ).executableSurfaceInventory;
  assertValid(validateBom, olderV2WithoutExecutableSurfaceInventory);

  const v027StyleBom = structuredClone(defaultBom);
  const v027Inventory = v027StyleBom.executableSurfaceInventory as unknown as {
    summary: Record<string, unknown>;
    surfaces: Array<Record<string, unknown>>;
    invocations: Array<Record<string, unknown>>;
  };
  for (const field of [
    "invocationsWithEffectivePolicyEvidence",
    "invocationsWithoutEffectivePolicyEvidence",
    "resolvedInvocationsWithEffectivePolicyEvidence",
    "resolvedInvocationsWithoutEffectivePolicyEvidence",
    "invocationsWithMultipleEffectivePolicyFingerprints",
    "invocationPolicyEvidenceRelations",
  ]) {
    delete v027Inventory.summary[field];
  }
  v027Inventory.surfaces = [schemaSurface(false)];
  v027Inventory.invocations = [schemaInvocation(false)];
  assertValid(validateBom, v027StyleBom);

  for (const type of [
    "owned_by",
    "owns_local_resource",
    "statically_references",
    "inherits_policy",
    "has_effective_policy",
  ] as const) {
    assert.ok(
      graph.edges.some((edge) => edge.type === type),
      type,
    );
  }
  assertValid(validateTrustGraph, graph);
});

test("BOM schema enforces output modes, timestamps, formats, and score bounds", async () => {
  const { validateBom } = await validators();
  const target = path.resolve("examples/interactive-placeholder");
  const defaultBom = await bom(target);
  const omittedBom = await bom(target, {}, { omitGeneratedAt: true });

  const defaultWithoutTimestamp = structuredClone(defaultBom);
  delete defaultWithoutTimestamp.generatedAt;
  assertInvalid(validateBom, defaultWithoutTimestamp, "required");

  const omittedWithTimestamp = structuredClone(omittedBom) as unknown as Record<
    string,
    unknown
  >;
  omittedWithTimestamp.generatedAt = FIXED_GENERATED_AT;
  assertInvalid(validateBom, omittedWithTimestamp, "not");

  const invalidTimestamp = structuredClone(defaultBom);
  invalidTimestamp.generatedAt = "2026-07-10";
  assertInvalid(validateBom, invalidTimestamp, "format");

  const belowMinimum = structuredClone(defaultBom);
  belowMinimum.summary.readinessScore = -1;
  assertInvalid(validateBom, belowMinimum, "minimum");

  const aboveMaximum = structuredClone(defaultBom);
  aboveMaximum.readiness.score = 101;
  assertInvalid(validateBom, aboveMaximum, "maximum");

  const negativeSecurityCount = structuredClone(defaultBom);
  negativeSecurityCount.securityPosture.riskClasses.violation = -1;
  assertInvalid(validateBom, negativeSecurityCount, "minimum");

  const negativePolicyCount = structuredClone(defaultBom);
  negativePolicyCount.securityPolicyInventory.policySources.owning_skill = -1;
  assertInvalid(validateBom, negativePolicyCount, "minimum");

  const negativeSurfaceCount = structuredClone(defaultBom);
  negativeSurfaceCount.executableSurfaceInventory.summary.totalSurfaces = -1;
  assertInvalid(validateBom, negativeSurfaceCount, "minimum");

  const negativeInvocationPolicyCount = structuredClone(defaultBom);
  negativeInvocationPolicyCount.executableSurfaceInventory.summary.invocationsWithEffectivePolicyEvidence =
    -1;
  assertInvalid(validateBom, negativeInvocationPolicyCount, "minimum");

  for (const field of [
    "schema",
    "summary",
    "surfaces",
    "invocations",
  ] as const) {
    const incompleteInventory = structuredClone(defaultBom);
    delete (
      incompleteInventory.executableSurfaceInventory as unknown as Record<
        string,
        unknown
      >
    )[field];
    assertInvalid(validateBom, incompleteInventory, "required");
  }

  const invalidSurfaceScope = structuredClone(defaultBom);
  invalidSurfaceScope.executableSurfaceInventory.surfaces = [
    {
      path: "tools/check.mjs",
      scope: "external",
      origins: ["discovered-script"],
      artifactKind: "script",
      contentClassification: "text",
      interpreterHints: ["node"],
      staticallyReferenced: false,
      staticallyInvoked: false,
      referenceCount: 0,
      invocationCount: 0,
      securityPolicy: {
        hasEffectivePolicy: false,
        policySources: [],
      },
      fingerprint: `sha256:${"0".repeat(64)}`,
    },
  ] as unknown as typeof invalidSurfaceScope.executableSurfaceInventory.surfaces;
  assertInvalid(validateBom, invalidSurfaceScope, "enum");

  const invalidInvocationResolution = structuredClone(defaultBom);
  invalidInvocationResolution.executableSurfaceInventory.invocations = [
    {
      sourcePath: "skills/demo/SKILL.md",
      line: 1,
      snippet: "node tools/check.mjs",
      launcher: "node",
      rawTarget: "tools/check.mjs",
      normalizedTarget: "tools/check.mjs",
      resolution: "executed",
      occurrenceOrdinal: 1,
    },
  ] as unknown as typeof invalidInvocationResolution.executableSurfaceInventory.invocations;
  assertInvalid(validateBom, invalidInvocationResolution, "enum");

  const currentGovernanceBom = structuredClone(defaultBom);
  const currentGovernanceInventory =
    currentGovernanceBom.executableSurfaceInventory as unknown as {
      surfaces: Array<Record<string, unknown>>;
      invocations: Array<Record<string, unknown>>;
    };
  currentGovernanceInventory.surfaces = [schemaSurface(true)];
  currentGovernanceInventory.invocations = [schemaInvocation(true)];
  assertValid(validateBom, currentGovernanceBom);

  for (const field of [
    "invocationsWithEffectivePolicyEvidence",
    "invocationsWithoutEffectivePolicyEvidence",
    "distinctEffectivePolicyFingerprints",
  ]) {
    const incompleteSurfaceGovernance = structuredClone(currentGovernanceBom);
    const surface = (
      incompleteSurfaceGovernance.executableSurfaceInventory
        .surfaces[0] as unknown as {
        invocationGovernance: Record<string, unknown>;
      }
    ).invocationGovernance;
    delete surface[field];
    assertInvalid(validateBom, incompleteSurfaceGovernance, "required");
  }

  for (const field of [
    "owningSkillResolution",
    "policyEvidence",
    "hasEffectivePolicyEvidence",
    "distinctEffectivePolicyFingerprints",
    "fingerprint",
  ]) {
    const incompleteInvocationGovernance =
      structuredClone(currentGovernanceBom);
    const governance = (
      incompleteInvocationGovernance.executableSurfaceInventory
        .invocations[0] as unknown as {
        governance: Record<string, unknown>;
      }
    ).governance;
    delete governance[field];
    assertInvalid(validateBom, incompleteInvocationGovernance, "required");
  }

  const invalidOwningSkillResolution = structuredClone(currentGovernanceBom);
  (
    invalidOwningSkillResolution.executableSurfaceInventory
      .invocations[0] as unknown as {
      governance: { owningSkillResolution: string };
    }
  ).governance.owningSkillResolution = "nearest";
  assertInvalid(validateBom, invalidOwningSkillResolution, "enum");

  const invalidPolicyRelation = structuredClone(currentGovernanceBom);
  (
    invalidPolicyRelation.executableSurfaceInventory
      .invocations[0] as unknown as {
      governance: { policyEvidence: Array<{ relation: string }> };
    }
  ).governance.policyEvidence[0]!.relation = "target-surface";
  assertInvalid(validateBom, invalidPolicyRelation, "enum");

  const invalidInvocationPolicySource = structuredClone(currentGovernanceBom);
  (
    invalidInvocationPolicySource.executableSurfaceInventory
      .invocations[0] as unknown as {
      governance: {
        policyEvidence: Array<{ policySources: string[] }>;
      };
    }
  ).governance.policyEvidence[0]!.policySources = ["environment"];
  assertInvalid(validateBom, invalidInvocationPolicySource, "enum");

  const invalidGovernanceFingerprint = structuredClone(currentGovernanceBom);
  (
    invalidGovernanceFingerprint.executableSurfaceInventory
      .invocations[0] as unknown as {
      governance: { fingerprint: string };
    }
  ).governance.fingerprint = "sha256:not-a-fingerprint";
  assertInvalid(validateBom, invalidGovernanceFingerprint, "pattern");

  const duplicateGovernanceFingerprints = structuredClone(currentGovernanceBom);
  (
    duplicateGovernanceFingerprints.executableSurfaceInventory
      .invocations[0] as unknown as {
      governance: { distinctEffectivePolicyFingerprints: string[] };
    }
  ).governance.distinctEffectivePolicyFingerprints = [sha256("a"), sha256("a")];
  assertInvalid(validateBom, duplicateGovernanceFingerprints, "uniqueItems");

  const negativeReadinessCount = structuredClone(defaultBom);
  negativeReadinessCount.readiness.summary.totalAssets = -1;
  assertInvalid(validateBom, negativeReadinessCount, "minimum");

  const nonNumericReadiness = structuredClone(defaultBom) as unknown as {
    readiness: { summary: Record<string, unknown> };
  };
  nonNumericReadiness.readiness.summary.graphResolutionPercent = "100";
  assertInvalid(validateBom, nonNumericReadiness, "type");

  const malformedTopFinding = structuredClone(defaultBom) as unknown as {
    securityPosture: { topFindingIds: unknown[] };
  };
  malformedTopFinding.securityPosture.topFindingIds = [
    { id: "SEC-INVALID", count: 1 },
  ];
  assertInvalid(validateBom, malformedTopFinding, "required");

  const extendedTopFinding = structuredClone(defaultBom) as unknown as {
    securityPosture: { topFindingIds: unknown[] };
  };
  extendedTopFinding.securityPosture.topFindingIds = [
    {
      id: "SEC-INVALID",
      count: 1,
      maxSeverity: "high",
      unexpected: true,
    },
  ];
  assertInvalid(validateBom, extendedTopFinding, "additionalProperties");

  const incompleteAssetKinds = structuredClone(defaultBom);
  delete (
    incompleteAssetKinds.securityPolicyInventory
      .assetKinds as unknown as Record<string, number>
  ).unknown;
  assertInvalid(validateBom, incompleteAssetKinds, "required");

  const extendedAssetKinds = structuredClone(defaultBom);
  (
    extendedAssetKinds.securityPolicyInventory.assetKinds as unknown as Record<
      string,
      number
    >
  ).future_kind = 0;
  assertInvalid(validateBom, extendedAssetKinds, "additionalProperties");
});

test("Trust Graph schema rejects missing and invalid edge provenance", async () => {
  const { validateTrustGraph } = await validators();
  const graph = await representativeTrustGraph();
  assertValid(validateTrustGraph, graph);

  const negativeSummaryCount = structuredClone(graph);
  negativeSummaryCount.summary.nodeTypeCounts.asset = -1;
  assertInvalid(validateTrustGraph, negativeSummaryCount, "minimum");

  const ownershipWithoutSource = structuredClone(graph);
  const ownedBy = requiredEdge(ownershipWithoutSource, "owned_by");
  assert.ok(ownedBy.properties);
  delete ownedBy.properties.ownershipSource;
  assertInvalid(validateTrustGraph, ownershipWithoutSource, "required");

  const inheritedOwnershipWithoutOrigin = structuredClone(graph);
  const inheritedOwnedBy = inheritedOwnershipWithoutOrigin.edges.find(
    (edge) =>
      edge.type === "owned_by" &&
      edge.properties?.ownershipSource === "inherited",
  );
  assert.ok(inheritedOwnedBy?.properties);
  delete inheritedOwnedBy.properties.inheritedFrom;
  assertInvalid(
    validateTrustGraph,
    inheritedOwnershipWithoutOrigin,
    "required",
  );

  const effectivePolicyWithoutSources = structuredClone(graph);
  const effectivePolicy = requiredEdge(
    effectivePolicyWithoutSources,
    "has_effective_policy",
  );
  assert.ok(effectivePolicy.properties);
  delete effectivePolicy.properties.policySources;
  assertInvalid(validateTrustGraph, effectivePolicyWithoutSources, "required");

  const localPolicy = graph.edges.find(
    (edge) =>
      edge.type === "has_effective_policy" &&
      Array.isArray(edge.properties?.policySources) &&
      edge.properties.policySources.length === 1 &&
      edge.properties.policySources[0] === "local",
  );
  assert.ok(localPolicy?.properties);
  assert.equal(localPolicy.properties.inheritedFrom, undefined);

  const owningSkillPolicyWithoutOrigin = structuredClone(graph);
  const owningSkillPolicy = owningSkillPolicyWithoutOrigin.edges.find(
    (edge) =>
      edge.type === "has_effective_policy" &&
      Array.isArray(edge.properties?.policySources) &&
      edge.properties.policySources.includes("owning_skill"),
  );
  assert.ok(owningSkillPolicy?.properties);
  assert.ok(owningSkillPolicy.properties.inheritedFrom);
  delete owningSkillPolicy.properties.inheritedFrom;
  assertInvalid(validateTrustGraph, owningSkillPolicyWithoutOrigin, "required");

  const emptyPolicySources = structuredClone(graph);
  const emptyPolicyEdge = requiredEdge(
    emptyPolicySources,
    "has_effective_policy",
  );
  assert.ok(emptyPolicyEdge.properties);
  emptyPolicyEdge.properties.policySources = [];
  assertInvalid(validateTrustGraph, emptyPolicySources, "minItems");

  const duplicatePolicySources = structuredClone(graph);
  const duplicatePolicyEdge = requiredEdge(
    duplicatePolicySources,
    "has_effective_policy",
  );
  assert.ok(duplicatePolicyEdge.properties);
  duplicatePolicyEdge.properties.policySources = ["local", "local"];
  assertInvalid(validateTrustGraph, duplicatePolicySources, "uniqueItems");

  const unknownPolicySource = structuredClone(graph);
  const unknownPolicyEdge = requiredEdge(
    unknownPolicySource,
    "has_effective_policy",
  );
  assert.ok(unknownPolicyEdge.properties);
  unknownPolicyEdge.properties.policySources = ["environment"];
  assertInvalid(validateTrustGraph, unknownPolicySource, "enum");
});

async function validators(): Promise<{
  validateBom: ValidateFunction;
  validateTrustGraph: ValidateFunction;
}> {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
    strictRequired: false,
  });
  addFormats.default(ajv);
  const [bomSchema, trustGraphSchema] = await Promise.all([
    schema(BOM_SCHEMA_PATH),
    schema(TRUST_GRAPH_SCHEMA_PATH),
  ]);
  return {
    validateBom: ajv.compile(bomSchema),
    validateTrustGraph: ajv.compile(trustGraphSchema),
  };
}

async function schema(file: string): Promise<AnySchemaObject> {
  return JSON.parse(await readFile(file, "utf8")) as AnySchemaObject;
}

async function representativeTrustGraph(): Promise<TrustGraph> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-schema-graph-"));
  const skill = path.join(root, "skills", "demo");
  try {
    await mkdir(path.join(skill, "scripts"), { recursive: true });
    await writeFile(
      path.join(skill, "SKILL.md"),
      `---
name: demo
description: Run a governed helper. Use when published schema validation needs support provenance.
metadata:
  renma.owner: qa-platform
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
---
# Demo

Run scripts/run.sh.

## Required Inputs
A repository fixture.

## Completion Criteria
Complete after the helper is verified.

## Verification
Verify scripts/run.sh exits successfully.

## Do Not Use For
Do not use for unrelated work.
`,
    );
    await writeFile(path.join(skill, "scripts", "run.sh"), "echo done\n");
    return await trustGraph(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function requiredEdge(
  graph: TrustGraph,
  type: TrustGraphEdgeType,
): TrustGraph["edges"][number] {
  const edge = graph.edges.find((candidate) => candidate.type === type);
  assert.ok(edge, `missing ${type} edge`);
  return edge;
}

function assertValid(validate: ValidateFunction, value: unknown): void {
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
}

function assertInvalid(
  validate: ValidateFunction,
  value: unknown,
  keyword: string,
): void {
  assert.equal(validate(value), false, "expected schema validation to fail");
  assert.ok(
    validate.errors?.some((error) => error.keyword === keyword),
    `expected ${keyword} error, received ${JSON.stringify(validate.errors, null, 2)}`,
  );
}

function schemaSurface(
  includeInvocationGovernance: boolean,
): Record<string, unknown> {
  return {
    path: "tools/check.mjs",
    scope: "repository-tool",
    origins: ["discovered-script", "resolved-static-invocation"],
    artifactKind: "script",
    contentClassification: "text",
    interpreterHints: ["node"],
    staticallyReferenced: true,
    staticallyInvoked: true,
    referenceCount: 1,
    invocationCount: 1,
    securityPolicy: {
      hasEffectivePolicy: false,
      policySources: [],
    },
    ...(includeInvocationGovernance
      ? {
          invocationGovernance: {
            invocationsWithEffectivePolicyEvidence: 1,
            invocationsWithoutEffectivePolicyEvidence: 0,
            distinctEffectivePolicyFingerprints: [sha256("a")],
          },
        }
      : {}),
    fingerprint: sha256("b"),
  };
}

function schemaInvocation(includeGovernance: boolean): Record<string, unknown> {
  return {
    sourcePath: "skills/demo/SKILL.md",
    line: 7,
    snippet: "node tools/check.mjs",
    launcher: "node",
    rawTarget: "tools/check.mjs",
    normalizedTarget: "tools/check.mjs",
    sourceSkillDirectory: "skills/demo",
    resolution: "resolved",
    targetPathState: "parsed",
    occurrenceOrdinal: 1,
    ...(includeGovernance
      ? {
          governance: {
            owningSkillResolution: "resolved",
            policyEvidence: [
              {
                relation: "source-artifact",
                path: "skills/demo/SKILL.md",
                hasEffectivePolicy: true,
                policySources: ["local"],
                fingerprint: sha256("a"),
              },
            ],
            hasEffectivePolicyEvidence: true,
            distinctEffectivePolicyFingerprints: [sha256("a")],
            fingerprint: sha256("c"),
          },
        }
      : {}),
  };
}

function sha256(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
