import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { COMMAND_HELP } from "../src/cli-help.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const COMMANDS = [
  "init",
  "scan",
  "bom",
  "catalog",
  "diff",
  "ci-report",
  "graph",
  "execution-contract",
  "skill-index",
  "trust-graph",
  "ownership",
  "readiness",
  "guide",
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
  ["execution-contract", ["json"]],
  ["skill-index", ["json", "markdown"]],
  ["trust-graph", ["json", "markdown"]],
  ["inspect", ["text", "json"]],
  ["guide", ["prompt", "json"]],
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

test("User Manual mentions every CLI option exposed by command help", async () => {
  const manual = await readRepoFile("docs/user-manual.md");
  const optionNames = new Set(
    COMMAND_HELP.flatMap((command) =>
      command.options.map((option) =>
        typeof option === "string" ? option : option.name,
      ),
    ),
  );

  for (const optionName of [...optionNames].sort()) {
    assert.match(
      manual,
      new RegExp(`--${optionName}(?![a-z-])`),
      `docs/user-manual.md does not mention the '--${optionName}' option exposed by src/cli-help.ts.`,
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

test("README preserves the Context Repository philosophy", async () => {
  const readme = await readRepoFile("README.md");
  const philosophyIndex = readme.indexOf("## Why A Context Repository?");
  const productBoundaryIndex = readme.indexOf("## Product Boundary");

  assert.ok(philosophyIndex >= 0);
  assert.ok(
    philosophyIndex < productBoundaryIndex,
    "The concise product philosophy should precede the product boundary.",
  );
  assert.match(
    readme,
    /A Context Repository is a Git-reviewed source of truth/,
  );
  assert.match(readme, /reusable knowledge/);
  assert.match(readme, /https:\/\/kazucocoa\.blog\/context-repository\//);
});

test("README and User Manual distinguish repository init from asset scaffold", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");

  for (const document of [readme, manual]) {
    assert.match(
      document,
      /`?renma init`? initializes repository-level Renma configuration/i,
    );
    assert.match(document, /does not\s+create Skills or Context Assets/i);
    assert.match(
      document,
      /`?renma scaffold`? creates one explicitly requested Skill, Context Asset, or\s+Context Lens/i,
    );
    assert.match(document, /renma init \./);
    assert.match(
      document,
      /without\s+(?:running\s+)?`?renma init`?|do not need to run `renma init`/i,
    );
  }
});

test("User Manual default glob list matches DEFAULT_CONFIG", async () => {
  const manual = await readRepoFile("docs/user-manual.md");
  const start = manual.indexOf("Canonical Agent Skills entrypoints are:");
  const end = manual.indexOf("## Where To Go Next", start);

  assert.ok(start >= 0);
  assert.ok(end > start);
  const documented = [
    ...manual.slice(start, end).matchAll(/^- `([^`]+)`$/gm),
  ].map((match) => match[1] ?? "");

  assert.deepEqual(documented.toSorted(), [...DEFAULT_CONFIG.globs].toSorted());
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
    assert.match(document, /skills\/\*\*\/SKILL\.md/);
    assert.match(document, /\.agents\/skills\/\*\*\/SKILL\.md/);
    assert.match(
      document,
      /historical[\s\S]*`skill\.md`[\s\S]*`\*\.skill\.md`/i,
    );
    assert.match(
      document,
      /(?:does not make those spellings|spellings are not)\s+Agent Skills-compatible/,
    );
  }
});

test("Authoring Guide preserves the Renma and platform responsibility boundary", async () => {
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const cliSource = await readRepoFile("src/cli-help.ts");
  const guidanceSource = await readRepoFile("src/guidance/skill-authoring.ts");

  assert.match(
    authoring,
    /For a new Skill,[\s\S]*start with\s+`renma guide skill`/,
  );
  assert.match(
    authoring,
    /After the clarification gate[\s\S]*platform-native Skill authoring guidance may refine[\s\S]*not the authority for Renma metadata/,
  );
  assert.match(
    authoring,
    /Ordinary\s+maintenance of an existing Skill starts with `renma scan \. --fail-on high`/,
  );
  assert.match(
    authoring,
    /`renma guide skill` remains deterministic and non-interactive[\s\S]*the consuming LLM conducts the conversation/,
  );
  assert.match(authoring, /LLM proposes\. Renma verifies\. Human approves\./);
  assert.match(authoring, /Do not run two independent generators/);
  assert.match(
    authoring,
    /Use `renma guide skill` only when the work intentionally reconsiders Skill and\s+Context boundaries/,
  );

  const optionalExampleIndex = authoring.indexOf("## Optional Codex Example");
  assert.ok(optionalExampleIndex >= 0);
  assert.doesNotMatch(
    authoring.slice(0, optionalExampleIndex),
    /\bCodex\b|skill-creator/,
  );
  assert.doesNotMatch(cliSource, /skill-creator/);
  assert.doesNotMatch(guidanceSource, /\bCodex\b|skill-creator/);
  assert.doesNotMatch(await readRepoFile("src/commands/scaffold.ts"), /Codex/);
  assert.doesNotMatch(
    await readRepoFile("src/commands/suggest-metadata.ts"),
    /Codex/,
  );
  assert.doesNotMatch(
    await readRepoFile("src/commands/suggest-semantic-split.ts"),
    /Codex/,
  );
});

test("Context Lens docs use canonical Skill metadata and explicit semantic boundaries", async () => {
  const lensGuide = await readRepoFile("docs/context-lens.md");
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const diagnostics = await readRepoFile("docs/diagnostics.md");

  assert.match(
    lensGuide,
    /Do not create a Context Lens when there\s+is no Context Asset/s,
  );
  assert.match(
    lensGuide,
    /A persona may frame a Lens, but a persona alone does not define one/,
  );
  assert.match(lensGuide, /Act as a senior QA engineer/);
  assert.match(lensGuide, /questions, risks, evidence, and expected output/);
  assert.match(lensGuide, /name: spec-review/);
  assert.match(
    lensGuide,
    /renma\.requires-context: '\["context\.testing\.boundary-value-analysis"\]'/,
  );
  assert.match(
    lensGuide,
    /renma\.requires-lens: '\["lens\.testing\.spec-review\.boundary-values"\]'/,
  );
  assert.match(lensGuide, /renma\.optional-lens: '\[\]'/);
  assert.doesNotMatch(lensGuide, /^id: skill\./m);
  assert.doesNotMatch(lensGuide, /^requires_lens:/m);
  assert.match(lensGuide, /^## Current Non-Goals$/m);
  assert.doesNotMatch(lensGuide, /Non-Goals For 0\.12\.0/);

  for (const asset of [
    "Skill",
    "Context Asset",
    "Context Lens",
    "Profile",
    "Reference",
    "Example",
    "Script",
    "Asset",
    "Provider-specific",
    "External agent or runtime",
  ]) {
    assert.match(authoring, new RegExp(asset));
  }
  assert.match(authoring, /Dynamically select a Lens/);
  assert.match(authoring, /create no asset solely for it/);
  assert.match(diagnostics, /CONTEXT-LENS-TARGET-NOT-CONTEXT/);
  assert.match(diagnostics, /must reference a Context Asset/);
});

test("current Skill Discovery docs preserve the static contract and boundaries", async () => {
  const rationale = await readRepoFile("docs/development/plan-discovery.md");
  const contract = await readRepoFile("docs/skill-discovery.md");

  assert.match(
    rationale,
    /Status: stable single-repository static Discovery core/,
  );
  assert.match(rationale, /not a release sequence or a second copy/);
  assert.match(
    rationale,
    /Publishing an entrypoint does not declare that every Discovery-eligible Skill[\s\S]*Repository-wide coverage is a separate explicit\s+configuration decision/,
  );
  assert.match(
    rationale,
    /Arbitrary local Markdown links are \*\*not\*\* authoritative routes/,
  );
  assert.match(rationale, /^## Open Questions$/m);
  assert.match(rationale, /candidates, not commitments/);
  assert.match(rationale, /^## Non-Goals$/m);

  assert.match(contract, /static, declaration-driven Skill-to-Skill graph/);
  assert.match(contract, /`metadata\.renma\.continues-with`/);
  assert.match(contract, /`metadata\.renma\.published-entrypoint`/);
  assert.match(contract, /"skill_discovery"[\s\S]*"adopted": true/);
  assert.match(
    contract,
    /specification-valid canonical Agent Skill[\s\S]*lifecycle-usable[\s\S]*status is omitted[\s\S]*unique in effective asset ID/,
  );
  assert.match(contract, /`DISCOVERY-ROUTE-CYCLE`/);
  assert.match(contract, /renma graph \. --view discovery/);
  assert.match(contract, /renma\.skill-index\.v1/);
  assert.match(contract, /renma\.skill-discovery-diff\.v1/);
  assert.match(contract, /renma\.skill-discovery-ci-policy\.v1/);
  assert.match(
    contract,
    /does not interpret task text, select, rank, load,\s+invoke, or execute a Skill/,
  );
});

test("workflow docs keep orchestration policy in normal owning Skills", async () => {
  const advanced = await readRepoFile("docs/advanced-skill-authoring.md");
  assert.match(
    advanced,
    /published entrypoint[\s\S]*broad router[\s\S]*intermediate router[\s\S]*workflow\/orchestration Skill[\s\S]*specialized operational Skill/,
  );
  assert.match(advanced, /responsibilities, not new\s+Renma asset kinds/);
  assert.match(
    advanced,
    /Workflow Skill[\s\S]*owns overall orchestration policy[\s\S]*Child Skills[\s\S]*own individual operational responsibilities/,
  );
  assert.match(
    advanced,
    /`renma\.continues-with` declares only possible authoritative continuation edges/,
  );
  assert.match(advanced, /Declaration order has no priority meaning/);
  assert.match(
    advanced,
    /Renma does not parse the\s+workflow prose or execute child Skills/,
  );
  assert.match(
    advanced,
    /workflow semantics remain in the body\s+of the owning workflow Skill/,
  );
  assert.match(advanced, /intermediate Skill may own Context/);
});

test("authoritative current documentation describes only BOM and Trust Graph v2", async () => {
  const documents = [
    "README.md",
    "docs/development/architecture.md",
    "docs/development/design.md",
    "docs/development/plan.md",
    "docs/repository-context-bom.md",
    "docs/trust-graph.md",
    "docs/README.md",
    "docs/user-manual.md",
  ];
  const staleContract =
    /(?:Repository Context )?BOM v1|Trust Graph v1|Both BOM schemas|renma\.repository-context-bom\.v1|renma\.trustGraph\.v1/;
  for (const documentPath of documents) {
    assert.doesNotMatch(
      await readRepoFile(documentPath),
      staleContract,
      `${documentPath} contains a stale current BOM/Trust Graph contract`,
    );
  }
});

test("Mermaid documentation blocks have supported GitHub entry directives", async () => {
  const documents = [
    "README.md",
    "docs/development/architecture.md",
    "docs/development/design.md",
    "docs/development/plan.md",
    "docs/development/plan-discovery.md",
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
