import assert from "node:assert/strict";
import test from "node:test";

import {
  collectHelperCommandEvidence,
  resolveHelperCommandEvidence,
} from "../src/helper-command-evidence.js";
import { parseDocument } from "../src/markdown.js";
import type { Artifact } from "../src/types/artifact.js";

const command = "node tools/check.mjs";

test("recognizes bounded inline Run helper invocations in eligible paragraphs", () => {
  const fixtures = [
    {
      name: "top-level cue",
      source: `Run \`${command}\`.`,
      expectedLine: 1,
    },
    {
      name: "colon cue",
      source: `Run: \`${command}\`.`,
      expectedLine: 1,
    },
    {
      name: "ordered-list paragraph",
      source: `1. Run \`${command}\`; inspect the summary.`,
      expectedLine: 1,
    },
    {
      name: "unordered-list paragraph",
      source: `- Run \`${command}\` before proceeding.`,
      expectedLine: 1,
    },
    {
      name: "nested-list paragraph",
      source: `- Outer\n  - Run \`${command}\`.`,
      expectedLine: 2,
    },
    {
      name: "soft-wrapped cue",
      source: `Run\n\`${command}\`; then inspect the output.`,
      expectedLine: 2,
    },
    {
      name: "strong visible cue",
      source: `**Run** \`${command}\`.`,
      expectedLine: 1,
    },
    {
      name: "emphasized visible cue",
      source: `*Run* \`${command}\`.`,
      expectedLine: 1,
    },
    {
      name: "comment-separated visible cue",
      source: `Run <!-- explanation --> \`${command}\`.`,
      expectedLine: 1,
    },
  ] as const;

  for (const fixture of fixtures) {
    const evidence = collect(fixture.source);
    assert.equal(evidence.length, 1, fixture.name);
    assert.equal(evidence[0]?.snippet, command, fixture.name);
    assert.equal(evidence[0]?.line, fixture.expectedLine, fixture.name);
    assert.equal(evidence[0]?.rawTarget, "tools/check.mjs", fixture.name);
  }
});

test("requires a structurally textual inline Run cue", () => {
  const rejected = [
    `[Run](https://example.com) \`${command}\`.`,
    `![Run](run.png) \`${command}\`.`,
    `**[Run](https://example.com)** \`${command}\`.`,
    `Run ![](separator.png) \`${command}\`.`,
    `Run <span></span> \`${command}\`.`,
  ];

  for (const source of rejected) {
    assert.equal(collect(source).length, 0, source);
  }
});

test("recognizes only the primary inline command span after the exact cue", () => {
  const evidence = collect(
    "Run `node tools/check.mjs`; pass `--local` only when requested.",
  );

  assert.deepEqual(
    evidence.map(({ line, snippet, launcher, rawTarget }) => ({
      line,
      snippet,
      launcher,
      rawTarget,
    })),
    [
      {
        line: 1,
        snippet: "node tools/check.mjs",
        launcher: "node",
        rawTarget: "tools/check.mjs",
      },
    ],
  );
  assert.equal(
    collect("Run `/status` and\n`node tools/smoke.mjs`; inspect the session.")
      .length,
    0,
  );
});

test("reuses the established launcher, extension, and options grammar", () => {
  const recognized = [
    "node tools/check.mjs",
    "node tools/check.js",
    "node tools/check.ts",
    "node tools/check.mts",
    "node tools/check.cts",
    "bash scripts/check.sh",
    "bash scripts/check.bash",
    "python scripts/check.py",
    "python3 scripts/check.py",
    "node --no-warnings tools/check.mjs",
    "pwsh -File tools/check.ps1",
    "pwsh.exe -File tools\\check.ps1",
    "powershell -File scripts/check.ps1",
    'powershell.exe -File "tools/check.ps1"',
    "cmd /c tools\\check.cmd",
    'cmd.exe /c "tools/check.bat"',
  ];
  const rejected = [
    "npm test",
    "npx appium",
    "appium driver doctor xcuitest",
    "tools/check.mjs",
    "$ node tools/check.mjs",
    "node -e \"console.log('test')\"",
    "node tools/check.txt",
    "pwsh -Command tools/check.ps1",
    "pwsh -File tools/$HELPER.ps1",
    "powershell tools/check.ps1",
    "cmd tools/check.cmd",
    "cmd /k tools/check.cmd",
    "cmd /c tools/%HELPER%.cmd",
    "node tools/check.ps1",
    "pwsh -File tools/check.cmd",
    "cmd /c tools/check.ps1",
  ];

  for (const snippet of recognized) {
    assert.equal(collect(`Run \`${snippet}\`.`).length, 1, snippet);
  }
  for (const snippet of rejected) {
    assert.equal(collect(`Run \`${snippet}\`.`).length, 0, snippet);
  }
});

test("Windows helper launchers preserve exact evidence and normalize separators for resolution", () => {
  const evidence = collect(
    [
      "```powershell",
      "pwsh -File tools\\check.ps1",
      "powershell.exe -File scripts\\local.ps1",
      "cmd /c tools\\check.cmd",
      'cmd.exe /c "tools\\check.bat"',
      "```",
    ].join("\n"),
  );

  assert.deepEqual(
    evidence.map(({ launcher, rawTarget, pathResolution }) => ({
      launcher,
      rawTarget,
      pathResolution,
    })),
    [
      {
        launcher: "pwsh",
        rawTarget: "tools\\check.ps1",
        pathResolution: {
          kind: "candidate",
          path: "tools/check.ps1",
          source: "repository-root",
        },
      },
      {
        launcher: "powershell.exe",
        rawTarget: "scripts\\local.ps1",
        pathResolution: {
          kind: "candidate",
          path: "skills/demo/scripts/local.ps1",
          source: "skill-relative",
        },
      },
      {
        launcher: "cmd",
        rawTarget: "tools\\check.cmd",
        pathResolution: {
          kind: "candidate",
          path: "tools/check.cmd",
          source: "repository-root",
        },
      },
      {
        launcher: "cmd.exe",
        rawTarget: "tools\\check.bat",
        pathResolution: {
          kind: "candidate",
          path: "tools/check.bat",
          source: "repository-root",
        },
      },
    ],
  );
});

test("rejects prose, structurally ineligible inline code, and hidden examples", () => {
  const fixtures = [
    `run \`${command}\`.`,
    `RUN \`${command}\`.`,
    `Rerun \`${command}\`.`,
    `Then run \`${command}\`.`,
    `You can run \`${command}\`.`,
    `Before you run \`${command}\`, verify the configuration.`,
    `Do not run \`${command}\`.`,
    `To run the check, use \`${command}\`.`,
    `Try \`${command}\`.`,
    `Example: \`${command}\`.`,
    `Run the command \`${command}\`.`,
    `Run this: \`${command}\`.`,
    `Use \`${command}\`.`,
    `# Run \`${command}\``,
    `> Run \`${command}\`.`,
    `Run [\`${command}\`](https://example.com).`,
    `Run **\`${command}\`**.`,
    `Run \`node\n tools/check.mjs\`.`,
    `<!-- Run \`${command}\`. -->`,
  ];

  for (const source of fixtures) {
    assert.equal(collect(source).length, 0, source);
  }
});

test("does not inspect frontmatter or Markdown-ineligible artifacts", () => {
  const frontmatter = [
    "---",
    "name: demo",
    `description: Run \`${command}\`.`,
    "---",
    "# Demo",
  ].join("\n");
  assert.equal(collect(frontmatter).length, 0);

  const ineligible = parseDocument({
    ...artifact(`Run \`${command}\`.`),
    path: "tools/readme.txt",
    kind: "unknown",
    markdownParserEligible: false,
  });
  assert.equal(collectHelperCommandEvidence([ineligible]).length, 0);
});

test("keeps fenced evidence stable and orders mixed occurrences deterministically", () => {
  const fenced = collect("```sh\nnode tools/check.mjs\n```");
  assert.deepEqual(fenced, [
    {
      sourcePath: "skills/demo/SKILL.md",
      line: 2,
      snippet: "node tools/check.mjs",
      launcher: "node",
      rawTarget: "tools/check.mjs",
      sourceSkillDirectory: "skills/demo",
      pathResolution: {
        kind: "candidate",
        path: "tools/check.mjs",
        source: "repository-root",
      },
    },
  ]);

  const mixed = collect(
    ["Run `python tools/z.py`.", "", "```sh", command, "```"].join("\n"),
  );
  assert.deepEqual(
    mixed.map(({ line, snippet }) => ({ line, snippet })),
    [
      { line: 1, snippet: "python tools/z.py" },
      { line: 4, snippet: command },
    ],
  );
  const deterministicSource = [
    "**Run** `node tools/a.mjs`.",
    "",
    "```sh",
    "node tools/b.mjs",
    "```",
  ].join("\n");
  assert.deepEqual(collect(deterministicSource), collect(deterministicSource));
});

test("recognized inline targets retain exact resolution states", () => {
  const evidence = collect(
    [
      "Run `node tools/check.mjs`.",
      "",
      "Run `node ../tools/unsafe.mjs`.",
      "",
      "Run `python scripts/local.py`.",
    ].join("\n"),
  );
  const states = new Map([["tools/check.mjs", "absent"]] as const);

  assert.deepEqual(
    evidence.map((row) => resolveHelperCommandEvidence(row, states).resolution),
    ["missing", "unsafe", "missing"],
  );
  assert.equal(evidence[2]?.pathResolution.kind, "candidate");
  assert.equal(
    evidence[2]?.pathResolution.kind === "candidate"
      ? evidence[2].pathResolution.path
      : undefined,
    "skills/demo/scripts/local.py",
  );
});

function collect(source: string) {
  return collectHelperCommandEvidence([parseDocument(artifact(source))]);
}

function artifact(content: string): Artifact {
  return {
    path: "skills/demo/SKILL.md",
    absolutePath: "/tmp/skills/demo/SKILL.md",
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentHash: "sha256:test",
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
