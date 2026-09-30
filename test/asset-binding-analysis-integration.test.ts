import type { Mermaid } from "mermaid";
import { buildTrustGraph } from "../src/trust-graph.js";
import { zeroContextLensSummary } from "../src/context-lens.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import { classifyAssetPath } from "../src/discovery.js";
import { parseRenmaFrontmatter } from "../src/yaml-frontmatter.js";
import {
  inspectAssetBindings,
  type AssetBindingFile,
} from "../src/public-asset-bindings.js";
import { resolveDeclaredComposition } from "../src/declared-composition.js";
import { resolveDeclaredImpact } from "../src/declared-impact.js";
import {
  graphFromRepositoryEvidence,
  formatGraphMarkdown,
  formatGraphMermaid,
  runGraphCommand,
} from "../src/commands/graph.js";

const file = (path: string, content: string): AssetBindingFile => ({
  path,
  bytes: Buffer.from(content),
});
const pin = { alias: "b", target: "skill.b", version: "1.0.0" };
function skill(name: string, version = "1.0.0", extra = "") {
  return file(
    `skills/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: Review workflows.\nmetadata:\n  renma.id: skill.${name}\n  renma.version: '${version}'\n${extra}---\n`,
  );
}
const a = (relation = "requires-skill", bindings: unknown = [pin]) =>
  skill(
    "a",
    "1.0.1",
    `  renma.${relation}: '["skill.b"]'\n  renma.asset-bindings: '${JSON.stringify(bindings)}'\n`,
  );
function analyze(files: AssetBindingFile[]) {
  const documents = files.map((f) => {
    const content = Buffer.from(f.bytes).toString();
    const type = parseRenmaFrontmatter(content).values.type;
    return parseDocument({
      path: f.path,
      absolutePath: f.path,
      kind: classifyAssetPath(
        f.path,
        typeof type === "string" ? { metadataType: type } : {},
      ).kind,
      content,
      sizeBytes: f.bytes.length,
      contentHash: createHash("sha256").update(f.bytes).digest("hex"),
      contentClassification: "text",
      markdownParserEligible: true,
    });
  });
  const { catalog } = buildCatalog(documents);
  const graph = graphFromRepositoryEvidence({
    root: "/snapshot",
    scannedFileCount: files.length,
    catalog,
    diagnostics: [],
    contextLens: zeroContextLensSummary(),
  });
  return {
    catalog,
    graph,
    api: inspectAssetBindings(files),
    composition: resolveDeclaredComposition(catalog, "skill.a"),
  };
}

test("catalog, API, composition and impact share pins while traversing mismatched snapshot releases", () => {
  for (const version of ["1.0.0", "2.0.0"]) {
    const files = [
      a(),
      skill("b", version, `  renma.requires-skill: '["skill.c"]'\n`),
      skill("c"),
    ];
    const { catalog, graph, api, composition } = analyze(files);
    const binding = catalog.dependencies.find(
      (edge) => edge.from === "skill.a",
    )!.bindings![0]!;
    const publicBinding = api.documents.find(
      (d) => d.identity.id === "skill.a",
    )!.bindings[0]!;
    const { satisfied, diagnostics: _diagnostics, ...normalized } = binding;
    assert.deepEqual(
      normalized,
      (({ satisfied: _satisfied, ...rest }) => rest)(publicBinding),
    );
    assert.equal(satisfied, publicBinding.satisfied);
    assert.equal(satisfied, version === "1.0.0");
    assert.equal(
      graph.edges.find((edge) => edge.from === "skill.a")!.resolved,
      true,
    );
    assert.deepEqual(
      composition.requiredAssets.map((asset) => asset.id),
      ["skill.b", "skill.c"],
    );
    assert.equal(composition.requiredAssets[0]!.releaseVersion, version);
    assert.equal(composition.requiredComplete, true);
    assert.equal(composition.bindingSatisfaction!.requiredSatisfied, satisfied);
    assert.deepEqual(composition.provenanceEdges[0]!.bindings, [binding]);
    const impact = resolveDeclaredImpact(catalog, "skill.c");
    assert.deepEqual(
      impact.requiredSkills.map((asset) => asset.id),
      ["skill.a", "skill.b"],
    );
    assert.deepEqual(
      impact.provenanceEdges.find((edge) => edge.from === "skill.a")!.bindings,
      [binding],
    );
    assert.equal(impact.bindingSatisfaction!.requiredSatisfied, satisfied);
    assert.match(
      formatGraphMarkdown(graph, "full"),
      new RegExp(`b @1.0.0: ${satisfied ? "matched" : "version-mismatch"}`),
    );
    assert.match(formatGraphMermaid(graph, "summary"), /b @1.0.0:/);
  }
});

test("missing, ambiguous, wrong-kind and invalid-release targets retain independent resolution and binding evidence", () => {
  const cases = [
    { targets: [], status: "missing", resolved: false },
    {
      targets: [
        skill("b"),
        file(
          "skills/duplicate/SKILL.md",
          Buffer.from(skill("b").bytes)
            .toString()
            .replace("name: b", "name: duplicate"),
        ),
      ],
      status: "ambiguous",
      resolved: false,
    },
    {
      targets: [
        file("contexts/b.md", "---\nid: skill.b\nversion: '1.0.0'\n---\n"),
      ],
      status: "kind-mismatch",
      resolved: true,
    },
    {
      targets: [
        file(
          "skills/b/SKILL.md",
          Buffer.from(skill("b").bytes)
            .toString()
            .replace("  renma.version: '1.0.0'\n", ""),
        ),
      ],
      status: "target-version-invalid",
      resolved: true,
    },
  ];
  for (const { targets, status, resolved } of cases) {
    const { graph, composition, api } = analyze([a(), ...targets]);
    const edge = graph.edges.find((edge) => edge.from === "skill.a")!;
    assert.equal(edge.resolved, resolved);
    assert.equal(edge.bindings![0]!.satisfaction.status, status);
    assert.equal(edge.bindings![0]!.satisfied, false);
    assert.deepEqual(
      edge.bindings![0]!.satisfaction,
      api.documents.find((d) => d.identity.id === "skill.a")!.bindings[0]!
        .satisfaction,
    );
    const relationships = [
      ...composition.provenanceEdges,
      ...composition.unresolvedRequired,
      ...composition.kindMismatches,
    ];
    assert.ok(
      relationships.some(
        (edge) => edge.bindings?.[0]?.satisfaction.status === status,
      ),
    );
    assert.equal(composition.bindingSatisfaction!.requiredSatisfied, false);
  }
});

test("invalid declarations cannot satisfy matching candidates; malformed entries remain visible", () => {
  for (const bindings of [
    [pin, { ...pin, alias: "duplicate" }],
    [{ ...pin, version: 1 }],
    [{ ...pin, extra: true }],
  ]) {
    const { graph, composition, api } = analyze([
      a("requires-skill", bindings),
      skill("b"),
    ]);
    assert.equal(graph.edges[0]!.resolved, true);
    assert.ok(graph.edges[0]!.bindingDiagnostics!.length);
    assert.equal(composition.bindingSatisfaction!.requiredSatisfied, false);
    assert.equal(
      api.documents.find((d) => d.identity.id === "skill.a")!.declarationValid,
      false,
    );
    assert.ok((graph.edges[0]!.bindings ?? []).every((b) => !b.satisfied));
    assert.match(formatGraphMermaid(graph, "full"), /invalid/);
  }
});

test("unsatisfied optional bindings preserve required membership and snapshot completeness", () => {
  const { composition, catalog } = analyze([
    a("optional-skill"),
    skill("b", "2.0.0"),
  ]);
  assert.equal(composition.requiredComplete, true);
  assert.equal(composition.optionalComplete, true);
  assert.deepEqual(composition.requiredAssets, []);
  assert.deepEqual(composition.bindingSatisfaction, {
    requiredSatisfied: true,
    optionalSatisfied: false,
  });
  assert.deepEqual(
    resolveDeclaredImpact(catalog, "skill.b").bindingSatisfaction,
    { requiredSatisfied: true, optionalSatisfied: false },
  );
});

test("Lens nodes use release_version, never the format version", () => {
  const files = [
    skill(
      "a",
      "1.0.1",
      `  renma.requires-lens: '["lens.b"]'\n  renma.asset-bindings: '[{"alias":"b","target":"lens.b","version":"release-B"}]'\n`,
    ),
    file(
      "contexts/b.lens.md",
      "---\nid: lens.b\ntype: context_lens\nversion: '1'\nrelease_version: release-B\nowner: qa\npurpose: Review\napplies_to: [ctx]\n---\n",
    ),
  ];
  const { graph, composition } = analyze(files);
  assert.equal(
    graph.nodes.find((n) => n.id === "lens.b")!.releaseVersion,
    "release-B",
  );
  assert.equal(composition.provenanceEdges[0]!.bindings![0]!.satisfied, true);
  assert.match(formatGraphMermaid(graph, "layered"), /lens.b @release-B/);
  const missingRelease = analyze([
    files[0]!,
    file(
      files[1]!.path,
      Buffer.from(files[1]!.bytes)
        .toString()
        .replace("release_version: release-B\n", ""),
    ),
  ]);
  assert.equal(
    missingRelease.graph.nodes.find((n) => n.id === "lens.b")!.releaseVersion,
    undefined,
  );
  assert.equal(
    missingRelease.graph.edges.find((edge) => edge.from === "skill.a")!
      .bindings![0]!.satisfaction.status,
    "target-version-invalid",
  );
});

test("unbound edges preserve their fields and completeness summaries", () => {
  const { graph, composition } = analyze([
    skill("a", "1.0.0", `  renma.requires-skill: '["skill.b"]'\n`),
    skill("b"),
  ]);
  assert.equal(graph.edges[0]!.bindings, undefined);
  assert.equal(graph.edges[0]!.bindingDiagnostics, undefined);
  assert.equal(composition.bindingSatisfaction, undefined);
  assert.equal(composition.requiredComplete, true);
  assert.doesNotMatch(
    formatGraphMermaid(graph, "full"),
    /matched|mismatch|binding/,
  );
});

test("focused composition and impact CLI projections retain annotations in JSON, Markdown and Mermaid", async (t) => {
  const mermaid = await loadMermaidParser();
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-binding-graphs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = file(
    a().path,
    Buffer.from(a().bytes).toString() + "\n```sh\nnode scripts/run.mjs\n```\n",
  );
  for (const f of [
    source,
    skill("b", "2.0.0"),
    file("skills/a/scripts/run.mjs", "console.log('review');\n"),
  ]) {
    const destination = path.join(root, f.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, f.bytes);
  }
  for (const view of ["composition", "impact"] as const) {
    for (const format of ["json", "markdown", "mermaid"] as const) {
      let output = "";
      const original = process.stdout.write;
      process.stdout.write = ((chunk: string | Uint8Array) => {
        output += chunk.toString();
        return true;
      }) as typeof original;
      try {
        await runGraphCommand(root, {
          view,
          format,
          focus: view === "composition" ? "skill.a" : "skill.b",
        });
      } finally {
        process.stdout.write = original;
      }
      if (format === "json") {
        const result = JSON.parse(output);
        assert.equal(result.schemaVersion, "renma.graph.v1");
        assert.equal(result.edges[0].resolved, true);
        assert.equal(result.edges[0].bindings[0].satisfied, false);
      } else {
        assert.match(output, /b @1.0.0: version-mismatch/);
        if (format === "mermaid")
          await assert.doesNotReject(mermaid.parse(output));
      }
    }
  }
  let executableOutput = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    executableOutput += chunk.toString();
    return true;
  }) as typeof original;
  try {
    await runGraphCommand(root, { view: "executable", format: "json" });
  } finally {
    process.stdout.write = original;
  }
  const executable = JSON.parse(executableOutput);
  assert.ok(
    executable.edges.some((edge: { kind: string }) => edge.kind === "invokes"),
  );
  assert.ok(
    executable.edges.every(
      (edge: { bindings?: unknown; bindingDiagnostics?: unknown }) =>
        edge.bindings === undefined && edge.bindingDiagnostics === undefined,
    ),
  );
});

test("bindings annotate every authored index without adding edges or redefining Context ambiguity", () => {
  const source = file(
    "contexts/a.md",
    "---\nid: ctx.a\nversion: '1'\nrequires_context: [ctx.b, ctx.b]\noptional_context: [ctx.b]\nasset_bindings:\n - {alias: b, target: ctx.b, version: '1'}\n---\n",
  );
  const target = file("contexts/b.md", "---\nid: ctx.b\nversion: '1'\n---\n");
  const duplicate = file(
    "contexts/duplicate.md",
    "---\nid: ctx.b\nversion: '2'\n---\n",
  );
  const documents = [source, target, duplicate].map((f) =>
    parseDocument({
      path: f.path,
      absolutePath: f.path,
      kind: "context",
      content: Buffer.from(f.bytes).toString(),
      sizeBytes: f.bytes.length,
      contentClassification: "text",
      markdownParserEligible: true,
    }),
  );
  const { catalog } = buildCatalog(documents);
  assert.equal(catalog.dependencies.length, 3);
  assert.deepEqual(
    catalog.dependencies.map((edge) => [
      edge.declaration,
      edge.declarationIndex,
    ]),
    [
      ["requires_context", 0],
      ["requires_context", 1],
      ["optional_context", 0],
    ],
  );
  assert.ok(
    catalog.dependencies.every(
      (edge) => edge.bindings?.[0]?.satisfaction.status === "ambiguous",
    ),
  );
  const composition = resolveDeclaredComposition(catalog, "ctx.a");
  assert.equal(composition.provenanceEdges.length, 3);
  assert.equal(composition.requiredComplete, true);
  assert.deepEqual(composition.bindingSatisfaction, {
    requiredSatisfied: false,
    optionalSatisfied: false,
  });
  const graph = graphFromRepositoryEvidence({
    root: "/snapshot",
    scannedFileCount: documents.length,
    catalog,
    diagnostics: [],
    contextLens: zeroContextLensSummary(),
  });
  assert.ok(graph.edges.every((edge) => edge.resolved));
  assert.equal(
    formatGraphMermaid(graph, "summary").split("ambiguous").length - 1,
    3,
  );
  const impact = resolveDeclaredImpact(catalog, "ctx.b");
  assert.equal(impact.provenanceEdges.length, 3);
  assert.ok(
    impact.provenanceEdges.every(
      (edge) => edge.bindings?.[0]?.satisfied === false,
    ),
  );
  assert.deepEqual(
    inspectAssetBindings([source, target, duplicate]),
    inspectAssetBindings([duplicate, target, source]),
  );
});

test("reverse impact retains binding evidence on invalid incoming kinds", () => {
  const { catalog } = analyze([
    a(),
    file("contexts/b.md", "---\nid: skill.b\nversion: '1.0.0'\n---\n"),
  ]);
  const impact = resolveDeclaredImpact(catalog, "skill.b");
  assert.deepEqual(impact.requiredDependents, []);
  assert.equal(
    impact.invalidIncomingDeclarations[0]!.bindings![0]!.satisfaction.status,
    "kind-mismatch",
  );
  assert.equal(impact.bindingSatisfaction!.requiredSatisfied, false);
});

test("an invalid optional pin does not annotate or invalidate unbound required relationships", () => {
  const source = skill(
    "a",
    "1.0.1",
    `  renma.requires-skill: '["skill.c"]'\n  renma.optional-skill: '["skill.b"]'\n  renma.asset-bindings: '[{"alias":"b","target":"skill.b","version":1}]'\n`,
  );
  const { catalog, composition } = analyze([source, skill("b"), skill("c")]);
  const required = catalog.dependencies.find((edge) => edge.to === "skill.c")!;
  assert.equal(required.bindings, undefined);
  assert.equal(required.bindingDiagnostics, undefined);
  assert.equal(composition.requiredComplete, true);
  assert.deepEqual(
    composition.requiredAssets.map((asset) => asset.id),
    ["skill.c"],
  );
  assert.deepEqual(composition.bindingSatisfaction, {
    requiredSatisfied: true,
    optionalSatisfied: false,
  });
});

test("Trust Graph relationships retain their existing semantics without binding propagation", () => {
  const { catalog } = analyze([a(), skill("b", "2.0.0")]);
  const unannotated = structuredClone(catalog);
  for (const asset of unannotated.assets) delete asset.releaseVersion;
  for (const dependency of unannotated.dependencies) {
    delete dependency.bindings;
    delete dependency.bindingDiagnostics;
  }
  assert.deepEqual(
    buildTrustGraph({ catalog }),
    buildTrustGraph({ catalog: unannotated }),
  );
});

async function loadMermaidParser(): Promise<Mermaid> {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      document: { nodeType: 9, currentScript: null, createElement: () => ({}) },
      Element: class {},
    },
  });
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
    });
    return mermaid;
  } finally {
    if (previousWindow === undefined)
      Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", previousWindow);
  }
}

test("Mermaid renders exact requested releases containing label delimiters", async () => {
  const files = [
    a("requires-skill", [{ ...pin, version: 'release|B (old) "review"' }]),
    skill("b"),
  ];
  const { graph } = analyze(files);
  const mermaid = await loadMermaidParser();
  for (const view of ["full", "summary", "layered"] as const) {
    await assert.doesNotReject(mermaid.parse(formatGraphMermaid(graph, view)));
  }
});

test("resolved provenance survives dependency projections and graph serialization", () => {
  const commit = "7e91d1654d" + "a".repeat(30);
  for (const declaration of [
    { ...pin, ref: "v1.0.0", resolved: { commit } },
    { alias: "b", target: "skill.b", ref: "main", resolved: { commit } },
  ]) {
    const { catalog, graph, composition, api } = analyze([
      a("requires-skill", [declaration]),
      skill("b"),
    ]);
    const binding = catalog.dependencies.find((e) => e.from === "skill.a")!
      .bindings![0]!;
    assert.deepEqual(binding.resolved, { commit });
    assert.equal(binding.ref, declaration.ref);
    assert.equal(
      binding.version,
      "version" in declaration ? declaration.version : undefined,
    );
    assert.deepEqual(graph.edges.find((e) => e.from === "skill.a")!.bindings, [
      binding,
    ]);
    assert.deepEqual(composition.provenanceEdges[0]!.bindings, [binding]);
    assert.deepEqual(
      resolveDeclaredImpact(catalog, "skill.b").provenanceEdges[0]!.bindings,
      [binding],
    );
    for (const report of [catalog, graph, composition, api])
      assert.ok(JSON.stringify(report).includes(commit));
    for (const text of [
      formatGraphMarkdown(graph, "full"),
      formatGraphMermaid(graph, "summary"),
    ]) {
      assert.ok(text.includes(commit.slice(0, 12)));
      assert.ok(text.includes(declaration.ref));
      assert.ok(!text.includes("undefined"));
    }
  }
});
