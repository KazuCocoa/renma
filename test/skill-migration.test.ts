import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildMetadataSuggestion } from "../src/commands/suggest-metadata.js";

test("suggest-metadata proposes a one-way legacy-to-Agent-Skills conversion", async () => {
  const { target, original } = await skillFixture(
    "demo",
    `---
id: skill.demo
title: Demo Review
owner: qa-platform
status: stable
tags:
  - demo
  - review
---
# Demo Review

Use this skill when reviewing demo inputs before implementation.
`,
  );

  const suggestion = await buildMetadataSuggestion(target);
  const after = await readFile(target, "utf8");

  assert.equal(after, original);
  assert.equal(suggestion.suggestedMode, "agent-skills-migration");
  assert.equal(suggestion.agentSkills?.sourceFormat, "renma-legacy");
  assert.equal(suggestion.agentSkills?.direction, "legacy-to-agent-skills");
  assert.deepEqual(suggestion.blockedMetadata, []);
  assert.equal(
    suggestion.agentSkills?.candidateRenmaMetadata["renma.id"],
    "skill.demo",
  );
  assert.equal(
    suggestion.agentSkills?.candidateRenmaMetadata["renma.tags"],
    '["demo","review"]',
  );
  assert.match(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /name: demo/,
  );
  assert.match(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /description: Use this skill when reviewing demo inputs before implementation\./,
  );
  assert.doesNotMatch(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /^owner:/m,
  );
});

test("canonical Agent Skill produces no reverse migration", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when a demo needs review.
metadata:
  renma.id: skill.demo
---
# Demo
`,
  );

  const suggestion = await buildMetadataSuggestion(target);

  assert.equal(suggestion.agentSkills?.sourceFormat, "agent-skills");
  assert.equal(suggestion.agentSkills?.direction, "none");
  assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
});

test("hybrid canonical and historical conflicts block output", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when a demo needs review.
owner: legacy-team
metadata:
  renma.owner: canonical-team
---
# Demo
`,
  );

  const suggestion = await buildMetadataSuggestion(target);
  const ownerBlock = suggestion.blockedMetadata.find(
    (item) => item.field === "owner",
  );

  assert.equal(suggestion.agentSkills?.sourceFormat, "hybrid");
  assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
  assert.match(ownerBlock?.reason ?? "", /conflicts with historical owner/);
  assert.match(ownerBlock?.reason ?? "", /Human review is required/);
});

test("structurally unsafe Skill migration never renders canonical frontmatter", async () => {
  const cases = [
    {
      label: "invalid YAML",
      content: '---\nid: skill.demo\ndescription: "unterminated\n---\n# Demo\n',
      field: "frontmatter",
    },
    {
      label: "unclosed frontmatter",
      content: "---\nid: skill.demo\n# Demo\n",
      field: "frontmatter",
    },
    {
      label: "duplicate top-level field",
      content:
        "---\nid: skill.demo\nowner: first\nowner: second\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n",
      field: "owner",
    },
    {
      label: "duplicate metadata key",
      content:
        "---\nid: skill.demo\nmetadata:\n  renma.owner: first\n  renma.owner: second\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n",
      field: "metadata.renma.owner",
    },
    {
      label: "invalid metadata child value",
      content:
        "---\nid: skill.demo\nmetadata:\n  renma.owner: [qa]\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n",
      field: "metadata",
    },
    {
      label: "invalid standard optional field",
      content:
        "---\nid: skill.demo\nlicense: [MIT]\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n",
      field: "license",
    },
    {
      label: "unknown top-level field",
      content:
        "---\nid: skill.demo\nmystery: keep-me\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n",
      field: "mystery",
    },
  ];

  for (const fixture of cases) {
    const { target } = await skillFixture("demo", fixture.content);
    const suggestion = await buildMetadataSuggestion(target);
    assert.equal(
      suggestion.agentSkills?.canonicalFrontmatter,
      undefined,
      fixture.label,
    );
    assert.ok(
      suggestion.blockedMetadata.some((item) => item.field === fixture.field),
      fixture.label,
    );
  }
});

test("migration preserves unknown Renma and other-vendor metadata", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when a demo needs review.
owner: qa-platform
metadata:
  renma.future-field: keep-me
  other-client.priority: high
---
# Demo
`,
  );

  const suggestion = await buildMetadataSuggestion(target);
  const frontmatter = suggestion.agentSkills?.canonicalFrontmatter ?? "";

  assert.deepEqual(suggestion.blockedMetadata, []);
  assert.equal(
    suggestion.agentSkills?.preservedMetadata["renma.future-field"],
    "keep-me",
  );
  assert.equal(
    suggestion.agentSkills?.preservedMetadata["other-client.priority"],
    "high",
  );
  assert.match(frontmatter, /renma\.future-field: keep-me/);
  assert.match(frontmatter, /other-client\.priority: high/);
});

test("migration compares list metadata semantically and preserves canonical text", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when a demo needs review.
tags: demo, review
metadata:
  renma.tags: '[ "demo", "review" ]'
---
# Demo
`,
  );

  const suggestion = await buildMetadataSuggestion(target);

  assert.deepEqual(suggestion.blockedMetadata, []);
  assert.equal(
    suggestion.agentSkills?.preservedMetadata["renma.tags"],
    '[ "demo", "review" ]',
  );
  assert.ok(suggestion.agentSkills?.canonicalFrontmatter);
});

test("migration accepts valid Unicode Skill directory names", async () => {
  for (const name of ["日本語", "überblick", "테스트"]) {
    const { target } = await skillFixture(
      name,
      `---
id: skill.unicode
---
# Unicode Skill

Use this skill when reviewing Unicode inputs.
`,
    );

    const suggestion = await buildMetadataSuggestion(target);

    assert.equal(
      suggestion.blockedMetadata.some((item) => item.field === "name"),
      false,
      name,
    );
    assert.equal(suggestion.agentSkills?.candidateAgentSkillsFields.name, name);
    assert.ok(suggestion.agentSkills?.canonicalFrontmatter, name);
  }
});

test("migration blocks arrays for scalar historical fields", async () => {
  for (const [field, value] of [
    ["owner", "qa-platform"],
    ["id", "skill.demo"],
    ["status", "stable"],
    ["network_allowed", "true"],
  ] as const) {
    const { target } = await skillFixture(
      "demo",
      `---
${field}: [${value}]
---
# Demo

Use this skill when reviewing demo inputs.
`,
    );

    const suggestion = await buildMetadataSuggestion(target);
    const block = suggestion.blockedMetadata.find(
      (item) => item.field === field,
    );

    assert.equal(
      suggestion.agentSkills?.canonicalFrontmatter,
      undefined,
      field,
    );
    assert.match(block?.reason ?? "", /must be a scalar value/, field);
  }
});

test("migration accepts arrays for established list fields", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
id: skill.demo
tags: [demo, review]
requires_context: [context.demo, context.review]
allowed_data: [public, internal]
forbidden_inputs: [secrets, credentials]
---
# Demo

Use this skill when reviewing demo inputs.
`,
  );

  const suggestion = await buildMetadataSuggestion(target);
  const metadata = suggestion.agentSkills?.candidateRenmaMetadata;

  assert.deepEqual(suggestion.blockedMetadata, []);
  assert.equal(metadata?.["renma.tags"], '["demo","review"]');
  assert.equal(
    metadata?.["renma.requires-context"],
    '["context.demo","context.review"]',
  );
  assert.equal(metadata?.["renma.allowed-data"], '["public","internal"]');
  assert.equal(
    metadata?.["renma.forbidden-inputs"],
    '["secrets","credentials"]',
  );
  assert.ok(suggestion.agentSkills?.canonicalFrontmatter);
});

test("migration recognizes established purpose and freshness fields", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
id: skill.demo
purpose: Release preparation
last_reviewed_at: 2026-07-01
review_cycle: P90D
expires_at: 2026-12-31
---
# Demo

Use this skill when preparing a release.
`,
  );

  const suggestion = await buildMetadataSuggestion(target);
  const metadata = suggestion.agentSkills?.candidateRenmaMetadata;

  assert.deepEqual(suggestion.blockedMetadata, []);
  assert.equal(metadata?.["renma.purpose"], "Release preparation");
  assert.equal(metadata?.["renma.last-reviewed-at"], "2026-07-01");
  assert.equal(metadata?.["renma.review-cycle"], "P90D");
  assert.equal(metadata?.["renma.expires-at"], "2026-12-31");
  assert.ok(suggestion.agentSkills?.canonicalFrontmatter);
});

test("migration blocks malformed shapes for established scalar fields", async () => {
  for (const field of [
    "purpose",
    "last_reviewed_at",
    "review_cycle",
    "expires_at",
  ]) {
    const { target } = await skillFixture(
      "demo",
      `---
id: skill.demo
${field}: [invalid]
---
# Demo

Use this skill when reviewing demo inputs.
`,
    );

    const suggestion = await buildMetadataSuggestion(target);

    assert.equal(
      suggestion.agentSkills?.canonicalFrontmatter,
      undefined,
      field,
    );
    assert.match(
      suggestion.blockedMetadata.find((item) => item.field === field)?.reason ??
        "",
      /must be a scalar value/,
      field,
    );
  }
});

test("migration blocks invalid directory names and missing description evidence", async () => {
  const invalidDirectory = await skillFixture(
    "MySkill",
    "---\nid: skill.demo\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n",
  );
  const noDescription = await skillFixture(
    "demo",
    "---\nid: skill.demo\n---\n# Demo\n\nDetailed procedure without a reviewed usage statement.\n",
  );

  const directorySuggestion = await buildMetadataSuggestion(
    invalidDirectory.target,
  );
  const descriptionSuggestion = await buildMetadataSuggestion(
    noDescription.target,
  );

  assert.ok(
    directorySuggestion.blockedMetadata.some((item) => item.field === "name"),
  );
  assert.ok(
    descriptionSuggestion.blockedMetadata.some(
      (item) => item.field === "description",
    ),
  );
  assert.equal(
    directorySuggestion.agentSkills?.canonicalFrontmatter,
    undefined,
  );
  assert.equal(
    descriptionSuggestion.agentSkills?.canonicalFrontmatter,
    undefined,
  );
});

test("migration blocks ambiguous duplicate semantic list values", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
id: skill.demo
tags:
  - review
  - review
---
# Demo

Use this skill when reviewing demo inputs.
`,
  );

  const suggestion = await buildMetadataSuggestion(target);

  assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
  assert.match(
    suggestion.blockedMetadata.find((item) => item.field === "tags")?.reason ??
      "",
    /duplicate semantic values/,
  );
});

async function skillFixture(
  name: string,
  content: string,
): Promise<{ target: string; original: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-skill-migration-"));
  const target = path.join(root, "skills", name, "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return { target, original: content };
}
