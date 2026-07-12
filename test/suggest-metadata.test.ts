import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { buildMetadataSuggestion } from "../src/commands/suggest-metadata.js";

test("suggest-metadata prompt reports blocked legacy Skill migration", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "skills",
    "testing",
    "spec-review",
    "SKILL.md",
  );
  await mkdir(path.dirname(target), { recursive: true });
  const original = [
    "---",
    "status: experimental",
    "---",
    "# Spec Review",
    "",
    "Keep this body intact.",
    "",
  ].join("\n");
  await writeFile(target, original);

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "prompt"]),
  );
  const after = await readFile(target, "utf8");

  assert.equal(result.code, 0);
  assert.equal(after, original);
  assert.match(result.stdout, /Review One-Way Agent Skills Migration/);
  assert.match(result.stdout, /Preserve the Markdown body/);
  assert.match(
    result.stdout,
    /If present, move only recognized pre-0\.16 Renma Skill fields/,
  );
  assert.match(result.stdout, /Source format: `renma-legacy`/);
  assert.match(result.stdout, /renma\.status: `experimental`/);
  assert.match(result.stdout, /description: No unambiguous, usable/);
  assert.match(result.stdout, /not generated while migration is blocked/);
  assert.match(
    result.stdout,
    /confirm the Skill's intent using your platform's standard Skill authoring guidance/,
  );
  assert.match(
    result.stdout,
    /Do not apply a candidate while Renma cannot generate it safely/,
  );
  assert.match(result.stdout, /Correct the source evidence/);
  assert.match(result.stdout, /renma suggest-metadata <SKILL\.md>/);
  assert.match(result.stdout, /renma scan \. --fail-on high/);
  assert.doesNotMatch(
    result.stdout,
    /Apply only the intended metadata or migration changes/,
  );
});

test("suggest-metadata does not invent a migration source from owner input", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "skills",
    "testing",
    "spec-review",
    "SKILL.md",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Spec Review\n\nKeep this body intact.\n");

  const result = await withCapturedConsole(() =>
    main([
      "suggest-metadata",
      target,
      "--owner",
      "qa-platform",
      "--format",
      "prompt",
    ]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Source format: `unknown`/);
  assert.match(result.stdout, /Direction: `none`/);
  assert.match(result.stdout, /frontmatter: Migration is unsafe/);
  assert.doesNotMatch(result.stdout, /renma\.owner: `qa-platform`/);
});

test("suggest-metadata JSON exposes the Skill migration contract", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "skills",
    "testing",
    "spec-review",
    "SKILL.md",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Spec Review\n\nKeep this body intact.\n");

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "json"]),
  );
  const suggestion = JSON.parse(result.stdout) as {
    kind: string;
    ownerProvided: boolean;
    suggestedMode: string;
    candidateMetadata: Record<string, string>;
    blockedMetadata: Array<{ field: string; reason: string }>;
    instructions: string[];
    agentSkills: { sourceFormat: string; direction: string };
  };

  assert.equal(result.code, 0);
  assert.equal(suggestion.kind, "skill");
  assert.equal(suggestion.suggestedMode, "agent-skills-migration");
  assert.equal(suggestion.ownerProvided, false);
  assert.deepEqual(suggestion.candidateMetadata, {});
  assert.equal(suggestion.agentSkills.sourceFormat, "unknown");
  assert.equal(suggestion.agentSkills.direction, "none");
  assert.equal(suggestion.blockedMetadata[0]?.field, "frontmatter");
  assert.ok(
    suggestion.instructions.includes(
      "Preserve the Markdown body and existing standard Agent Skills fields.",
    ),
  );
  assert.deepEqual(Object.keys(suggestion), [
    "path",
    "kind",
    "suggestedMode",
    "ownerProvided",
    "instructions",
    "candidateMetadata",
    "blockedMetadata",
    "agentSkills",
  ]);
  assert.equal("nextSteps" in suggestion, false);
});

test("suggest-metadata proposes no migration or rewrite for canonical release-prep", async () => {
  const target = "skills/release-prep/SKILL.md";
  const original = await readFile(target, "utf8");
  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "json"]),
  );
  const suggestion = JSON.parse(result.stdout) as {
    instructions: string[];
    blockedMetadata: Array<{ field: string; reason: string }>;
    agentSkills: {
      sourceFormat: string;
      direction: string;
      proposalKind: string;
      canonicalFrontmatter?: string;
      candidateRenmaMetadata: Record<string, string>;
    };
  };
  const after = await readFile(target, "utf8");

  assert.equal(result.code, 0);
  assert.equal(suggestion.agentSkills.sourceFormat, "agent-skills");
  assert.equal(suggestion.agentSkills.direction, "none");
  assert.equal(suggestion.agentSkills.proposalKind, "none");
  assert.deepEqual(Object.keys(suggestion), [
    "path",
    "kind",
    "suggestedMode",
    "ownerProvided",
    "instructions",
    "candidateMetadata",
    "blockedMetadata",
    "agentSkills",
  ]);
  assert.deepEqual(suggestion.blockedMetadata, []);
  assert.equal(
    Object.hasOwn(suggestion.agentSkills, "canonicalFrontmatter"),
    false,
  );
  assert.deepEqual(suggestion.agentSkills.candidateRenmaMetadata, {});
  assert.equal(after, original);
  assert.ok(
    suggestion.instructions.includes(
      "Do not propose reverse migration or an unnecessary frontmatter rewrite.",
    ),
  );

  const promptResult = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "prompt"]),
  );

  assert.equal(promptResult.code, 0);
  assert.match(
    promptResult.stdout,
    /Inspect Canonical Agent Skill \(No Migration Proposed\)/,
  );
  assert.match(
    promptResult.stdout,
    /Review the Skill's trigger description, instructions, workflow, constraints, and completion criteria using your platform's standard Skill authoring guidance/,
  );
  assert.match(
    promptResult.stdout,
    /No metadata or migration change is proposed; preserve the existing source/,
  );
  assert.match(
    promptResult.stdout,
    /If a separate, intentionally reviewed authoring change is made/,
  );
  assert.match(promptResult.stdout, /renma scan \. --fail-on high/);
  assert.doesNotMatch(
    promptResult.stdout,
    /Apply only the intended metadata or migration changes/,
  );
  assert.doesNotMatch(
    promptResult.stdout,
    /Return (?:a|one) small reviewed (?:frontmatter )?patch/,
  );
  assert.equal(await readFile(target, "utf8"), original);
});

test("suggest-metadata keeps candidate application guidance for a real owner retrofit", async () => {
  const root = await fixture();
  const target = path.join(root, "skills", "spec-review", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  const original = [
    "---",
    "name: spec-review",
    "description: Review specifications. Use when requirements need evidence-backed review.",
    "metadata:",
    "  renma.id: skill.spec-review",
    "---",
    "",
    "# Spec Review",
    "",
  ].join("\n");
  await writeFile(target, original);

  const result = await withCapturedConsole(() =>
    main([
      "suggest-metadata",
      target,
      "--owner",
      "qa-platform",
      "--format",
      "prompt",
    ]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(
    result.stdout,
    /Review Canonical Agent Skills Metadata Retrofit/,
  );
  assert.match(
    result.stdout,
    /Apply only the intended metadata or migration changes/,
  );
  assert.match(result.stdout, /Return a small reviewed frontmatter patch/);
  assert.doesNotMatch(
    result.stdout,
    /No metadata or migration change is proposed/,
  );
  assert.equal(await readFile(target, "utf8"), original);
});

test("suggest-metadata JSON records explicit owner without unsafe output", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "skills",
    "testing",
    "spec-review",
    "SKILL.md",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Spec Review\n\nKeep this body intact.\n");

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--owner", "qa-platform", "--json"]),
  );
  const suggestion = JSON.parse(result.stdout) as {
    ownerProvided: boolean;
    candidateMetadata: Record<string, string>;
    blockedMetadata: Array<{ field: string; reason: string }>;
    agentSkills: {
      direction: string;
      candidateRenmaMetadata: Record<string, string>;
    };
  };

  assert.equal(result.code, 0);
  assert.equal(suggestion.ownerProvided, true);
  assert.deepEqual(suggestion.candidateMetadata, {});
  assert.equal(suggestion.agentSkills.direction, "none");
  assert.deepEqual(suggestion.agentSkills.candidateRenmaMetadata, {});
  assert.equal(suggestion.blockedMetadata[0]?.field, "frontmatter");
});

test("suggest-metadata preserves an existing owner in prompt", async () => {
  const root = await fixture();
  const target = path.join(root, "skills", "docs", "foo", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    [
      "---",
      "id: skill.docs.foo",
      "title: Foo",
      "owner: docs",
      "---",
      "# Foo",
      "",
    ].join("\n"),
  );

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "prompt"]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /renma\.owner: `docs`/);
  assert.match(result.stdout, /description: No unambiguous, usable/);
  assert.doesNotMatch(
    result.stdout,
    /Canonical Frontmatter Candidate:\n\n```yaml/,
  );
});

test("suggest-metadata does not create owner candidate for same existing owner", async () => {
  const root = await fixture();
  const target = path.join(root, "skills", "qa", "foo", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    [
      "---",
      "id: skill.qa.foo",
      "title: Foo",
      "owner: qa-platform",
      "---",
      "# Foo",
      "",
    ].join("\n"),
  );

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--owner", "qa-platform", "--json"]),
  );
  const suggestion = JSON.parse(result.stdout) as {
    candidateMetadata: Record<string, string>;
    blockedMetadata: Array<{ field: string; reason: string }>;
    instructions: string[];
    agentSkills: { candidateRenmaMetadata: Record<string, string> };
  };

  assert.equal(result.code, 0);
  assert.equal("owner" in suggestion.candidateMetadata, false);
  assert.equal(
    suggestion.agentSkills.candidateRenmaMetadata["renma.owner"],
    "qa-platform",
  );
  assert.equal(suggestion.blockedMetadata[0]?.field, "description");
});

test("suggest-metadata blocks different explicit owner from replacing existing owner", async () => {
  const root = await fixture();
  const target = path.join(root, "skills", "docs", "foo", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    [
      "---",
      "id: skill.docs.foo",
      "title: Foo",
      "owner: docs",
      "---",
      "# Foo",
      "",
    ].join("\n"),
  );

  const result = await withCapturedConsole(() =>
    main([
      "suggest-metadata",
      target,
      "--owner",
      "qa-platform",
      "--format",
      "prompt",
    ]),
  );

  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    /owner: Existing owner "docs" differs from explicitly provided owner "qa-platform"\. Human review is required before migration\./,
  );
  assert.match(result.stdout, /renma\.owner: `docs`/);
  assert.doesNotMatch(result.stdout, /renma\.owner: `qa-platform`/);
});

test("suggest-metadata JSON represents blocked owner replacement", async () => {
  const root = await fixture();
  const target = path.join(root, "skills", "docs", "foo", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    [
      "---",
      "id: skill.docs.foo",
      "title: Foo",
      "owner: docs",
      "---",
      "# Foo",
      "",
    ].join("\n"),
  );

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--owner", "qa-platform", "--json"]),
  );
  const suggestion = JSON.parse(result.stdout) as {
    candidateMetadata: Record<string, string>;
    blockedMetadata: Array<{ field: string; reason: string }>;
    instructions: string[];
    agentSkills: { candidateRenmaMetadata: Record<string, string> };
  };

  assert.equal(result.code, 0);
  assert.equal("owner" in suggestion.candidateMetadata, false);
  assert.deepEqual(
    suggestion.blockedMetadata.map((item) => item.field),
    ["description", "owner"],
  );
  assert.equal(
    suggestion.agentSkills.candidateRenmaMetadata["renma.owner"],
    "docs",
  );
});

test("suggest-metadata rejects unsupported format", async () => {
  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", "skills/demo/SKILL.md", "--format", "markdown"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /--format must be either prompt or json\./);
});

test("suggest-metadata requires a target file", async () => {
  const result = await withCapturedConsole(() => main(["suggest-metadata"]));

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /suggest-metadata requires a target file\./);
});

test("suggest-metadata reports missing file concisely", async () => {
  const root = await fixture();
  const target = path.join(root, "missing.md");

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Could not read metadata target .*missing\.md/);
  assert.match(result.stderr, /file does not exist/);
  assert.doesNotMatch(result.stderr, /\n\s+at\s+/);
});

test("suggest-metadata reports directory target concisely", async () => {
  const root = await fixture();

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", root]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Could not read metadata target/);
  assert.match(result.stderr, /target is a directory/);
  assert.doesNotMatch(result.stderr, /\n\s+at\s+/);
});

test("suggest-metadata works for context assets", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "contexts",
    "testing",
    "boundary-value-analysis.md",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Boundary Value Analysis\n\nReusable context.\n");

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "json"]),
  );
  const suggestion = JSON.parse(result.stdout) as {
    kind: string;
    candidateMetadata: Record<string, string>;
  };

  assert.equal(result.code, 0);
  assert.equal(suggestion.kind, "context");
  assert.deepEqual(suggestion.candidateMetadata, {
    id: "context.testing.boundary-value-analysis",
    title: "Boundary Value Analysis",
  });

  const promptResult = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "prompt"]),
  );
  assert.doesNotMatch(
    promptResult.stdout,
    /platform's standard Skill authoring guidance/,
  );
  assert.doesNotMatch(promptResult.stdout, /renma scan \. --fail-on high/);
});

test("scan commands execute historical Skill entrypoint migrations end to end", async () => {
  const root = await fixture();
  const fixtures = [
    {
      source: "skills/demo/skill.md",
      target: "skills/demo/SKILL.md",
      name: "demo",
      migration: "rename",
    },
    {
      source: "skills/testing/spec-review.skill.md",
      target: "skills/testing/spec-review/SKILL.md",
      name: "spec-review",
      migration: "move-and-rename",
    },
    {
      source: ".agents/skills/demo/skill.md",
      target: ".agents/skills/demo/SKILL.md",
      name: "demo",
      migration: "rename",
    },
    {
      source: ".agents/skills/testing/spec-review.skill.md",
      target: ".agents/skills/testing/spec-review/SKILL.md",
      name: "spec-review",
      migration: "move-and-rename",
    },
  ] as const;
  const original =
    "---\nid: skill.legacy\n---\n# Legacy\n\nUse this skill when reviewing legacy inputs.\n";

  for (const entry of fixtures) {
    const absolute = path.join(root, ...entry.source.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, original);
  }

  const textScan = await withCapturedConsole(() =>
    main(["scan", root, "--format", "text"]),
  );
  const jsonScan = await withCapturedConsole(() =>
    main(["scan", root, "--format", "json"]),
  );
  const report = JSON.parse(jsonScan.stdout) as {
    agentSkills: {
      results: Array<{
        path: string;
        migrationCommand?: {
          command: string;
          args: [string, string];
          display: string;
        };
      }>;
    };
  };

  for (const entry of fixtures) {
    assert.match(
      textScan.stdout,
      new RegExp(
        `renma suggest-metadata ${entry.source.replaceAll(".", "\\.")}`,
      ),
      entry.source,
    );
    assert.deepEqual(
      report.agentSkills.results.find((item) => item.path === entry.source)
        ?.migrationCommand,
      {
        command: "renma",
        args: ["suggest-metadata", entry.source],
        display: `renma suggest-metadata ${entry.source}`,
      },
      entry.source,
    );

    const absoluteSource = path.join(root, ...entry.source.split("/"));
    const result = await withCapturedConsole(() =>
      main(["suggest-metadata", absoluteSource, "--format", "json"]),
    );
    const suggestion = JSON.parse(result.stdout) as {
      kind: string;
      suggestedMode: string;
      agentSkills: {
        sourcePath: string;
        targetPath: string;
        entrypointMigration: string;
        candidateAgentSkillsFields: Record<string, string>;
      };
    };

    assert.equal(suggestion.kind, "skill", entry.source);
    assert.equal(
      suggestion.suggestedMode,
      "agent-skills-migration",
      entry.source,
    );
    assert.equal(
      suggestion.agentSkills.sourcePath,
      absoluteSource,
      entry.source,
    );
    assert.equal(
      suggestion.agentSkills.targetPath,
      path.join(root, ...entry.target.split("/")),
      entry.source,
    );
    assert.equal(
      suggestion.agentSkills.entrypointMigration,
      entry.migration,
      entry.source,
    );
    assert.equal(
      suggestion.agentSkills.candidateAgentSkillsFields.name,
      entry.name,
      entry.source,
    );
    assert.equal(
      await readFile(absoluteSource, "utf8"),
      original,
      entry.source,
    );
  }
});

test("scan recommends historical filename migration without legacy Renma fields", async () => {
  const root = await fixture();
  const fixtures = [
    ["skills/demo/skill.md", "demo"],
    ["skills/testing/spec-review.skill.md", "spec-review"],
    [".agents/skills/demo/skill.md", "demo"],
    [".agents/skills/testing/spec-review.skill.md", "spec-review"],
  ] as const;

  for (const [source, name] of fixtures) {
    const target = path.join(root, ...source.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      `---
name: ${name}
description: Review ${name} inputs. Use when ${name} inputs need review.
---
# ${name}
`,
    );
  }

  const textResult = await withCapturedConsole(() =>
    main(["scan", root, "--format", "text"]),
  );
  const jsonResult = await withCapturedConsole(() =>
    main(["scan", root, "--format", "json"]),
  );
  const report = JSON.parse(jsonResult.stdout) as {
    agentSkills: {
      results: Array<{
        path: string;
        migrationRecommended: boolean;
        migrationCommand?: {
          command: string;
          args: [string, string];
          display: string;
        };
      }>;
    };
  };

  for (const [source] of fixtures) {
    const validation = report.agentSkills.results.find(
      (item) => item.path === source,
    );
    assert.equal(validation?.migrationRecommended, true, source);
    assert.deepEqual(validation?.migrationCommand?.args, [
      "suggest-metadata",
      source,
    ]);
    assert.ok(
      textResult.stdout.includes(`renma suggest-metadata ${source}`),
      source,
    );

    const suggestionResult = await withCapturedConsole(() =>
      main([
        "suggest-metadata",
        path.join(root, ...source.split("/")),
        "--format",
        "json",
      ]),
    );
    const suggestion = JSON.parse(suggestionResult.stdout) as {
      agentSkills: {
        direction: string;
        canonicalFrontmatter?: string;
      };
    };
    assert.equal(
      suggestion.agentSkills.direction,
      "legacy-to-agent-skills",
      source,
    );
    assert.ok(suggestion.agentSkills.canonicalFrontmatter, source);
  }
});

test("suggest-metadata does not infer a Skill from ambiguous absolute roots", async () => {
  const root = await fixture();
  const target = path.join(
    root,
    "skills",
    "demo",
    "references",
    "skills",
    "example",
    "SKILL.md",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    "---\nname: example\ndescription: Review examples. Use when examples need review.\n---\n",
  );

  const suggestion = await buildMetadataSuggestion(target);
  assert.notEqual(suggestion.kind, "skill");
  assert.equal(suggestion.agentSkills, undefined);
});

test("suggest-metadata safely normalizes repository-relative dot segments", async () => {
  const root = await fixture();
  const source = path.join(root, "skills", "demo", "skill.md");
  const docsTarget = path.join(root, "docs", "SKILL.md");
  await mkdir(path.dirname(source), { recursive: true });
  await mkdir(path.dirname(docsTarget), { recursive: true });
  const original = `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
---
# Demo
`;
  await writeFile(source, original);
  await writeFile(docsTarget, "# Documentation\n");

  const previousDirectory = process.cwd();
  try {
    process.chdir(root);
    const result = await withCapturedConsole(() =>
      main(["suggest-metadata", "./skills/demo/skill.md", "--format", "json"]),
    );
    const suggestion = JSON.parse(result.stdout) as {
      kind: string;
      suggestedMode: string;
      agentSkills: {
        sourcePath: string;
        targetPath: string;
        entrypointMigration: string;
      };
    };

    assert.equal(suggestion.kind, "skill");
    assert.equal(suggestion.suggestedMode, "agent-skills-migration");
    assert.equal(suggestion.agentSkills.sourcePath, "skills/demo/skill.md");
    assert.equal(suggestion.agentSkills.targetPath, "skills/demo/SKILL.md");
    assert.equal(suggestion.agentSkills.entrypointMigration, "rename");
    assert.equal(await readFile(source, "utf8"), original);

    for (const escaped of [
      "skills/../docs/SKILL.md",
      "skills/demo/../../docs/SKILL.md",
      ".agents/skills/../../docs/SKILL.md",
    ]) {
      const escapedSuggestion = await buildMetadataSuggestion(escaped);
      assert.notEqual(escapedSuggestion.kind, "skill", escaped);
      assert.equal(escapedSuggestion.agentSkills, undefined, escaped);
    }
  } finally {
    process.chdir(previousDirectory);
  }
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-suggest-metadata-"));
}

async function withCapturedConsole(
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
    return { code: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
