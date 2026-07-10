import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseDocument } from "../src/markdown.js";
import type { Catalog } from "../src/model.js";
import { collectRepositoryPaths } from "../src/repository-paths.js";
import type { Artifact } from "../src/types.js";

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
