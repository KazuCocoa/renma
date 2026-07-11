import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_SKILLS_SPECIFICATION,
  validateAgentSkill,
  validateAgentSkills,
} from "../src/agent-skills.js";
import { buildScaffoldBundle } from "../src/commands/scaffold.js";
import { buildMetadataSuggestion } from "../src/commands/suggest-metadata.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import type { Artifact } from "../src/types.js";

test("validates the Agent Skills specification and canonical Renma metadata", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review. Do not use for production work.
metadata:
  renma.id: skill.demo
  renma.owner: qa-platform
  renma.tags: '["demo","review"]'
---
# Demo

## Do Not Use For

- Do not use for production work.
`;
  const document = parseDocument(artifact("skills/demo/SKILL.md", content));
  const validation = validateAgentSkill(document);
  const { metadata } = parseAssetMetadata(document);

  assert.equal(validation.valid, true);
  assert.equal(validation.format, "agent-skills");
  assert.equal(validation.migrationRecommended, false);
  assert.equal(validation.errorCount, 0);
  assert.deepEqual(metadata, {
    id: "skill.demo",
    owner: "qa-platform",
    tags: ["demo", "review"],
    whenToUse: [],
    whenNotToUse: [],
    requiresContext: [],
    optionalContext: [],
    conflicts: [],
    supersededBy: [],
  });
});

test("reports legacy top-level Renma metadata as a one-way migration source", () => {
  const content = `---
id: skill.demo
owner: qa-platform
status: stable
when_not_to_use:
  - Production work
---
# Demo
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.equal(validation.valid, false);
  assert.equal(validation.format, "renma-legacy");
  assert.equal(validation.migrationRecommended, true);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "AS-SKILL-UNEXPECTED-TOP-LEVEL-FIELD",
    ),
  );
  assert.ok(
    validation.issues.some((issue) => issue.code === "AS-SKILL-MISSING-NAME"),
  );
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "AS-SKILL-MISSING-DESCRIPTION",
    ),
  );
});

test("requires the name to match the parent directory", () => {
  const content = `---
name: other
description: Reviews demo inputs. Use when a demo needs review. Do not use for production work.
---
# Demo
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "AS-SKILL-NAME-DIRECTORY-MISMATCH",
    ),
  );
});

test("warns when a body-level exclusion is absent from description", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Do Not Use For

- Do not use for production work.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.equal(validation.valid, true);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-DESCRIPTION-OMITS-NEGATIVE-BOUNDARY",
    ),
  );
});

test("summarizes repository-wide Agent Skills validation", () => {
  const valid = parseDocument(
    artifact(
      "skills/demo/SKILL.md",
      `---
name: demo
description: Reviews demo inputs. Use when a demo needs review. Do not use for production work.
---
# Demo

## Do Not Use For
Do not use for production work.
`,
    ),
  );
  const legacy = parseDocument(
    artifact(
      "skills/legacy/SKILL.md",
      "---\nid: skill.legacy\n---\n# Legacy\n",
    ),
  );
  const summary = validateAgentSkills([legacy, valid]);

  assert.equal(summary.specification, AGENT_SKILLS_SPECIFICATION);
  assert.equal(summary.totalSkillCount, 2);
  assert.equal(summary.validSkillCount, 1);
  assert.equal(summary.invalidSkillCount, 1);
  assert.equal(summary.legacySkillCount, 1);
});

test("new skill scaffold is Agent Skills compatible", () => {
  const bundle = buildScaffoldBundle({
    kind: "skill",
    targetPath: "skills/testing/spec-review/SKILL.md",
    format: "json",
    owner: "qa-platform",
    tags: ["testing", "review"],
  });
  const validation = validateAgentSkill(
    parseDocument(
      artifact("skills/testing/spec-review/SKILL.md", bundle.content),
    ),
  );

  assert.equal(bundle.name, "spec-review");
  assert.equal(validation.valid, true);
  assert.match(bundle.content, /^---\nname: 'spec-review'/);
  assert.match(bundle.content, /metadata:\n  renma\.id:/);
  assert.match(bundle.content, /## Do not use this skill when/);
  assert.match(bundle.content, /## Hard Constraints/);
});

test("suggest-metadata emits legacy-to-Agent-Skills migration evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-agent-skills-"));
  const target = path.join(root, "skills", "demo", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `---
id: skill.demo
owner: qa-platform
status: stable
when_not_to_use:
  - Production work
---
# Demo

Use this skill when reviewing demo inputs before implementation. Do not use it for production execution.

## Do Not Use For

- Do not use for production execution.
`,
  );

  const suggestion = await buildMetadataSuggestion(target, {});

  assert.equal(suggestion.agentSkills?.direction, "legacy-to-agent-skills");
  assert.equal(suggestion.agentSkills?.sourceFormat, "renma-legacy");
  assert.equal(
    suggestion.agentSkills?.candidateRenmaMetadata["renma.id"],
    "skill.demo",
  );
  assert.match(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /name: 'demo'/,
  );
  assert.match(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /renma\.owner: 'qa-platform'/,
  );
  assert.doesNotMatch(
    suggestion.agentSkills?.canonicalFrontmatter ?? "",
    /^owner:/m,
  );
});

function artifact(filePath: string, content: string): Artifact {
  return {
    path: filePath,
    absolutePath: `/tmp/${filePath}`,
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    content,
  };
}
