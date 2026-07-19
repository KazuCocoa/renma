import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
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
  const agentSkillsIndex = readme.indexOf("## Agent Skills And Renma");

  assert.ok(philosophyIndex >= 0);
  assert.ok(
    philosophyIndex < agentSkillsIndex,
    "Context Repository philosophy should precede Agent Skills guidance.",
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
    assert.match(document, /historical/i);
    assert.match(
      document,
      /not(?: make those spellings)? Agent Skills-compatible/,
    );
  }
});

test("Skill authoring docs establish Renma boundaries before platform semantic refinement", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const compatibility = await readRepoFile(
    "docs/agent-skills-compatibility.md",
  );
  const cliSource = await readRepoFile("src/cli-help.ts");
  const guidanceSource = await readRepoFile("src/guidance/skill-authoring.ts");

  for (const document of [readme, manual, authoring, compatibility]) {
    assert.match(document, /renma guide skill/i);
    assert.match(document, /platform-native.*guidance/i);
    assert.match(document, /renma scan \. --fail-on high/);
    assert.doesNotMatch(
      document,
      /use (?:your )?platform(?:'s|-native).*guidance first,? then use Renma/i,
    );
  }

  for (const document of [readme, manual, authoring]) {
    const scanIndex = document.indexOf("renma scan . --fail-on high");
    const conditionalSuggestionIndex = document.search(
      /suggest-metadata`? only|use suggest-metadata only/i,
    );
    assert.ok(scanIndex >= 0);
    assert.ok(
      conditionalSuggestionIndex > scanIndex,
      "Existing-Skill guidance should start with scan and make suggest-metadata conditional.",
    );
  }

  assert.match(authoring, /Do not run two independent generators/);
  assert.match(authoring, /Optional Codex Example/);
  assert.match(authoring, /skill-creator/);
  assert.match(
    authoring,
    /run renma guide skill[\s\S]*conduct Renma clarification[\s\S]*pass the creation gate[\s\S]*create the Renma scaffold[\s\S]*use skill-creator only for semantic refinement/,
  );
  assert.match(
    authoring,
    /If `skill-creator` is available or activates automatically, do not let it[\s\S]*create files before the Renma clarification gate is satisfied/,
  );
  assert.match(
    authoring,
    /If semantic refinement reveals a justified asset-boundary change,[\s\S]*`skill-creator` must return that need to the Renma clarification protocol/,
  );
  assert.match(
    authoring,
    /skill-creator[\s\S]*not[\s\S]*authority for Renma metadata/,
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
  assert.match(advanced, /focused-workflow model introduced in 0\.18\.0/);
  assert.match(advanced, /0\.19\.0 authoring contract/);
  assert.match(advanced, /active Skill Discovery design/);
  assert.match(advanced, /no assigned\s+release/);
  assert.doesNotMatch(advanced, /`renma\.continues-with`|`skill-index`/);
  assert.match(readme, /Skill Discovery Design/);
  assert.match(authoring, /focused, bounded workflows/);
  assert.doesNotMatch(authoring, /current thin-Skill authoring/);
  for (const document of [readme, manual, authoring, docsIndex]) {
    assert.match(document, /consuming LLM/);
    assert.match(document, /non-interactive|does not conduct the conversation/);
  }

  const optionalExampleIndex = authoring.indexOf("## Optional Codex Example");
  assert.ok(optionalExampleIndex >= 0);
  assert.doesNotMatch(
    authoring.slice(0, optionalExampleIndex),
    /\bCodex\b|skill-creator/,
  );
  for (const document of [
    readme,
    manual,
    compatibility,
    docsIndex,
    advanced,
    await readRepoFile("design.md"),
  ]) {
    assert.doesNotMatch(document, /\bCodex\b|skill-creator/);
  }

  const changelog = await readRepoFile("CHANGELOG.md");
  assert.match(changelog, /optional Codex `skill-creator` example/);
});

test("authoring docs qualify truth, source access, repairs, and gate re-entry", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const architecture = await readRepoFile("docs/internal-architecture.md");
  const combined = [readme, manual, authoring, architecture].join("\n");

  assert.match(authoring, /User-provided artifacts/);
  assert.match(authoring, /Reviewed authoritative external source content/);
  assert.match(
    authoring,
    /deprecated, archived, stale, conflicting, unresolved, or diagnostic-blocked evidence is not Confirmed/,
  );
  assert.match(
    combined,
    /Authoring-time access is separate from finished-Skill runtime access|Authoring-time source access comes from the current/,
  );
  assert.match(combined, /never retroactively authorizes/);
  assert.match(
    combined,
    /Deterministic detection alone is not enough|deterministic detection does not imply deterministic repair/i,
  );
  assert.match(authoring, /Repeated-context findings are evidence/);
  assert.match(authoring, /re-enter the creation gate/);
  assert.match(combined, /LLM proposes\. Renma verifies\. Human approves\./);
});

test("authoring docs separate progression and document batched clarification", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const architecture = await readRepoFile("docs/internal-architecture.md");
  const cliSource = await readRepoFile("src/cli-help.ts");
  const combined = [readme, manual, authoring, architecture, cliSource].join(
    "\n",
  );

  assert.ok(
    readme.includes("I want to create a Skill with `renma guide skill`."),
  );
  assert.match(readme, /Create a Skill interactively/);
  assert.match(
    authoring,
    /Confirmed, Proposed, and Unresolved describe epistemic support/,
  );
  assert.match(
    authoring,
    /limit[\s\S]*one to three closely related questions applies only to the current turn, not[\s\S]*total set/,
  );
  assert.match(
    authoring,
    /Queued from the complete blocker list above \(not additional\)/,
  );
  assert.match(
    authoring,
    /Proceed when no Blocking decision remains[\s\S]*Reversible defaults and Deferred/,
  );
  assert.match(combined, /complete blocker set|complete Blocking set/);
  assert.match(combined, /never an automatic split|Do not split automatically/);
});

test("authoring docs separate runtime unknowns and stage-dependent dispositions", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const architecture = await readRepoFile("docs/internal-architecture.md");
  const plan = await readRepoFile("plan.md");
  const combined = [readme, manual, authoring, architecture, plan].join("\n");

  assert.match(
    authoring,
    /authoring decision[\s\S]*runtime task unknown[\s\S]*does not automatically block creation/i,
  );
  assert.match(
    authoring,
    /Do not ask the author to resolve task-instance unknowns/,
  );
  assert.match(
    authoring,
    /Do not guess does not mean stop and ask about every unknown/,
  );
  assert.match(authoring, /Failure and recovery behavior/);
  assert.match(authoring, /Report as finding/);
  assert.match(
    authoring,
    /runtime-stage blocker is execution behavior that the authored Skill must\s+handle/i,
  );
  assert.match(
    authoring,
    /Do not add\s+the task-instance fact to the authoring creation-gate blocker set/,
  );
  assert.match(
    authoring,
    /Re-enter\s+authoring clarification only when the Skill's handling policy or asset boundary\s+itself is unresolved/,
  );
  assert.match(
    authoring,
    /initial creation gate can pass with no blockers and no mandatory questions/,
  );
  assert.match(
    authoring,
    /Current schema, fields, constraints, and operation-specific behavior are[\s\S]*epistemically unresolved, source-dependent runtime knowledge/,
  );
  assert.match(
    authoring,
    /listed\s+only in the runtime task-unknown section rather than repeated in generic\s+Unresolved/,
  );
  assert.match(
    authoring,
    /Example Product API is a fictional external API[\s\S]*not a Renma concept or a real product/,
  );
  assert.match(
    authoring,
    /skills\/build-example-product-json\/SKILL\.md[\s\S]*contexts\/example-product-api\.md/,
  );
  assert.match(
    combined,
    /not repository metadata|not additional progression classes/,
  );
});

test("authoring docs separate normative protocol from optional illustrations", async () => {
  const files = await Promise.all(
    [
      "README.md",
      "architecture.md",
      "design.md",
      "plan.md",
      "docs/authoring-guide.md",
      "docs/internal-architecture.md",
      "docs/user-manual.md",
    ].map(readRepoFile),
  );
  const combined = files.join("\n");

  assert.match(combined, /structurally separate/);
  assert.match(combined, /non-normative illustrations?/i);
  assert.match(
    combined,
    /does not classify a Skill request|does not classify a request/,
  );
  assert.match(combined, /closest (?:one|example|illustration)/);
  assert.match(combined, /may ignore|may be ignored/);
  assert.match(
    combined,
    /must not be copied as templates|not Skill categories or templates/,
  );
  assert.match(
    combined,
    /Future illustrations can be added|Future illustrations may be added/,
  );
});

test("authoring docs preserve Context and external-source security boundaries", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const design = await readRepoFile("design.md");
  const combined = [readme, manual, authoring, design].join("\n");

  assert.match(
    combined,
    /correctness (?:importance )?alone (?:does not|is not)/i,
  );
  assert.match(combined, /source-of-truth status alone is sufficient/i);
  assert.match(
    authoring,
    /correctness dependency determines `requires-context` versus `optional-context`/,
  );
  assert.match(combined, /Markdown URL does not grant network permission/i);
  assert.match(combined, /allowed[- ]data/i);
  assert.match(combined, /approved[- ]destination/i);
  assert.match(combined, /external[- ]upload/i);
  assert.match(combined, /secrets/i);
  assert.match(combined, /human[- ]approval/i);
  assert.match(
    combined,
    /do not (?:manufacture|infer) permissive policy values/i,
  );
  assert.match(
    authoring,
    /URL is body content, not a Renma asset node or graph edge/,
  );
  assert.match(authoring, /Neither a\s+clean scan nor a valid graph proves/i);
});

test("ordinary existing-Skill workflows start with scan and keep guide conditional", async () => {
  const readme = await readRepoFile("README.md");
  const manual = await readRepoFile("docs/user-manual.md");
  const authoring = await readRepoFile("docs/authoring-guide.md");
  const sections = [
    readme.slice(
      readme.indexOf("For an existing Skill:"),
      readme.indexOf("The [Authoring Guide]"),
    ),
    manual.slice(
      manual.indexOf("## User Story: Improve Existing Skills With Diagnostics"),
      manual.indexOf("## Configuration"),
    ),
    authoring.slice(
      authoring.indexOf("## Existing Skill Workflow"),
      authoring.indexOf("## Canonical Skill Metadata"),
    ),
  ];

  for (const section of sections) {
    assert.match(section, /renma scan \. --fail-on high/);
    const scanIndex = section.indexOf("renma scan . --fail-on high");
    const guideIndex = section.indexOf("renma guide skill");
    assert.ok(guideIndex === -1 || scanIndex < guideIndex);
  }
  assert.match(
    readme,
    /guide skill` only when the work\s+intentionally reconsiders/,
  );
  assert.match(
    manual,
    /guide skill` during existing-Skill work only when intentionally/,
  );
  assert.match(
    authoring,
    /guide skill` only when the work intentionally reconsiders/,
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

test("published current docs separate implemented discovery from the active unimplemented design", async () => {
  const documents = [
    "README.md",
    "plan.md",
    "plan-discovery.md",
    "docs/README.md",
    "docs/authoring-guide.md",
    "docs/advanced-skill-authoring.md",
    "docs/repository-context-bom.md",
    "docs/trust-graph.md",
  ];
  const content = await Promise.all(documents.map(readRepoFile));
  assert.ok(content.some((text) => /focused workflow/i.test(text)));
  assert.ok(content.some((text) => /active Skill Discovery/i.test(text)));
  assert.ok(
    content.some((text) =>
      /repository.*support-resource\s+discovery.*implemented/is.test(text),
    ),
  );
  for (const [index, text] of content.entries()) {
    assert.doesNotMatch(
      text,
      /Proposed 0\.18\.0 Skill(?:-to-Skill)? Discovery/i,
      `${documents[index]} assigns Skill Discovery to 0.18.0`,
    );
    assert.doesNotMatch(text, /current thin-Skill|thin, bounded Skills/i);
    assert.doesNotMatch(text, /renma-quality@0\.18\.0/);
  }
  const proposal = content[2] ?? "";
  assert.match(proposal, /Status: active design proposal/);
  assert.match(proposal, /Implementation status: not implemented/);
  assert.match(proposal, /Baseline: Renma 0\.21\.0/);
  assert.match(proposal, /`renma\.continues-with`/);
  assert.match(proposal, /`renma\.published-entrypoint`/);
  assert.match(
    proposal,
    /Discovery-eligible Skill[\s\S]*specification-valid canonical Agent Skill[\s\S]*not deprecated[\s\S]*not archived/,
  );
  assert.match(
    proposal,
    /target is a specification-invalid Skill, retain its Skill identity,\s+path, validation diagnostics, and route evidence/,
  );
  assert.match(proposal, /"skill_discovery"[\s\S]*"adopted": true/);
  assert.match(
    proposal,
    /Publishing an entrypoint does not declare that every Discovery-eligible Skill/,
  );
  assert.match(
    proposal,
    /Repository-wide coverage is a\s+separate explicit configuration decision/,
  );
  assert.match(
    proposal,
    /global unreachable Skills only in adopted mode|only the adopted state enables authoritative\s+global unreachable diagnostics/,
  );
  assert.match(
    proposal,
    /Arbitrary local Markdown links are \*\*not\*\* authoritative routes/,
  );
  for (const text of [content[0] ?? "", content[3] ?? ""]) {
    assert.doesNotMatch(text, /renma skill-index \[path\]/);
  }
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

test("authoritative current documentation describes only BOM and Trust Graph v2", async () => {
  const documents = [
    "architecture.md",
    "design.md",
    "plan.md",
    "docs/repository-context-bom.md",
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
