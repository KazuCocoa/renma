import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { bom, formatBomMarkdown } from "../src/commands/bom.js";
import { buildExecutableSurfaceDiff } from "../src/executable-surface-diff.js";
import {
  buildExecutableSurfaceInventory,
  type ExecutableSurfaceInventory,
  zeroExecutableSurfaceInventory,
} from "../src/executable-surface-inventory.js";
import {
  collectHelperCommandEvidence,
  resolveHelperCommandEvidence,
} from "../src/helper-command-evidence.js";
import { parseDocument } from "../src/markdown.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { formatText } from "../src/report.js";
import { scan } from "../src/scanner.js";
import type { Artifact } from "../src/types/artifact.js";

test("inventory composes discovery, invocation, reachability, and policy evidence deterministically", async (t) => {
  const root = await inventoryFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await scan(root);
  const second = await scan(root);
  const inventory = first.executableSurfaceInventory;
  assert.ok(inventory);
  assert.deepEqual(inventory, second.executableSurfaceInventory);
  assert.equal(inventory.schema, "renma.executable-surface-inventory.v1");
  assert.deepEqual(
    inventory.surfaces.map((surface) => surface.path),
    [...inventory.surfaces]
      .map((surface) => surface.path)
      .sort((left, right) => left.localeCompare(right)),
  );

  const direct = requiredSurface(inventory, "skills/demo/scripts/direct.sh");
  assert.equal(direct.scope, "skill-local");
  assert.equal(direct.reachableFromOwningSkill, true);
  assert.equal(direct.reachabilityDepth, 1);
  assert.deepEqual(direct.interpreterHints, ["bash"]);
  assert.equal(direct.shebang, "#!/usr/bin/env bash");
  assert.equal(direct.invocationCount, 1);
  assert.equal(direct.securityPolicy.hasEffectivePolicy, true);
  assert.ok(direct.securityPolicy.policySources.includes("owning_skill"));
  assert.match(direct.fingerprint, /^sha256:[a-f0-9]{64}$/);

  const oneHop = requiredSurface(inventory, "skills/demo/scripts/one-hop.js");
  assert.equal(oneHop.reachableFromOwningSkill, true);
  assert.equal(oneHop.reachabilityDepth, 2);
  assert.deepEqual(oneHop.interpreterHints, ["node"]);
  assert.equal(oneHop.invocationCount, 0);

  const deep = requiredSurface(inventory, "skills/demo/scripts/deep.py");
  assert.equal(deep.reachabilityDepth, 3);
  assert.deepEqual(deep.interpreterHints, ["python"]);

  const unreachable = requiredSurface(
    inventory,
    "skills/demo/scripts/unreachable.mjs",
  );
  assert.equal(unreachable.reachableFromOwningSkill, false);
  assert.equal(unreachable.staticallyReferenced, false);

  const invokedTool = requiredSurface(inventory, "tools/invoked.mjs");
  assert.equal(invokedTool.scope, "repository-tool");
  assert.equal(invokedTool.invocationCount, 3);
  assert.equal(invokedTool.referenceCount, 3);
  assert.deepEqual(invokedTool.interpreterHints, ["node"]);
  assert.equal("owningSkill" in invokedTool, false);

  const unreferencedTool = requiredSurface(inventory, "tools/unreferenced.sh");
  assert.equal(unreferencedTool.scope, "repository-tool");
  assert.equal(unreferencedTool.staticallyReferenced, false);
  assert.deepEqual(unreferencedTool.interpreterHints, ["sh"]);

  const orphan = requiredSurface(inventory, "skills/orphan/scripts/orphan.py");
  assert.equal(orphan.scope, "noncanonical");
  assert.equal(orphan.securityPolicy.hasEffectivePolicy, false);

  const binary = requiredSurface(inventory, "skills/demo/scripts/binary.py");
  assert.equal(binary.contentClassification, "binary");
  assert.equal(binary.shebang, undefined);
  assert.deepEqual(binary.interpreterHints, ["python"]);

  assert.deepEqual(
    inventory.invocations.map((invocation) => invocation.resolution),
    [
      "unscoped",
      "resolved",
      "resolved",
      "resolved",
      "resolved",
      "missing",
      "unsafe",
      "resolved",
      "noncanonical",
    ],
  );
  assert.deepEqual(
    inventory.invocations
      .filter(
        (invocation) => invocation.normalizedTarget === "tools/invoked.mjs",
      )
      .map((invocation) => invocation.occurrenceOrdinal),
    [1, 1, 2],
  );

  const summary = inventory.summary;
  assert.equal(
    summary.totalSurfaces,
    summary.skillLocalSurfaces +
      summary.repositoryToolSurfaces +
      summary.noncanonicalSurfaces,
  );
  assert.equal(
    summary.totalSurfaces,
    summary.textSurfaces + summary.binarySurfaces,
  );
  assert.equal(
    summary.totalSurfaces,
    summary.referencedSurfaces + summary.unreferencedSurfaces,
  );
  assert.equal(
    summary.totalSurfaces,
    summary.invokedSurfaces + summary.uninvokedSurfaces,
  );
  assert.equal(
    summary.totalSurfaces,
    summary.surfacesWithEffectivePolicy +
      summary.surfacesWithoutEffectivePolicy,
  );
  assert.equal(
    summary.skillLocalSurfaces,
    summary.reachableSkillLocalSurfaces + summary.unreachableSkillLocalSurfaces,
  );
  assert.equal(summary.totalInvocations, inventory.invocations.length);

  const text = formatText(first);
  assert.match(text, /Executable Surface Inventory/);
  assert.match(text, /skills\/demo\/scripts\/direct\.sh/);
  const manifest = await bom(root, {}, { omitGeneratedAt: true });
  assert.deepEqual(manifest.executableSurfaceInventory, inventory);
  assert.match(formatBomMarkdown(manifest), /## Executable Surface Inventory/);
});

test("helper resolution preserves exact unavailable states and bounded evidence", () => {
  const source = artifact(
    "skills/demo/SKILL.md",
    [
      "```sh",
      "node tools/parsed.js",
      "node tools/excluded.js",
      "node tools/deep.js",
      "node tools/oversize.js",
      "node tools/unsupported.js",
      "node tools/symlink.js",
      "node tools/unreadable.js",
      "node tools/missing.js",
      "node contexts/demo/scripts/noncanonical.js",
      "node ../tools/unsafe.js",
      "```",
    ].join("\n"),
  );
  const evidence = collectHelperCommandEvidence([parseDocument(source)]);
  const states = new Map([
    ["tools/parsed.js", "parsed"],
    ["tools/excluded.js", "excluded"],
    ["tools/deep.js", "deep"],
    ["tools/oversize.js", "oversize"],
    ["tools/unsupported.js", "unsupported"],
    ["tools/symlink.js", "symlink"],
    ["tools/unreadable.js", "unreadable"],
    ["tools/missing.js", "absent"],
    ["contexts/demo/scripts/noncanonical.js", "parsed"],
  ] as const);
  assert.deepEqual(
    evidence.map(
      (command) => resolveHelperCommandEvidence(command, states).resolution,
    ),
    [
      "resolved",
      "excluded",
      "deep",
      "oversize",
      "unsupported",
      "symlink",
      "unreadable",
      "missing",
      "noncanonical",
      "unsafe",
    ],
  );
  assert.deepEqual(
    evidence.map((command) => command.line),
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

test("inventory creation adds no finding or exit-status policy", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-surface-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeSkill(root, "# Demo\n\nNo helper is required.\n");
  const before = await scan(root);
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(path.join(root, "tools", "unreferenced.mjs"), "// helper\n");
  const after = await scan(root);
  assert.deepEqual(after.findings, before.findings);
  assert.equal(after.exitThreshold, before.exitThreshold);
  assert.equal(
    after.executableSurfaceInventory?.summary.repositoryToolSurfaces,
    1,
  );
});

test("surface diff uses path identity, reason sets, and line-insensitive invocation identity", async (t) => {
  const root = await inventoryFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const fromSnapshot = await collectRepositorySnapshot(root);
  const fromInventory = fromSnapshot.executableSurfaceInventory;

  await writeFile(
    path.join(root, "skills", "demo", "scripts", "direct.sh"),
    "#!/usr/bin/env bash\necho changed\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    skillBody().replace("# Demo", "\n\n# Demo"),
  );
  await writeFile(path.join(root, "tools", "added.py"), "print('ok')\n");
  const toInventory = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const diff = buildExecutableSurfaceDiff(fromInventory, toInventory);

  assert.ok(diff.addedSurfacePaths.includes("tools/added.py"));
  assert.deepEqual(
    diff.changedSurfaces.find(
      (surface) => surface.path === "skills/demo/scripts/direct.sh",
    )?.reasons,
    ["content"],
  );
  assert.equal(diff.invocationResolutionChanges.length, 0);
});

test("zero inventory remains a valid deterministic composed projection", () => {
  const inventory = zeroExecutableSurfaceInventory();
  assert.equal(inventory.summary.totalSurfaces, 0);
  assert.equal(inventory.summary.totalInvocations, 0);
  assert.deepEqual(inventory.summary.interpreterHints, []);
  assert.deepEqual(
    buildExecutableSurfaceInventory({
      artifacts: [],
      documents: [],
      repositoryPaths: new Set(),
      repositoryPathStates: new Map(),
      skillParents: new Map(),
      securityPolicies: [],
    }),
    inventory,
  );
});

async function inventoryFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-surfaces-"));
  await mkdir(path.join(root, "skills", "demo", "references"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", "demo", "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", "orphan", "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(root, "contexts", "demo", "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(path.join(root, "skills", "demo", "SKILL.md"), skillBody());
  await writeFile(
    path.join(root, "skills", "demo", "references", "index.md"),
    [
      "# Index",
      "",
      "Use scripts/one-hop.js and read references/detail.md.",
      "",
      "```sh",
      "node tools/invoked.mjs",
      "```",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "skills", "demo", "references", "detail.md"),
    "# Detail\n\nUse scripts/deep.py.\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "direct.sh"),
    "#!/usr/bin/env bash\necho direct\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "one-hop.js"),
    "console.log('one hop');\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "deep.py"),
    "print('deep')\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "unreachable.mjs"),
    "console.log('unreachable');\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "binary.py"),
    Buffer.from([0, 1, 2, 3]),
  );
  await writeFile(
    path.join(root, "skills", "orphan", "scripts", "orphan.py"),
    "print('orphan')\n",
  );
  await writeFile(
    path.join(root, "contexts", "demo", "scripts", "bad.py"),
    "print('noncanonical')\n",
  );
  await writeFile(
    path.join(root, "tools", "invoked.mjs"),
    "console.log('tool');\n",
  );
  await writeFile(
    path.join(root, "tools", "unreferenced.sh"),
    "echo unreferenced\n",
  );
  await writeFile(
    path.join(root, "README.md"),
    "```sh\npython scripts/root.py\n```\n",
  );
  return root;
}

function skillBody(): string {
  return `---
name: demo
description: Exercise local helpers. Use when executable inventory evidence needs validation.
metadata:
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
---
# Demo

Read references/index.md and run scripts/direct.sh.

\`\`\`sh
bash scripts/direct.sh
node tools/invoked.mjs
node tools/invoked.mjs
node tools/missing.mjs
node ../tools/unsafe.mjs
python skills/orphan/scripts/orphan.py
python contexts/demo/scripts/bad.py
\`\`\`

## Required Inputs

A repository.

## Completion Criteria

Complete after verification.
`;
}

async function writeSkill(root: string, body: string): Promise<void> {
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    `---
name: demo
description: Exercise a local workflow. Use when inventory policy boundaries need validation.
---
${body}`,
  );
}

function requiredSurface(
  inventory: ExecutableSurfaceInventory,
  surfacePath: string,
) {
  const surface = inventory.surfaces.find(
    (candidate) => candidate.path === surfacePath,
  );
  assert.ok(surface, surfacePath);
  return surface;
}

function artifact(sourcePath: string, content: string): Artifact {
  return {
    path: sourcePath,
    absolutePath: `/${sourcePath}`,
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentHash: "sha256:test",
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
