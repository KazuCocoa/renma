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
  const graph = await representativeTrustGraph();

  assertValid(validateBom, defaultBom);
  assertValid(validateBom, omittedBom);
  assert.equal(defaultBom.outputMode, "default");
  assert.equal(typeof defaultBom.generatedAt, "string");
  assert.equal(omittedBom.outputMode, "omit_generated_at");
  assert.equal("generatedAt" in omittedBom, false);

  const withoutConfigPath = structuredClone(defaultBom);
  delete withoutConfigPath.configPath;
  assertValid(validateBom, withoutConfigPath);

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
});

test("Trust Graph schema rejects missing and invalid edge provenance", async () => {
  const { validateTrustGraph } = await validators();
  const graph = await representativeTrustGraph();
  assertValid(validateTrustGraph, graph);

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
