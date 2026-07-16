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

test("graph composition view resolves required and optional closure with provenance", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    requiresLens: ["lens.testing.review"],
    optionalContext: ["testing.optional"],
  });
  await writeContextLens(root, "testing", "review", {
    id: "lens.testing.review",
    appliesTo: ["testing.required"],
  });
  await writeContext(root, "testing", "required", {
    requiresContext: ["testing.child"],
  });
  await writeContext(root, "testing", "child", {});
  await writeContext(root, "testing", "optional", {});

  const result = await withCapturedConsole(() =>
    main([
      "graph",
      root,
      "--view",
      "composition",
      "--focus",
      "demo",
      "--format",
      "json",
    ]),
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout) as {
    view: string;
    composition: {
      root: { id: string };
      requiredAssets: Array<{ id: string }>;
      optionalAssets: Array<{ id: string }>;
      provenanceEdges: Array<{
        relationship: string;
        evidence?: { path: string; startLine: number; snippet: string };
      }>;
      requiredComplete: boolean;
      optionalComplete: boolean;
      cycleFree: boolean;
    };
  };
  assert.equal(output.view, "composition");
  assert.equal(output.composition.root.id, "demo");
  assert.deepEqual(
    output.composition.requiredAssets.map((asset) => asset.id),
    ["lens.testing.review", "testing.child", "testing.required"],
  );
  assert.deepEqual(
    output.composition.optionalAssets.map((asset) => asset.id),
    ["testing.optional"],
  );
  assert.ok(
    output.composition.provenanceEdges.every(
      (edge) =>
        edge.evidence?.path &&
        edge.evidence.startLine > 0 &&
        edge.evidence.snippet.length > 0,
    ),
  );
  assert.deepEqual(
    output.composition.provenanceEdges.map((edge) => edge.relationship),
    ["requires_lens", "optional_context", "applies_to", "requires_context"],
  );
  assert.equal(output.composition.requiredComplete, true);
  assert.equal(output.composition.optionalComplete, true);
  assert.equal(output.composition.cycleFree, true);
});

test("graph composition Markdown and Mermaid focus by repository-relative path", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    requiresContext: ["testing.required"],
    optionalContext: ["testing.optional"],
  });
  await writeContext(root, "testing", "required", {});
  await writeContext(root, "testing", "optional", {});

  const markdown = await withCapturedConsole(() =>
    main([
      "graph",
      root,
      "--view",
      "composition",
      "--focus",
      "skills/demo/SKILL.md",
      "--format",
      "markdown",
    ]),
  );
  const mermaid = await withCapturedConsole(() =>
    main([
      "graph",
      root,
      "--view",
      "composition",
      "--focus",
      "skills/demo/SKILL.md",
      "--format",
      "mermaid",
    ]),
  );

  assert.equal(markdown.code, 0);
  assert.match(markdown.stdout, /^# Renma Declared Composition/);
  assert.match(markdown.stdout, /## Declaration provenance/);
  assert.match(markdown.stdout, /Required complete: yes/);
  assert.match(markdown.stdout, /optional_context/);
  assert.equal(mermaid.code, 0);
  assert.match(mermaid.stdout, /^graph TD/);
  assert.match(mermaid.stdout, /requires_context required/);
  assert.match(mermaid.stdout, /optional_context optional/);
  assert.match(
    mermaid.stdout,
    /Solid edges are required; dotted edges are optional/,
  );
});

test("composition Markdown renders SCC members and actual edges without fabricating a cycle path", async () => {
  const root = await fixture();
  await writeContext(root, "cycle", "a", {
    requiresContext: ["cycle.c"],
  });
  await writeContext(root, "cycle", "b", {
    requiresContext: ["cycle.a"],
  });
  await writeContext(root, "cycle", "c", {
    requiresContext: ["cycle.b"],
  });

  const markdown = await withCapturedConsole(() =>
    main([
      "graph",
      root,
      "--view",
      "composition",
      "--focus",
      "cycle.a",
      "--format",
      "markdown",
    ]),
  );
  const json = await withCapturedConsole(() =>
    main([
      "graph",
      root,
      "--view",
      "composition",
      "--focus",
      "cycle.a",
      "--format",
      "json",
    ]),
  );

  assert.equal(markdown.code, 0);
  assert.match(
    markdown.stdout,
    /Strongly connected assets: cycle\.a, cycle\.b, cycle\.c\./,
  );
  assert.match(markdown.stdout, /cycle\.a requires_context cycle\.c/);
  assert.match(markdown.stdout, /cycle\.b requires_context cycle\.a/);
  assert.match(markdown.stdout, /cycle\.c requires_context cycle\.b/);
  assert.doesNotMatch(markdown.stdout, /cycle\.a -> cycle\.b/);

  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout) as {
    composition: {
      requiredCycles: Array<{
        assetIds: string[];
        edges: Array<{ from: string; to: string }>;
      }>;
    };
  };
  assert.deepEqual(
    report.composition.requiredCycles.map((cycle) => ({
      assetIds: cycle.assetIds,
      edges: cycle.edges.map((edge) => [edge.from, edge.to]),
    })),
    [
      {
        assetIds: ["cycle.a", "cycle.b", "cycle.c"],
        edges: [
          ["cycle.a", "cycle.c"],
          ["cycle.b", "cycle.a"],
          ["cycle.c", "cycle.b"],
        ],
      },
    ],
  );
});

test("graph composition view requires a focus target", async () => {
  const root = await fixture();
  const result = await withCapturedConsole(() =>
    main(["graph", root, "--view", "composition", "--format", "json"]),
  );

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /graph --view composition requires --focus <asset-id-or-path>/,
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
    declaration: "requires_context",
    declarationIndex: 0,
    sourcePath: "skills/demo/SKILL.md",
    evidence: {
      path: "skills/demo/SKILL.md",
      startLine: 6,
      endLine: 6,
      snippet: `  renma.requires-context: '["missing.asset"]'`,
    },
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
    /\| demo \| skill \| skills\/demo\/SKILL\.md \| platform \(declared\) \| {2}\| {2}\|/,
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

test("graph mermaid default view remains unlayered", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    requiresContext: ["testing.boundary"],
  });
  await writeContext(root, "testing", "boundary", { owner: "qa" });

  const mermaid = formatGraphMermaid(await graph(root));

  assert.equal(
    mermaid,
    [
      "graph TD",
      '  node_0["contexts/testing/* (1)"]',
      '  node_1["skill: demo"]',
      "  node_1 -->|requires| node_0",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(mermaid, /subgraph/);
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
          ownership: {
            declaredOwner: null,
            effectiveOwner: null,
            source: "unowned",
          },
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

test("graph layered mermaid groups nodes by asset kind", async () => {
  const root = await fixture();
  await writeSkill(root, "setup", {
    requiresContext: ["contexts/setup/routing.md"],
    requiresLens: ["lens.setup.diagnosis"],
  });
  await writeContextLens(root, "setup", "diagnosis", {
    id: "lens.setup.diagnosis",
    appliesTo: ["contexts/setup/routing.md"],
  });
  await writeMarkdownAsset(root, "contexts/setup/routing.md", "setup.routing");

  const mermaid = formatGraphMermaid(await graph(root), "layered");

  assert.match(mermaid, /subgraph Skills\["Skills"\]/);
  assert.match(mermaid, /subgraph Context_Lenses\["Context Lenses"\]/);
  assert.match(mermaid, /subgraph Contexts\["Contexts"\]/);
  assert.match(mermaid, /skill: setup/);
  assert.match(mermaid, /lens: lens\.setup\.diagnosis/);
  assert.match(mermaid, /context: setup\.routing/);
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

test("graph CLI supports layered lens view alias", async () => {
  const root = await graphViewFixture();

  const result = await withCapturedConsole(() =>
    main(["graph", root, "--format", "mermaid", "--view", "lens"]),
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /subgraph Skills\["Skills"\]/);
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
    /--view must be one of: summary, workflow, full, layered, lens, composition\./,
  );
});

test("graph layered mermaid shows skill lens context paths", async () => {
  const root = await appiumLensFixture();

  const mermaid = formatGraphMermaid(await graph(root), "layered");
  const skill = mermaidNodeId(mermaid, "skill: skill.tools.appium.setup");
  const lens = mermaidNodeId(
    mermaid,
    "lens: lens.tools.appium.setup-diagnosis",
  );
  const context = mermaidNodeId(
    mermaid,
    "context: context.tools.appium.setup.routing",
  );

  assert.match(mermaid, /subgraph Skills\["Skills"\]/);
  assert.match(mermaid, /subgraph Context_Lenses\["Context Lenses"\]/);
  assert.match(mermaid, /subgraph Contexts\["Contexts"\]/);
  assert.match(mermaid, new RegExp(`${skill} -->\\|requires_lens\\| ${lens}`));
  assert.match(mermaid, new RegExp(`${lens} -->\\|applies_to\\| ${context}`));
  assert.match(
    mermaid,
    new RegExp(`${skill} -->\\|requires_context\\| ${context}`),
  );
});

test("focused layered lens graph includes inbound skills and applied contexts", async () => {
  const root = await appiumLensFixture();

  const result = await withCapturedConsole(() =>
    main([
      "graph",
      root,
      "--focus",
      "lens.tools.appium.setup-diagnosis",
      "--view",
      "layered",
      "--format",
      "mermaid",
    ]),
  );

  assert.equal(result.code, 0);
  const skill = mermaidNodeId(result.stdout, "skill: skill.tools.appium.setup");
  const lens = mermaidNodeId(
    result.stdout,
    "lens: lens.tools.appium.setup-diagnosis",
  );
  const context = mermaidNodeId(
    result.stdout,
    "context: context.tools.appium.setup.routing",
  );

  assert.match(
    result.stdout,
    new RegExp(`${skill} -->\\|requires_lens\\| ${lens}`),
  );
  assert.match(
    result.stdout,
    new RegExp(`${lens} -->\\|applies_to\\| ${context}`),
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

async function appiumLensFixture(): Promise<string> {
  const root = await fixture();
  await writeSkill(root, "setup", {
    id: "skill.tools.appium.setup",
    owner: "platform",
    requiresContext: ["contexts/tools/appium/setup/routing.md"],
    requiresLens: ["lens.tools.appium.setup-diagnosis"],
    optionalLens: ["lens.tools.appium.driver-selection"],
  });
  await writeMarkdownAsset(
    root,
    "contexts/tools/appium/setup/routing.md",
    "context.tools.appium.setup.routing",
  );
  await writeContextLens(root, "tools/appium", "setup-diagnosis", {
    id: "lens.tools.appium.setup-diagnosis",
    appliesTo: ["contexts/tools/appium/setup/routing.md"],
  });
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

test("graph CLI fails clearly when focus does not match", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    owner: "platform",
    status: "experimental",
  });

  const result = await withCapturedConsole(() =>
    main(["graph", root, "--focus", "does.not.exist"]),
  );

  assert.equal(result.code, 2);
  assert.match(
    result.stderr,
    /graph --focus did not match any asset id or source path: does\.not\.exist/,
  );
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-graph-"));
}

async function writeSkill(
  root: string,
  id: string,
  metadata: {
    id?: string;
    owner?: string;
    status?: string;
    tags?: string[];
    requiresContext?: string[];
    optionalContext?: string[];
    requiresLens?: string[];
    optionalLens?: string[];
  },
): Promise<void> {
  await mkdir(path.join(root, "skills", id), { recursive: true });
  await writeFile(
    path.join(root, "skills", id, "SKILL.md"),
    markdown({
      skillName: id,
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
  metadata: {
    owner?: string;
    status?: string;
    tags?: string[];
    requiresContext?: string[];
  },
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

async function writeContextLens(
  root: string,
  group: string,
  name: string,
  metadata: {
    id: string;
    owner?: string;
    status?: string;
    tags?: string[];
    appliesTo: string[];
  },
): Promise<void> {
  await mkdir(path.join(root, "lenses", group), { recursive: true });
  await writeFile(
    path.join(root, "lenses", group, `${name}.md`),
    markdown({
      ...metadata,
      type: "context_lens",
      owner: metadata.owner ?? "platform",
      purpose: "Make setup context easier to review.",
      title: `# ${metadata.id}`,
    }),
  );
}

function markdown(metadata: {
  skillName?: string;
  id: string;
  type?: string;
  owner?: string;
  status?: string;
  purpose?: string;
  tags?: string[];
  requiresContext?: string[];
  optionalContext?: string[];
  requiresLens?: string[];
  optionalLens?: string[];
  appliesTo?: string[];
  title: string;
}): string {
  if (metadata.skillName) {
    return [
      "---",
      `name: ${metadata.skillName}`,
      "description: Use this skill for deterministic graph report tests. Use when repository relationships need review.",
      "metadata:",
      `  renma.id: ${metadata.id}`,
      ...(metadata.owner ? [`  renma.owner: ${metadata.owner}`] : []),
      ...(metadata.status ? [`  renma.status: ${metadata.status}`] : []),
      ...(metadata.purpose ? [`  renma.purpose: ${metadata.purpose}`] : []),
      ...(metadata.tags
        ? [`  renma.tags: '${JSON.stringify(metadata.tags)}'`]
        : []),
      ...(metadata.requiresContext
        ? [
            `  renma.requires-context: '${JSON.stringify(metadata.requiresContext)}'`,
          ]
        : []),
      ...(metadata.optionalContext
        ? [
            `  renma.optional-context: '${JSON.stringify(metadata.optionalContext)}'`,
          ]
        : []),
      ...(metadata.requiresLens
        ? [`  renma.requires-lens: '${JSON.stringify(metadata.requiresLens)}'`]
        : []),
      ...(metadata.optionalLens
        ? [`  renma.optional-lens: '${JSON.stringify(metadata.optionalLens)}'`]
        : []),
      "---",
      metadata.title,
      "Use for graph report tests.",
      "",
    ].join("\n");
  }
  return [
    "---",
    `id: ${metadata.id}`,
    ...(metadata.type ? [`type: ${metadata.type}`] : []),
    ...(metadata.owner ? [`owner: ${metadata.owner}`] : []),
    ...(metadata.status ? [`status: ${metadata.status}`] : []),
    ...(metadata.purpose ? [`purpose: ${metadata.purpose}`] : []),
    ...(metadata.tags ? [`tags: ${metadata.tags.join(", ")}`] : []),
    ...(metadata.requiresContext
      ? [`requires_context: ${metadata.requiresContext.join(", ")}`]
      : []),
    ...(metadata.optionalContext
      ? [`optional_context: ${metadata.optionalContext.join(", ")}`]
      : []),
    ...(metadata.requiresLens
      ? [`requires_lens: ${metadata.requiresLens.join(", ")}`]
      : []),
    ...(metadata.optionalLens
      ? [`optional_lens: ${metadata.optionalLens.join(", ")}`]
      : []),
    ...(metadata.appliesTo
      ? [`applies_to: ${metadata.appliesTo.join(", ")}`]
      : []),
    "---",
    metadata.title,
    "Use for graph report tests.",
    "",
  ].join("\n");
}

function mermaidNodeId(mermaid: string, label: string): string {
  const match = mermaid.match(
    new RegExp(`(node_\\d+)\\["${escapeRegExp(label)}"\\]`),
  );
  assert.ok(match, `Expected Mermaid node with label ${label}`);
  return match[1] as string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
