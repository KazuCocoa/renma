import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import {
  formatGraphMarkdown,
  formatGraphMermaid,
  graph,
} from "../src/commands/graph.js";

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

  const markdown = formatGraphMarkdown(await graph(root), "full");

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

test("graph mermaid output includes nodes and resolved edges", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "stable",
    requiresContext: ["testing.boundary"],
  });
  await writeContext(root, "testing", "boundary", { owner: "qa" });

  const mermaid = formatGraphMermaid(await graph(root), "full");

  assert.equal(
    mermaid,
    [
      "graph TD",
      '  node_0["context: testing.boundary"]',
      '  node_1["skill: demo (stable)"]',
      "  node_1 -->|requires| node_0",
      "",
    ].join("\n"),
  );
});

test("graph mermaid output creates synthetic missing nodes for unresolved edges", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    requiresContext: ["missing.asset", "missing.other"],
  });

  const mermaid = formatGraphMermaid(await graph(root), "full");

  assert.match(mermaid, /missing_0\["missing: missing.asset"\]/);
  assert.match(mermaid, /missing_1\["missing: missing.other"\]/);
  assert.match(mermaid, /node_0 -\.->\|requires unresolved\| missing_0/);
  assert.match(mermaid, /node_0 -\.->\|requires unresolved\| missing_1/);
});

test("graph mermaid output uses deterministic ids and ordering", async () => {
  const root = await fixture();
  await writeSkill(root, "zeta", {
    owner: "platform",
    requiresContext: ["testing.zeta"],
  });
  await writeSkill(root, "alpha", {
    owner: "platform",
    requiresContext: ["missing.alpha"],
  });
  await writeContext(root, "testing", "zeta", { owner: "qa" });

  const mermaid = formatGraphMermaid(await graph(root), "full");

  assert.deepEqual(mermaid.trimEnd().split("\n"), [
    "graph TD",
    '  node_0["context: testing.zeta"]',
    '  node_1["skill: alpha"]',
    '  node_2["skill: zeta"]',
    '  missing_0["missing: missing.alpha"]',
    "  node_1 -.->|requires unresolved| missing_0",
    "  node_2 -->|requires| node_0",
  ]);
});

test("graph mermaid output escapes labels and keeps diagnostics as comments", () => {
  const mermaid = formatGraphMermaid(
    {
      root: "/repo",
      scannedFileCount: 1,
      view: "full",
      nodeCount: 1,
      edgeCount: 0,
      nodes: [
        {
          id: 'quote-"node"\nnext',
          kind: "context",
          sourcePath: "contexts/quote.md",
          tags: [],
        },
      ],
      edges: [],
      diagnostics: [
        {
          severity: "warning",
          message: "Line one\nLine two",
          path: "contexts/quote.md",
        },
      ],
    },
    "full",
  );

  assert.match(mermaid, /node_0\["context: quote-\\"node\\" next"\]/);
  assert.match(mermaid, /%% Diagnostics:/);
  assert.match(mermaid, /%% warning: contexts\/quote\.md: Line one Line two/);
});

test("graph full view preserves individual node and edge detail", async () => {
  const root = await graphViewFixture();
  const markdown = formatGraphMarkdown(await graph(root), "full");

  assert.match(markdown, /contexts\/setup\/references\/node\/http-health\.md/);
  assert.match(markdown, /contexts\/setup\/references\/node\/cache-health\.md/);
  assert.match(markdown, /contexts\/setup\/examples\/basic\.md/);
  assert.match(
    markdown,
    /\| setup \| requires \| tools\/setup\/scripts\/check-node-env\.mjs \| no \| {2}\|/,
  );
  assert.match(markdown, /requires/);
});

test("graph summary view collapses leaf paths", async () => {
  const root = await graphViewFixture();
  const mermaid = formatGraphMermaid(await graph(root), "summary");

  assert.match(mermaid, /contexts\/setup\/references\/\* \(2\)/);
  assert.match(mermaid, /contexts\/setup\/examples\/\* \(1\)/);
  assert.match(mermaid, /tools\/setup\/scripts\/\* \(1\)/);
  assert.doesNotMatch(mermaid, /http-health\.md/);
  assert.doesNotMatch(mermaid, /cache-health\.md/);
  assert.doesNotMatch(mermaid, /basic\.md/);
  assert.doesNotMatch(mermaid, /check-node-env\.mjs/);
});

test("graph summary view deduplicates repeated group edges", async () => {
  const root = await graphViewFixture();
  const markdown = formatGraphMarkdown(await graph(root), "summary");
  const referenceGroupEdges = markdown.match(
    /\| setup \| requires \| contexts\/setup\/references\/\* \| yes \|/g,
  );

  assert.equal(referenceGroupEdges?.length, 1);
});

test("graph workflow view keeps router files and collapses deep support assets", async () => {
  const root = await graphViewFixture();
  const mermaid = formatGraphMermaid(await graph(root), "workflow");

  assert.match(mermaid, /contexts\.setup\.routing/);
  assert.match(mermaid, /contexts\.setup\.node-environment/);
  assert.match(mermaid, /contexts\/setup\/references\/\* \(2\)/);
  assert.doesNotMatch(mermaid, /http-health\.md/);
});

test("graph CLI supports mermaid format", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {});

  const result = await withCapturedConsole(() =>
    main(["graph", root, "--format", "mermaid"]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^graph TD/);
  assert.match(result.stdout, /node_0\["skill: demo"\]/);
});

test("graph CLI supports summary view", async () => {
  const root = await graphViewFixture();

  const result = await withCapturedConsole(() =>
    main(["graph", root, "--format", "mermaid", "--view", "summary"]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /contexts\/setup\/references\/\* \(2\)/);
  assert.doesNotMatch(result.stdout, /http-health\.md/);
});

test("graph CLI rejects unsupported format", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {});

  const result = await withCapturedConsole(() =>
    main(["graph", root, "--format", "text"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /--format must be one of: json, markdown, mermaid\./,
  );
});

test("graph CLI rejects unsupported view", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {});

  const result = await withCapturedConsole(() =>
    main(["graph", root, "--format", "mermaid", "--view", "invalid"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /--view must be one of: summary, workflow, full\./,
  );
});

async function graphViewFixture(): Promise<string> {
  const root = await fixture();
  await writeSkill(root, "setup", {
    owner: "platform",
    requiresContext: [
      "contexts/setup/routing.md",
      "contexts/setup/node-environment.md",
      "contexts/setup/references/node/http-health.md",
      "contexts/setup/references/node/cache-health.md",
      "contexts/setup/examples/basic.md",
      "tools/setup/scripts/check-node-env.mjs",
    ],
  });
  await writeMarkdownAsset(
    root,
    "contexts/setup/routing.md",
    "contexts.setup.routing",
  );
  await writeMarkdownAsset(
    root,
    "contexts/setup/node-environment.md",
    "contexts.setup.node-environment",
  );
  await writeMarkdownAsset(
    root,
    "contexts/setup/references/node/http-health.md",
    "contexts.setup.references.node.npm-health",
  );
  await writeMarkdownAsset(
    root,
    "contexts/setup/references/node/cache-health.md",
    "contexts.setup.references.node.cache-health",
  );
  await writeMarkdownAsset(
    root,
    "contexts/setup/examples/basic.md",
    "contexts.setup.examples.basic",
  );
  await mkdir(path.join(root, "tools", "setup", "scripts"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "tools", "setup", "scripts", "check-node-env.mjs"),
    "console.log('ok');\n",
  );
  return root;
}

async function writeMarkdownAsset(
  root: string,
  relativePath: string,
  id: string,
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    markdown({
      id,
      owner: "platform",
      title: `# ${id}`,
    }),
  );
}

test("graph CLI can focus on a node id", async () => {
  const root = await fixture();
  await writeContext(root, "testing", "checklist", {
    owner: "qa",
    status: "stable",
    tags: ["qa"],
  });
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "experimental",
    requiresContext: ["contexts/testing/checklist.md"],
  });
  await writeSkill(root, "unrelated", {
    owner: "platform",
    status: "experimental",
  });

  const result = await withCapturedConsole(() =>
    main(["graph", root, "--focus", "demo"]),
  );

  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout) as {
    nodeCount: number;
    edgeCount: number;
    nodes: Array<{ id: string }>;
    edges: Array<{ from: string; to: string }>;
  };
  assert.equal(report.nodeCount, 2);
  assert.equal(report.edgeCount, 1);
  assert.deepEqual(report.nodes.map((node) => node.id).sort(), [
    "demo",
    "testing.checklist",
  ]);
  assert.deepEqual(
    report.edges.map((edge) => [edge.from, edge.to]),
    [["demo", "contexts/testing/checklist.md"]],
  );
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
