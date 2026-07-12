import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bom } from "../src/commands/bom.js";
import { catalog } from "../src/commands/catalog.js";
import { runScaffoldCommand } from "../src/commands/scaffold.js";
import { scan } from "../src/scanner.js";

test("scripts and opaque assets are first-class and binary-safe under both Skill roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-kinds-"));
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
  for (const skillRoot of ["skills/demo", ".agents/skills/other"]) {
    await mkdir(path.join(root, skillRoot, "scripts"), { recursive: true });
    await mkdir(path.join(root, skillRoot, "assets"), { recursive: true });
    const name = path.basename(skillRoot);
    await writeFile(
      path.join(root, skillRoot, "SKILL.md"),
      `---\nname: ${name}\ndescription: Run a local helper and use its image. Use when testing support inventory.\n---\n# ${name}\n\nRun scripts/run.mjs. Use assets/pixel.png as output material.\n\n## Required Inputs\nA fixture.\n\n## Completion Criteria\nComplete after verification.\n\n## Verification\nVerify the helper output.\n\n## Do Not Use For\nDo not use for unrelated work.\n`,
    );
    await writeFile(
      path.join(root, skillRoot, "scripts", "run.mjs"),
      "console.log('ok');\n",
    );
    await writeFile(path.join(root, skillRoot, "assets", "pixel.png"), binary);
  }

  const result = await catalog(root);
  const scripts = result.catalog.assets.filter(
    (asset) => asset.kind === "script",
  );
  const assets = result.catalog.assets.filter(
    (asset) => asset.kind === "asset",
  );
  assert.equal(scripts.length, 2);
  assert.equal(assets.length, 2);
  for (const asset of assets) {
    assert.equal(asset.contentClassification, "binary");
    assert.equal(asset.markdownParserEligible, false);
    assert.equal(asset.sizeBytes, binary.length);
    assert.equal(
      asset.contentHash,
      `sha256:${createHash("sha256").update(binary).digest("hex")}`,
    );
  }

  const manifest = await bom(root, {}, { omitGeneratedAt: true });
  const bomAsset = manifest.assets.find((asset) => asset.kind === "asset");
  assert.equal(bomAsset?.contentClassification, "binary");
  assert.equal(bomAsset?.markdownParserEligible, false);
  assert.doesNotMatch(JSON.stringify(manifest.diagnostics), /�|PNG/);
});

test("support reachability accepts direct and one-hop paths and reports deep and missing paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-depth-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(path.join(skill, "references"), { recursive: true });
  await mkdir(path.join(skill, "scripts"), { recursive: true });
  await mkdir(path.join(skill, "assets"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---\nname: demo\ndescription: Review local resources. Use when static support reachability needs validation.\n---\n# Demo\n\nRead references/index.md, run scripts/run.mjs, and use assets/logo.txt. Missing: assets/missing.png.\n\n## Required Inputs\nA repository.\n\n## Completion Criteria\nComplete after verification.\n\n## Verification\nVerify every path.\n\n## Do Not Use For\nDo not use for runtime selection.\n`,
  );
  await writeFile(
    path.join(skill, "references", "index.md"),
    "# Index\n\nRead references/detail.md when detailed checks apply.\n",
  );
  await writeFile(
    path.join(skill, "references", "detail.md"),
    "# Detail\n\nRead references/deep.md for the final note.\n",
  );
  await writeFile(path.join(skill, "references", "deep.md"), "# Deep\n");
  await writeFile(path.join(skill, "scripts", "run.mjs"), "// helper\n");
  await writeFile(path.join(skill, "assets", "logo.txt"), "logo\n");

  const result = await scan(root);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.id.startsWith("SUPPORT-UNREACHABLE-") &&
        /(?:index|detail|run\.mjs|logo\.txt)$/.test(finding.evidence.path),
    ),
    false,
  );
  const deep = result.findings.find(
    (finding) => finding.id === "SUPPORT-DEEP-REFERENCE-CHAIN",
  );
  assert.equal(deep?.evidence.path, "skills/demo/references/deep.md");
  assert.equal(deep?.details?.measured, 3);
  const missing = result.findings.find(
    (finding) => finding.id === "SUPPORT-MISSING-PATH",
  );
  assert.equal(missing?.details?.target, "skills/demo/assets/missing.png");
});

test("missing local paths are reported even when no support resource exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-missing-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(skill, { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---
name: demo
description: Review local resources. Use when a missing Skill resource needs validation.
---
# Demo

Read references/missing.md when the validation requires it.
`,
  );

  const result = await scan(root);
  const missing = result.findings.find(
    (finding) => finding.id === "SUPPORT-MISSING-PATH",
  );
  assert.equal(missing?.details?.target, "skills/demo/references/missing.md");
});

test("scaffold creates only selected resource directories", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-scaffold-resources-"),
  );
  const target = path.join(root, "skills", "demo", "SKILL.md");
  await runScaffoldCommand({
    kind: "skill",
    targetPath: target,
    format: "file",
    owner: "qa-platform",
    resources: ["references", "assets"],
  });
  await access(path.join(root, "skills", "demo", "references"));
  await access(path.join(root, "skills", "demo", "assets"));
  await assert.rejects(access(path.join(root, "skills", "demo", "scripts")));
});
