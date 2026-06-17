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

  assert.deepEqual(partNames, ["large-01.md", "large-02.md"]);
  assert.equal(reconstructed, original);
  assert.match(stdout, /Verified reconstruction byte-for-byte/);
});

test("suggest-semantic-split builds a Codex prompt that asks for inferred categories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-semantic-split-"));
  const skillDir = path.join(root, "skills", "setup");
  const referencesDir = path.join(skillDir, "references");
  await mkdir(referencesDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---\n",
      'name: "setup"\n',
      "---\n",
      "# Setup\n",
      "Route environment setup requests to the relevant reference.\n",
    ].join(""),
  );
  await writeFile(
    path.join(referencesDir, "index.md"),
    "# References\n\n- Android setup\n",
  );

  const source = path.join(referencesDir, "environment-setup-android.md");
  await writeFile(
    source,
    [
      "# Android setup\n",
      "\n",
      "macOS/Linux users should export ANDROID_HOME from a shell.\n",
      "\n",
      "Windows users should set persistent environment variables in PowerShell.\n",
    ].join(""),
  );

  const { stdout: prompt } = await execFileAsync(process.execPath, [
    "scripts/suggest-semantic-split.mjs",
    source,
  ]);

  assert.match(prompt, /# Codex Task: Suggest Semantic Reference Split/);
  assert.match(prompt, /Infer the best split direction as a human maintainer/);
  assert.match(prompt, /Name files by meaning, not by part number/);
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /L0003: macOS\/Linux users/);
  assert.match(prompt, /Route environment setup/);

  const { stdout } = await execFileAsync(process.execPath, [
    "scripts/suggest-semantic-split.mjs",
    source,
    "--format",
    "json",
  ]);
  const contextPackage = JSON.parse(stdout) as {
    mutatesFiles: boolean;
    source: {
      numberedText: string;
    };
    context: {
      skill: {
        text: string;
      };
      siblingFiles: Array<{
        path: string;
        preview: string;
      }>;
    };
  };

  assert.equal(contextPackage.mutatesFiles, false);
  assert.match(contextPackage.source.numberedText, /L0003: macOS\/Linux users/);
  assert.match(contextPackage.context.skill.text, /Route environment setup/);
  assert.ok(
    contextPackage.context.siblingFiles.some((file) =>
      file.path.endsWith("references/index.md"),
    ),
  );
});
