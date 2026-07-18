import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { validateAgentSkill } from "../src/agent-skills.js";
import { buildMetadataSuggestion } from "../src/commands/suggest-metadata.js";
import { parseDocument } from "../src/markdown.js";
import { buildAgentSkillMigrationSuggestion } from "../src/skill-migration.js";
import type { Artifact } from "../src/types.js";

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
  assert.equal(suggestion.agentSkills?.sourcePath, "skills/demo/SKILL.md");
  assert.equal(suggestion.agentSkills?.targetPath, "skills/demo/SKILL.md");
  assert.equal(suggestion.agentSkills?.entrypointMigration, "none");
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
  assert.match(
    ownerBlock?.reason ?? "",
    /conflicts with pre-0\.16 Renma Skill field owner/,
  );
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

test("duplicate top-level metadata mappings select no structured canonical metadata", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when a demo needs review.
id: skill.demo
owner: legacy-team
metadata:
  renma.owner: first-team
  other-client.priority: first
metadata:
  renma.owner: second-team
  other-client.priority: second
---
# Demo
`,
  );

  const suggestion = await buildMetadataSuggestion(target, {
    owner: "explicit-team",
  });

  assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
  assert.ok(
    suggestion.blockedMetadata.some((item) => item.field === "metadata"),
  );
  assert.deepEqual(suggestion.agentSkills?.candidateRenmaMetadata, {});
  assert.deepEqual(suggestion.agentSkills?.preservedMetadata, {});
});

test("duplicated metadata child keys are absent from every structured metadata source", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when a demo needs review.
id: skill.demo
owner: legacy-team
metadata:
  renma.owner: first-team
  renma.owner: second-team
  renma.tags: '["demo"]'
  other-client.priority: high
---
# Demo
`,
  );

  const suggestion = await buildMetadataSuggestion(target, {
    owner: "explicit-team",
  });

  assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
  assert.ok(
    suggestion.blockedMetadata.some(
      (item) => item.field === "metadata.renma.owner",
    ),
  );
  assert.equal(
    suggestion.agentSkills?.candidateRenmaMetadata["renma.owner"],
    undefined,
  );
  assert.equal(
    suggestion.agentSkills?.preservedMetadata["renma.owner"],
    undefined,
  );
  assert.deepEqual(suggestion.agentSkills?.candidateRenmaMetadata, {
    "renma.tags": '["demo"]',
    "renma.id": "skill.demo",
  });
  assert.deepEqual(suggestion.agentSkills?.preservedMetadata, {
    "renma.tags": '["demo"]',
    "other-client.priority": "high",
    "renma.id": "skill.demo",
  });
});

test("canonical owner retrofit does not replace a duplicated owner", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when a demo needs review.
metadata:
  renma.owner: first-team
  renma.owner: second-team
---
# Demo
`,
  );

  const suggestion = await buildMetadataSuggestion(target, {
    owner: "explicit-team",
  });

  assert.equal(
    suggestion.agentSkills?.proposalKind,
    "canonical-metadata-retrofit",
  );
  assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
  assert.ok(
    suggestion.blockedMetadata.some(
      (item) => item.field === "metadata.renma.owner",
    ),
  );
  assert.equal(
    suggestion.agentSkills?.candidateRenmaMetadata["renma.owner"],
    undefined,
  );
  assert.equal(
    suggestion.agentSkills?.preservedMetadata["renma.owner"],
    undefined,
  );
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
    assert.match(block?.reason ?? "", /must be a YAML string/, field);
  }
});

test("migration accepts arrays for canonical list fields", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
id: skill.demo
tags: [demo, review]
requires_context: [context.demo, context.review]
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
  assert.ok(suggestion.agentSkills?.canonicalFrontmatter);
});

test("migration serializes legacy boolean security policy as canonical strings", async () => {
  const { target, original } = await skillFixture(
    "demo",
    `---
id: skill.demo
network_allowed: true
---
# Demo

Use this skill when reviewing demo inputs.
`,
  );

  const suggestion = await buildMetadataSuggestion(target);
  assert.equal(await readFile(target, "utf8"), original);
  assert.deepEqual(suggestion.blockedMetadata, []);
  assert.equal(
    suggestion.agentSkills?.candidateRenmaMetadata["renma.network-allowed"],
    "true",
  );
  assert.match(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /renma\.network-allowed: "true"/,
  );
  assert.match(
    suggestion.agentSkills?.reviewPrompt ?? "",
    /Review the canonical frontmatter proposal/,
  );
});

test("migration serializes legacy security lists as canonical JSON strings", async () => {
  for (const fixture of [
    {
      field: "allowed_data",
      canonicalKey: "renma.allowed-data",
      value: "[public, internal]",
      expected: '["public","internal"]',
    },
    {
      field: "forbidden_inputs",
      canonicalKey: "renma.forbidden-inputs",
      value: "[secrets, credentials]",
      expected: '["secrets","credentials"]',
    },
  ]) {
    const { target, original } = await skillFixture(
      "demo",
      `---
id: skill.demo
${fixture.field}: ${fixture.value}
---
# Demo

Use this skill when reviewing demo inputs.
`,
    );

    const suggestion = await buildMetadataSuggestion(target);
    assert.equal(await readFile(target, "utf8"), original, fixture.field);
    assert.deepEqual(suggestion.blockedMetadata, [], fixture.field);
    assert.equal(
      suggestion.agentSkills?.candidateRenmaMetadata[fixture.canonicalKey],
      fixture.expected,
      fixture.field,
    );
    assert.ok(suggestion.agentSkills?.canonicalFrontmatter, fixture.field);
  }
});

test("migration candidates reject invalid existing canonical security metadata", async () => {
  for (const fixture of [
    {
      key: "renma.network-allowed",
      value: '"yes"',
      expected: /expected the exact string "true" or "false"/,
    },
    {
      key: "renma.allowed-data",
      value: "public,internal",
      expected: /expected a JSON-array string containing strings only/,
    },
  ]) {
    const { target } = await skillFixture(
      "demo",
      `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
owner: qa-platform
metadata:
  ${fixture.key}: ${fixture.value}
---
# Demo
`,
    );
    const suggestion = await buildMetadataSuggestion(target);
    const block = suggestion.blockedMetadata.find(
      (item) => item.field === `metadata.${fixture.key}`,
    );

    assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
    assert.match(block?.reason ?? "", fixture.expected);
  }
});

test("historical entrypoint migration validates preserved canonical security metadata", async () => {
  const { target } = await skillEntrypointFixture(
    "skills/demo/skill.md",
    `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
metadata:
  renma.network-allowed: "yes"
---
# Demo
`,
  );
  const suggestion = await buildMetadataSuggestion(target);

  assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
  assert.ok(
    suggestion.blockedMetadata.some(
      (item) => item.field === "metadata.renma.network-allowed",
    ),
  );
});

test("migration candidates preserve valid existing canonical security metadata", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
owner: qa-platform
metadata:
  renma.network-allowed: "false"
  renma.allowed-data: '["public"]'
---
# Demo
`,
  );
  const suggestion = await buildMetadataSuggestion(target);

  assert.deepEqual(suggestion.blockedMetadata, []);
  assert.match(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /renma\.network-allowed: "false"/,
  );
  assert.match(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /renma\.allowed-data: '\["public"\]'/,
  );
});

test("canonical owner retrofit rejects invalid canonical security metadata", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
metadata:
  renma.network-allowed: "flase"
---
# Demo
`,
  );
  const suggestion = await buildMetadataSuggestion(target, {
    owner: "qa-platform",
  });

  assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
  assert.ok(
    suggestion.blockedMetadata.some(
      (item) => item.field === "metadata.renma.network-allowed",
    ),
  );
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
      /must be a YAML string/,
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

test("migration blocks lossy native YAML values", async () => {
  const cases = [
    {
      field: "version",
      yaml: "version: 1.0",
      message: /Pre-0\.16 Renma Skill field version must be a YAML string/,
    },
    {
      field: "id",
      yaml: "id: 001",
      message: /Pre-0\.16 Renma Skill field id must be a YAML string/,
    },
    {
      field: "owner",
      yaml: "owner: true",
      message: /Pre-0\.16 Renma Skill field owner must be a YAML string/,
    },
    {
      field: "status",
      yaml: "status: false",
      message: /Pre-0\.16 Renma Skill field status must be a YAML string/,
    },
    {
      field: "tags",
      yaml: "tags: [1.0]",
      message:
        /Pre-0\.16 Renma Skill field tags must contain string values only/,
    },
    {
      field: "network_allowed",
      yaml: "network_allowed: 1",
      message:
        /Pre-0\.16 Renma Skill field network_allowed must be a boolean or the string/,
    },
    {
      field: "allowed_data",
      yaml: "allowed_data: [true]",
      message:
        /Pre-0\.16 Renma Skill field allowed_data must contain string values only/,
    },
  ];

  for (const fixture of cases) {
    const { target } = await skillFixture(
      "demo",
      `---\n${fixture.yaml}\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n`,
    );
    const suggestion = await buildMetadataSuggestion(target);
    const block = suggestion.blockedMetadata.find(
      (item) => item.field === fixture.field,
    );

    assert.equal(
      suggestion.agentSkills?.canonicalFrontmatter,
      undefined,
      fixture.yaml,
    );
    assert.match(block?.reason ?? "", fixture.message, fixture.yaml);
  }
});

test("migration preserves quoted text, safe booleans, and string-only lists", async () => {
  const cases = [
    ["version", 'version: "1.0"', "1.0"],
    ["id", 'id: "001"', "001"],
    ["owner", 'owner: "true"', "true"],
    ["tags", 'tags: ["1.0"]', '["1.0"]'],
    ["tags", `tags: '["1.0"]'`, '["1.0"]'],
    ["network-allowed", "network_allowed: false", "false"],
    ["network-allowed", 'network_allowed: "true"', "true"],
    ["security-profile", "security_profile: strict-local", "strict-local"],
  ] as const;

  for (const [canonicalSuffix, yaml, expected] of cases) {
    const { target } = await skillFixture(
      "demo",
      `---\n${yaml}\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n`,
    );
    const suggestion = await buildMetadataSuggestion(target);

    assert.deepEqual(suggestion.blockedMetadata, [], yaml);
    assert.equal(
      suggestion.agentSkills?.candidateRenmaMetadata[
        `renma.${canonicalSuffix}`
      ],
      expected,
      yaml,
    );
    assert.ok(suggestion.agentSkills?.canonicalFrontmatter, yaml);
  }
});

test("canonical Agent Skills support explicit owner metadata retrofit", async () => {
  const noOwner = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
---
# Demo
`,
  );
  const added = await buildMetadataSuggestion(noOwner.target, {
    owner: "qa-platform",
  });

  assert.equal(added.suggestedMode, "agent-skills-metadata-retrofit");
  assert.equal(added.agentSkills?.direction, "none");
  assert.equal(
    added.agentSkills?.candidateRenmaMetadata["renma.owner"],
    "qa-platform",
  );
  assert.match(
    added.agentSkills?.canonicalFrontmatter ?? "",
    /renma\.owner: qa-platform/,
  );

  const existing = await skillFixture(
    "demo",
    `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
metadata:
  renma.owner: docs
---
# Demo
`,
  );
  const same = await buildMetadataSuggestion(existing.target, {
    owner: "docs",
  });
  const different = await buildMetadataSuggestion(existing.target, {
    owner: "qa-platform",
  });
  const omitted = await buildMetadataSuggestion(noOwner.target);

  assert.deepEqual(same.blockedMetadata, []);
  assert.equal(same.agentSkills?.preservedMetadata["renma.owner"], "docs");
  assert.deepEqual(same.agentSkills?.candidateRenmaMetadata, {});
  assert.equal(same.agentSkills?.canonicalFrontmatter, undefined);

  assert.equal(different.agentSkills?.canonicalFrontmatter, undefined);
  assert.match(
    different.blockedMetadata.find((item) => item.field === "owner")?.reason ??
      "",
    /differs from explicitly provided owner/,
  );

  assert.deepEqual(omitted.agentSkills?.candidateRenmaMetadata, {});
  assert.equal(omitted.agentSkills?.canonicalFrontmatter, undefined);
});

test("migration validates the target directory without trimming filesystem names", async () => {
  for (const name of ["demo ", " demo"]) {
    const { target } = await skillFixture(
      name,
      "---\nid: skill.demo\n---\n# Demo\n\nUse this skill when reviewing demo inputs.\n",
    );
    const suggestion = await buildMetadataSuggestion(target);
    assert.ok(
      suggestion.blockedMetadata.some((item) => item.field === "name"),
      JSON.stringify(name),
    );
    assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
  }
});

test("migration description extraction ignores both fence characters and lengths", async () => {
  for (const fenced of [
    [
      "```markdown",
      "Use this skill when performing a dangerous example action.",
      "```",
    ],
    [
      "~~~markdown",
      "Use this skill when performing a dangerous example action.",
      "~~~",
    ],
    [
      "~~~~markdown",
      "Use this skill when performing a dangerous example action.",
      "~~~",
      "Use this skill when performing another dangerous example action.",
      "~~~~~",
    ],
  ]) {
    const { target } = await skillFixture(
      "demo",
      [
        "---",
        "id: skill.demo",
        "---",
        "# Demo",
        "",
        ...fenced,
        "",
        "Use this skill when reviewing real demo inputs.",
        "",
      ].join("\n"),
    );
    const suggestion = await buildMetadataSuggestion(target);

    assert.equal(
      suggestion.agentSkills?.candidateAgentSkillsFields.description,
      "Use this skill when reviewing real demo inputs.",
    );
    assert.ok(suggestion.agentSkills?.canonicalFrontmatter);
  }
});

test("migration description recovery excludes fences from copied documents", () => {
  const content = [
    "---",
    "id: skill.demo",
    "---",
    "# Demo",
    "",
    "```markdown",
    "Use this skill when performing a dangerous example action.",
    "```",
    "",
    "Use this skill when reviewing real demo inputs.",
    "",
  ].join("\n");
  const parsed = parseDocument({
    path: "skills/demo/SKILL.md",
    absolutePath: "/repo/skills/demo/SKILL.md",
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  } satisfies Artifact);

  const suggestion = buildAgentSkillMigrationSuggestion({ ...parsed });

  assert.equal(
    suggestion.candidateAgentSkillsFields.description,
    "Use this skill when reviewing real demo inputs.",
  );
});

test("canonical owner retrofit blocks specification-invalid Agent Skills", async () => {
  const cases = [
    {
      label: "invalid name",
      content: `---
name: InvalidName
description: Review demo inputs. Use when demo inputs need review.
---
# Demo
`,
      field: "name",
    },
    {
      label: "invalid metadata",
      content: `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
metadata:
  renma.owner: [docs]
---
# Demo
`,
      field: "metadata",
    },
  ];

  for (const fixture of cases) {
    const { target } = await skillFixture("demo", fixture.content);
    const suggestion = await buildMetadataSuggestion(target, {
      owner: "qa-platform",
    });

    assert.equal(
      suggestion.suggestedMode,
      "agent-skills-metadata-retrofit",
      fixture.label,
    );
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

test("historical entrypoints with valid Agent Skills identity render target-valid candidates", async () => {
  for (const fixture of [
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
  ] as const) {
    const body = `# Demo

Review the requested input.
`;
    const original = `---
name: ${fixture.name}
description: Review demo inputs. Use when demo inputs need review.
---
${body}`;
    const { root, target: source } = await skillEntrypointFixture(
      fixture.source,
      original,
    );
    const suggestion = await buildMetadataSuggestion(source);
    const canonicalFrontmatter =
      suggestion.agentSkills?.canonicalFrontmatter ?? "";
    const targetAbsolutePath = path.join(root, ...fixture.target.split("/"));
    const candidateContent = `${canonicalFrontmatter}\n${body}`;
    const candidate = parseDocument({
      path: fixture.target,
      absolutePath: targetAbsolutePath,
      kind: "skill",
      sizeBytes: Buffer.byteLength(candidateContent),
      contentClassification: "text",
      markdownParserEligible: true,
      content: candidateContent,
    } satisfies Artifact);

    assert.equal(suggestion.agentSkills?.sourceFormat, "agent-skills");
    assert.equal(suggestion.agentSkills?.direction, "legacy-to-agent-skills");
    assert.equal(suggestion.agentSkills?.targetPath, fixture.target);
    assert.equal(
      suggestion.agentSkills?.entrypointMigration,
      fixture.migration,
    );
    assert.equal(
      suggestion.agentSkills?.candidateAgentSkillsFields.name,
      fixture.name,
    );
    assert.ok(canonicalFrontmatter, fixture.source);
    assert.equal(validateAgentSkill(candidate).valid, true, fixture.source);
    assert.equal(await readFile(source, "utf8"), original, fixture.source);
  }
});

test("historical entrypoint migration blocks invalid or mismatched names", async () => {
  const cases = [
    {
      source: "skills/demo/skill.md",
      name: "InvalidName",
      candidate: "demo",
    },
    {
      source: "skills/testing/spec-review.skill.md",
      name: "testing",
      candidate: "spec-review",
    },
  ];

  for (const fixture of cases) {
    const { target } = await skillEntrypointFixture(
      fixture.source,
      `---
name: ${fixture.name}
description: Review demo inputs. Use when demo inputs need review.
---
# Demo
`,
    );
    const suggestion = await buildMetadataSuggestion(target);

    assert.equal(
      suggestion.agentSkills?.candidateAgentSkillsFields.name,
      fixture.candidate,
    );
    assert.equal(suggestion.agentSkills?.canonicalFrontmatter, undefined);
    assert.ok(
      suggestion.blockedMetadata.some((item) => item.field === "name"),
      fixture.source,
    );
  }
});

test("path migration blocks when a distinct target entrypoint already exists", async () => {
  for (const fixture of [
    {
      source: "skills/demo/skill.md",
      target: "skills/demo/SKILL.md",
      migration: "rename",
    },
    {
      source: "skills/testing/spec-review.skill.md",
      target: "skills/testing/spec-review/SKILL.md",
      migration: "move-and-rename",
    },
  ] as const) {
    const name = fixture.source.includes("spec-review")
      ? "spec-review"
      : "demo";
    const content = `---
name: ${name}
description: Review demo inputs. Use when demo inputs need review.
---
# Demo
`;
    const { root, target: source } = await skillEntrypointFixture(
      fixture.source,
      content,
    );
    const absent = await buildMetadataSuggestion(source);
    assert.equal(absent.agentSkills?.entrypointMigration, fixture.migration);
    assert.ok(absent.agentSkills?.canonicalFrontmatter, fixture.source);

    const target = path.join(root, ...fixture.target.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    const collision = await buildMetadataSuggestion(source);
    const [sourceInfo, targetInfo] = await Promise.all([
      stat(source),
      stat(target),
    ]);
    const sameEntry =
      sourceInfo.dev === targetInfo.dev && sourceInfo.ino === targetInfo.ino;

    if (sameEntry) {
      assert.ok(collision.agentSkills?.canonicalFrontmatter, fixture.source);
      assert.equal(
        collision.blockedMetadata.some((item) => item.field === "targetPath"),
        false,
        fixture.source,
      );
    } else {
      assert.equal(collision.agentSkills?.canonicalFrontmatter, undefined);
      assert.match(
        collision.blockedMetadata.find((item) => item.field === "targetPath")
          ?.reason ?? "",
        /Target Agent Skills entrypoint already exists/,
        fixture.source,
      );
    }
  }
});

test("frontmatter fence-like text does not hide body migration evidence", async () => {
  const { target } = await skillFixture(
    "demo",
    `---
id: skill.demo
purpose: |
  Example marker:
  ~~~
---
# Demo

Use this skill when reviewing real demo inputs.
`,
  );
  const suggestion = await buildMetadataSuggestion(target);

  assert.equal(
    suggestion.agentSkills?.candidateAgentSkillsFields.description,
    "Use this skill when reviewing real demo inputs.",
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

async function skillEntrypointFixture(
  relativePath: string,
  content: string,
): Promise<{ root: string; target: string; original: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-skill-entrypoint-"));
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return { root, target, original: content };
}
