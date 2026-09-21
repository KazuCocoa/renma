import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateAgentSkill } from "../src/agent-skills.js";
import { buildCatalog } from "../src/catalog.js";
import { buildBomReport, formatBomJson } from "../src/commands/bom.js";
import {
  buildCiReportFromDiff,
  formatCiReport,
} from "../src/commands/ci-report.js";
import { diff } from "../src/commands/diff.js";
import {
  graphFromRepositorySnapshot,
  formatGraphMarkdown,
  formatGraphMermaid,
} from "../src/commands/graph.js";
import {
  declaredCompositionFindings,
  resolveDeclaredComposition,
} from "../src/declared-composition.js";
import { resolveDeclaredImpact } from "../src/declared-impact.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { buildAgentSkillMigrationSuggestion } from "../src/skill-migration.js";
import { buildTrustGraph } from "../src/trust-graph.js";
import { RepositoryFixture } from "./repository-fixture.js";

for (const membership of ["required", "optional"] as const) {
  test(`${membership} Skill composition propagates through Skills, Contexts and Lenses with reverse provenance`, async (t) => {
    const fixture = await RepositoryFixture.create({ testContext: t });
    const key = membership === "required" ? "requires" : "optional";
    await fixture.skill("a", {
      owner: "team-a",
      metadata: {
        [`${key}-skill`]: '["skill.b"]',
        "writable-by": '["team-a"]',
      },
      continuesWith: ["skill.route"],
    });
    await fixture.skill("route");
    await fixture.skill("b", {
      owner: "team-b",
      metadata: {
        "requires-context": '["context.c"]',
        "requires-lens": '["lens.d"]',
      },
    });
    await fixture.context("contexts/c.md", { id: "context.c" });
    await fixture.contextLens("lenses/d.md", {
      id: "lens.d",
      appliesTo: ["context.c"],
    });
    const snapshot = await collectRepositorySnapshot(fixture.root);
    const catalog = snapshot.catalog;
    const report = resolveDeclaredComposition(catalog, "skill.a");
    assert.deepEqual(
      report[`${membership}Assets`].map((a) => a.id),
      ["context.c", "lens.d", "skill.b"],
    );
    assert.equal(report.requiredComplete, true);
    assert.equal(report.optionalComplete, true);
    assert.ok(report.provenanceEdges.every((e) => e.membership === membership));
    assert.ok(!report.provenanceEdges.some((e) => e.to === "skill.route"));
    const direct = report.provenanceEdges.find((e) => e.to === "skill.b")!;
    assert.equal(direct.relationship, `${key}_skill`);
    const source = (
      await readFile(fixture.resolve("skills/a/SKILL.md"), "utf8")
    ).split("\n");
    const line = source.findIndex((l) => l.includes(`renma.${key}-skill`)) + 1;
    assert.deepEqual(direct.evidence, {
      path: "skills/a/SKILL.md",
      startLine: line,
      endLine: line,
      snippet: source[line - 1],
    });
    const impact = resolveDeclaredImpact(catalog, "context.c");
    assert.ok(
      impact[`${membership}Dependents`].some((a) => a.id === "skill.a"),
    );
    assert.deepEqual(
      impact.provenanceEdges.find((e) => e.from === "skill.a")?.evidence,
      direct.evidence,
    );
    const graph = graphFromRepositorySnapshot(snapshot);
    assert.equal(
      graph.edges.find((e) => e.to === "skill.b")?.declaration,
      `${key}_skill`,
    );
    for (const view of ["full", "summary", "layered"] as const) {
      assert.equal(
        formatGraphMarkdown(graph, view),
        formatGraphMarkdown(graph, view),
      );
      assert.equal(
        formatGraphMermaid(graph, view),
        formatGraphMermaid(graph, view),
      );
    }
    assert.match(
      formatGraphMermaid(graph, "layered"),
      new RegExp(`${key}_skill`),
    );
    const bom = buildBomReport(snapshot, { omitGeneratedAt: true });
    assert.ok(
      bom.dependencies.some(
        (e) =>
          e.from === "skill.a" &&
          e.to === "skill.b" &&
          e.kind === (key === "requires" ? "requires" : "optional") &&
          e.targetKind === "skill",
      ),
    );
    assert.equal(
      formatBomJson(bom),
      formatBomJson(buildBomReport(snapshot, { omitGeneratedAt: true })),
    );
    const trust = buildTrustGraph({ catalog });
    const ajv = new Ajv2020({
      allErrors: true,
      allowUnionTypes: true,
      strict: true,
      strictRequired: false,
    });
    addFormats.default(ajv);
    for (const [file, output] of [
      ["repository-context-bom-v3", bom],
      ["trust-graph-v2", trust],
    ] as const) {
      const schema = JSON.parse(
        await readFile(`docs/schemas/${file}.schema.json`, "utf8"),
      ) as AnySchemaObject;
      const validate = ajv.compile(schema);
      assert.ok(validate(output), JSON.stringify(validate.errors));
    }
    const golden =
      JSON.stringify(
        {
          composition: report,
          impact,
          graphEdges: graph.edges,
          bomDependencies: bom.dependencies,
          trustDependencies: trust.edges.filter(
            (e) => e.type === "declares_dependency",
          ),
        },
        null,
        2,
      ) + "\n";
    const goldenPath = `test/fixtures/skill-composition-${membership}.golden`;
    if (process.env.UPDATE_PUBLIC_JSON_GOLDENS === "1")
      await writeFile(goldenPath, golden);
    assert.equal(golden, await readFile(goldenPath, "utf8"));
    assert.ok(
      trust.edges.some(
        (e) =>
          e.type === "declares_dependency" &&
          e.properties?.declaredTarget === "skill.b",
      ),
    );
    assert.deepEqual(
      catalog.assets.find((a) => a.id === "skill.a")?.metadata.writableBy,
      ["team-a"],
    );
    // Discovery reads only its continuation projection, never catalog dependencies.
    const { prepareRepositorySnapshotProjections } =
      await import("../src/repository-evidence.js");
    prepareRepositorySnapshotProjections(snapshot, ["skill-discovery"]);
    assert.ok(
      snapshot.skillDiscovery.routes.some((r) => r.rawTarget === "skill.route"),
    );
    assert.ok(
      !snapshot.skillDiscovery.routes.some((r) => r.rawTarget === "skill.b"),
    );
  });
}

test("Skill cycles, duplicate declarations, mixed membership and ambiguous targets retain finite explicit evidence", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.skill("a", {
    metadata: {
      "requires-skill": '["skill.b","skill.b"]',
      "optional-skill": '["skill.b","skill.missing","skill.duplicate"]',
    },
  });
  await fixture.skill("b", {
    metadata: {
      "requires-skill": '["skill.a"]',
      "optional-skill": '["skill.a"]',
    },
  });
  await fixture.skill("duplicate-one", { id: "skill.duplicate" });
  await fixture.skill("duplicate-two", { id: "skill.duplicate" });
  const { catalog } = await collectRepositorySnapshot(fixture.root);
  const report = resolveDeclaredComposition(catalog, "skill.a");
  assert.deepEqual(
    report.requiredAssets.map((a) => a.id),
    ["skill.b"],
  );
  assert.deepEqual(report.optionalAssets, []);
  assert.ok(report.requiredCycles.length > 0);
  const optionalOnly = resolveDeclaredComposition(
    {
      ...catalog,
      dependencies: catalog.dependencies.filter((d) => d.kind !== "requires"),
    },
    "skill.a",
  );
  assert.ok(optionalOnly.optionalCycles.length > 0);
  assert.ok(
    report.provenanceEdges.some(
      (e) => e.to === "skill.b" && e.membership === "optional",
    ),
  );
  assert.equal(
    report.unresolvedOptional.find((e) => e.declaredTarget === "skill.missing")
      ?.resolutionReason,
    "missing",
  );
  assert.deepEqual(
    report.unresolvedOptional.find(
      (e) => e.declaredTarget === "skill.duplicate",
    )?.candidatePaths,
    ["skills/duplicate-one/SKILL.md", "skills/duplicate-two/SKILL.md"],
  );
  assert.ok(
    declaredCompositionFindings(catalog, "2026-09-20").some(
      (f) =>
        f.details?.relationshipKind === "requires_skill" &&
        f.id.includes("DUPLICATE"),
    ),
  );
  assert.deepEqual(
    resolveDeclaredComposition(
      {
        ...catalog,
        assets: [...catalog.assets].reverse(),
        dependencies: [...catalog.dependencies].reverse(),
      },
      "skill.a",
    ),
    report,
  );
});

test("Skill declarations reject wrong source and target kinds", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.skill("a", {
    metadata: { "requires-skill": '["context.c","lens.d"]' },
  });
  await fixture.context("contexts/c.md", { id: "context.c" });
  await fixture.contextLens("lenses/d.md", { id: "lens.d" });
  await fixture.write(
    "contexts/wrong.md",
    "---\nid: context.wrong\nrequires_skill:\n  - skill.a\n---\n# Wrong\n",
  );
  const { catalog } = await collectRepositorySnapshot(fixture.root);
  assert.deepEqual(
    resolveDeclaredComposition(catalog, "skill.a").kindMismatches.map(
      (m) => m.expectedTargetKind,
    ),
    ["skill", "skill"],
  );
  const mismatch = resolveDeclaredComposition(catalog, "context.wrong")
    .kindMismatches[0]!;
  assert.equal(mismatch.expectedSourceKind, "skill");
  assert.equal(mismatch.evidence?.startLine, 4);
});

for (const status of [
  "suspended",
  "revoked",
  "deprecated",
  "archived",
] as const) {
  test(`Skill dependency lifecycle reuses ${status} required/optional behavior`, async (t) => {
    const fixture = await RepositoryFixture.create({ testContext: t });
    await fixture.skill("a", {
      status: "stable",
      metadata: {
        "requires-skill": '["skill.b"]',
        "optional-skill": '["skill.b"]',
      },
    });
    await fixture.skill("b", {
      status,
      statusReason: "Reviewed lifecycle decision",
      statusChangedAt: "2026-07-01",
    });
    const snapshot = await collectRepositorySnapshot(fixture.root);
    const report = resolveDeclaredComposition(snapshot.catalog, "skill.a");
    assert.ok(
      report.lifecycleFindings.some(
        (f) => f.assetId === "skill.b" && f.status === status,
      ),
    );
    assert.equal(
      report.requiredComplete,
      status !== "suspended" && status !== "revoked",
    );
    const diagnostics = snapshot.diagnostics ?? [];
    if (status === "suspended" || status === "revoked") {
      assert.ok(
        diagnostics.some(
          (d) =>
            d.details?.relationship === "requires_skill" &&
            d.severity === "error",
        ),
      );
      assert.ok(
        diagnostics.some(
          (d) =>
            d.details?.relationship === "optional_skill" &&
            d.severity === "warning",
        ),
      );
    } else {
      assert.ok(
        diagnostics.some(
          (d) => d.details?.targetStatus === status && d.severity === "warning",
        ),
      );
    }
  });
}

function document(content: string) {
  return parseDocument({
    path: "skills/demo/SKILL.md",
    absolutePath: "/repo/skills/demo/SKILL.md",
    kind: "skill",
    sizeBytes: content.length,
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  });
}

test("canonical Skill dependency parsing, malformed values and migration retain existing boundaries", () => {
  const valid = document(
    `---\nname: demo\ndescription: Review demo inputs when requested.\nmetadata:\n  renma.requires-skill: '["skill.b"]'\n  renma.optional-skill: '["skill.c"]'\n---\n# Demo\n`,
  );
  assert.deepEqual(parseAssetMetadata(valid).metadata.requiresSkill, [
    "skill.b",
  ]);
  assert.deepEqual(parseAssetMetadata(valid).metadata.optionalSkill, [
    "skill.c",
  ]);
  for (const value of [
    "'[1]'",
    "'skill.b'",
    "[skill.b]",
    '\'{"id":"skill.b"}\'',
  ]) {
    const result = parseAssetMetadata(
      document(valid.artifact.content!.replace("'[\"skill.b\"]'", value)),
    );
    assert.equal(result.metadata.requiresSkill, undefined);
    assert.ok(
      result.diagnostics.length > 0 ||
        validateAgentSkill(
          document(valid.artifact.content!.replace("'[\"skill.b\"]'", value)),
        ).issues.length > 0,
    );
  }
  const legacy = document(
    "---\nid: skill.demo\nrequires_skill:\n  - skill.b\noptional_skill:\n  - skill.c\n---\n# Demo\n",
  );
  assert.equal(parseAssetMetadata(legacy).metadata.requiresSkill, undefined);
  const migration = buildAgentSkillMigrationSuggestion(legacy);
  assert.equal(
    migration.candidateRenmaMetadata["renma.requires-skill"],
    '["skill.b"]',
  );
  assert.equal(
    migration.candidateRenmaMetadata["renma.optional-skill"],
    '["skill.c"]',
  );
  assert.equal(
    buildCatalog([valid]).catalog.dependencies[0]?.declaration,
    "requires_skill",
  );
});

test("semantic diff and CI retain additions, removals and required/optional Skill changes", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.git(["init"]);
  await fixture.git(["config", "user.name", "Renma Test"]);
  await fixture.git(["config", "user.email", "test@example.invalid"]);
  await fixture.skill("a");
  await fixture.skill("b");
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base"]);
  for (const [before, after] of [
    [undefined, "requires"],
    ["requires", "optional"],
    ["optional", "requires"],
    ["requires", undefined],
  ] as const) {
    await fixture.skill("a", {
      metadata: after ? { [`${after}-skill`]: '["skill.b"]' } : {},
    });
    await fixture.git(["add", "."]);
    await fixture.git(["commit", "-m", "dependency change"]);
    const report = await diff(fixture.root, {
      fromRef: "HEAD~1",
      toRef: "HEAD",
    });
    assert.deepEqual(
      report.graph.addedEdges
        .filter((e) => e.target === "skill.b")
        .map((e) => e.kind),
      after ? [after] : [],
    );
    assert.deepEqual(
      report.graph.removedEdges
        .filter((e) => e.target === "skill.b")
        .map((e) => e.kind),
      before ? [before] : [],
    );
    const ci = buildCiReportFromDiff(report);
    assert.ok(JSON.stringify(ci).includes("skill.b"));
    assert.equal(
      formatCiReport(ci, "markdown"),
      formatCiReport(ci, "markdown"),
    );
  }
});
