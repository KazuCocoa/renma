import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  AGENT_SKILLS_SPECIFICATION,
  validateAgentSkill,
  validateAgentSkills,
} from "../src/agent-skills.js";
import { main } from "../src/cli.js";
import { parseDocument } from "../src/markdown.js";
import { formatText } from "../src/report.js";
import { scan } from "../src/scanner.js";
import type { Artifact } from "../src/types.js";

test("validates canonical Agent Skills YAML forms", () => {
  const cases = [
    {
      label: "quoted metadata key",
      metadata: 'metadata:\n  "renma.owner": "qa-platform"',
      description: "Use when reviewing demo inputs.",
    },
    {
      label: "inline metadata mapping",
      metadata:
        'metadata: { "renma.owner": "qa-platform", "other-client.priority": "high" }',
      description: "Use when reviewing demo inputs.",
    },
    {
      label: "multiline description",
      metadata: "metadata:\n  renma.owner: qa-platform",
      description: ">\n  Review demo inputs. Use when a demo needs review.",
    },
  ];

  for (const fixture of cases) {
    const validation = validateAgentSkill(
      skill(
        "skills/demo/SKILL.md",
        `---\nname: demo\ndescription: ${fixture.description}\n${fixture.metadata}\n---\n# Demo\n`,
      ),
    );

    assert.equal(validation.valid, true, fixture.label);
    assert.equal(validation.format, "agent-skills", fixture.label);
    assert.equal(validation.errorCount, 0, fixture.label);
  }
});

test("reports frontmatter structure and YAML failures with stable codes", () => {
  const cases = [
    {
      label: "missing frontmatter",
      content: "# Demo\n",
      code: "AS-SKILL-MISSING-FRONTMATTER",
    },
    {
      label: "unclosed frontmatter",
      content:
        "---\nname: demo\ndescription: Use when reviewing demo inputs.\n",
      code: "AS-SKILL-UNCLOSED-FRONTMATTER",
    },
    {
      label: "invalid YAML",
      content: '---\nname: demo\ndescription: "unterminated\n---\n# Demo\n',
      code: "AS-SKILL-INVALID-YAML",
    },
    {
      label: "non-mapping frontmatter",
      content:
        "---\n- name: demo\n- description: Use when reviewing demo inputs.\n---\n# Demo\n",
      code: "AS-SKILL-FRONTMATTER-NOT-MAPPING",
    },
  ];

  for (const fixture of cases) {
    const validation = validateAgentSkill(
      skill("skills/demo/SKILL.md", fixture.content),
    );
    assert.equal(validation.valid, false, fixture.label);
    assert.ok(
      validation.issues.some((issue) => issue.code === fixture.code),
      fixture.label,
    );
  }
});

test("reports duplicate and unexpected fields without selecting a winner", () => {
  const validation = validateAgentSkill(
    skill(
      "skills/demo/SKILL.md",
      `---
name: demo
name: other
description: Use when reviewing demo inputs.
metadata:
  renma.owner: first
  renma.owner: second
mystery: keep
---
# Demo
`,
    ),
  );
  const codes = validation.issues.map((issue) => issue.code);

  assert.ok(codes.includes("AS-SKILL-DUPLICATE-FIELD"));
  assert.ok(codes.includes("AS-SKILL-DUPLICATE-METADATA-KEY"));
  assert.ok(codes.includes("AS-SKILL-UNEXPECTED-TOP-LEVEL-FIELD"));
  assert.equal(validation.valid, false);
});

test("validates required identity, filename, name constraints, and directory match", () => {
  const cases = [
    {
      file: "skills/demo/SKILL.md",
      content: "---\ndescription: Use when reviewing demo inputs.\n---\n",
      code: "AS-SKILL-MISSING-NAME",
    },
    {
      file: "skills/demo/SKILL.md",
      content: "---\nname: demo\n---\n",
      code: "AS-SKILL-MISSING-DESCRIPTION",
    },
    {
      file: "skills/MyDemo/SKILL.md",
      content:
        "---\nname: MyDemo\ndescription: Use when reviewing demo inputs.\n---\n",
      code: "AS-SKILL-INVALID-NAME",
    },
    {
      file: "skills/demo/SKILL.md",
      content:
        "---\nname: other\ndescription: Use when reviewing demo inputs.\n---\n",
      code: "AS-SKILL-NAME-DIRECTORY-MISMATCH",
    },
    {
      file: "skills/demo/skill.md",
      content:
        "---\nname: demo\ndescription: Use when reviewing demo inputs.\n---\n",
      code: "AS-SKILL-NONCANONICAL-FILENAME",
    },
  ];

  for (const fixture of cases) {
    const validation = validateAgentSkill(skill(fixture.file, fixture.content));
    assert.ok(validation.issues.some((issue) => issue.code === fixture.code));
  }
});

test("accepts Unicode names and NFKC-equivalent parent directories", () => {
  const cases = [
    { parent: "日本語", name: "日本語" },
    { parent: "überblick", name: "überblick" },
    { parent: "테스트", name: "테스트" },
    { parent: "é", name: "e\u0301" },
  ];

  for (const fixture of cases) {
    const validation = validateAgentSkill(
      skill(
        `skills/${fixture.parent}/SKILL.md`,
        `---\nname: ${fixture.name}\ndescription: Review inputs. Use when inputs need review.\n---\n# Demo\n`,
      ),
    );
    assert.equal(validation.valid, true, fixture.parent);
    assert.equal(validation.errorCount, 0, fixture.parent);
  }
});

test("does not trim Agent Skill directory names", () => {
  for (const parent of ["demo ", " demo"]) {
    const validation = validateAgentSkill(
      skill(
        `skills/${parent}/SKILL.md`,
        "---\nname: demo\ndescription: Review inputs. Use when inputs need review.\n---\n# Demo\n",
      ),
    );
    assert.ok(
      validation.issues.some(
        (issue) => issue.code === "AS-SKILL-NAME-DIRECTORY-MISMATCH",
      ),
      JSON.stringify(parent),
    );
    assert.equal(validation.valid, false, JSON.stringify(parent));
  }
});

test("rejects invalid Unicode name forms deterministically", () => {
  const cases = [
    { name: "Überblick", label: "uppercase Unicode" },
    { name: "demo!", label: "punctuation" },
    { name: "-demo", label: "leading hyphen" },
    { name: "demo-", label: "trailing hyphen" },
    { name: "demo--review", label: "consecutive hyphens" },
  ];

  for (const fixture of cases) {
    const validation = validateAgentSkill(
      skill(
        `skills/${fixture.name}/SKILL.md`,
        `---\nname: ${fixture.name}\ndescription: Review inputs. Use when inputs need review.\n---\n# Demo\n`,
      ),
    );
    assert.ok(
      validation.issues.some((issue) => issue.code === "AS-SKILL-INVALID-NAME"),
      fixture.label,
    );
  }
});

test("requires metadata child values and optional fields to have specification types", () => {
  const invalidMetadata = validateAgentSkill(
    skill(
      "skills/demo/SKILL.md",
      "---\nname: demo\ndescription: Use when reviewing demo inputs.\nmetadata:\n  renma.tags: [demo]\n---\n",
    ),
  );
  const invalidTools = validateAgentSkill(
    skill(
      "skills/demo/SKILL.md",
      "---\nname: demo\ndescription: Use when reviewing demo inputs.\nallowed-tools: [Read]\n---\n",
    ),
  );

  assert.ok(
    invalidMetadata.issues.some(
      (issue) => issue.code === "AS-SKILL-INVALID-METADATA",
    ),
  );
  assert.ok(
    invalidTools.issues.some(
      (issue) => issue.code === "AS-SKILL-INVALID-ALLOWED-TOOLS",
    ),
  );
});

test("classifies canonical, legacy, hybrid, and unknown Skills", () => {
  const contents = [
    canonical("demo"),
    "---\nid: skill.legacy\n---\n# Legacy\n",
    "---\nname: hybrid\ndescription: Use when reviewing hybrid inputs.\nowner: qa\n---\n# Hybrid\n",
    "---\nlicense: MIT\n---\n# Unknown\n",
  ];
  const paths = ["demo", "legacy", "hybrid", "unknown"].map(
    (name) => `skills/${name}/SKILL.md`,
  );
  const formats = contents.map(
    (content, index) =>
      validateAgentSkill(skill(paths[index]!, content)).format,
  );

  assert.deepEqual(formats, [
    "agent-skills",
    "renma-legacy",
    "hybrid",
    "unknown",
  ]);
});

test("keeps specification validity separate from authoring warnings", () => {
  const validation = validateAgentSkill(
    skill(
      "skills/demo/SKILL.md",
      `---
name: demo
description: Reviews demo inputs.
---
# Demo

## Do not use this skill when

- Do not use this skill for production deployment.

## Procedure

- Do not modify production files.
`,
    ),
  );
  const codes = validation.issues.map((issue) => issue.code);

  assert.equal(validation.valid, true);
  assert.ok(codes.includes("RN-SKILL-DESCRIPTION-MISSING-USAGE-BOUNDARY"));
  assert.ok(codes.includes("RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY"));
  assert.ok(codes.includes("RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT"));
  assert.ok(
    codes.includes("RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE"),
  );
});

test("does not turn an execution constraint into a description warning", () => {
  const validation = validateAgentSkill(
    skill(
      "skills/demo/SKILL.md",
      `---
name: demo
description: Review demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- Do not modify production files. Produce a patch instead.
`,
    ),
  );

  assert.equal(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY",
    ),
    false,
  );
});

test("preserves constraint heading ancestry for nested subsections", () => {
  const validation = validateAgentSkill(
    skill(
      "skills/demo/SKILL.md",
      `---
name: demo
description: Review demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

### File Changes

- Do not modify production files. Produce a patch instead.

### Network Safety

- Never upload secrets. Stop and report the blocked operation.
`,
    ),
  );

  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT" ||
        issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-SCATTERED",
    ),
    false,
  );
});

test("does not treat verbs inside a prohibition as execution alternatives", () => {
  for (const constraint of [
    "Do not return secrets.",
    "Do not produce unreviewed output.",
    "Do not keep credentials in logs.",
    "Do not report private data.",
  ]) {
    const validation = validateAgentSkill(
      skill(
        "skills/demo/SKILL.md",
        `---
name: demo
description: Review demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- ${constraint}
`,
      ),
    );
    assert.ok(
      validation.issues.some(
        (issue) =>
          issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE",
      ),
      constraint,
    );
  }
});

test("recognizes a separate positive instruction after a prohibition", () => {
  for (const constraint of [
    "Do not return secrets. Stop and report the blocked request.",
    "Do not modify production files. Produce a patch instead.",
    "Do not resolve the ambiguity; request human review.",
    "Do not run this workflow. Use the test-execution skill instead.",
  ]) {
    const validation = validateAgentSkill(
      skill(
        "skills/demo/SKILL.md",
        `---
name: demo
description: Review demo inputs. Use when a demo needs review.
---
# Demo

## Hard Constraints

- ${constraint}
`,
      ),
    );
    assert.equal(
      validation.issues.some(
        (issue) =>
          issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE",
      ),
      false,
      constraint,
    );
  }
});

test("authoring inspection ignores backtick and tilde fenced examples", () => {
  for (const fenced of [
    ["```markdown", "## Procedure", "Do not delete production data.", "```"],
    ["~~~markdown", "## Procedure", "Do not delete production data.", "~~~"],
    [
      "~~~~markdown",
      "## Procedure",
      "Do not delete production data.",
      "~~~",
      "Never upload production data.",
      "~~~~~",
    ],
  ]) {
    const validation = validateAgentSkill(
      skill(
        "skills/demo/SKILL.md",
        [
          "---",
          "name: demo",
          "description: Review demo inputs. Use when demo inputs need review.",
          "---",
          "# Demo",
          "",
          ...fenced,
          "",
          "Review the real input and return a summary.",
          "",
        ].join("\n"),
      ),
    );
    assert.equal(
      validation.issues.some((issue) =>
        issue.code.startsWith("RN-SKILL-EXECUTION-CONSTRAINT"),
      ),
      false,
      fenced[0],
    );
  }
});

test("frontmatter fence-like text does not hide body authoring constraints", () => {
  const validation = validateAgentSkill(
    skill(
      "skills/demo/SKILL.md",
      `---
name: demo
description: |
  Review demo inputs. Use when demo inputs need review.
  ~~~
---
# Demo

## Procedure

- Do not modify production files.
`,
    ),
  );

  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE",
    ),
  );
});

test("scan migration commands preserve argv and safely quote shell metacharacters", async () => {
  const root = await fixture();
  const cases = [
    {
      directory: "demo skill",
      display: "renma suggest-metadata 'skills/demo skill/skill.md'",
    },
    {
      directory: "demo'quote",
      display: `renma suggest-metadata 'skills/demo'"'"'quote/skill.md'`,
    },
    {
      directory: "demo;echo-danger",
      display: "renma suggest-metadata 'skills/demo;echo-danger/skill.md'",
    },
    {
      directory: "demo$dollar",
      display: "renma suggest-metadata 'skills/demo$dollar/skill.md'",
    },
    {
      directory: "demo(test)",
      display: "renma suggest-metadata 'skills/demo(test)/skill.md'",
    },
  ];

  for (const fixtureCase of cases) {
    const directory = path.join(root, "skills", fixtureCase.directory);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "skill.md"),
      `---
name: demo
description: Review demo inputs. Use when demo inputs need review.
---
# Demo
`,
    );
  }

  const result = await scan(root, { failOn: "critical" });
  const text = formatText(result);
  for (const fixtureCase of cases) {
    const skillPath = `skills/${fixtureCase.directory}/skill.md`;
    const command = result.agentSkills.results.find(
      (item) => item.path === skillPath,
    )?.migrationCommand;

    assert.deepEqual(command, {
      command: "renma",
      args: ["suggest-metadata", skillPath],
      display: fixtureCase.display,
    });
    assert.ok(text.includes(fixtureCase.display), skillPath);
  }
});

test("summarizes Agent Skills inside JSON and text scan output", async () => {
  const root = await fixture();
  await writeSkill(root, "valid", canonical("valid"));
  await writeSkill(root, "legacy", "---\nid: skill.legacy\n---\n# Legacy\n");

  const result = await scan(root, { failOn: "critical" });
  const text = formatText(result);

  assert.equal(result.agentSkills.specification, AGENT_SKILLS_SPECIFICATION);
  assert.equal(result.agentSkills.totalSkillCount, 2);
  assert.equal(result.agentSkills.validSkillCount, 1);
  assert.equal(result.agentSkills.legacySkillCount, 1);
  assert.match(
    text,
    /Agent Skills: 1\/2 valid \(1 invalid, 1 legacy, 0 hybrid\)/,
  );
  assert.match(text, /INVALID skills\/legacy\/SKILL\.md/);
  assert.match(text, /renma suggest-metadata skills\/legacy\/SKILL\.md/);
});

test("Agent Skills issues do not change existing scan exit threshold behavior", async () => {
  const root = await fixture();
  await writeSkill(root, "legacy", "---\nid: skill.legacy\n---\n# Legacy\n");

  const result = await capture(() =>
    main(["scan", root, "--format", "json", "--fail-on", "critical"]),
  );
  const report = JSON.parse(result.stdout) as {
    agentSkills: { invalidSkillCount: number };
  };

  assert.equal(report.agentSkills.invalidSkillCount, 1);
  assert.equal(result.code, 0);
});

test("text output distinguishes Agent Skills issues from rule findings", async () => {
  const root = await fixture();
  await writeSkill(root, "legacy", "---\nid: skill.legacy\n---\n# Legacy\n");
  const result = await scan(root, { failOn: "critical" });
  const text = formatText({ ...result, findings: [] });

  assert.match(text, /INVALID skills\/legacy\/SKILL\.md/);
  assert.match(text, /No rule findings\./);
  assert.doesNotMatch(text, /No findings\./);
});

test("repository-wide summary is deterministic", () => {
  const summary = validateAgentSkills([
    skill("skills/zeta/SKILL.md", canonical("zeta")),
    skill("skills/alpha/SKILL.md", canonical("alpha")),
  ]);

  assert.deepEqual(
    summary.results.map((result) => result.path),
    ["skills/alpha/SKILL.md", "skills/zeta/SKILL.md"],
  );
});

function canonical(name: string): string {
  return `---\nname: ${name}\ndescription: Review ${name} inputs. Use when ${name} inputs need review.\n---\n# ${name}\n`;
}

function skill(filePath: string, content: string) {
  return parseDocument({
    path: filePath,
    absolutePath: `/tmp/${filePath}`,
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    content,
  } satisfies Artifact);
}

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-agent-skills-"));
}

async function writeSkill(
  root: string,
  name: string,
  content: string,
): Promise<void> {
  const directory = path.join(root, "skills", name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), content);
}

async function capture(
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
