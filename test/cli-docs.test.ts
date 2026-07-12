import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { COMMAND_HELP } from "../src/cli-help.js";

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

test("User Manual documents every implemented CLI command", async () => {
  const manual = await readRepoFile("docs/user-manual.md");
  const implementedCommands = COMMAND_HELP.map((command) => command.name);

  assert.deepEqual(
    implementedCommands.toSorted(),
    [...COMMANDS].toSorted(),
    "src/cli-help.ts command list changed. Update docs/user-manual.md and this docs guardrail together.",
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

test("Skill path guidance distinguishes canonical and historical entrypoints", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");
  const compatibility = await readRepoFile(
    "docs/agent-skills-compatibility.md",
  );

  assert.match(
    readme,
    /spec-review\/\n\s+SKILL\.md/,
    "README repository shape should recommend directory-based SKILL.md entrypoints.",
  );
  for (const document of [readme, manual, compatibility]) {
    assert.match(document, /Canonical Agent Skills entrypoints?/);
    assert.match(document, /historical/i);
    assert.match(
      document,
      /not(?: make those spellings)? Agent Skills-compatible/,
    );
  }
});

test("Skill authoring docs preserve the platform and Renma responsibility boundary", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const compatibility = await readRepoFile(
    "docs/agent-skills-compatibility.md",
  );
  const cliSource = await readRepoFile("src/cli-help.ts");

  for (const document of [readme, manual, authoring, compatibility]) {
    assert.match(document, /platform(?:'s|-native).*Skill authoring guidance/i);
    assert.match(document, /renma scan \. --fail-on high/);
  }

  assert.match(authoring, /Do not run two independent generators/);
  assert.match(authoring, /Optional Codex Example/);
  assert.match(authoring, /skill-creator/);
  assert.doesNotMatch(cliSource, /skill-creator/);
  assert.doesNotMatch(await readRepoFile("src/commands/scaffold.ts"), /Codex/);
  assert.doesNotMatch(
    await readRepoFile("src/commands/suggest-metadata.ts"),
    /Codex/,
  );
  assert.doesNotMatch(
    await readRepoFile("src/commands/suggest-semantic-split.ts"),
    /Codex/,
  );
  assert.match(
    authoring,
    /Do not apply a candidate while Renma cannot generate it safely/,
  );
  assert.match(
    authoring,
    /explicit owner retrofit and one-way migration of recognized pre-0\.16\s+governance and security metadata/,
  );
  assert.match(authoring, /infer missing security policy/);
  assert.doesNotMatch(authoring, /owner or security metadata completion/);

  const docsIndex = await readRepoFile("docs/README.md");
  const advanced = await readRepoFile("docs/advanced-skill-authoring.md");
  assert.match(authoring, /Advanced Skill Authoring/);
  assert.match(docsIndex, /Advanced Skill Authoring/);
  assert.match(advanced, /current 0\.17\.0 authoring guidance/);
  assert.match(advanced, /Proposed 0\.18\.0 Skill-to-Skill discovery/);
  assert.doesNotMatch(advanced, /`routes_to`|`skill-index`/);
  assert.match(readme, /proposed 0\.18\.0 Skill Discovery/i);
});

test("relative Markdown links in current documentation resolve", async () => {
  const documents = [
    "README.md",
    "architecture.md",
    "design.md",
    "plan.md",
    "plan-discovery.md",
    ...(await markdownFilesUnder("docs")),
    ...(await markdownFilesUnder("examples")),
  ];

  for (const documentPath of documents) {
    const markdown = await readRepoFile(documentPath);
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = (match[1] ?? "").trim();
      if (
        rawTarget === "" ||
        rawTarget.startsWith("#") ||
        /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
      ) {
        continue;
      }

      const withoutTitle = rawTarget.startsWith("<")
        ? rawTarget.slice(1, rawTarget.indexOf(">"))
        : (rawTarget.split(/\s+["']/)[0] ?? rawTarget);
      const relativeTarget = decodeURIComponent(
        withoutTitle.split("#", 1)[0] ?? "",
      );
      if (relativeTarget === "") continue;

      const resolved = path.resolve(path.dirname(documentPath), relativeTarget);
      await assert.doesNotReject(
        access(resolved),
        `${documentPath} contains an unresolved relative link: ${rawTarget}`,
      );
    }
  }
});

test("Mermaid documentation blocks have supported GitHub entry directives", async () => {
  const documents = [
    "README.md",
    "architecture.md",
    "design.md",
    "plan.md",
    "plan-discovery.md",
    ...(await markdownFilesUnder("docs")),
    ...(await markdownFilesUnder("examples")),
  ];
  const supportedDirective =
    /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|gitGraph)\b/;

  for (const documentPath of documents) {
    const markdown = await readRepoFile(documentPath);
    const blocks = [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)];
    const openingCount = [...markdown.matchAll(/```mermaid\b/g)].length;
    assert.equal(
      blocks.length,
      openingCount,
      `${documentPath} contains an unclosed Mermaid block.`,
    );
    for (const block of blocks) {
      assert.match(
        (block[1] ?? "").trimStart(),
        supportedDirective,
        `${documentPath} contains an unsupported Mermaid entry directive.`,
      );
    }
  }
});

async function markdownFilesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return markdownFilesUnder(entryPath);
      return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
    }),
  );
  return nested.flat().sort();
}
