import {
  collectTargetDocumentEvidence,
  collectTargetRepositoryEvidence,
} from "../src/evidence/target.js";
import { captureProcessOutput } from "./process-output.js";
import { runGraphCommand } from "../src/commands/graph.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { RepositoryFixture } from "./repository-fixture.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { buildCatalog } from "../src/catalog.js";
import { graphFromRepositorySnapshot } from "../src/commands/graph.js";
import { executableGraphReport } from "../src/commands/executable-graph.js";
import { buildTrustGraph } from "../src/trust-graph.js";
import { buildBomReport } from "../src/commands/bom.js";
import { ownership } from "../src/commands/ownership.js";
import { readinessFromRepositorySnapshot } from "../src/commands/readiness.js";
import { buildDiffReport } from "../src/commands/diff.js";
import { buildCiReportFromDiff } from "../src/commands/ci-report.js";

const script = "contexts/devkit/f/scripts/probe.py";
const owner = "qe-skills-hub-maintainers";
function context(
  id: string,
  declaredOwner: string | null,
  body: string,
  network = false,
) {
  return `---\nid: ${id}\n${declaredOwner ? `owner: ${declaredOwner}\n` : ""}when_to_use: [testing]\npurpose: Review scripts\napplies_to: [source-0]\nnetwork_allowed: ${network}\n---\n# ${id}\n${body}\n`;
}

for (const scenario of [
  {
    name: "single direct reference",
    owners: [owner],
    effective: owner,
    source: "inherited",
  },
  {
    name: "multiple references with the same owner",
    owners: [owner, owner],
    effective: owner,
    source: "inherited",
  },
  {
    name: "different owners",
    owners: [owner, "other-team"],
    effective: null,
    source: "ambiguous",
  },
  {
    name: "undeclared owner",
    owners: [null],
    effective: null,
    source: "unowned",
  },
  { name: "no references", owners: [], effective: null, source: "unowned" },
  {
    name: "declared and undeclared owners",
    owners: [owner, null],
    effective: owner,
    source: "inherited",
  },
]) {
  test(`direct script ownership: ${scenario.name} agrees across reports`, async (t) => {
    const fixture = await RepositoryFixture.create({ testContext: t });
    const baseline = await collectRepositorySnapshot(fixture.root);
    await fixture.write(script, "from . import helper\nprint('probe')\n");
    await fixture.write(
      "contexts/devkit/f/scripts/helper.py",
      "print('helper')\n",
    );
    for (const [i, candidateOwner] of scenario.owners.entries()) {
      const source =
        i % 2 === 0 ? `contexts/source-${i}.md` : `lenses/source-${i}.md`;
      await fixture.write(
        source,
        context(
          `source-${i}`,
          candidateOwner,
          `[Probe](../${script})\n[Again](../${script})\n\nRun: \`python ${script}\``,
          i % 2 === 0,
        ),
      );
    }
    // A consumer Skill must never become an owner, including when no Context links exist.
    await fixture.skill("consumer", {
      owner: "consumer-team",
      body: `[Probe](../../${script})`,
    });
    const snapshot = await collectRepositorySnapshot(fixture.root);
    const asset = snapshot.catalog.assets.find(
      (asset) => asset.sourcePath === script,
    )!;
    assert.equal(asset.ownership.effectiveOwner, scenario.effective);
    assert.equal(asset.ownership.source, scenario.source);
    assert.equal(asset.ownership.candidates?.length, scenario.owners.length);
    const surface = snapshot.executableSurfaceInventory.surfaces.find(
      (surface) => surface.path === script,
    )!;
    assert.equal(
      surface.parentResolution,
      scenario.owners.length === 0
        ? "missing"
        : scenario.owners.length === 1
          ? "resolved"
          : "ambiguous",
    );
    if (scenario.owners.length === 1) {
      assert.equal(surface.owningAsset?.sourcePath, "contexts/source-0.md");
      assert.equal(surface.reachableFromOwningAsset, true);
      assert.equal(surface.owningAssetReferenceDepth, 1);
    } else {
      assert.equal(surface.owningAsset, undefined);
      assert.equal(surface.reachableFromOwningAsset, undefined);
      assert.equal(surface.owningAssetReferenceDepth, undefined);
    }
    assert.equal(
      snapshot.catalog.assets.find((asset) =>
        asset.sourcePath.endsWith("helper.py"),
      )?.ownership.effectiveOwner,
      null,
    );
    for (const candidate of asset.ownership.candidates!) {
      assert.equal(candidate.references.length, 2);
      for (const reference of candidate.references) {
        assert.equal(reference.path, candidate.sourcePath);
        assert.ok(reference.startLine > 0);
        assert.match(reference.snippet, /Probe|Again/);
      }
      if (candidate.declaredOwner) {
        assert.equal(candidate.ownerEvidence?.path, candidate.sourcePath);
        assert.match(candidate.ownerEvidence!.raw, /owner:/);
      }
      assert.ok(
        snapshot.catalog.dependencies.some(
          (edge) =>
            edge.kind === "statically_references" &&
            edge.from === candidate.id &&
            edge.to === asset.id,
        ),
      );
    }
    if (scenario.owners.length > 1)
      assert.equal(asset.ownership.inheritedFrom, undefined);
    const target = await collectTargetRepositoryEvidence(
      await collectTargetDocumentEvidence(fixture.resolve(script), {
        unresolvedArtifactPath: "input",
      }),
    );
    assert.equal(target.state, "resolved");
    if (target.state === "resolved") {
      assert.deepEqual(target.governance?.ownership, asset.ownership);
      assert.equal(target.governance?.metadataState, "not-required");
      assert.equal(target.governance?.policyInheritedFrom, undefined);
    }
    const policy = snapshot.securityPolicies.find(
      (policy) => policy.path === script,
    )!;
    assert.equal(policy.hasEffectivePolicy, false);
    assert.equal(policy.inheritedFrom, undefined);
    assert.ok(
      !snapshot.catalog.dependencies.some(
        (edge) => edge.from === asset.id && edge.kind === "inherits_policy",
      ),
    );
    // Caller policies remain separate even when all callers have the same owner.
    for (const [i] of scenario.owners.entries()) {
      const source =
        i % 2 === 0 ? `contexts/source-${i}.md` : `lenses/source-${i}.md`;
      assert.equal(
        snapshot.securityPolicies.find((policy) => policy.path === source)
          ?.effectivePolicy.networkAllowed,
        i % 2 === 0,
      );
    }
    for (const candidate of asset.ownership.candidates!) {
      const invocations =
        snapshot.executableSurfaceInventory.invocations.filter(
          (invocation) => invocation.sourcePath === candidate.sourcePath,
        );
      assert.ok(invocations.length > 0);
      assert.ok(
        invocations.every((invocation) =>
          invocation.governance.policyEvidence.some(
            (evidence) => evidence.path === candidate.sourcePath,
          ),
        ),
      );
    }
    assert.ok(
      snapshot.executableSurfaceInventory.dependencies.some(
        (dependency) =>
          dependency.sourcePath === script &&
          dependency.normalizedTarget?.endsWith("helper.py"),
      ),
    );
    const graph = graphFromRepositorySnapshot(snapshot);
    const executable = executableGraphReport(
      graph,
      snapshot.executableSurfaceInventory,
      snapshot.skillParents,
    );
    assert.equal(
      executable.edges.filter((edge) => edge.kind === "contains").length,
      0,
    );
    assert.ok(
      executable.edges.filter(
        (edge) => edge.kind === "statically_references" && edge.to === script,
      ).length >= scenario.owners.length,
    );

    assert.deepEqual(
      graph.nodes.find((node) => node.id === asset.id)?.ownership,
      asset.ownership,
    );
    assert.ok(
      graph.edges.filter(
        (edge) => edge.kind === "statically_references" && edge.to === asset.id,
      ).length >=
        scenario.owners.length + 1,
    );
    const impactOutput = await captureProcessOutput(() =>
      runGraphCommand(fixture.root, {
        view: "asset-impact",
        focus: script,
        format: "json",
      }),
    );
    assert.equal(
      impactOutput.code,
      scenario.owners.some((value, i) => i % 2 === 1 && value === null) ? 1 : 0,
      impactOutput.stdout,
    );
    const impact = JSON.parse(impactOutput.stdout);
    for (const candidate of asset.ownership.candidates!) {
      assert.ok(
        impact.nodes.some(
          (node: { sourcePath: string }) =>
            node.sourcePath === candidate.sourcePath,
        ),
      );
    }
    const own = await ownership(fixture.root, {}, { includeOwned: true });
    const row = [
      ...(own.ownedAssetList ?? []),
      ...(own.unownedAssetList ?? []),
    ].find((row) => row.id === asset.id)!;
    assert.deepEqual(row.ownership, asset.ownership);
    const ready = readinessFromRepositorySnapshot(snapshot);
    assert.equal(
      ready.summary.unownedAssets,
      snapshot.catalog.assets.filter((asset) => !asset.ownership.effectiveOwner)
        .length,
    );
    const bom = buildBomReport(snapshot, { omitGeneratedAt: true });
    assert.deepEqual(
      bom.assets.find((entry) => entry.id === asset.id)?.ownership,
      asset.ownership,
    );
    for (const candidate of asset.ownership.candidates!) {
      assert.ok(
        bom.assets
          .find((entry) => entry.id === asset.id)
          ?.dependents.some(
            (dependent) =>
              dependent.sourcePath === candidate.sourcePath &&
              dependent.kind === "statically_references",
          ),
      );
    }
    const ajv = new Ajv2020({
      strict: true,
      strictRequired: false,
      allowUnionTypes: true,
    });
    addFormats.default(ajv);
    const validate = ajv.compile(
      JSON.parse(
        await readFile(
          "docs/schemas/repository-context-bom-v3.schema.json",
          "utf8",
        ),
      ),
    );
    assert.ok(validate(bom), JSON.stringify(validate.errors));
    const validateTrust = ajv.compile(
      JSON.parse(
        await readFile("docs/schemas/trust-graph-v2.schema.json", "utf8"),
      ),
    );
    const trust = buildTrustGraph({
      catalog: snapshot.catalog,
      securityPolicies: snapshot.securityPolicies,
    });
    assert.ok(validateTrust(trust), JSON.stringify(validateTrust.errors));
    const unchanged = buildDiffReport(
      fixture.root,
      { ref: "before", root: fixture.root, graph, readiness: ready },
      {
        ref: "after",
        root: fixture.root,
        graph: structuredClone(graph),
        readiness: ready,
      },
    );
    assert.deepEqual(unchanged.catalog.changedAssets, []);

    const ci = buildCiReportFromDiff(
      buildDiffReport(
        fixture.root,
        {
          ref: "before",
          root: fixture.root,
          graph: graphFromRepositorySnapshot(baseline),
          readiness: readinessFromRepositorySnapshot(baseline),
        },
        { ref: "after", root: fixture.root, graph, readiness: ready },
      ),
    );
    assert.deepEqual(
      ci.diff.catalog.addedAssets.find((entry) => entry.id === asset.id)
        ?.ownership,
      asset.ownership,
    );
    assert.ok(
      ci.diff.graph.addedEdges.filter(
        (edge) =>
          edge.kind === "statically_references" && edge.target === asset.id,
      ).length >=
        scenario.owners.length + 1,
    );
  });
}

for (const targetState of [
  "missing",
  "excluded",
  "oversized",
  "inspected",
] as const) {
  test(`owner conflicts are diagnosed only for inspected scripts: ${targetState}`, async (t) => {
    const fixture = await RepositoryFixture.create({ testContext: t });
    for (const [id, declaredOwner] of [
      ["one", "team-one"],
      ["two", "team-two"],
    ]) {
      await fixture.write(
        `contexts/${id}.md`,
        context(id!, declaredOwner!, `[Probe](${script})`),
      );
    }
    if (targetState !== "missing") {
      await fixture.write(
        script,
        targetState === "oversized"
          ? "# padding\n".repeat(300)
          : "print('probe')\n",
      );
    }
    await fixture.writeConfig({
      max_file_size_bytes: 1024,
      ...(targetState === "excluded" ? { exclude: [script] } : {}),
    });
    const snapshot = await collectRepositorySnapshot(fixture.root);
    const asset = snapshot.catalog.assets.find(
      (asset) => asset.sourcePath === script,
    );
    const conflicts = snapshot.catalogDiagnostics.filter((diagnostic) =>
      diagnostic.message.startsWith("Ambiguous Context/Lens script ownership"),
    );
    if (targetState === "inspected") {
      assert.equal(asset?.ownership.source, "ambiguous");
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0]?.path, script);
      assert.deepEqual(
        conflicts[0]?.details?.candidates,
        asset?.ownership.candidates,
      );
    } else {
      assert.equal(asset, undefined);
      assert.deepEqual(conflicts, []);
      assert.ok(
        !snapshot.catalog.dependencies.some(
          (edge) => edge.kind === "inherits_owner" && edge.from === script,
        ),
      );
    }
  });
}

test("excluded and uninspected sources supply no ownership candidates", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(script, "print('probe')\n");
  await fixture.write(
    "contexts/excluded.md",
    context("excluded", owner, `[Probe](${script})`),
  );
  await fixture.write(
    "contexts/oversized.md",
    context("oversized", owner, `[Probe](${script})\n${"x".repeat(3000)}`),
  );
  const inspected = await collectRepositorySnapshot(fixture.root);
  const ineligible = buildCatalog(
    inspected.documents.map((document) => ({
      ...document,
      artifact: { ...document.artifact, markdownParserEligible: false },
    })),
  );
  assert.deepEqual(
    ineligible.catalog.assets.find((asset) => asset.sourcePath === script)
      ?.ownership.candidates,
    [],
  );
  await fixture.writeConfig({
    exclude: ["contexts/excluded.md"],
    max_file_size_bytes: 1024,
  });
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const asset = snapshot.catalog.assets.find(
    (asset) => asset.sourcePath === script,
  )!;
  assert.equal(asset.ownership.source, "unowned");
  assert.deepEqual(asset.ownership.candidates, []);
  assert.equal(
    snapshot.securityPolicies.find((policy) => policy.path === script)
      ?.hasEffectivePolicy,
    false,
  );
});

test("README placement, imports and prose references supply no ownership", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(script, "print('probe')\n");
  await fixture.write(
    "contexts/devkit/f/README.md",
    context("readme", owner, "No links."),
  );
  await fixture.write(
    "contexts/usage.md",
    context("usage", owner, `Use \`${script}\`.\n\`python ${script}\``),
  );
  await fixture.write(
    "contexts/devkit/f/scripts/importer.py",
    "import probe\n",
  );
  await fixture.write(
    "contexts/devkit/f/scripts/importer.mjs",
    "import './probe.py';\n",
  );
  const snapshot = await collectRepositorySnapshot(fixture.root);
  assert.equal(
    snapshot.catalog.assets.find((asset) => asset.sourcePath === script)
      ?.ownership.source,
    "unowned",
  );
  assert.ok(
    snapshot.catalog.dependencies.some(
      (edge) =>
        edge.kind === "statically_references" &&
        edge.sourcePath === "contexts/usage.md",
    ),
  );
  const withoutInspectedSource = buildCatalog(
    snapshot.documents.filter(
      (document) => document.artifact.path !== "contexts/usage.md",
    ),
  );
  assert.equal(
    withoutInspectedSource.catalog.assets.find(
      (asset) => asset.sourcePath === script,
    )?.ownership.source,
    "unowned",
  );
});

test("CI retains ownership provenance changes and references when a new owner conflicts", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(script, "print('probe')\n");
  await fixture.write(
    "contexts/one.md",
    context("one", owner, `[Probe](${script})`),
  );
  const before = await collectRepositorySnapshot(fixture.root);
  await fixture.write(
    "lenses/two.md",
    context("two", "another-team", `[Probe](${script})`),
  );
  const after = await collectRepositorySnapshot(fixture.root);
  const endpoint = (ref: string, snapshot: typeof before) => ({
    ref,
    root: fixture.root,
    graph: graphFromRepositorySnapshot(snapshot),
    readiness: readinessFromRepositorySnapshot(snapshot),
  });
  const ci = buildCiReportFromDiff(
    buildDiffReport(
      fixture.root,
      endpoint("before", before),
      endpoint("after", after),
    ),
  );
  const change = ci.diff.catalog.changedAssets.find(
    (change) => change.to.path === script,
  )!;
  assert.equal(change.from.effectiveOwner, owner);
  assert.equal(change.to.effectiveOwner, null);
  assert.equal(change.to.ownership?.source, "ambiguous");
  assert.equal(change.to.ownership?.candidates?.length, 2);
  assert.ok(change.changedFields.includes("ownership"));
  assert.ok(
    !ci.diff.graph.removedEdges.some(
      (edge) => edge.kind === "statically_references",
    ),
  );
  assert.ok(
    ci.diff.graph.addedEdges.some(
      (edge) => edge.kind === "statically_references" && edge.source === "two",
    ),
  );
});
