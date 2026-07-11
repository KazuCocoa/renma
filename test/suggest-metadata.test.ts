import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";

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
  assert.match(result.stdout, /Source format: `renma-legacy`/);
  assert.match(result.stdout, /renma\.status: `experimental`/);
  assert.match(result.stdout, /description: No unambiguous, usable/);
  assert.match(result.stdout, /not generated while migration is blocked/);
  assert.match(result.stdout, /renma scan \./);
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
