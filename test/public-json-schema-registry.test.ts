import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PUBLIC_JSON_SCHEMA_VERSIONS } from "../src/commands/public-json-schema-versions.js";

test("public JSON schema registry matches the documented top-level inventory", async () => {
  const documentation = await readFile("docs/machine-readable-json.md", "utf8");
  const documented = Object.fromEntries(
    documentation
      .split("\n")
      .map((line) => line.split("|").slice(1, -1).map(cleanTableCell))
      .filter(
        (cells): cells is [string, string] =>
          cells.length === 2 && /^renma\..+\.v\d+$/u.test(cells[1] ?? ""),
      ),
  );
  const { "execution-contract": experimental, ...stable } = documented;

  assert.deepEqual(stable, PUBLIC_JSON_SCHEMA_VERSIONS.stable);
  assert.deepEqual(
    { "execution-contract": experimental },
    PUBLIC_JSON_SCHEMA_VERSIONS.experimental,
  );
});

function cleanTableCell(value: string): string {
  return value.trim().replaceAll("`", "");
}
