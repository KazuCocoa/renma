import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PUBLIC_JSON_SCHEMA_VERSIONS } from "./public-json-schema-versions.js";

const RELEASE_CANDIDATE_1_0_SCHEMA_IDENTITIES = {
  scan: "renma.scan.v2",
  catalog: "renma.catalog.v1",
  graph: "renma.graph.v1",
  readiness: "renma.readiness.v2",
  ownership: "renma.ownership.v1",
  diff: "renma.diff.v1",
  "ci-report": "renma.ci-report.v1",
  "inspect outline": "renma.inspect-outline.v1",
  "inspect --lines": "renma.inspect-slice.v1",
  "guide skill": "renma.skill-authoring-guide.v2",
  scaffold: "renma.scaffold.v1",
  "suggest-metadata": "renma.metadata-suggestion.v1",
  "suggest-semantic-split": "renma.semantic-split-suggestion.v1",
  "skill-index": "renma.skill-index.v1",
  "trust-graph": "renma.trustGraph.v2",
  bom: "renma.repository-context-bom.v3",
} as const;

test("1.0 release-candidate top-level schema identities are frozen", () => {
  assert.deepEqual(
    PUBLIC_JSON_SCHEMA_VERSIONS.stable,
    RELEASE_CANDIDATE_1_0_SCHEMA_IDENTITIES,
  );
  assert.equal(
    "execution-contract" in RELEASE_CANDIDATE_1_0_SCHEMA_IDENTITIES,
    false,
  );
});

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
  assert.match(documentation, /Skill Authoring Guide v2 replaces v1/);
  assert.match(
    documentation,
    /Consumers must branch on `schemaVersion`:[\s\S]*`renma\.skill-authoring-guide\.v1` is\s+not reinterpreted or emitted as the new contract/,
  );
});

function cleanTableCell(value: string): string {
  return value.trim().replaceAll("`", "");
}
