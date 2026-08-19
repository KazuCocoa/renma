import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PUBLIC_JSON_SCHEMA_VERSIONS } from "../src/commands/public-json-schema-versions.js";

test("public JSON schema registry matches the documented top-level inventory", async () => {
  const documentation = await readFile("docs/machine-readable-json.md", "utf8");
  const rows = documentation
    .split("\n")
    .map((line) => line.split("|").slice(1, -1).map(cleanTableCell))
    .filter(
      (cells): cells is [string, string, string] =>
        cells.length === 3 && /^renma\..+\.v\d+$/u.test(cells[1] ?? ""),
    );
  const documented = Object.fromEntries(
    rows.map(([command, schemaVersion]) => [command, schemaVersion]),
  );
  const { "execution-contract": experimental, ...stable } = documented;

  assert.deepEqual(stable, PUBLIC_JSON_SCHEMA_VERSIONS.stable);
  assert.deepEqual(
    { "execution-contract": experimental },
    PUBLIC_JSON_SCHEMA_VERSIONS.experimental,
  );
  assert.deepEqual(
    Object.fromEntries(
      rows.map(([command, , assurance]) => [command, assurance]),
    ),
    {
      scan: "Representative whole-document golden",
      catalog: "Representative whole-document golden",
      graph: "Representative whole-document golden",
      readiness: "Representative whole-document golden",
      ownership: "Representative whole-document golden",
      diff: "Representative revision-diff whole-document golden",
      "ci-report": "Representative revision-report whole-document golden",
      "inspect outline": "Representative whole-document golden",
      "inspect --lines": "Representative whole-document golden",
      "guide skill": "Representative whole-document golden",
      scaffold: "Representative whole-document golden",
      "suggest-metadata": "Representative whole-document golden",
      "suggest-semantic-split": "Representative whole-document golden",
      "skill-index": "Representative whole-document golden",
      "trust-graph":
        "Published JSON Schema plus frozen semantic contract fixture",
      bom: "Published JSON Schema plus whole-document golden",
      "execution-contract":
        "Explicitly experimental tests; no stable 1.x assurance",
    },
  );
});

function cleanTableCell(value: string): string {
  return value.trim().replaceAll("`", "");
}
