import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { formatGraphMarkdown, graph } from "../src/commands/graph.js";

test("graph JSON includes nodes and metadata dependency edges", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    tags: ["mobile"],
    requiresContext: [
      "testing.boundary",
      "contexts/testing/checklist.md",
      "missing.asset",
    ],
  });
  await writeContext(root, "testing", "boundary", { owner: "qa" });
  await writeContext(root, "testing", "checklist", { owner: "qa" });

  const report = await graph(root);

  assert.equal(report.nodeCount, 3);
  assert.equal(report.edgeCount, 3);
  assert.deepEqual(
    report.nodes.map((node) => [node.id, node.kind, node.sourcePath]),
    [
      ["testing.boundary", "context", "contexts/testing/boundary.md"],
      ["testing.checklist", "context", "contexts/testing/checklist.md"],
      ["demo", "skill", "skills/demo/SKILL.md"],
    ],
  );
  assert.deepEqual(
    report.edges.map((edge) => [
      edge.from,
      edge.kind,
      edge.to,
      edge.resolved,
      edge.targetId,
      edge.targetPath,
    ]),
    [
      [
        "demo",
        "requires",
        "contexts/testing/checklist.md",
        true,
        "testing.checklist",
        "contexts/testing/checklist.md",
      ],
      ["demo", "requires", "missing.asset", false, undefined, undefined],
      [
        "demo",
        "requires",
        "testing.boundary",
        true,
        "testing.boundary",
        "contexts/testing/boundary.md",
      ],
    ],
  );
});

test("graph resolves requires_context by asset id", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", { requiresContext: ["testing.boundary"] });
  await writeContext(root, "testing", "boundary", {});

  const edge = (await graph(root)).edges.at(0);

  assert.equal(edge?.resolved, true);
  assert.equal(edge?.targetId, "testing.boundary");
  assert.equal(edge?.targetKind, "context");
  assert.equal(edge?.targetPath, "contexts/testing/boundary.md");
});

test("graph resolves dependency edge by repository-relative path", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    requiresContext: ["./contexts/testing/boundary.md"],
  });
  await writeContext(root, "testing", "boundary", {});

  const edge = (await graph(root)).edges.at(0);

  assert.equal(edge?.resolved, true);
  assert.equal(edge?.targetId, "testing.boundary");
  assert.equal(edge?.targetPath, "contexts/testing/boundary.md");
});

test("graph keeps unknown dependencies as unresolved edges", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", { requiresContext: ["missing.asset"] });

  const edge = (await graph(root)).edges.at(0);

  assert.deepEqual(edge, {
    from: "demo",
    to: "missing.asset",
    kind: "requires",
    sourcePath: "skills/demo/SKILL.md",
    resolved: false,
  });
});

test("graph markdown output includes node and edge tables", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    requiresContext: ["testing.boundary"],
  });
  await writeContext(root, "testing", "boundary", { owner: "qa" });

  const markdown = formatGraphMarkdown(await graph(root));

  assert.match(markdown, /^# Renma Graph/);
  assert.match(markdown, /## Nodes/);
  assert.match(
    markdown,
    /\| ID \| Kind \| Source \| Owner \| Status \| Tags \|/,
  );
  assert.match(
    markdown,
    /\| demo \| skill \| skills\/demo\/SKILL\.md \| platform \| {2}\| {2}\|/,
  );
  assert.match(markdown, /## Edges/);
  assert.match(markdown, /\| From \| Kind \| To \| Resolved \| Target \|/);
  assert.match(
    markdown,
    /\| demo \| requires \| testing\.boundary \| yes \| testing\.boundary context contexts\/testing\/boundary\.md \|/,
  );
});

test("graph report uses deterministic ordering of nodes and edges", async () => {
  const root = await fixture();
  await writeSkill(root, "zeta", { requiresContext: ["testing.zeta"] });
  await writeSkill(root, "alpha", { requiresContext: ["testing.alpha"] });
  await writeContext(root, "testing", "zeta", {});
  await writeContext(root, "testing", "alpha", {});

  const report = await graph(root);

  assert.deepEqual(
    report.nodes.map((node) => [node.kind, node.sourcePath, node.id]),
    [
      ["context", "contexts/testing/alpha.md", "testing.alpha"],
      ["context", "contexts/testing/zeta.md", "testing.zeta"],
      ["skill", "skills/alpha/SKILL.md", "alpha"],
      ["skill", "skills/zeta/SKILL.md", "zeta"],
    ],
  );
  assert.deepEqual(
    report.edges.map((edge) => [edge.from, edge.kind, edge.to]),
    [
      ["alpha", "requires", "testing.alpha"],
      ["zeta", "requires", "testing.zeta"],
    ],
  );
});

test("graph CLI rejects unsupported format", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {});

  const result = await withCapturedConsole(() =>
    main(["graph", root, "--format", "text"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /--format must be either json or markdown\./);
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-graph-"));
}

async function writeSkill(
  root: string,
  id: string,
  metadata: {
    owner?: string;
    status?: string;
    tags?: string[];
    requiresContext?: string[];
  },
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
  requiresContext?: string[];
  title: string;
}): string {
  return [
    "---",
    `id: ${metadata.id}`,
    ...(metadata.owner ? [`owner: ${metadata.owner}`] : []),
    ...(metadata.status ? [`status: ${metadata.status}`] : []),
    ...(metadata.tags ? [`tags: ${metadata.tags.join(", ")}`] : []),
    ...(metadata.requiresContext
      ? [`requires_context: ${metadata.requiresContext.join(", ")}`]
      : []),
    "---",
    metadata.title,
    "Use for graph report tests.",
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
