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
import { parseAssetMetadata, parseSkillGovernance } from "../src/metadata.js";
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
  assert.equal(validation.migrationDirection, "legacy-to-agent-skills");
  assert.equal(
    validation.migrationCommand,
    "renma suggest-metadata skills/demo/SKILL.md",
  );
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

test("uses YAML 1.2 parsing for Agent Skills frontmatter", () => {
  const invalidCases = [
    {
      label: "unterminated quoted description",
      content: `---\nname: demo\ndescription: "Use when reviewing demo inputs.\n---\n# Demo\n`,
    },
    {
      label: "invalid escape sequence",
      content: `---\nname: demo\ndescription: "Use when reviewing \\q inputs."\n---\n# Demo\n`,
    },
    {
      label: "malformed YAML sequence",
      content: `---\nname: demo\ndescription: [Use when reviewing demo inputs.\n---\n# Demo\n`,
    },
  ];

  for (const fixture of invalidCases) {
    const validation = validateAgentSkill(
      parseDocument(artifact("skills/demo/SKILL.md", fixture.content)),
    );
    assert.equal(validation.valid, false, fixture.label);
    assert.ok(
      validation.issues.some((issue) => issue.code === "AS-SKILL-INVALID-YAML"),
      fixture.label,
    );
  }
});

test("requires Agent Skills frontmatter to parse to a mapping", () => {
  const validation = validateAgentSkill(
    parseDocument(
      artifact(
        "skills/demo/SKILL.md",
        `---\n- name: demo\n- description: Use when reviewing demo inputs.\n---\n# Demo\n`,
      ),
    ),
  );

  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "AS-SKILL-FRONTMATTER-NOT-MAPPING",
    ),
  );
});

test("reports duplicate top-level and metadata mapping keys", () => {
  const validation = validateAgentSkill(
    parseDocument(
      artifact(
        "skills/demo/SKILL.md",
        `---
name: demo
name: demo
description: Use when reviewing demo inputs.
metadata:
  renma.owner: first
  renma.owner: second
---
# Demo
`,
      ),
    ),
  );
  const codes = validation.issues.map((issue) => issue.code);

  assert.ok(codes.includes("AS-SKILL-DUPLICATE-FIELD"));
  assert.ok(codes.includes("AS-SKILL-DUPLICATE-METADATA-KEY"));
});

test("requires Agent Skills metadata child values to be strings", () => {
  for (const metadataValue of ["[one, two]", "true"]) {
    const validation = validateAgentSkill(
      parseDocument(
        artifact(
          "skills/demo/SKILL.md",
          `---
name: demo
description: Use when reviewing demo inputs.
metadata:
  renma.owner: ${metadataValue}
---
# Demo
`,
        ),
      ),
    );
    assert.ok(
      validation.issues.some(
        (issue) => issue.code === "AS-SKILL-INVALID-METADATA",
      ),
      metadataValue,
    );
  }
});

test("accepts standard YAML scalar and multiline description forms", () => {
  const descriptions = [
    "'Use when reviewing demo inputs.'",
    '"Use when reviewing demo inputs."',
    "Use when reviewing demo inputs. # discovery guidance",
    "|\n  Use when reviewing demo inputs.\n  Return reviewed findings.",
    ">\n  Use when reviewing demo inputs.\n  Return reviewed findings.",
  ];

  for (const description of descriptions) {
    const validation = validateAgentSkill(
      parseDocument(
        artifact(
          "skills/demo/SKILL.md",
          `---\nname: demo\ndescription: ${description}\n---\n# Demo\n`,
        ),
      ),
    );
    assert.equal(validation.valid, true, description);
    assert.equal(validation.errorCount, 0, description);
  }
});

test("warns when an explicit skill-selection exclusion is absent from description", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Do not use this skill when

- Do not use this skill for production deployment.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.equal(validation.valid, true);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY",
    ),
  );
});

test("does not copy a prominent execution constraint into description", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- Do not modify production files. Produce a patch for review instead.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );
  const codes = validation.issues.map((issue) => issue.code);

  assert.equal(validation.valid, true);
  assert.equal(
    codes.includes("RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY"),
    false,
  );
  assert.equal(
    codes.includes("RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT"),
    false,
  );
  assert.equal(
    codes.includes("RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE"),
    false,
  );
});

test("warns when an execution constraint is buried in procedure", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Procedure

1. Inspect the repository.
2. Do not modify production files.
3. Prepare findings.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT",
    ),
  );
  assert.equal(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY",
    ),
    false,
  );
});

test("does not let an unrelated constraint heading hide a buried constraint", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- Add reviewed constraints here.

## Procedure

- Do not modify production files. Produce a patch instead.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT",
    ),
  );
});

test("reports mixed prominent and buried constraints as scattered", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- Do not infer behavior. Stop and report missing evidence.

## Procedure

- Never upload secrets. Stop and report the blocked operation.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );
  const codes = validation.issues.map((issue) => issue.code);

  assert.ok(codes.includes("RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT"));
  assert.ok(codes.includes("RN-SKILL-EXECUTION-CONSTRAINT-SCATTERED"));
});

test("accepts a nearby stop and alternative for an execution constraint", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- When evidence is missing, do not infer behavior. Stop and report the missing evidence.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE",
    ),
    false,
  );
});

test("accepts an instead clause as an execution alternative", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- Do not execute tests from this review skill. Use the test-execution workflow instead.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE",
    ),
    false,
  );
});

test("requests human review when an execution constraint has no alternative", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- Do not infer product behavior.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );
  const warning = validation.issues.find(
    (issue) =>
      issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE",
  );

  assert.ok(warning);
  assert.match(warning.message, /human clarification/i);
  assert.match(warning.message, /Do not invent/i);
  assert.equal(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY",
    ),
    false,
  );
});

test("warns when execution constraints are scattered across sections", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Procedure

- Do not modify production files. Produce a patch instead.

## Validation

- Never upload secrets. Stop and report the blocked validation.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-SCATTERED",
    ),
  );
});

test("treats nested constraint subsections as prominent", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

### File Changes

- Do not modify production files. Produce a patch instead.

### Network Safety

- Never upload secrets. Stop and report the blocked operation.
`;
  const validation = validateAgentSkill(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.equal(
    validation.issues.some((issue) => issue.code.includes("NOT-PROMINENT")),
    false,
  );
  assert.equal(
    validation.issues.some((issue) => issue.code.includes("SCATTERED")),
    false,
  );
});

test("uses one YAML interpretation for quoted and inline canonical metadata", () => {
  for (const metadataYaml of [
    'metadata:\n  "renma.owner": "qa-platform"',
    'metadata: { "renma.owner": "qa-platform", "renma.future-field": "keep-me", "other-client.priority": "high" }',
    "metadata: # repository governance\n  renma.owner: qa-platform",
  ]) {
    const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
${metadataYaml}
---
# Demo
`;
    const document = parseDocument(artifact("skills/demo/SKILL.md", content));
    const validation = validateAgentSkill(document);
    const { metadata } = parseAssetMetadata(document);

    assert.equal(validation.valid, true, metadataYaml);
    assert.equal(metadata.owner, "qa-platform", metadataYaml);
  }
});

test("Skill governance preserves unknown Renma and vendor metadata", () => {
  const content = `---
name: demo
description: Reviews demo inputs. Use when a demo needs review.
metadata:
  renma.id: skill.demo
  renma.future-field: keep-me
  other-client.priority: high
---
# Demo
`;
  const governance = parseSkillGovernance(
    parseDocument(artifact("skills/demo/SKILL.md", content)),
  );

  assert.equal(governance.id, "skill.demo");
  assert.deepEqual(governance.extensionMetadata, {
    "renma.id": "skill.demo",
    "renma.future-field": "keep-me",
    "other-client.priority": "high",
  });
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
  assert.match(bundle.content, /metadata:\n {2}renma\.id:/);
  assert.match(bundle.content, /## Do not use this skill when/);
  assert.match(bundle.content, /## Hard Constraints/);
  assert.match(bundle.content, /Hard constraints apply after this skill/);
  assert.match(
    bundle.content,
    /When source evidence is missing, do not infer product behavior\. Stop and report the missing evidence\./,
  );
  assert.match(
    bundle.content,
    /Do not modify production files\. Produce a proposed patch for human review instead\./,
  );
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
  assert.ok(suggestion.agentSkills?.selectionBoundaryReview.length);
  assert.ok(suggestion.agentSkills?.executionConstraintReview.length);
});

test("suggest-metadata keeps execution constraints out of a description candidate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-agent-skills-"));
  const target = path.join(root, "skills", "demo", "SKILL.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `---
id: skill.demo
---
# Demo

Use this skill when reviewing demo inputs. Do not modify production files. Produce a proposed patch for human review instead.

## Hard Constraints

- Do not modify production files. Produce a proposed patch for human review instead.
`,
  );

  const suggestion = await buildMetadataSuggestion(target, {});
  const description =
    suggestion.agentSkills?.candidateAgentSkillsMetadata.description ?? "";

  assert.match(description, /Use this skill when reviewing demo inputs\./);
  assert.doesNotMatch(description, /modify production files/);
  assert.doesNotMatch(description, /proposed patch/);
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
