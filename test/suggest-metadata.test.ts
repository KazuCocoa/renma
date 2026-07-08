import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";

test("suggest-metadata prompt for an existing skill without owner", async () => {
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
  assert.match(
    result.stdout,
    /Update this existing Renma asset metadata safely/,
  );
  assert.match(result.stdout, /Preserve the existing markdown body content/);
  assert.match(result.stdout, /Preserve existing frontmatter fields/);
  assert.match(
    result.stdout,
    /Do not add owner unless the existing asset already declares one/,
  );
  assert.match(result.stdout, /Do not infer owner from Git history/);
  assert.match(result.stdout, /Missing owner is allowed/);
  assert.match(result.stdout, /id: `skill\.testing\.spec-review`/);
  assert.match(result.stdout, /title: `Spec Review`/);
  assert.match(result.stdout, /owner: No owner was explicitly provided/);
  assert.match(result.stdout, /renma scan \./);
  assert.match(result.stdout, /renma ownership \./);
});

test("suggest-metadata prompt includes explicit user-provided owner", async () => {
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
  assert.match(
    result.stdout,
    /Use owner: qa-platform because the user explicitly provided it/,
  );
  assert.match(result.stdout, /owner: `qa-platform`/);
  assert.doesNotMatch(result.stdout, /No owner was explicitly provided/);
});

test("suggest-metadata JSON includes conservative candidate metadata", async () => {
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
  };

  assert.equal(result.code, 0);
  assert.equal(suggestion.kind, "skill");
  assert.equal(suggestion.suggestedMode, "metadata-retrofit");
  assert.equal(suggestion.ownerProvided, false);
  assert.deepEqual(suggestion.candidateMetadata, {
    id: "skill.testing.spec-review",
    title: "Spec Review",
  });
  assert.deepEqual(suggestion.blockedMetadata, [
    {
      field: "owner",
      reason: "No owner was explicitly provided. Missing owner is allowed.",
    },
  ]);
  assert.ok(
    suggestion.instructions.includes(
      "Preserve the existing markdown body content.",
    ),
  );
});

test("suggest-metadata JSON includes explicit owner candidate", async () => {
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
  };

  assert.equal(result.code, 0);
  assert.equal(suggestion.ownerProvided, true);
  assert.equal(suggestion.candidateMetadata.owner, "qa-platform");
  assert.deepEqual(suggestion.blockedMetadata, []);
});

test("suggest-metadata rejects unsupported format", async () => {
  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", "skills/demo/SKILL.md", "--format", "markdown"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /--format must be either prompt or json\./);
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
