import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import {
  buildSkillIndexReport,
  formatSkillIndexJson,
  formatSkillIndexMarkdown,
} from "../src/commands/skill-index.js";
import { CONTEXT_LENS_DIAGNOSTIC_CODES } from "../src/context-lens.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { focusSkillDiscoveryIndex } from "../src/skill-discovery.js";

test("skill-index help documents the static stdout-only command", async () => {
  const rootHelp = await captured(() => main(["--help"]));
  const help = await captured(() => main(["skill-index", "--help"]));

  assert.equal(rootHelp.code, 0);
  assert.match(
    rootHelp.stdout,
    /skill-index\s+Where can static Skill Discovery begin/,
  );
  assert.equal(help.code, 0);
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /renma skill-index \[path\] \[options\]/);
  assert.match(help.stdout, /renma\.skill-index\.v1/);
  assert.match(help.stdout, /Defaults to markdown/);
  assert.match(help.stdout, /--focus <asset-id-or-path>/);
  assert.match(help.stdout, /writes only to stdout/);
});

test("skill-index defaults to Markdown and supports explicit JSON conventions", async (t) => {
  const root = await fixture(t);
  await writeSkill(root, "published", "skill.published", {
    published: true,
    routes: ["skill.child"],
  });
  await writeSkill(root, "child", "skill.child");

  const before = await repositoryFiles(root);
  const defaultResult = await captured(() => main(["skill-index", root]));
  const markdown = await captured(() =>
    main(["skill-index", root, "--format", "markdown"]),
  );
  const json = await captured(() =>
    main(["skill-index", root, "--format", "json"]),
  );
  const shortcut = await captured(() => main(["skill-index", root, "--json"]));

  assert.equal(defaultResult.code, 0);
  assert.equal(defaultResult.stderr, "");
  assert.equal(defaultResult.stdout, markdown.stdout);
  assert.match(defaultResult.stdout, /^# Renma Skill Index/m);
  assert.match(defaultResult.stdout, /This is a static Skill index/);
  assert.match(
    defaultResult.stdout,
    /does not interpret the user request, select the best Skill, load Context, or execute a workflow/,
  );
  assert.equal(json.code, 0);
  assert.equal(json.stderr, "");
  assert.equal(json.stdout, shortcut.stdout);
  assert.equal(JSON.parse(json.stdout).schemaVersion, "renma.skill-index.v1");
  assert.deepEqual(await repositoryFiles(root), before);
});

test("skill-index rejects conflicting, invalid, unknown, and Mermaid options", async (t) => {
  const root = await fixture(t);
  const cases: Array<{ argv: string[]; pattern: RegExp }> = [
    {
      argv: ["skill-index", root, "--json", "--format", "markdown"],
      pattern: /--json conflicts with a non-JSON --format/,
    },
    {
      argv: ["skill-index", root, "--format", "text"],
      pattern: /--format must be either json or markdown/,
    },
    {
      argv: ["skill-index", root, "--format", "mermaid"],
      pattern: /--format must be either json or markdown/,
    },
    {
      argv: ["skill-index", root, "--view", "discovery"],
      pattern: /skill-index does not support --view/,
    },
    {
      argv: ["skill-index", root, "--unknown-option"],
      pattern: /Unknown option '--unknown-option'/,
    },
  ];
  for (const item of cases) {
    const result = await captured(() => main(item.argv));
    assert.equal(result.code, 2, item.argv.join(" "));
    assert.equal(result.stdout, "", item.argv.join(" "));
    assert.match(result.stderr, item.pattern, item.argv.join(" "));
  }
});

test("skill-index uses current directory by default and preserves -- paths beginning with hyphen", async (t) => {
  const parent = await fixture(t);
  const root = path.join(parent, "-repository");
  await mkdir(root);
  await writeSkill(root, "entry", "skill.entry", { published: true });
  const previous = process.cwd();
  try {
    process.chdir(root);
    const normalizedRoot = process.cwd();
    const defaultPath = await captured(() =>
      main(["skill-index", "--format", "json"]),
    );
    assert.equal(defaultPath.code, 0);
    assert.equal(JSON.parse(defaultPath.stdout).root, normalizedRoot);

    process.chdir(parent);
    const hyphenPath = await captured(() =>
      main(["skill-index", "--format", "json", "--", "-repository"]),
    );
    assert.equal(hyphenPath.code, 0);
    assert.equal(JSON.parse(hyphenPath.stdout).root, normalizedRoot);
  } finally {
    process.chdir(previous);
  }
});

test("the v1 builder wraps the prepared Discovery index without recalculation", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: true } })}\n`,
  );
  await writeSkill(root, "entry", "skill.entry", {
    published: true,
    routes: ["skill.child", "skill.missing"],
  });
  await writeSkill(root, "child", "skill.child");
  const snapshot = await collectRepositorySnapshot(root);
  const report = buildSkillIndexReport(snapshot);
  const discovery = snapshot.skillDiscovery;

  assert.deepEqual(Object.keys(report), [
    "schemaVersion",
    "root",
    "configPath",
    "scannedFileCount",
    "adoption",
    "coverage",
    "summary",
    "skills",
    "routes",
    "publishedEntrypointIds",
    "reachableDiscoveryEligibleSkillIds",
    "notReachedDiscoveryEligibleSkillIds",
    "structuralRootIds",
    "standaloneSkillIds",
    "unroutedSkillIds",
    "diagnostics",
  ]);
  assert.equal(report.schemaVersion, "renma.skill-index.v1");
  assert.equal(report.root, root);
  assert.equal(report.configPath, "renma.config.json");
  assert.equal(report.scannedFileCount, 2);
  assert.equal(report.focus, undefined);
  for (const key of [
    "skills",
    "routes",
    "adoption",
    "coverage",
    "summary",
    "publishedEntrypointIds",
    "reachableDiscoveryEligibleSkillIds",
    "notReachedDiscoveryEligibleSkillIds",
    "structuralRootIds",
    "standaloneSkillIds",
    "unroutedSkillIds",
  ] as const) {
    assert.deepEqual(report[key], discovery[key], key);
  }
  assert.deepEqual(report.diagnostics.discovery, discovery.diagnostics);
  assert.equal(
    report.diagnostics.repository.some((item) =>
      item.code?.startsWith("DISCOVERY-"),
    ),
    false,
  );
  assert.equal(formatSkillIndexJson(report), formatSkillIndexJson(report));
});

test("empty, unconfigured, partial, and authoritative reports preserve coverage semantics", async (t) => {
  const emptyRoot = await fixture(t);
  const empty = buildSkillIndexReport(
    await collectRepositorySnapshot(emptyRoot),
  );
  assert.equal(empty.configPath, undefined);
  assert.equal(empty.summary.visibleSkillCount, 0);
  assert.deepEqual(empty.skills, []);
  assert.equal(empty.adoption.state, "not-adopted");
  assert.equal(empty.coverage.mode, "not-evaluated");
  assert.match(
    formatSkillIndexMarkdown(empty),
    /No effective published entrypoint is visible/,
  );

  const unconfiguredRoot = await fixture(t);
  await writeSkill(unconfiguredRoot, "plain", "skill.plain");
  const unconfigured = buildSkillIndexReport(
    await collectRepositorySnapshot(unconfiguredRoot),
  );
  assert.equal(unconfigured.adoption.state, "not-adopted");

  const partialRoot = await fixture(t);
  await writeSkill(partialRoot, "entry", "skill.entry", { published: true });
  await writeSkill(partialRoot, "gap", "skill.gap");
  const partial = buildSkillIndexReport(
    await collectRepositorySnapshot(partialRoot),
  );
  assert.equal(partial.adoption.state, "partial");
  assert.equal(partial.coverage.mode, "descriptive");
  assert.match(
    formatSkillIndexMarkdown(partial),
    /Descriptive coverage is review evidence, not a repository-wide completeness claim/,
  );

  const authoritativeRoot = await fixture(t);
  await writeFile(
    path.join(authoritativeRoot, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: true } })}\n`,
  );
  await writeSkill(authoritativeRoot, "entry", "skill.entry", {
    published: true,
    routes: ["skill.child"],
  });
  await writeSkill(authoritativeRoot, "child", "skill.child");
  const complete = buildSkillIndexReport(
    await collectRepositorySnapshot(authoritativeRoot),
  );
  assert.equal(complete.coverage.mode, "authoritative");
  assert.equal(complete.coverage.complete, true);
  assert.match(
    formatSkillIndexMarkdown(complete),
    /None\. Every Discovery-eligible Skill is reachable/,
  );
  await writeSkill(authoritativeRoot, "gap", "skill.gap");
  const incomplete = buildSkillIndexReport(
    await collectRepositorySnapshot(authoritativeRoot),
  );
  assert.equal(incomplete.coverage.complete, false);
  assert.deepEqual(incomplete.notReachedDiscoveryEligibleSkillIds, [
    "skill.gap",
  ]);
  assert.match(formatSkillIndexMarkdown(incomplete), /skill\.gap/);
  assert.match(formatSkillIndexMarkdown(incomplete), /not a claim.*unused/);
});

test("exact focus keeps global coverage and repository diagnostics with a direct projection", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: true } })}\n`,
  );
  await writeSkill(root, "entry", "skill.entry", {
    published: true,
    routes: ["skill.middle"],
  });
  await writeSkill(root, "middle", "skill.middle", {
    routes: ["skill.leaf"],
  });
  await writeSkill(root, "leaf", "skill.leaf", { routes: ["skill.deep"] });
  await writeSkill(root, "deep", "skill.deep");
  await writeSkill(root, "gap", "skill.gap");
  await writeBrokenLens(root);
  const snapshot = await collectRepositorySnapshot(root);

  for (const focus of ["skill.middle", "skills/middle/SKILL.md"]) {
    const report = buildSkillIndexReport(snapshot, focus);
    const expectedProjection = focusSkillDiscoveryIndex(
      snapshot.skillDiscovery,
      focus,
    );
    assert.deepEqual(report.focus, {
      id: "skill.middle",
      sourcePath: "skills/middle/SKILL.md",
    });
    assert.equal(report.adoption, snapshot.skillDiscovery.adoption);
    assert.equal(report.coverage, snapshot.skillDiscovery.coverage);
    assert.deepEqual(
      report.skills.map((skill) => skill.id),
      ["skill.entry", "skill.leaf", "skill.middle"],
    );
    assert.deepEqual(
      report.routes.map((route) => [route.sourceId, route.normalizedTarget]),
      [
        ["skill.entry", "skill.middle"],
        ["skill.middle", "skill.leaf"],
      ],
    );
    assert.equal(
      report.skills.some((skill) => skill.id === "skill.deep"),
      false,
    );
    assert.equal(report.coverage.notReachedSkillCount, 1);
    assert.deepEqual(report.notReachedDiscoveryEligibleSkillIds, []);
    assert.equal(report.summary.visibleSkillCount, 3);
    assert.deepEqual(
      report.diagnostics.discovery,
      expectedProjection.diagnostics,
    );
    assert.ok(
      report.diagnostics.repository.some(
        (diagnostic) =>
          diagnostic.code ===
          CONTEXT_LENS_DIAGNOSTIC_CODES.MISSING_REQUIRED_FIELD,
      ),
    );
    assert.match(formatSkillIndexMarkdown(report), /## Focused Skill/);
    assert.match(formatSkillIndexMarkdown(report), /not a recommendation/);
    assert.match(
      formatSkillIndexMarkdown(report),
      /focused projection does not contain the repository-wide gap/,
    );
  }

  const missing = await captured(() =>
    main(["skill-index", root, "--focus", "skill.unknown"]),
  );
  assert.equal(missing.code, 2);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /skill-index --focus did not match/);

  const empty = await captured(() =>
    main(["skill-index", root, "--focus", ""]),
  );
  assert.equal(empty.code, 2);
  assert.match(empty.stderr, /skill-index --focus did not match/);

  await writeSkill(root, "duplicate-one", "skill.duplicate");
  await writeSkill(root, "duplicate-two", "skill.duplicate");
  const ambiguous = await captured(() =>
    main(["skill-index", root, "--focus", "skill.duplicate"]),
  );
  assert.equal(ambiguous.code, 2);
  assert.match(ambiguous.stderr, /skill-index --focus is ambiguous/);
});

test("diagnostics stay separated and drive exit codes 0, 1, and 2", async (t) => {
  const warningRoot = await fixture(t);
  await writeSkill(warningRoot, "source", "skill.source", {
    routes: ["skill.missing"],
  });
  const warning = await captured(() =>
    main(["skill-index", warningRoot, "--format", "json"]),
  );
  const warningReport = JSON.parse(warning.stdout);
  assert.equal(warning.code, 0);
  assert.ok(warningReport.diagnostics.discovery.length > 0);
  assert.deepEqual(warningReport.diagnostics.repository, []);

  await writeBrokenLens(warningRoot);
  const error = await captured(() =>
    main(["skill-index", warningRoot, "--format", "json"]),
  );
  const errorReport = JSON.parse(error.stdout);
  assert.equal(error.code, 1);
  assert.equal(error.stderr, "");
  assert.ok(errorReport.diagnostics.discovery.length > 0);
  assert.ok(
    errorReport.diagnostics.repository.some(
      (item: { severity: string }) => item.severity === "error",
    ),
  );
  const discoveryKeys = new Set(
    errorReport.diagnostics.discovery.map(diagnosticKey),
  );
  assert.equal(
    errorReport.diagnostics.repository.some((item: unknown) =>
      discoveryKeys.has(diagnosticKey(item)),
    ),
    false,
  );

  const invalidConfigRoot = await fixture(t);
  await writeFile(
    path.join(invalidConfigRoot, "renma.config.json"),
    `${JSON.stringify({ skill_discovery: { adopted: "true" } })}\n`,
  );
  const invalid = await captured(() =>
    main(["skill-index", invalidConfigRoot]),
  );
  assert.equal(invalid.code, 2);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /skill_discovery\.adopted must be a boolean/);
});

test("focused Markdown presents a published Skill once and keeps neighboring entrypoints compact", async (t) => {
  const root = await fixture(t);
  await writeSkill(root, "entry", "skill.entry", {
    published: true,
    routes: ["skill.neighbor"],
  });
  await writeSkill(root, "neighbor", "skill.neighbor", {
    published: true,
    routes: ["skill.hidden"],
  });
  await writeSkill(root, "hidden", "skill.hidden");
  const snapshot = await collectRepositorySnapshot(root);
  const report = buildSkillIndexReport(snapshot, "skill.entry");
  const markdown = formatSkillIndexMarkdown(report);
  const focusedSection = markdownSection(
    markdown,
    "## Focused Skill",
    "## Published entrypoints",
  );
  const publishedSection = markdownSection(
    markdown,
    "## Published entrypoints",
    "## Structural candidates",
  );

  assert.equal(occurrences(markdown, "### skill.entry"), 1);
  assert.equal(occurrences(markdown, "- Description: Review entry"), 1);
  assert.equal(occurrences(markdown, "- Source: skills/entry/SKILL.md"), 1);
  assert.equal(occurrences(markdown, "#### Direct outgoing declarations"), 1);
  assert.match(focusedSection, /Publication: effective published entrypoint/);
  assert.match(
    focusedSection,
    /Published-entrypoint lists and route evidence are limited to this focused direct-neighborhood projection/,
  );
  assert.match(
    publishedSection,
    /- skill\.neighbor — skills\/neighbor\/SKILL\.md/,
  );
  assert.doesNotMatch(publishedSection, /### skill\.neighbor/);
  assert.doesNotMatch(publishedSection, /Direct declared continuations/);
  assert.doesNotMatch(publishedSection, /skill\.hidden/);
  assert.match(
    publishedSection,
    /Neighboring entrypoints may have declarations outside this projection, so no complete route list is implied/,
  );
  assert.match(
    publishedSection,
    /Unfocused JSON contains the complete repository projection/,
  );
  assert.match(
    markdown,
    /Skill, route, structural, visible-ID, and Discovery-diagnostic counts are projection-scoped\. Coverage and repository diagnostics are repository-scoped\./,
  );
});

test("unfocused Markdown keeps detailed entrypoints and Markdown formatting cannot change JSON bytes", async (t) => {
  const root = await fixture(t);
  await writeSkill(root, "entry", "skill.entry", {
    published: true,
    routes: ["skill.neighbor"],
  });
  await writeSkill(root, "neighbor", "skill.neighbor", {
    published: true,
    routes: ["skill.hidden"],
  });
  await writeSkill(root, "hidden", "skill.hidden");
  const snapshot = await collectRepositorySnapshot(root);
  const full = buildSkillIndexReport(snapshot);
  const focused = buildSkillIndexReport(snapshot, "skill.entry");
  const fullJsonBefore = formatSkillIndexJson(full);
  const focusedJsonBefore = formatSkillIndexJson(focused);
  const normalizedFullJson = formatSkillIndexJson({
    ...full,
    root: "/repository",
  });
  const normalizedFocusedJson = formatSkillIndexJson({
    ...focused,
    root: "/repository",
  });
  const markdown = formatSkillIndexMarkdown(full);
  formatSkillIndexMarkdown(focused);

  assert.doesNotMatch(markdown, /## Focused Skill/);
  assert.match(markdown, /### skill\.entry/);
  assert.match(markdown, /### skill\.neighbor/);
  assert.equal(occurrences(markdown, "- Direct declared continuations:"), 2);
  assert.equal(occurrences(markdown, "| Source | Index |"), 2);
  assert.match(markdown, /skill\.hidden/);
  assert.equal(formatSkillIndexJson(full), fullJsonBefore);
  assert.equal(formatSkillIndexJson(focused), focusedJsonBefore);
  assert.equal(
    sha256(normalizedFullJson),
    "06201a63b574dcaa029ab94480b658a6df0e2d513f62e26f44c7b0cc5f247063",
  );
  assert.equal(
    sha256(normalizedFocusedJson),
    "b2bc305ebe2e812f836e7f70951c071d6fb3fd3aaaa3c89bce58f133369f885e",
  );
});

test("Markdown applies deterministic caps and points back to source Skills and JSON", async (t) => {
  const root = await fixture(t);
  await writeSkill(root, "entry", "skill.entry", { published: true });
  for (let index = 0; index < 12; index += 1) {
    const suffix = index.toString().padStart(2, "0");
    await writeSkill(
      root,
      `standalone-${suffix}`,
      `skill.standalone-${suffix}`,
    );
  }
  const report = buildSkillIndexReport(await collectRepositorySnapshot(root));
  const first = formatSkillIndexMarkdown(report);
  const second = formatSkillIndexMarkdown(report);

  assert.equal(first, second);
  assert.match(first, /3 more structural roots omitted/);
  assert.match(first, /3 more standalone skills omitted/);
  assert.match(first, /2 more unrouted skills omitted/);
  assert.match(first, /Use JSON for complete evidence/);
  assert.match(first, /Open the referenced source `SKILL\.md`/);
  assert.match(first, /does not choose or execute/);
  assert.doesNotMatch(first, /Review evidence and report completion/);
});

test("skill-index leaves every Discovery graph format byte-for-byte unchanged", async (t) => {
  const root = await fixture(t);
  await writeSkill(root, "entry", "skill.entry", {
    published: true,
    routes: ["skill.child"],
  });
  await writeSkill(root, "child", "skill.child");

  const formats = ["json", "markdown", "mermaid"] as const;
  const before = [];
  for (const format of formats) {
    before.push(
      await captured(() =>
        main(["graph", root, "--view", "discovery", "--format", format]),
      ),
    );
  }
  const index = await captured(() =>
    main(["skill-index", root, "--format", "json"]),
  );
  const after = [];
  for (const format of formats) {
    after.push(
      await captured(() =>
        main(["graph", root, "--view", "discovery", "--format", format]),
      ),
    );
  }

  assert.equal(index.code, 0);
  assert.equal(index.stderr, "");
  assert.deepEqual(after, before);
});

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-skill-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeSkill(
  root: string,
  name: string,
  id: string,
  options: { routes?: string[]; published?: boolean } = {},
): Promise<void> {
  await mkdir(path.join(root, "skills", name), { recursive: true });
  await writeFile(
    path.join(root, "skills", name, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: Review ${name} inputs and produce deterministic evidence. Use when ${name} workflow decisions need review; do not use for runtime selection or execution.`,
      "metadata:",
      `  renma.id: ${id}`,
      ...(options.routes
        ? [`  renma.continues-with: '${JSON.stringify(options.routes)}'`]
        : []),
      ...(options.published ? ['  renma.published-entrypoint: "true"'] : []),
      "---",
      `# ${name}`,
      "",
      "Review evidence and report completion.",
      "",
    ].join("\n"),
  );
}

async function writeBrokenLens(root: string): Promise<void> {
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "lenses", "testing", "broken.md"),
    [
      "---",
      "id: lens.testing.broken",
      "owner: qa-platform",
      "---",
      "# Broken Lens",
      "",
    ].join("\n"),
  );
}

async function repositoryFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.map(String).sort((left, right) => left.localeCompare(right));
}

function diagnosticKey(value: unknown): string {
  const item = value as {
    code?: string;
    path?: string;
    evidence?: { startLine?: number };
    message?: string;
  };
  return [
    item.code ?? "",
    item.path ?? "",
    item.evidence?.startLine ?? 0,
    item.message ?? "",
  ].join("\0");
}

function occurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function markdownSection(
  markdown: string,
  startHeading: string,
  endHeading: string,
): string {
  const start = markdown.indexOf(startHeading);
  const end = markdown.indexOf(endHeading, start + startHeading.length);
  assert.notEqual(start, -1, startHeading);
  assert.notEqual(end, -1, endHeading);
  return markdown.slice(start, end);
}

async function captured(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await callback();
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
