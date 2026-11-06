import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { RepositoryFixture } from "./repository-fixture.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";
import { buildCatalog } from "../src/catalog.js";
import { collectSecurityPolicyAssetEvidence } from "../src/security-policy-inventory.js";
import { buildSecurityPolicyChanges } from "../src/security-policy-diff.js";
import { buildExecutableSurfaceDiff } from "../src/executable-surface-diff.js";
import { graphFromRepositorySnapshot } from "../src/commands/graph.js";
import { executableGraphReport } from "../src/commands/executable-graph.js";
import { buildBomReport } from "../src/commands/bom.js";
import { buildTrustGraph } from "../src/trust-graph.js";
import {
  buildRepositoryScriptParentIndex,
  resolveRepositoryScriptParent,
} from "../src/repository-script-parent.js";
import {
  collectTargetDocumentEvidence,
  collectTargetRepositoryEvidence,
} from "../src/evidence/target.js";

function readme(root: string, body: string, network = false): string {
  return `---\nid: ${root}.deployment\nowner: platform\nstatus: stable\nwhen_to_use: [reviewing deployment]\nwhen_not_to_use: [selecting runtime behavior]\npurpose: Review deployment\napplies_to: []\nnetwork_allowed: ${network}\nexternal_upload_allowed: false\nsecrets_allowed: false\nrequires_human_approval: true\n---\n# Deployment\n\n${body}\n`;
}

for (const root of ["contexts", "lenses"]) {
  test(`${root} README supplies owner, policy and provenance to local scripts only`, async (t) => {
    const fixture = await RepositoryFixture.create({ testContext: t });
    const parent = `${root}/deployment/README.md`;
    const script = `${root}/deployment/scripts/run.sh`;
    const adjacent = `${root}/deployment/check.py`;
    const unused = `${root}/deployment/scripts/unused.py`;
    await fixture.write(
      parent,
      readme(root, "Run `bash scripts/run.sh`.\n\n[Check](check.py)"),
    );
    await fixture.write(script, "#!/bin/sh\necho ready\n");
    await fixture.write(adjacent, "print('check')\n");
    await fixture.write(unused, "print('unused')\n");
    await fixture.write(
      `${root}/other.md`,
      readme("other", `Run \`bash ${unused}\`.`, true).replace(
        "owner: platform",
        "owner: other-team",
      ),
    );
    const snapshot = await collectRepositorySnapshot(fixture.root);
    for (const sourcePath of [script, adjacent, unused]) {
      const asset = snapshot.catalog.assets.find(
        (asset) => asset.sourcePath === sourcePath,
      )!;
      assert.deepEqual(asset.ownership, {
        declaredOwner: null,
        effectiveOwner: "platform",
        source: "inherited",
        inheritedFrom: { id: `${root}.deployment`, sourcePath: parent },
      });
      const policy = snapshot.securityPolicies.find(
        (policy) => policy.path === sourcePath,
      )!;
      assert.equal(policy.hasLocalPolicyMetadata, false);
      assert.equal(policy.effectivePolicy.networkAllowed, false);
      assert.equal(policy.effectivePolicy.externalUploadAllowed, false);
      assert.equal(policy.effectivePolicy.secretsAllowed, false);
      assert.equal(policy.effectivePolicy.humanApprovalRequired, true);
      assert.ok(policy.policySources.includes("owning_asset"));
      assert.ok(!policy.policySources.includes("owning_skill"));
      assert.equal(policy.inheritedFrom?.sourcePath, parent);
      assert.equal(
        snapshot.classifications.get(sourcePath)?.parentAssetPath,
        parent,
      );
      const surface = snapshot.executableSurfaceInventory.surfaces.find(
        (surface) => surface.path === sourcePath,
      )!;
      assert.equal(surface.owningAsset?.sourcePath, parent);
      assert.equal(surface.parentResolution, "resolved");
      assert.equal(surface.reachableFromOwningAsset, sourcePath !== unused);
      assert.equal(surface.owningSkill, undefined);
      for (const kind of [
        "owns_local_resource",
        "inherits_owner",
        "inherits_policy",
      ]) {
        assert.ok(
          snapshot.catalog.dependencies.some(
            (edge) =>
              edge.kind === kind &&
              (kind === "owns_local_resource"
                ? edge.from === `${root}.deployment` && edge.to === sourcePath
                : edge.from === sourcePath && edge.to === `${root}.deployment`),
          ),
        );
      }
    }
    const graph = executableGraphReport(
      graphFromRepositorySnapshot(snapshot),
      snapshot.executableSurfaceInventory,
      snapshot.skillParents,
    );
    assert.equal(
      graph.edges.filter(
        (edge) =>
          edge.kind === "contains" && edge.from === `${root}.deployment`,
      ).length,
      3,
    );
    const findings = scanFromRepositorySnapshot(snapshot).findings;
    assert.ok(
      findings.some(
        (f) =>
          f.id === "SUPPORT-UNREACHABLE-SCRIPT" && f.evidence.path === unused,
      ),
    );
    assert.ok(
      !findings.some(
        (f) =>
          f.id === "SUPPORT-UNREACHABLE-SCRIPT" && f.evidence.path === script,
      ),
    );

    const target = await collectTargetRepositoryEvidence(
      await collectTargetDocumentEvidence(fixture.resolve(script), {
        unresolvedArtifactPath: "input",
      }),
    );
    assert.equal(target.state, "resolved");
    if (target.state === "resolved") {
      assert.equal(target.classification.parentAssetPath, parent);
      assert.equal(target.governance?.policyInheritedFrom, parent);
      assert.equal(target.governance?.metadataState, "not-required");
    }
    const ajv = new Ajv2020({
      strict: true,
      strictRequired: false,
      allowUnionTypes: true,
    });
    addFormats.default(ajv);
    const validateBom = ajv.compile(
      JSON.parse(
        await readFile(
          "docs/schemas/repository-context-bom-v3.schema.json",
          "utf8",
        ),
      ),
    );
    assert.ok(
      validateBom(buildBomReport(snapshot, { omitGeneratedAt: true })),
      JSON.stringify(validateBom.errors),
    );
    const trust = buildTrustGraph({
      catalog: snapshot.catalog,
      securityPolicies: snapshot.securityPolicies,
    });
    const validateTrust = ajv.compile(
      JSON.parse(
        await readFile("docs/schemas/trust-graph-v2.schema.json", "utf8"),
      ),
    );
    assert.ok(validateTrust(trust), JSON.stringify(validateTrust.errors));
    assert.equal(await fixture.read(script), "#!/bin/sh\necho ready\n");
  });
}

test("missing, excluded, ambiguous and shared parents never infer governance", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/package/README.md",
    readme("contexts", "[Run](scripts/run.py)"),
  );
  await fixture.write("contexts/package/scripts/run.py", "print('run')\n");
  await fixture.write(
    "contexts/package/nested/scripts/run.py",
    "print('nested')\n",
  );
  await fixture.write("contexts/shared/scripts/run.py", "print('shared')\n");
  await fixture.write(
    "contexts/shared/one.md",
    readme("one", "[Run](scripts/run.py)"),
  );
  await fixture.write(
    "contexts/shared/two.md",
    readme("two", "[Run](scripts/run.py)"),
  );
  await fixture.write(
    "contexts/README.md",
    readme("root", "[Run](scripts/run.py)"),
  );
  await fixture.write("contexts/scripts/run.py", "print('root shared')\n");
  const snapshot = await collectRepositorySnapshot(fixture.root);
  for (const sourcePath of [
    "contexts/package/nested/scripts/run.py",
    "contexts/shared/scripts/run.py",
    "contexts/scripts/run.py",
  ]) {
    assert.equal(
      snapshot.catalog.assets.find((asset) => asset.sourcePath === sourcePath)
        ?.ownership.source,
      "unowned",
    );
    assert.equal(
      snapshot.securityPolicies.find((policy) => policy.path === sourcePath)
        ?.hasEffectivePolicy,
      false,
    );
  }
  const original = snapshot.documents.find(
    (document) => document.artifact.path === "contexts/package/README.md",
  )!;
  const duplicate = {
    ...original,
    artifact: { ...original.artifact, path: "contexts/package/readme.md" },
  };
  const documents = [...snapshot.documents, duplicate];
  const index = buildRepositoryScriptParentIndex(documents);
  assert.equal(
    resolveRepositoryScriptParent("contexts/package/scripts/run.py", index)
      .state,
    "ambiguous",
  );
  const catalog = buildCatalog(documents);
  assert.equal(
    catalog.catalog.assets.find(
      (asset) => asset.sourcePath === "contexts/package/scripts/run.py",
    )?.ownership.source,
    "unowned",
  );
  assert.ok(
    catalog.diagnostics.some((d) =>
      /Ambiguous Context\/Lens README/.test(d.message),
    ),
  );
  assert.equal(
    collectSecurityPolicyAssetEvidence(documents).find(
      (policy) => policy.path === "contexts/package/scripts/run.py",
    )?.hasEffectivePolicy,
    false,
  );
  await fixture.writeConfig({ exclude: ["contexts/package/README.md"] });
  const excluded = await collectRepositorySnapshot(fixture.root);
  assert.equal(
    excluded.classifications.get("contexts/package/scripts/run.py")
      ?.parentResolution,
    "missing",
  );
  assert.equal(
    excluded.catalog.assets.find(
      (asset) => asset.sourcePath === "contexts/package/scripts/run.py",
    )?.ownership.source,
    "unowned",
  );
  assert.equal(
    excluded.securityPolicies.find(
      (policy) => policy.path === "contexts/package/scripts/run.py",
    )?.hasEffectivePolicy,
    false,
  );
});

test("parent reference closure is cycle safe and diagnoses missing guidance and deep chains", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/package/README.md",
    readme("contexts", "No local instructions."),
  );
  await fixture.write("contexts/package/scripts/run.py", "print('run')\n");
  const before = await collectRepositorySnapshot(fixture.root);
  assert.ok(
    scanFromRepositorySnapshot(before).findings.some(
      (f) => f.id === "SUPPORT-MISSING-REACHABILITY-GUIDANCE",
    ),
  );
  await fixture.write(
    "contexts/package/README.md",
    readme("contexts", "[Index](one.md)"),
  );
  await fixture.write(
    "contexts/package/one.md",
    readme("one", "[Next](two.md)"),
  );
  await fixture.write(
    "contexts/package/two.md",
    readme("two", "[Cycle](one.md)\n\n[Run](scripts/run.py)"),
  );
  const after = await collectRepositorySnapshot(fixture.root);
  const surface = after.executableSurfaceInventory.surfaces[0]!;
  assert.equal(surface.reachableFromOwningAsset, true);
  assert.equal(surface.owningAssetReferenceDepth, 3);
  assert.ok(
    scanFromRepositorySnapshot(after).findings.some(
      (f) => f.id === "SUPPORT-DEEP-REFERENCE-CHAIN",
    ),
  );
  const diff = buildExecutableSurfaceDiff(
    before.executableSurfaceInventory,
    after.executableSurfaceInventory,
  );
  assert.ok(
    diff.changedSurfaces.some((change) =>
      change.reasons.includes("reachability"),
    ),
  );
});

test("README policy changes propagate to scripts with owning-asset provenance", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/package/README.md",
    readme("contexts", "[Run](scripts/run.py)", false),
  );
  await fixture.write("contexts/package/scripts/run.py", "print('run')\n");
  const before = await collectRepositorySnapshot(fixture.root);
  await fixture.write(
    "contexts/package/README.md",
    readme("contexts", "[Run](scripts/run.py)", true),
  );
  const after = await collectRepositorySnapshot(fixture.root);
  const changes = buildSecurityPolicyChanges({
    fromAssets: before.securityPolicies,
    toAssets: after.securityPolicies,
  });
  const inherited = changes.policyChanges.find(
    (change) => change.asset.path === "contexts/package/scripts/run.py",
  );
  assert.ok(inherited);
  const network = inherited.fields.find(
    (field) => field.field === "networkAllowed",
  )!;
  assert.equal(network.provenance.mode, "inherited");
  assert.ok(
    network.provenance.sources.some(
      (source) =>
        source.type === "owning_asset" &&
        source.path === "contexts/package/README.md",
    ),
  );
});

test("README policy profiles are inherited independently of owner and raw script contents", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/package/README.md",
    readme("contexts", "[Run](scripts/run.py)")
      .replace("owner: platform\n", "")
      .replace("network_allowed: false", "security_profile: restricted"),
  );
  await fixture.write(
    "contexts/package/scripts/run.py",
    "# network_allowed: true\nprint('run')\n",
  );
  await fixture.writeConfig({
    security: {
      disallowedCommands: ["curl"],
      profiles: {
        restricted: { network_allowed: false, allowed_data: ["public"] },
      },
    },
  });
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const script = snapshot.catalog.assets.find((asset) =>
    asset.sourcePath.endsWith("run.py"),
  )!;
  assert.equal(script.ownership.source, "unowned");
  const policy = snapshot.securityPolicies.find(
    (policy) => policy.path === script.sourcePath,
  )!;
  assert.equal(policy.effectivePolicy.networkAllowed, false);
  assert.deepEqual(policy.effectivePolicy.allowedData, ["public"]);
  assert.deepEqual(policy.effectivePolicy.disallowedCommands, ["curl"]);
  assert.deepEqual(policy.policySources, [
    "local",
    "security_profile",
    "repository_config",
    "owning_asset",
  ]);
  assert.equal(policy.hasLocalPolicyMetadata, false);
  assert.equal(policy.selectedSecurityProfile, "restricted");
  assert.ok(
    policy.evidence.policyFields.every(
      (evidence) => evidence.path === "contexts/package/README.md",
    ),
  );
  assert.ok(
    !snapshot.catalog.dependencies.some(
      (edge) => edge.from === script.id && edge.kind === "inherits_owner",
    ),
  );
  assert.ok(
    snapshot.catalog.dependencies.some(
      (edge) => edge.from === script.id && edge.kind === "inherits_policy",
    ),
  );
});
