import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { bom } from "../src/commands/bom.js";
import { trustGraph } from "../src/commands/trust-graph.js";

type JsonSchema = Record<string, unknown>;

test("published v2 schemas validate representative generated reports", async () => {
  const target = path.resolve("examples/interactive-placeholder");
  const bomSchema = await schema(
    "docs/schemas/repository-context-bom-v2.schema.json",
  );
  const trustSchema = await schema("docs/schemas/trust-graph-v2.schema.json");

  validate(await bom(target, {}, { omitGeneratedAt: true }), bomSchema);
  validate(await trustGraph(target), trustSchema);
});

test("published schemas pin the v2-only contract and provenance arrays", async () => {
  const bomSchema = await schema(
    "docs/schemas/repository-context-bom-v2.schema.json",
  );
  const trustSchema = await schema("docs/schemas/trust-graph-v2.schema.json");
  assert.equal(
    property(bomSchema, "schemaVersion").const,
    "renma.repository-context-bom.v2",
  );
  assert.equal(
    property(trustSchema, "schemaVersion").const,
    "renma.trustGraph.v2",
  );
  const edge = definition(trustSchema, "edge");
  const edgeProperties = property(edge, "properties");
  const policySources = property(edgeProperties, "policySources");
  assert.equal(policySources.minItems, 1);
  assert.deepEqual((policySources.items as JsonSchema).enum, [
    "local",
    "security_profile",
    "repository_config",
    "owning_skill",
  ]);
});

async function schema(file: string): Promise<JsonSchema> {
  return JSON.parse(await readFile(file, "utf8")) as JsonSchema;
}

function validate(value: unknown, root: JsonSchema): void {
  const errors: string[] = [];
  visit(value, root, root, "$", errors);
  assert.deepEqual(errors, []);
}

function visit(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  location: string,
  errors: string[],
): void {
  if (typeof schema.$ref === "string") {
    visit(value, resolveReference(root, schema.$ref), root, location, errors);
    return;
  }
  if ("const" in schema && value !== schema.const)
    errors.push(`${location}: expected const ${String(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    errors.push(`${location}: value is outside enum`);

  const allowedTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (
    allowedTypes.length > 0 &&
    !allowedTypes.some(
      (type) =>
        jsonType(value) === type ||
        (type === "number" && jsonType(value) === "integer"),
    )
  ) {
    errors.push(`${location}: expected ${allowedTypes.join("|")}`);
    return;
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      errors.push(`${location}: fewer than minItems`);
    if (schema.items && typeof schema.items === "object")
      value.forEach((item, index) =>
        visit(
          item,
          schema.items as JsonSchema,
          root,
          `${location}[${index}]`,
          errors,
        ),
      );
    return;
  }
  if (!isRecord(value)) return;

  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const required of Array.isArray(schema.required)
    ? schema.required
    : []) {
    if (typeof required === "string" && !(required in value))
      errors.push(`${location}: missing ${required}`);
  }
  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key];
    if (isRecord(childSchema)) {
      visit(child, childSchema, root, `${location}.${key}`, errors);
    } else if (schema.additionalProperties === false) {
      errors.push(`${location}: unexpected ${key}`);
    } else if (isRecord(schema.additionalProperties)) {
      visit(
        child,
        schema.additionalProperties,
        root,
        `${location}.${key}`,
        errors,
      );
    }
  }
}

function resolveReference(root: JsonSchema, reference: string): JsonSchema {
  assert.match(reference, /^#\//);
  let current: unknown = root;
  for (const segment of reference.slice(2).split("/")) {
    assert.ok(isRecord(current));
    current = current[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  assert.ok(isRecord(current));
  return current;
}

function property(schema: JsonSchema, name: string): JsonSchema {
  assert.ok(isRecord(schema.properties));
  const value = schema.properties[name];
  assert.ok(isRecord(value));
  return value;
}

function definition(schema: JsonSchema, name: string): JsonSchema {
  assert.ok(isRecord(schema.$defs));
  const value = schema.$defs[name];
  assert.ok(isRecord(value));
  return value;
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value === "object" ? "object" : typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
