import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";

const DESCRIPTION_BLOCKED_METADATA = {
  field: "description",
  reason:
    "No reviewed Agent Skills description can be extracted from the existing body. Draft what the skill does, when to use it, and any selection-critical exclusion from repository evidence; require human review.",
};

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
  assert.match(result.stdout, /Selection-boundary review:/);
  assert.match(result.stdout, /Execution-constraint review:/);
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
    agentSkills: { candidateRenmaMetadata: Record<string, string> };
  };

  assert.equal(result.code, 0);
  assert.equal(suggestion.kind, "skill");
  assert.equal(suggestion.suggestedMode, "metadata-retrofit");
  assert.equal(suggestion.ownerProvided, false);
  assert.deepEqual(suggestion.candidateMetadata, {});
  assert.deepEqual(suggestion.agentSkills.candidateRenmaMetadata, {
    "renma.id": "skill.testing.spec-review",
    "renma.title": "Spec Review",
  });
  assert.deepEqual(suggestion.blockedMetadata, [
    {
      field: "owner",
      reason: "No owner was explicitly provided. Missing owner is allowed.",
    },
    DESCRIPTION_BLOCKED_METADATA,
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
    agentSkills: { candidateRenmaMetadata: Record<string, string> };
  };

  assert.equal(result.code, 0);
  assert.equal(suggestion.ownerProvided, true);
  assert.deepEqual(suggestion.candidateMetadata, {});
  assert.equal(
    suggestion.agentSkills.candidateRenmaMetadata["renma.owner"],
    "qa-platform",
  );
  assert.deepEqual(suggestion.blockedMetadata, [DESCRIPTION_BLOCKED_METADATA]);
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
  assert.match(result.stdout, /Preserve existing owner: docs\./);
  assert.doesNotMatch(
    result.stdout,
    /Use owner: docs because the user explicitly provided it/,
  );
  assert.doesNotMatch(result.stdout, /(?:^|\n)- owner: `docs`/);
  assert.match(result.stdout, /renma\.owner: `docs`/);
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
  };

  assert.equal(result.code, 0);
  assert.equal("owner" in suggestion.candidateMetadata, false);
  assert.deepEqual(suggestion.blockedMetadata, [DESCRIPTION_BLOCKED_METADATA]);
  assert.ok(
    suggestion.instructions.includes("Preserve existing owner: qa-platform."),
  );
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
    /Existing owner is docs\. The explicitly provided owner qa-platform differs, so do not change ownership without human review\./,
  );
  assert.match(
    result.stdout,
    /owner: Existing owner "docs" differs from explicitly provided owner "qa-platform"\. Do not change ownership without human review\./,
  );
  assert.doesNotMatch(
    result.stdout,
    /Use owner: qa-platform because the user explicitly provided it/,
  );
  assert.doesNotMatch(result.stdout, /owner: `qa-platform`/);
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
  };

  assert.equal(result.code, 0);
  assert.equal("owner" in suggestion.candidateMetadata, false);
  assert.deepEqual(suggestion.blockedMetadata, [
    {
      field: "owner",
      reason:
        'Existing owner "docs" differs from explicitly provided owner "qa-platform". Do not change ownership without human review.',
    },
    DESCRIPTION_BLOCKED_METADATA,
  ]);
  assert.ok(
    suggestion.instructions.includes(
      "Existing owner is docs. The explicitly provided owner qa-platform differs, so do not change ownership without human review.",
    ),
  );
});

test("suggest-metadata blocks canonical and legacy metadata conflicts", async () => {
  const cases = [
    {
      field: "owner",
      canonicalKey: "owner",
      legacy: "owner: legacy-team",
      canonical: "  renma.owner: canonical-team",
    },
    {
      field: "id",
      canonicalKey: "id",
      legacy: "id: skill.legacy",
      canonical: "  renma.id: skill.canonical",
    },
    {
      field: "title",
      canonicalKey: "title",
      legacy: "title: Legacy Demo",
      canonical: "  renma.title: Canonical Demo",
    },
    {
      field: "requires_context",
      canonicalKey: "requires-context",
      legacy: "requires_context: '[\"context.legacy\"]'",
      canonical: "  renma.requires-context: '[\"context.canonical\"]'",
    },
    {
      field: "allowed_data",
      canonicalKey: "allowed-data",
      legacy: "allowed_data: '[\"legacy\"]'",
      canonical: "  renma.allowed-data: '[\"canonical\"]'",
    },
    {
      field: "network_allowed",
      canonicalKey: "network-allowed",
      legacy: "network_allowed: true",
      canonical: "  renma.network-allowed: 'false'",
    },
  ];

  for (const fixtureCase of cases) {
    const root = await fixture();
    const target = path.join(root, "skills", "demo", "SKILL.md");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      `---
name: demo
description: Reviews demo inputs. Use when reviewing demo inputs.
${fixtureCase.legacy}
metadata:
${fixtureCase.canonical}
---
# Demo
`,
    );

    const result = await withCapturedConsole(() =>
      main(["suggest-metadata", target, "--format", "json"]),
    );
    const suggestion = JSON.parse(result.stdout) as {
      blockedMetadata: Array<{ field: string; reason: string }>;
      instructions: string[];
      agentSkills: {
        canonicalFrontmatter?: string;
        candidateRenmaMetadata: Record<string, string>;
        metadataConflicts: string[];
      };
    };
    const blocked = suggestion.blockedMetadata.find(
      (item) => item.field === fixtureCase.field,
    );

    assert.equal(result.code, 0, fixtureCase.field);
    assert.ok(blocked, fixtureCase.field);
    assert.match(blocked.reason, /Human review is required before migration/);
    assert.equal(suggestion.agentSkills.canonicalFrontmatter, undefined);
    assert.ok(
      suggestion.agentSkills.metadataConflicts.includes(fixtureCase.field),
      fixtureCase.field,
    );
    assert.equal(
      `renma.${fixtureCase.canonicalKey}` in
        suggestion.agentSkills.candidateRenmaMetadata,
      false,
      fixtureCase.field,
    );
    assert.equal(
      suggestion.instructions.some((instruction) =>
        instruction.includes("remove the migrated legacy"),
      ),
      false,
      fixtureCase.field,
    );
  }
});

test("suggest-metadata does not suggest legacy fields for a canonical Skill", async () => {
  const root = await fixture();
  const target = path.join(root, "skills", "demo", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `---
name: demo
description: Reviews demo inputs. Use when reviewing demo inputs.
metadata:
  renma.id: skill.demo
  renma.title: Demo
---
# Demo
`,
  );

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "json"]),
  );
  const suggestion = JSON.parse(result.stdout) as {
    candidateMetadata: Record<string, string>;
    agentSkills: { direction: string };
  };

  assert.equal(result.code, 0);
  assert.deepEqual(suggestion.candidateMetadata, {});
  assert.equal(suggestion.agentSkills.direction, "none");
});

test("suggest-metadata blocks migration for an invalid Skill directory name", async () => {
  const root = await fixture();
  const target = path.join(root, "skills", "MySkill", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `---
id: skill.demo
---
# Demo

Use this skill when reviewing demo inputs.
`,
  );

  const result = await withCapturedConsole(() =>
    main(["suggest-metadata", target, "--format", "json"]),
  );
  const suggestion = JSON.parse(result.stdout) as {
    blockedMetadata: Array<{ field: string; reason: string }>;
    agentSkills: {
      canonicalFrontmatter?: string;
      candidateAgentSkillsMetadata: Record<string, string>;
    };
  };

  assert.equal(result.code, 0);
  assert.equal(suggestion.agentSkills.canonicalFrontmatter, undefined);
  assert.equal(
    "name" in suggestion.agentSkills.candidateAgentSkillsMetadata,
    false,
  );
  assert.match(
    suggestion.blockedMetadata.find((item) => item.field === "name")?.reason ??
      "",
    /Rename the directory/,
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
