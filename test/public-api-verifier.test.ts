import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

interface PublicApiSnapshot {
  version: number;
  entrypoints: Record<string, Record<string, string>>;
  declarations: Record<
    string,
    { declarations: string[]; references: string[] }
  >;
}

interface PublicApiVerifierModule {
  createPublicApiSnapshot(options: {
    entrypoints: ReadonlyMap<string, string>;
    ownedDeclarationRoots: string[];
  }): PublicApiSnapshot;
  normalizeLineEndings(value: string): string;
}

const verifierUrl = pathToFileURL(
  path.resolve("scripts/verify-public-api.mjs"),
).href;

test("the public API verifier is independent of platform line endings", async () => {
  const verifier = (await import(verifierUrl)) as PublicApiVerifierModule;
  assert.equal(
    verifier.normalizeLineEndings("first\r\nsecond\rthird\n"),
    "first\nsecond\nthird\n",
  );
});

test("the public API verifier follows cyclic Renma-owned declaration graphs", async (t) => {
  const verifier = (await import(verifierUrl)) as PublicApiVerifierModule;
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "renma-public-api-verifier-"),
  );
  t.after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  const entrypoint = path.join(fixtureRoot, "entry.d.ts");
  const publicDeclaration = path.join(fixtureRoot, "public.d.ts");
  const declarationA = path.join(fixtureRoot, "internal-a.d.ts");
  const declarationB = path.join(fixtureRoot, "internal-b.d.ts");
  await writeFile(
    entrypoint,
    'export type { PublicApi } from "./public.js";\n',
  );
  await writeFile(
    publicDeclaration,
    [
      'import type { InternalA } from "./internal-a.js";',
      "export interface PublicApi {",
      "  value: Promise<InternalA>;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    declarationA,
    [
      'import type { InternalB } from "./internal-b.js";',
      "export interface InternalA {",
      "  readonly child?: InternalB;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    declarationB,
    [
      'import type { InternalA } from "./internal-a.js";',
      'export type InternalB = readonly ["v1", InternalA];',
      "",
    ].join("\n"),
  );

  const snapshot = () =>
    verifier.createPublicApiSnapshot({
      entrypoints: new Map([["fixture", entrypoint]]),
      ownedDeclarationRoots: [fixtureRoot],
    });
  const baseline = snapshot();
  const publicId = baseline.entrypoints.fixture?.PublicApi;
  assert.equal(publicId, "public.d.ts#PublicApi");
  assert.deepEqual(Object.keys(baseline.declarations), [
    "internal-a.d.ts#InternalA",
    "internal-b.d.ts#InternalB",
    "public.d.ts#PublicApi",
  ]);
  assert.deepEqual(
    baseline.declarations["internal-b.d.ts#InternalB"]?.references,
    ["internal-a.d.ts#InternalA"],
  );
  assert.ok(
    Object.keys(baseline.declarations).every(
      (id) => !id.includes("lib.") && !id.includes("node_modules"),
    ),
    "Promise and other TypeScript library declarations remain external",
  );

  await writeFile(
    declarationB,
    [
      'import type { InternalA } from "./internal-a.js";',
      'export type InternalB = readonly ["v2", InternalA];',
      "",
    ].join("\n"),
  );
  const changedB = snapshot();
  assert.equal(changedB.entrypoints.fixture?.PublicApi, publicId);
  assert.deepEqual(
    changedB.declarations[publicId]?.declarations,
    baseline.declarations[publicId]?.declarations,
  );
  assert.notDeepEqual(changedB, baseline);

  await writeFile(
    declarationA,
    [
      'import type { InternalB } from "./internal-b.js";',
      "export interface InternalA {",
      "  child: InternalB;",
      "}",
      "",
    ].join("\n"),
  );
  const changedA = snapshot();
  assert.equal(changedA.entrypoints.fixture?.PublicApi, publicId);
  assert.deepEqual(
    changedA.declarations[publicId]?.declarations,
    baseline.declarations[publicId]?.declarations,
  );
  assert.notDeepEqual(changedA, changedB);
});
