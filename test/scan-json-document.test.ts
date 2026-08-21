import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { formatJson, toScanJsonDocument } from "../src/report.js";
import { scan } from "../src/scanner.js";
import {
  SCAN_JSON_SCHEMA_VERSION,
  type ScanJsonDocument,
  type ScanResult,
} from "../src/types/scan-result.js";

test("scan JSON serialization adds the typed renma.scan.v1 wire boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-scan-json-type-"));
  const result: ScanResult = await scan(root, { format: "json" });
  const expectedDocument = toScanJsonDocument(result);
  const document = JSON.parse(formatJson(result)) as ScanJsonDocument;

  assert.equal("schemaVersion" in result, false);
  assert.equal(result.format, "json");
  assert.equal(document.schemaVersion, "renma.scan.v1");
  assert.equal(document.format, "json");
  assert.deepEqual(document, expectedDocument);
});

test("scan JSON projection excludes internal-only ScanResult properties", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-scan-json-internal-"),
  );
  const result = (await scan(root, { format: "json" })) as ScanResult & {
    internalOnly: { enumerable: true };
  };
  result.internalOnly = { enumerable: true };

  const document = JSON.parse(formatJson(result)) as Record<string, unknown>;

  assert.equal("internalOnly" in document, false);
  assert.equal("internalOnly" in toScanJsonDocument(result), false);
});

test("the JSON wire type is narrower than the core scan result", () => {
  function acceptCoreFormat(format: ScanResult["format"]): void {
    void format;
  }
  function acceptWireFormat(format: ScanJsonDocument["format"]): void {
    void format;
  }

  acceptCoreFormat("text");
  acceptCoreFormat("json");
  acceptWireFormat("json");
  // @ts-expect-error The serialized scan document never reports text format.
  acceptWireFormat("text");
});

test("formatJson enforces JSON format even for a text-configured core result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-scan-json-core-"));
  const result = await scan(root, { format: "text" });
  const document = JSON.parse(formatJson(result)) as ScanJsonDocument;

  assert.equal(result.format, "text");
  assert.equal(document.format, "json");
});
