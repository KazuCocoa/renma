import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  helperScriptPath,
  resolveHelperScriptPath,
} from "../src/helper-command-evidence.js";
import { parseDocument } from "../src/markdown.js";
import type { Catalog } from "../src/model.js";
import { collectRepositoryPaths } from "../src/repository-paths.js";
import type { Artifact } from "../src/types/artifact.js";

test("collectRepositoryPaths normalizes repo paths without resolving traversal outside the snapshot root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-paths-"));
  const outsideRoot = path.join(
    path.dirname(root),
    `outside-${path.basename(root)}`,
  );
  const absoluteOutsideScript = path.join(
    outsideRoot,
    "scripts",
    "absolute.sh",
  );

  await writeRepositoryFile(root, "tools/testing/scripts/setup.sh", "");
  await writeRepositoryFile(root, "contexts/shared.md", "# Shared\n");
  await writeFileAt(path.join(outsideRoot, "scripts", "setup.sh"), "");
  await writeFileAt(path.join(outsideRoot, "context.md"), "# Outside\n");
  await writeFileAt(absoluteOutsideScript, "");

  const artifact = artifactFixture(
    root,
    "skills\\testing\\SKILL.md",
    [
      "# Skill",
      "",
      "```bash",
      "bash ./tools/testing/scripts/setup.sh",
      "bash ../outside/scripts/setup.sh",
      `bash ${absoluteOutsideScript}`,
      "```",
      "",
    ].join("\n"),
  );
  const catalog: Catalog = {
    entries: [],
    assets: [],
    dependencies: [
      {
        from: "skill.testing",
        to: "contexts/shared.md",
        kind: "requires",
        sourcePath: "skills/testing/SKILL.md",
      },
      {
        from: "skill.testing",
        to: "contexts\\shared.md",
        kind: "optional",
        sourcePath: "skills/testing/SKILL.md",
      },
      {
        from: "skill.testing",
        to: "../outside/context.md",
        kind: "optional",
        sourcePath: "skills/testing/SKILL.md",
      },
    ],
  };

  const paths = await collectRepositoryPaths(
    root,
    [artifact],
    [parseDocument(artifact)],
    catalog,
  );

  assert.equal(paths.has("skills/testing/SKILL.md"), true);
  assert.equal(paths.has("tools/testing/scripts/setup.sh"), true);
  assert.equal(paths.has("contexts/shared.md"), true);
  assert.equal(paths.has("../outside/scripts/setup.sh"), false);
  assert.equal(paths.has("../outside/context.md"), false);
  assert.equal(paths.has(absoluteOutsideScript), false);
});

test("helper script extraction forwards traversal and selects only the primary target", () => {
  for (const candidate of [
    "../tools/helper.mjs",
    "../scripts/helper.mjs",
    "./../tools/helper.mjs",
    "./../scripts/helper.mjs",
    "tools/../../scripts/helper.mjs",
    "scripts/../../tools/helper.mjs",
  ]) {
    assert.equal(helperScriptPath(`node ${candidate}`), candidate);
    assert.deepEqual(
      resolveHelperScriptPath("skills/testing/demo/SKILL.md", candidate),
      { kind: "unsafe", path: candidate },
    );
  }

  for (const candidate of [
    "scripts/helper.mjs",
    "./scripts/helper.mjs",
    "tools/helper.mjs",
    "./tools/helper.mjs",
  ]) {
    assert.equal(helperScriptPath(`node ${candidate}`), candidate);
  }

  assert.equal(helperScriptPath("node /tmp/tools/helper.mjs"), undefined);
  assert.equal(
    helperScriptPath("node /tmp/scripts/helper.mjs"),
    "/tmp/scripts/helper.mjs",
  );
  assert.deepEqual(
    resolveHelperScriptPath(
      "skills/testing/demo/SKILL.md",
      "/tmp/scripts/helper.mjs",
    ),
    { kind: "unsafe", path: "/tmp/scripts/helper.mjs" },
  );
  assert.equal(
    helperScriptPath("node runner.mjs ../tools/helper.mjs"),
    "runner.mjs",
  );
  assert.equal(
    helperScriptPath("node runner.mjs --config tools/a.mjs"),
    "runner.mjs",
  );
});

test("Windows helper extraction uses explicit launcher grammars", () => {
  assert.equal(
    helperScriptPath("pwsh -FILE tools\\Entry.PS1"),
    "tools\\Entry.PS1",
  );
  assert.equal(
    helperScriptPath('PowerShell.EXE -fIlE "scripts\\Check.Ps1"'),
    "scripts\\Check.Ps1",
  );
  assert.equal(
    helperScriptPath("CMD /C tools\\Worker.CMD"),
    "tools\\Worker.CMD",
  );
  assert.equal(
    helperScriptPath('CMD.EXE /c "tools\\Runner.BAT"'),
    "tools\\Runner.BAT",
  );
  assert.deepEqual(
    resolveHelperScriptPath(
      "skills/testing/demo/SKILL.md",
      helperScriptPath("pwsh -FILE tools\\Entry.PS1")!,
    ),
    {
      kind: "candidate",
      path: "tools/Entry.PS1",
      source: "repository-root",
    },
  );
  assert.equal(helperScriptPath("pwsh -Command tools/check.ps1"), undefined);
  assert.equal(helperScriptPath("cmd /k tools/check.cmd"), undefined);
  assert.equal(helperScriptPath("cmd /c %COMMAND%"), undefined);
  assert.equal(helperScriptPath("pwsh -File tools/$HELPER.ps1"), undefined);
});

function artifactFixture(
  root: string,
  repositoryPath: string,
  content: string,
): Artifact {
  return {
    path: repositoryPath,
    absolutePath: path.join(root, repositoryPath.replace(/\\/g, path.sep)),
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

async function writeRepositoryFile(
  root: string,
  repositoryPath: string,
  content: string,
): Promise<void> {
  await writeFileAt(path.join(root, repositoryPath), content);
}

async function writeFileAt(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
