import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("split-reference writes ordered parts and verifies reconstruction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-split-"));
  const source = path.join(root, "large.md");
  const outputDir = path.join(root, "parts");
  const original = [
    "# Large Reference\n",
    "Step 1: preserve this exact procedure.\n",
    "Step 2: do not summarize this line.\n",
    "Step 3: keep ordered details reachable.\n",
  ].join("");
  await mkdir(outputDir, { recursive: true });
  await writeFile(source, original);

  const { stdout } = await execFileAsync(process.execPath, [
    "scripts/split-reference.mjs",
    source,
    "--out-dir",
    outputDir,
    "--part-size-bytes",
    "80",
  ]);

  const partNames = (await readdir(outputDir)).sort();
  const reconstructed = Buffer.concat(
    await Promise.all(
      partNames.map((partName) => readFile(path.join(outputDir, partName))),
    ),
  ).toString("utf8");

  assert.deepEqual(partNames, ["large.part-001.md", "large.part-002.md"]);
  assert.equal(reconstructed, original);
  assert.match(stdout, /Verified reconstruction byte-for-byte/);
});
