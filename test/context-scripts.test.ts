import assert from "node:assert/strict";
import { access, readFile, symlink } from "node:fs/promises";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { RepositoryFixture } from "./repository-fixture.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";
import { graphFromRepositorySnapshot } from "../src/commands/graph.js";
import {
  executableGraphReport,
  formatExecutableGraphMarkdown,
  formatExecutableGraphMermaid,
} from "../src/commands/executable-graph.js";
import { buildBomReport, formatBomMarkdown } from "../src/commands/bom.js";
import { buildExecutionContract } from "../src/commands/execution-contract.js";
import { buildExecutableSurfaceDiff } from "../src/executable-surface-diff.js";
import { zeroExecutableSurfaceInventory } from "../src/executable-surface-inventory.js";
import { evaluateExecutableSurfaceCiPolicy } from "../src/executable-surface-ci-policy.js";
import { resolveHelperScriptPath } from "../src/helper-command-evidence.js";
import { evaluateStrictScan } from "../src/strict-scan.js";

const context = (id: string, body: string) => `---
id: ${id}
owner: platform
status: stable
when_to_use: [reviewing deployment]
when_not_to_use: [selecting runtime behavior]
network_allowed: false
---
# Deployment

${body}
`;

for (const root of ["contexts", "lenses"] as const) {
  test(`${root} scripts use the shared discovery, invocation and dependency pipeline without execution`, async (t) => {
    const fixture = await RepositoryFixture.create({ testContext: t });
    const source = `${root}/deployment/README.md`;
    const prefix = `${root}/deployment/scripts`;
    await fixture.write(
      source,
      root === "contexts"
        ? context(
            "context.deployment",
            "Run: `bash scripts/collect.sh`\n\nRun: `python scripts/validate.py`\n\nRun: `node scripts/filter.js`",
          )
        : `---\nid: lens.deployment\nowner: platform\npurpose: Review deployment\napplies_to: []\n---\n# Deployment\n\nRun: \`bash scripts/collect.sh\`\n\nRun: \`python scripts/validate.py\`\n\nRun: \`node scripts/filter.js\`\n`,
    );
    await fixture.write(
      `${prefix}/collect.sh`,
      `#!/bin/sh\n. ./shared.sh\ntouch '${fixture.resolve("EXECUTED")}'\n`,
    );
    await fixture.write(`${prefix}/shared.sh`, "#!/bin/sh\necho ready\n");
    await fixture.write(`${prefix}/validate.py`, "from . import helper\n");
    await fixture.write(`${prefix}/helper.py`, "VALUE = 1\n");
    await fixture.write(`${prefix}/filter.js`, 'import "./helper.js";\n');
    await fixture.write(`${prefix}/helper.js`, "export const value = 1;\n");
    await fixture.write(`${prefix}/unused.ts`, "export const unused = true;\n");
    const snapshot = await collectRepositorySnapshot(fixture.root);
    const result = scanFromRepositorySnapshot(snapshot);
    const inventory = snapshot.executableSurfaceInventory;
    assert.equal(inventory.surfaces.length, 7);
    assert.equal(inventory.summary.repositoryScriptSurfaces, 7);
    assert.ok(
      inventory.surfaces.every(
        (surface) =>
          surface.scope === "repository-script" &&
          surface.artifactKind === "script" &&
          !surface.owningSkill,
      ),
    );
    assert.equal(inventory.summary.resolvedInvocations, 3);
    assert.equal(inventory.summary.resolvedDependencies, 3);
    assert.equal(inventory.summary.directlyInvokedSurfaces, 3);
    assert.equal(inventory.summary.transitivelyReachableSurfaces, 3);
    assert.equal(inventory.summary.unreachedFromInvocationSurfaces, 1);
    assert.ok(
      inventory.surfaces.every(
        (surface) => surface.securityPolicy.hasEffectivePolicy === false,
      ),
    );
    assert.equal(
      result.findings.filter((finding) => /HELPER.*NON_TOOLS/.test(finding.id))
        .length,
      0,
    );
    const graph = executableGraphReport(
      graphFromRepositorySnapshot(snapshot),
      inventory,
      snapshot.skillParents,
      source,
    );
    assert.equal(
      graph.edges.filter((edge) => edge.kind === "invokes").length,
      3,
    );
    assert.equal(
      graph.edges.filter((edge) => edge.kind === "contains").length,
      0,
    );
    assert.match(formatExecutableGraphMarkdown(graph), /collect\.sh/);
    assert.match(formatExecutableGraphMermaid(graph), /\|invokes\|/);
    const bom = buildBomReport(snapshot, { omitGeneratedAt: true });
    assert.deepEqual(bom.executableSurfaceInventory, inventory);
    assert.ok(
      bom.assets.some(
        (asset) =>
          asset.sourcePath === `${prefix}/validate.py` &&
          asset.kind === "script",
      ),
    );
    assert.match(formatBomMarkdown(bom), /7 Context\/Lens scripts/);
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
    assert.deepEqual(
      (await collectRepositorySnapshot(fixture.root))
        .executableSurfaceInventory,
      inventory,
    );
    await assert.rejects(access(fixture.resolve("EXECUTED")));
  });
}

test("individual Context/Lens references retain source identity with ambiguous ownership and without directory expansion or invocation", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/deployment.md",
    context(
      "context.deployment",
      "[Check](scripts/check.py)\n\nSee `lenses/scripts/filter.js`.\n\n[scripts](scripts/)\n\n`scripts/*`",
    ),
  );
  await fixture.contextLens("lenses/review.md", {
    id: "lens.review",
    owner: "reviewers",
    purpose: "Review deployment",
    body: "# Review\n\n[Check](../contexts/scripts/check.py)\n",
  });
  await fixture.write("contexts/scripts/check.py", "print('check')\n");
  await fixture.write("contexts/scripts/unreferenced.py", "print('unused')\n");
  await fixture.write("lenses/scripts/filter.js", "export {};\n");
  await fixture.write(
    "contexts/scripts/guide.md",
    context("context.guide", "Existing Markdown context."),
  );
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const inventory = snapshot.executableSurfaceInventory;
  assert.equal(inventory.surfaces.length, 3);
  assert.equal(inventory.invocations.length, 0);
  const check = inventory.surfaces.find(
    (surface) => surface.path === "contexts/scripts/check.py",
  )!;
  assert.equal(check.referenceCount, 2);
  assert.equal(
    check.dependencyEvidence.staticInvocationReachability,
    "unreached",
  );
  assert.equal(check.securityPolicy.hasEffectivePolicy, false);
  assert.equal(
    inventory.surfaces.find((surface) =>
      surface.path.endsWith("unreferenced.py"),
    )?.staticallyReferenced,
    false,
  );
  assert.equal(
    snapshot.catalog.assets.find((asset) => asset.sourcePath === check.path)
      ?.ownership.source,
    "ambiguous",
  );
  assert.equal(
    snapshot.catalog.assets.find((asset) =>
      asset.sourcePath.endsWith("guide.md"),
    )?.kind,
    "context",
  );
  const fullGraph = graphFromRepositorySnapshot(snapshot);
  const executable = executableGraphReport(
    fullGraph,
    inventory,
    snapshot.skillParents,
  );
  assert.deepEqual(
    executable.edges.map((edge) => [edge.from, edge.to, edge.kind]),
    [
      [
        "context.deployment",
        "contexts/scripts/check.py",
        "statically_references",
      ],
      [
        "context.deployment",
        "lenses/scripts/filter.js",
        "statically_references",
      ],
      ["lens.review", "contexts/scripts/check.py", "statically_references"],
    ],
  );
  assert.ok(
    fullGraph.edges.some(
      (edge) => edge.from === "lens.review" && edge.targetPath === check.path,
    ),
  );
});

test("Skill-local behavior and script security stay unchanged when Context/Lens scripts are added", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.skill("deploy", {
    owner: "platform",
    metadata: { "network-allowed": "false" },
    body: "# Deploy\n\nRun: `bash scripts/run.sh`\n",
  });
  const shell = "#!/bin/sh\n# review\u202e marker\necho ready\n";
  await fixture.write("skills/deploy/scripts/run.sh", shell);
  const before = await collectRepositorySnapshot(fixture.root);
  const beforeScan = scanFromRepositorySnapshot(before);
  const beforeContract = buildExecutionContract(before, {
    entrypoint: "skill.deploy",
  });
  await fixture.write(
    "contexts/deploy.md",
    context("context.deploy", "Run: `bash scripts/run.sh`"),
  );
  await fixture.write("contexts/scripts/run.sh", shell);
  await fixture.write("lenses/scripts/run.sh", shell);
  const after = await collectRepositorySnapshot(fixture.root);
  const afterScan = scanFromRepositorySnapshot(after);
  assert.deepEqual(
    after.executableSurfaceInventory.surfaces.filter(
      (surface) => surface.scope === "skill-local",
    ),
    before.executableSurfaceInventory.surfaces,
  );
  assert.deepEqual(
    after.executableSurfaceInventory.invocations.filter((invocation) =>
      invocation.sourcePath.startsWith("skills/"),
    ),
    before.executableSurfaceInventory.invocations,
  );
  assert.deepEqual(
    buildExecutionContract(after, { entrypoint: "skill.deploy" }),
    beforeContract,
  );
  const security = (result: typeof beforeScan, source: string) =>
    result.findings
      .filter(
        (finding) =>
          finding.category === "safety" && finding.evidence.path === source,
      )
      .map((finding) => [finding.id, finding.severity]);
  assert.deepEqual(
    security(afterScan, "contexts/scripts/run.sh"),
    security(beforeScan, "skills/deploy/scripts/run.sh"),
  );
  assert.deepEqual(
    security(afterScan, "lenses/scripts/run.sh"),
    security(beforeScan, "skills/deploy/scripts/run.sh"),
  );
  assert.ok(security(afterScan, "contexts/scripts/run.sh").length > 0);
  assert.equal(
    after.executableSurfaceInventory.invocations.find((invocation) =>
      invocation.sourcePath.startsWith("contexts/"),
    )?.governance.hasEffectivePolicyEvidence,
    true,
  );
  assert.equal(
    after.executableSurfaceInventory.surfaces.find(
      (surface) => surface.path === "contexts/scripts/run.sh",
    )?.securityPolicy.hasEffectivePolicy,
    false,
  );
});

test("Context script dependency changes flow through the existing diff and CI policy", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/deploy.md",
    context("context.deploy", "Run: `node scripts/run.js`"),
  );
  await fixture.write(
    "contexts/scripts/run.js",
    'import "../../lenses/scripts/filter.js";\n',
  );
  await fixture.write("lenses/scripts/filter.js", "export {};\n");
  const before = (await collectRepositorySnapshot(fixture.root))
    .executableSurfaceInventory;
  assert.equal(before.summary.resolvedDependencies, 1);
  assert.equal(
    before.surfaces.find((surface) => surface.path.startsWith("lenses/"))
      ?.dependencyEvidence.staticInvocationReachability,
    "transitive",
  );
  await fixture.write("contexts/scripts/run.js", 'import "./missing.js";\n');
  const after = (await collectRepositorySnapshot(fixture.root))
    .executableSurfaceInventory;
  const diff = buildExecutableSurfaceDiff(before, after);
  const evaluation = evaluateExecutableSurfaceCiPolicy(diff, {
    from: "warn",
    to: "warn",
  });
  assert.equal(evaluation.outcome, "warn");
  assert.ok(
    evaluation.matches.some(
      (match) =>
        match.id === "executable_surface_ci.problematic_dependency_added",
    ),
  );
  assert.equal(
    buildExecutableSurfaceDiff(zeroExecutableSurfaceInventory(), after).summary
      .repositoryScriptSurfacesDelta,
    2,
  );
});

test("exact Context references work with narrow discovery without admitting directories or globs", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/deploy.md",
    context(
      "context.deploy",
      "Use scripts/run.py\n\n[scripts](scripts/)\n\nscripts/unused.py*\n\n`scripts/unused.py*`",
    ),
  );
  await fixture.write("contexts/scripts/run.py", "print('run')\n");
  await fixture.write("contexts/scripts/unused.py", "print('unused')\n");
  await fixture.writeConfig({ globs: ["contexts/**/*.md"] });
  const snapshot = await collectRepositorySnapshot(fixture.root);
  assert.deepEqual(
    snapshot.executableSurfaceInventory.surfaces.map((surface) => surface.path),
    ["contexts/scripts/run.py"],
  );
  assert.equal(
    snapshot.executableSurfaceInventory.surfaces[0]?.staticallyReferenced,
    true,
  );
  assert.equal(
    snapshot.executableSurfaceInventory.surfaces[0]?.staticallyInvoked,
    false,
  );
  await fixture.writeConfig({
    globs: ["contexts/**/*.md"],
    exclude: ["contexts/scripts/run.py"],
  });
  const excluded = await collectRepositorySnapshot(fixture.root);
  assert.equal(excluded.executableSurfaceInventory.surfaces.length, 0);
  assert.equal(
    excluded.repositoryPathStates.get("contexts/scripts/run.py"),
    "excluded",
  );
  const excludedScan = scanFromRepositorySnapshot(excluded);
  assert.ok(
    excludedScan.inspectionCoverage.blockingIssues.some(
      (issue) =>
        issue.path === "contexts/scripts/run.py" && issue.state === "excluded",
    ),
  );
  assert.ok(
    evaluateStrictScan(excludedScan).matches.some(
      (match) => match.id === "strict_scan.incomplete_inspection",
    ),
  );
  await fixture.writeConfig({ max_depth: 2 });
  const shallow = await collectRepositorySnapshot(fixture.root);
  assert.equal(shallow.executableSurfaceInventory.surfaces.length, 0);
  assert.equal(
    shallow.repositoryPathStates.get("contexts/scripts/run.py"),
    "deep",
  );
  assert.ok(
    scanFromRepositorySnapshot(shallow).inspectionCoverage.blockingIssues.some(
      (issue) =>
        issue.path === "contexts/scripts/run.py" && issue.state === "deep",
    ),
  );
});

test("Context/Lens script directories retain extensionless surfaces and Markdown asset semantics", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/deploy.md",
    context("context.deploy", "[Helper](scripts/run)\n"),
  );
  await fixture.write("contexts/scripts/run", "#!/bin/sh\necho ready\n");
  await fixture.write("lenses/scripts/check.rb", "puts 'ready'\n");
  await fixture.write(
    "contexts/scripts/guide.md",
    context("context.guide", "Existing guide."),
  );
  await fixture.write("contexts/context.yaml", "id: ignored.manifest\n");
  const snapshot = await collectRepositorySnapshot(fixture.root);
  assert.deepEqual(
    snapshot.executableSurfaceInventory.surfaces.map((surface) => [
      surface.path,
      surface.scope,
    ]),
    [
      ["contexts/scripts/run", "repository-script"],
      ["lenses/scripts/check.rb", "repository-script"],
    ],
  );
  assert.equal(
    snapshot.executableSurfaceInventory.surfaces[0]?.staticallyReferenced,
    true,
  );
  assert.equal(snapshot.executableSurfaceInventory.dependencies.length, 0);
  assert.ok(
    !snapshot.artifacts.some(
      (artifact) => artifact.path === "contexts/context.yaml",
    ),
  );
  assert.equal(
    snapshot.catalog.assets.find(
      (asset) => asset.sourcePath === "contexts/scripts/guide.md",
    )?.kind,
    "context",
  );
});

test("Context/Lens discovery preserves safety limits and recognizes the existing executable extensions", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.write(
    "contexts/deploy.md",
    context(
      "context.deploy",
      "```sh\npython scripts/excluded.py\npython scripts/large.py\npython scripts/link.py\npython scripts/missing.py\n```",
    ),
  );
  await fixture.write("contexts/scripts/excluded.py", "print('excluded')\n");
  await fixture.write("contexts/scripts/large.py", "# large\n".repeat(1000));
  await fixture.write("contexts/scripts/target.py", "print('safe')\n");
  await symlink(
    fixture.resolve("contexts/scripts/target.py"),
    fixture.resolve("contexts/scripts/link.py"),
  );
  await fixture.write("lenses/scripts/binary.py", new Uint8Array([0, 1, 2]));
  for (const extension of [
    "ts",
    "mts",
    "cts",
    "cjs",
    "mjs",
    "bash",
    "pS1",
    "BaT",
    "cMd",
  ]) {
    await fixture.write(`lenses/helpers/check.${extension}`, "");
  }
  await fixture.writeConfig({
    exclude: ["contexts/scripts/excluded.py"],
    max_file_size_bytes: 1000,
  });
  const snapshot = await collectRepositorySnapshot(fixture.root);
  assert.deepEqual(
    snapshot.executableSurfaceInventory.invocations.map(
      (invocation) => invocation.resolution,
    ),
    ["excluded", "oversize", "symlink", "missing"],
  );
  const blocked =
    scanFromRepositorySnapshot(snapshot).inspectionCoverage.blockingIssues;
  for (const [file, state] of [
    ["excluded.py", "excluded"],
    ["large.py", "oversize"],
    ["link.py", "symlink"],
  ]) {
    assert.ok(
      blocked.some(
        (issue) =>
          issue.path === `contexts/scripts/${file}` && issue.state === state,
      ),
    );
  }
  assert.equal(snapshot.executableSurfaceInventory.surfaces.length, 11);
  assert.equal(
    snapshot.executableSurfaceInventory.surfaces.find((surface) =>
      surface.path.endsWith("binary.py"),
    )?.contentClassification,
    "binary",
  );
  assert.deepEqual(
    resolveHelperScriptPath("contexts/deploy.md", "../../escape.py"),
    { kind: "unsafe", path: "../../escape.py" },
  );
  assert.deepEqual(
    resolveHelperScriptPath(
      "skills/deploy/SKILL.md",
      "../other/scripts/run.py",
    ),
    { kind: "unsafe", path: "../other/scripts/run.py" },
  );
  assert.deepEqual(
    resolveHelperScriptPath(
      "lenses/review.md",
      "../contexts/scripts/target.py",
    ),
    {
      kind: "candidate",
      path: "contexts/scripts/target.py",
      source: "document-relative",
    },
  );
});
