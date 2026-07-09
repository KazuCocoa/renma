import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const COMMANDS = [
  "scan",
  "bom",
  "catalog",
  "diff",
  "ci-report",
  "graph",
  "trust-graph",
  "ownership",
  "readiness",
  "scaffold",
  "suggest-metadata",
  "suggest-semantic-split",
  "inspect",
] as const;

const EXPECTED_FORMATS = new Map<string, string[]>([
  ["scan", ["text", "json"]],
  ["bom", ["json", "markdown"]],
  ["catalog", ["json", "markdown"]],
  ["ownership", ["json", "markdown"]],
  ["readiness", ["json", "markdown"]],
  ["diff", ["json", "markdown"]],
  ["ci-report", ["json", "markdown"]],
  ["graph", ["json", "markdown", "mermaid"]],
  ["trust-graph", ["json", "markdown"]],
  ["inspect", ["text", "json"]],
  ["scaffold", ["file", "prompt", "json"]],
  ["suggest-metadata", ["prompt", "json"]],
  ["suggest-semantic-split", ["prompt", "json"]],
]);

const STALE_INSPECT_EXAMPLES = [
  "renma inspect . <file>",
  "renma inspect <path> <asset-or-file>",
];

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

function parseOutputFormatsTable(markdown: string): Map<string, string[]> {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line === "## Output Formats");

  assert.notEqual(
    headingIndex,
    -1,
    "docs/user-manual.md must contain a '## Output Formats' section.",
  );

  const table = new Map<string, string[]>();

  for (const line of lines.slice(headingIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }

    const match = line.match(/^\| `([^`]+)` \| (.+) \|$/);
    if (!match) {
      continue;
    }

    const command = match[1] ?? "";
    const formatCell = match[2] ?? "";

    table.set(
      command,
      [...formatCell.matchAll(/`([^`]+)`/g)].map((format) => format[1] ?? ""),
    );
  }

  return table;
}

function parseSupportedCommands(cliSource: string): string[] {
  return [...cliSource.matchAll(/command !== "([^"]+)"/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
}

test("User Manual documents every implemented CLI command", async () => {
  const [cliSource, manual] = await Promise.all([
    readRepoFile("src/cli.ts"),
    readRepoFile("docs/user-manual.md"),
  ]);

  const implementedCommands = parseSupportedCommands(cliSource);

  assert.deepEqual(
    implementedCommands.toSorted(),
    [...COMMANDS].toSorted(),
    "src/cli.ts command list changed. Update docs/user-manual.md and this docs guardrail together.",
  );

  for (const command of implementedCommands) {
    assert.match(
      manual,
      new RegExp(`^### \`${command}\`$`, "m"),
      `docs/user-manual.md is missing a '### \`${command}\`' command section.`,
    );
  }
});

test("User Manual output format table matches supported command formats", async () => {
  const manual = await readRepoFile("docs/user-manual.md");
  const documented = parseOutputFormatsTable(manual);

  assert.deepEqual(
    [...documented.keys()].sort(),
    [...EXPECTED_FORMATS.keys()].sort(),
    "docs/user-manual.md Output Formats table must list exactly the supported commands.",
  );

  for (const [command, expectedFormats] of EXPECTED_FORMATS) {
    assert.deepEqual(
      documented.get(command),
      expectedFormats,
      `docs/user-manual.md Output Formats row for '${command}' is stale.`,
    );
  }
});

test("README uses current inspect syntax", async () => {
  const readme = await readRepoFile("README.md");

  for (const staleExample of STALE_INSPECT_EXAMPLES) {
    assert.doesNotMatch(
      readme,
      new RegExp(staleExample.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `README.md contains stale inspect syntax: ${staleExample}`,
    );
  }

  assert.match(
    readme,
    /renma inspect <file>/,
    "README.md should document 'renma inspect <file>'.",
  );
  assert.match(
    readme,
    /renma inspect <file> --lines L10-L42/,
    "README.md should document 'renma inspect <file> --lines L10-L42'.",
  );
});
