import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { formatOwnershipMarkdown, ownership } from "../src/commands/ownership.js";

test("ownership report counts all assets owned", async () => {
  const root = await fixture();
  await writeSkill(root, "alpha", { owner: "platform", tags: ["core"] });
  await writeSkill(root, "beta", { owner: "docs", status: "stable" });

  const report = await ownership(root);

  assert.equal(report.scannedFileCount, 2);
  assert.equal(report.totalAssets, 2);
  assert.equal(report.ownedAssets, 2);
  assert.equal(report.unownedAssets, 0);
  assert.equal(report.coveragePercent, 100);
  assert.deepEqual(report.unownedAssetList, []);
  assert.deepEqual(report.byKind, [
    {
      kind: "skill",
      totalAssets: 2,
      ownedAssets: 2,
      unownedAssets: 0,
      coveragePercent: 100,
    },
  ]);
});

test("ownership report lists mixed owned and unowned assets", async () => {
  const root = await fixture();
  await writeSkill(root, "owned", { owner: "platform", status: "stable" });
  await writeSkill(root, "unowned", {
    status: "experimental",
    tags: ["needs-owner", "mobile"],
  });

  const report = await ownership(root);

  assert.equal(report.totalAssets, 2);
  assert.equal(report.ownedAssets, 1);
  assert.equal(report.unownedAssets, 1);
  assert.equal(report.coveragePercent, 50);
  assert.deepEqual(report.unownedAssetList, [
    {
      id: "unowned",
      kind: "skill",
      sourcePath: "skills/unowned/SKILL.md",
      status: "experimental",
      tags: ["needs-owner", "mobile"],
    },
  ]);
});

test("ownership report uses stable deterministic ordering", async () => {
  const root = await fixture();
  await writeSkill(root, "zeta", {});
  await writeSkill(root, "alpha", {});
  await writeContext(root, "testing", "boundary", {});

  const report = await ownership(root);

  assert.deepEqual(
    report.unownedAssetList.map((asset) => [
      asset.kind,
      asset.sourcePath,
      asset.id,
    ]),
    [
      ["context", "contexts/testing/boundary.md", "testing.boundary"],
      ["skill", "skills/alpha/SKILL.md", "alpha"],
      ["skill", "skills/zeta/SKILL.md", "zeta"],
    ],
  );
  assert.deepEqual(
    report.byKind.map((summary) => summary.kind),
    ["context", "skill"],
  );
});

test("ownership markdown output includes summary", async () => {
  const root = await fixture();
  await writeSkill(root, "owned", { owner: "platform" });
  await writeSkill(root, "unowned", { tags: ["todo"] });

  const markdown = formatOwnershipMarkdown(await ownership(root));

  assert.match(markdown, /^# Ownership Coverage/);
  assert.match(markdown, /- Total assets: 2/);
  assert.match(markdown, /- Owned assets: 1/);
  assert.match(markdown, /- Unowned assets: 1/);
  assert.match(markdown, /- Coverage: 50%/);
  assert.match(markdown, /\| skill \| 2 \| 1 \| 1 \| 50% \|/);
  assert.match(
    markdown,
    /\| unowned \| skill \| skills\/unowned\/SKILL\.md \| {2}\| todo \|/,
  );
});

test("ownership CLI rejects unsupported format", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", { owner: "platform" });

  const result = await withCapturedConsole(() =>
    main(["ownership", root, "--format", "text"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /--format must be either json or markdown\./);
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-ownership-"));
}

async function writeSkill(
  root: string,
  id: string,
  metadata: { owner?: string; status?: string; tags?: string[] },
): Promise<void> {
  await mkdir(path.join(root, "skills", id), { recursive: true });
  await writeFile(
    path.join(root, "skills", id, "SKILL.md"),
    markdown({
      id,
      ...metadata,
      title: `# ${id}`,
    }),
  );
}

async function writeContext(
  root: string,
  group: string,
  id: string,
  metadata: { owner?: string; status?: string; tags?: string[] },
): Promise<void> {
  await mkdir(path.join(root, "contexts", group), { recursive: true });
  await writeFile(
    path.join(root, "contexts", group, `${id}.md`),
    markdown({
      id: `${group}.${id}`,
      ...metadata,
      title: `# ${id}`,
    }),
  );
}

function markdown(metadata: {
  id: string;
  owner?: string;
  status?: string;
  tags?: string[];
  title: string;
}): string {
  return [
    "---",
    `id: ${metadata.id}`,
    ...(metadata.owner ? [`owner: ${metadata.owner}`] : []),
    ...(metadata.status ? [`status: ${metadata.status}`] : []),
    ...(metadata.tags ? [`tags: ${metadata.tags.join(", ")}`] : []),
    "---",
    metadata.title,
    "Use for ownership report tests.",
    "",
  ].join("\n");
}

async function withCapturedConsole(
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
