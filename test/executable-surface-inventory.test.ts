import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { bom, formatBomMarkdown } from "../src/commands/bom.js";
import { compareUtf16CodeUnits } from "../src/canonical-json.js";
import { buildExecutableSurfaceDiff } from "../src/executable-surface-diff.js";
import {
  buildExecutableSurfaceInventory,
  type ExecutableSurfaceEntry,
  type ExecutableSurfaceInventory,
  zeroExecutableSurfaceInventory,
} from "../src/executable-surface-inventory.js";
import {
  collectHelperCommandEvidence,
  resolveHelperCommandEvidence,
} from "../src/helper-command-evidence.js";
import { parseDocument } from "../src/markdown.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { formatJson, formatText } from "../src/report.js";
import { scan } from "../src/scanner.js";
import type { Artifact } from "../src/types/artifact.js";

test("inventory composes discovery, invocation, reachability, and policy evidence deterministically", async (t) => {
  const root = await inventoryFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await scan(root);
  const second = await scan(root);
  const inventory = first.executableSurfaceInventory;
  assert.ok(inventory);
  assert.deepEqual(inventory, second.executableSurfaceInventory);
  assert.equal(inventory.schema, "renma.executable-surface-inventory.v1");
  assert.deepEqual(
    inventory.surfaces.map((surface) => surface.path),
    [...inventory.surfaces]
      .map((surface) => surface.path)
      .sort(compareUtf16CodeUnits),
  );

  const direct = requiredSurface(inventory, "skills/demo/scripts/direct.sh");
  assert.equal(direct.scope, "skill-local");
  assert.equal(direct.reachableFromOwningSkill, true);
  assert.equal(direct.reachabilityDepth, 1);
  assert.deepEqual(direct.interpreterHints, ["bash"]);
  assert.equal(direct.shebang, "#!/usr/bin/env bash");
  assert.equal(direct.invocationCount, 1);
  assert.equal(direct.securityPolicy.hasEffectivePolicy, true);
  assert.ok(direct.securityPolicy.policySources.includes("owning_skill"));
  assert.deepEqual(direct.invocationGovernance, {
    invocationsWithEffectivePolicyEvidence: 1,
    invocationsWithoutEffectivePolicyEvidence: 0,
    distinctEffectivePolicyFingerprints: [
      direct.securityPolicy.fingerprint as string,
    ],
  });
  assert.match(direct.fingerprint, /^sha256:[a-f0-9]{64}$/);

  const oneHop = requiredSurface(inventory, "skills/demo/scripts/one-hop.js");
  assert.equal(oneHop.reachableFromOwningSkill, true);
  assert.equal(oneHop.reachabilityDepth, 2);
  assert.deepEqual(oneHop.interpreterHints, ["node"]);
  assert.equal(oneHop.invocationCount, 0);

  const deep = requiredSurface(inventory, "skills/demo/scripts/deep.py");
  assert.equal(deep.reachabilityDepth, 3);
  assert.deepEqual(deep.interpreterHints, ["python"]);

  const unreachable = requiredSurface(
    inventory,
    "skills/demo/scripts/unreachable.mjs",
  );
  assert.equal(unreachable.reachableFromOwningSkill, false);
  assert.equal(unreachable.staticallyReferenced, false);

  const invokedTool = requiredSurface(inventory, "tools/invoked.mjs");
  assert.equal(invokedTool.scope, "repository-tool");
  assert.equal(invokedTool.invocationCount, 3);
  assert.equal(invokedTool.referenceCount, 3);
  assert.deepEqual(invokedTool.interpreterHints, ["node"]);
  assert.equal("owningSkill" in invokedTool, false);
  assert.equal(invokedTool.securityPolicy.hasEffectivePolicy, false);
  assert.equal(
    invokedTool.invocationGovernance.invocationsWithEffectivePolicyEvidence,
    3,
  );
  assert.equal(
    invokedTool.invocationGovernance.invocationsWithoutEffectivePolicyEvidence,
    0,
  );
  assert.equal(
    invokedTool.invocationGovernance.distinctEffectivePolicyFingerprints.length,
    1,
  );

  const unreferencedTool = requiredSurface(inventory, "tools/unreferenced.sh");
  assert.equal(unreferencedTool.scope, "repository-tool");
  assert.equal(unreferencedTool.staticallyReferenced, false);
  assert.deepEqual(unreferencedTool.interpreterHints, ["sh"]);

  const orphan = requiredSurface(inventory, "skills/orphan/scripts/orphan.py");
  assert.equal(orphan.scope, "noncanonical");
  assert.equal(orphan.securityPolicy.hasEffectivePolicy, false);

  const binary = requiredSurface(inventory, "skills/demo/scripts/binary.py");
  assert.equal(binary.contentClassification, "binary");
  assert.equal(binary.shebang, undefined);
  assert.deepEqual(binary.interpreterHints, ["python"]);

  const indentedShebang = requiredSurface(
    inventory,
    "skills/demo/scripts/indented.py",
  );
  assert.equal(indentedShebang.shebang, undefined);
  assert.deepEqual(indentedShebang.interpreterHints, ["python"]);

  const bomPrefixedShebang = requiredSurface(
    inventory,
    "skills/demo/scripts/bom-prefixed.sh",
  );
  assert.equal(bomPrefixedShebang.shebang, undefined);
  assert.deepEqual(bomPrefixedShebang.interpreterHints, ["sh"]);

  assert.deepEqual(
    inventory.invocations.map((invocation) => invocation.resolution),
    [
      "unscoped",
      "resolved",
      "resolved",
      "resolved",
      "missing",
      "unsafe",
      "noncanonical",
      "unsupported",
      "resolved",
    ],
  );
  assert.deepEqual(
    inventory.invocations
      .filter(
        (invocation) => invocation.normalizedTarget === "tools/invoked.mjs",
      )
      .map((invocation) => invocation.occurrenceOrdinal),
    [1, 2, 1],
  );
  const directInvocation = inventory.invocations.find(
    (invocation) =>
      invocation.sourcePath === "skills/demo/SKILL.md" &&
      invocation.normalizedTarget === "skills/demo/scripts/direct.sh",
  );
  assert.ok(directInvocation);
  assert.equal(directInvocation.governance.owningSkillResolution, "resolved");
  assert.equal(directInvocation.governance.policyEvidence.length, 1);
  assert.equal(
    directInvocation.governance.policyEvidence[0]?.relation,
    "source-artifact",
  );
  assert.equal(directInvocation.governance.hasEffectivePolicyEvidence, true);
  const referenceInvocation = inventory.invocations.find(
    (invocation) =>
      invocation.sourcePath === "skills/demo/references/index.md" &&
      invocation.normalizedTarget === "tools/invoked.mjs",
  );
  assert.ok(referenceInvocation);
  assert.deepEqual(
    referenceInvocation.governance.policyEvidence.map(
      (evidence) => evidence.relation,
    ),
    ["source-artifact", "owning-skill"],
  );
  const jsonInventory = (
    JSON.parse(formatJson(first)) as {
      executableSurfaceInventory: ExecutableSurfaceInventory;
    }
  ).executableSurfaceInventory;
  assert.deepEqual(jsonInventory, inventory);
  assert.match(
    jsonInventory.invocations[0]?.governance.fingerprint ?? "",
    /^sha256:[a-f0-9]{64}$/,
  );

  const summary = inventory.summary;
  assert.equal(
    summary.totalSurfaces,
    summary.skillLocalSurfaces +
      summary.repositoryToolSurfaces +
      summary.noncanonicalSurfaces,
  );
  assert.equal(
    summary.totalSurfaces,
    summary.textSurfaces + summary.binarySurfaces,
  );
  assert.equal(
    summary.totalSurfaces,
    summary.referencedSurfaces + summary.unreferencedSurfaces,
  );
  assert.equal(
    summary.totalSurfaces,
    summary.invokedSurfaces + summary.uninvokedSurfaces,
  );
  assert.equal(
    summary.totalSurfaces,
    summary.surfacesWithEffectivePolicy +
      summary.surfacesWithoutEffectivePolicy,
  );
  assert.equal(
    summary.skillLocalSurfaces,
    summary.reachableSkillLocalSurfaces + summary.unreachableSkillLocalSurfaces,
  );
  assert.equal(summary.totalInvocations, inventory.invocations.length);
  assert.equal(
    summary.totalInvocations,
    summary.invocationsWithEffectivePolicyEvidence +
      summary.invocationsWithoutEffectivePolicyEvidence,
  );
  assert.equal(
    summary.resolvedInvocations,
    summary.resolvedInvocationsWithEffectivePolicyEvidence +
      summary.resolvedInvocationsWithoutEffectivePolicyEvidence,
  );
  assert.equal(
    summary.totalInvocations,
    summary.resolvedInvocations +
      summary.missingInvocations +
      summary.unsafeInvocations +
      summary.unscopedInvocations +
      summary.noncanonicalInvocations +
      summary.unavailableInvocations,
  );
  for (const invocation of inventory.invocations.filter(
    (candidate) => candidate.resolution === "resolved",
  )) {
    assert.ok(invocation.normalizedTarget);
    const surface: ExecutableSurfaceEntry | undefined = inventory.surfaces.find(
      (candidate) => candidate.path === invocation.normalizedTarget,
    );
    assert.ok(surface, invocation.normalizedTarget);
    assert.ok(
      surface.scope === "skill-local" || surface.scope === "repository-tool",
      `${surface.path}: ${surface.scope}`,
    );
  }
  for (const surface of inventory.surfaces) {
    assert.equal(
      surface.invocationCount,
      surface.invocationGovernance.invocationsWithEffectivePolicyEvidence +
        surface.invocationGovernance.invocationsWithoutEffectivePolicyEvidence,
      surface.path,
    );
  }

  assert.deepEqual(
    first.findings
      .filter(
        (finding) =>
          finding.id === "PATH-HELPER-COMMAND-UNRESOLVED" &&
          finding.evidence.path === "skills/demo/SKILL.md",
      )
      .map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        evidence: finding.evidence,
        remediation: finding.remediation,
      })),
    [
      {
        id: "PATH-HELPER-COMMAND-UNRESOLVED",
        severity: "medium",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: 18,
          endLine: 18,
          snippet: "node tools/missing.mjs",
        },
        remediation:
          "Create `tools/missing.mjs` or update this command to the correct local helper path.",
      },
      {
        id: "PATH-HELPER-COMMAND-UNRESOLVED",
        severity: "medium",
        evidence: {
          path: "skills/demo/SKILL.md",
          startLine: 19,
          endLine: 19,
          snippet: "node ../tools/unsafe.mjs",
        },
        remediation:
          "Update this command to a path inside the owning Skill's scripts/** directory or to a repository-root tools/** helper; do not escape the Skill with `..`.",
      },
    ],
  );

  const text = formatText(first);
  assert.match(text, /Executable Surface Review/);
  assert.match(
    text,
    /Executable surfaces: \d+; static reachability 3 direct, 0 transitive; invocations 4\/9 resolved; invocation-context policy evidence 8\/9/,
  );
  assert.match(
    text,
    /skills\/demo\/SKILL\.md:L18 node tools\/missing\.mjs \[resolution missing/,
  );
  assert.doesNotMatch(text, /skills\/demo\/scripts\/direct\.sh/);
  const manifest = await bom(root, {}, { omitGeneratedAt: true });
  assert.deepEqual(manifest.executableSurfaceInventory, inventory);
  const markdown = formatBomMarkdown(manifest);
  assert.match(markdown, /## Executable Surface Inventory/);
  assert.match(markdown, /- Surface policy evidence:/);
  assert.match(markdown, /- Invocation-context policy evidence:/);
  assert.match(markdown, /- Invocations with multiple policy variants:/);
  assert.match(markdown, /\| Surface policy \| Invocation policy \|/);
  assert.match(markdown, /skills\/demo\/scripts\/direct\.sh/);
});

test("helper resolution preserves exact unavailable states and bounded evidence", () => {
  const source = artifact(
    "skills/demo/SKILL.md",
    [
      "```sh",
      "node tools/parsed.js",
      "node tools/excluded.js",
      "node tools/deep.js",
      "node tools/oversize.js",
      "node tools/unsupported.js",
      "node tools/symlink.js",
      "node tools/unreadable.js",
      "node tools/missing.js",
      "node contexts/demo/scripts/noncanonical.js",
      "node ../tools/unsafe.js",
      "```",
    ].join("\n"),
  );
  const evidence = collectHelperCommandEvidence([parseDocument(source)]);
  const states = new Map([
    ["tools/parsed.js", "parsed"],
    ["tools/excluded.js", "excluded"],
    ["tools/deep.js", "deep"],
    ["tools/oversize.js", "oversize"],
    ["tools/unsupported.js", "unsupported"],
    ["tools/symlink.js", "symlink"],
    ["tools/unreadable.js", "unreadable"],
    ["tools/missing.js", "absent"],
    ["contexts/demo/scripts/noncanonical.js", "parsed"],
  ] as const);
  assert.deepEqual(
    evidence.map(
      (command) => resolveHelperCommandEvidence(command, states).resolution,
    ),
    [
      "resolved",
      "excluded",
      "deep",
      "oversize",
      "unsupported",
      "symlink",
      "unreadable",
      "missing",
      "noncanonical",
      "unsafe",
    ],
  );
  assert.deepEqual(
    evidence.map((command) => command.line),
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

test("helper resolution preserves noncanonical repository availability before parsed scope", () => {
  const source = artifact(
    "skills/demo/SKILL.md",
    [
      "```sh",
      "node contexts/demo/scripts/parsed.js",
      "node contexts/demo/scripts/absent.js",
      "node contexts/demo/scripts/missing.js",
      "node contexts/demo/scripts/excluded.js",
      "node contexts/demo/scripts/deep.js",
      "node contexts/demo/scripts/oversize.js",
      "node contexts/demo/scripts/unsupported.js",
      "node contexts/demo/scripts/symlink.js",
      "node contexts/demo/scripts/unreadable.js",
      "```",
    ].join("\n"),
  );
  const evidence = collectHelperCommandEvidence([parseDocument(source)]);
  const states = new Map([
    ["contexts/demo/scripts/parsed.js", "parsed"],
    ["contexts/demo/scripts/absent.js", "absent"],
    ["contexts/demo/scripts/excluded.js", "excluded"],
    ["contexts/demo/scripts/deep.js", "deep"],
    ["contexts/demo/scripts/oversize.js", "oversize"],
    ["contexts/demo/scripts/unsupported.js", "unsupported"],
    ["contexts/demo/scripts/symlink.js", "symlink"],
    ["contexts/demo/scripts/unreadable.js", "unreadable"],
  ] as const);

  assert.deepEqual(
    evidence.map(
      (command) => resolveHelperCommandEvidence(command, states).resolution,
    ),
    [
      "noncanonical",
      "missing",
      "missing",
      "excluded",
      "deep",
      "oversize",
      "unsupported",
      "symlink",
      "unreadable",
    ],
  );
});

test("inventory requires one unambiguous owning Skill before resolving a Skill-local invocation", () => {
  const source = artifact(
    "README.md",
    "```sh\nnode skills/demo/scripts/run.mjs\n```\n",
  );
  const script = {
    ...artifact("skills/demo/scripts/run.mjs", "console.log('run');\n"),
    kind: "script" as const,
    markdownParserEligible: false,
  };
  const inventory = buildExecutableSurfaceInventory({
    artifacts: [source, script],
    documents: [parseDocument(source), parseDocument(script)],
    repositoryPaths: new Set([source.path, script.path]),
    repositoryPathStates: new Map([[script.path, "parsed"]]),
    skillParents: new Map([
      [
        "skills/demo",
        [
          {
            owner: "one",
            id: "skill.demo.one",
            sourcePath: "skills/demo/SKILL.md",
          },
          {
            owner: "two",
            id: "skill.demo.two",
            sourcePath: "skills/demo/skill.md",
          },
        ],
      ],
    ]),
    securityPolicies: [],
  });
  const invocation = inventory.invocations.find(
    (candidate) => candidate.normalizedTarget === "skills/demo/scripts/run.mjs",
  );
  assert.equal(invocation?.resolution, "noncanonical");
  assert.equal(
    requiredSurface(inventory, "skills/demo/scripts/run.mjs").scope,
    "noncanonical",
  );
});

test("inventory creation adds no finding or exit-status policy", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-surface-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeSkill(root, "# Demo\n\nNo helper is required.\n");
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(path.join(root, "tools", "unreferenced.mjs"), "// helper\n");
  const before = await scan(root);
  const beforeBom = await bom(root, {}, { omitGeneratedAt: true });
  await writeSkill(root, "# Demo\n\nRun `node tools/unreferenced.mjs`.\n");
  const after = await scan(root);
  const afterBom = await bom(root, {}, { omitGeneratedAt: true });
  assert.deepEqual(after.findings, before.findings);
  assert.deepEqual(afterBom.readiness, beforeBom.readiness);
  assert.deepEqual(
    after.securityPolicyInventory,
    before.securityPolicyInventory,
  );
  assert.equal(after.exitThreshold, before.exitThreshold);
  assert.equal(
    after.executableSurfaceInventory?.summary.repositoryToolSurfaces,
    1,
  );
  assert.equal(after.executableSurfaceInventory?.summary.totalInvocations, 1);
  assert.equal(
    afterBom.executableSurfaceInventory?.invocations[0]?.snippet,
    "node tools/unreferenced.mjs",
  );
});

test("inline Run evidence reuses reference, governance, and dependency reachability projections", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-inline-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await mkdir(path.join(root, "tools"), { recursive: true });
  const skillBody = `---
name: demo
description: Exercise inline helper evidence. Use when reachability needs validation.
metadata:
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
---
# Demo

Run \`node tools/check.mjs\`; pass \`--local\` only when requested.
`;
  const skillPath = path.join(root, "skills", "demo", "SKILL.md");
  await writeFile(
    skillPath,
    skillBody.replace(
      "Run `node tools/check.mjs`; pass `--local` only when requested.",
      "Inspect tools/check.mjs before proceeding.",
    ),
  );
  await writeFile(
    path.join(root, "tools", "check.mjs"),
    'import "./helper.mjs";\n',
  );
  await writeFile(
    path.join(root, "tools", "helper.mjs"),
    "export const helper = true;\n",
  );
  const before = await scan(root);
  await writeFile(skillPath, skillBody);

  const result = await scan(root);
  const inventory = result.executableSurfaceInventory;
  const beforeInventory = before.executableSurfaceInventory;
  assert.ok(inventory);
  assert.ok(beforeInventory);
  assert.equal(inventory.summary.totalInvocations, 1);
  assert.equal(inventory.summary.resolvedInvocations, 1);
  assert.equal(inventory.summary.directlyInvokedSurfaces, 1);
  assert.equal(inventory.summary.transitivelyReachableSurfaces, 1);
  assert.equal(inventory.summary.unreachedFromInvocationSurfaces, 0);

  const invocation = inventory.invocations[0];
  assert.ok(invocation);
  assert.equal(invocation.sourcePath, "skills/demo/SKILL.md");
  assert.equal(invocation.line, 12);
  assert.equal(invocation.snippet, "node tools/check.mjs");
  assert.equal(invocation.governance.owningSkillResolution, "resolved");
  assert.equal(invocation.governance.hasEffectivePolicyEvidence, true);
  assert.deepEqual(
    invocation.governance.policyEvidence.map((evidence) => evidence.relation),
    ["source-artifact"],
  );

  const direct = requiredSurface(inventory, "tools/check.mjs");
  assert.equal(direct.staticallyReferenced, true);
  assert.equal(direct.referenceCount, 1);
  assert.equal(direct.staticallyInvoked, true);
  assert.equal(direct.invocationCount, 1);
  assert.equal(
    direct.dependencyEvidence.staticInvocationReachability,
    "direct",
  );
  assert.equal(direct.dependencyEvidence.minimumInvocationDependencyDepth, 0);

  const transitive = requiredSurface(inventory, "tools/helper.mjs");
  assert.equal(transitive.staticallyInvoked, false);
  assert.equal(transitive.invocationCount, 0);
  assert.equal(
    transitive.dependencyEvidence.staticInvocationReachability,
    "transitive",
  );
  assert.equal(
    transitive.dependencyEvidence.minimumInvocationDependencyDepth,
    1,
  );
  assert.equal(
    transitive.invocationGovernance.invocationsWithEffectivePolicyEvidence,
    0,
  );
  assert.equal(
    transitive.invocationGovernance.invocationsWithoutEffectivePolicyEvidence,
    0,
  );
  assert.deepEqual(result.findings, before.findings);
  assert.deepEqual(
    result.securityPolicyInventory,
    before.securityPolicyInventory,
  );
  assert.equal(result.exitThreshold, before.exitThreshold);
  assert.match(
    formatText(result),
    /Executable surfaces: 2; static reachability 1 direct, 1 transitive; invocations 1\/1 resolved; invocation-context policy evidence 1\/1/,
  );
  assert.doesNotMatch(formatText(result), /Inline invocations/);

  const diff = buildExecutableSurfaceDiff(beforeInventory, inventory);
  assert.equal(diff.summary.totalInvocationsDelta, 1);
  assert.equal(diff.summary.directlyInvokedSurfacesDelta, 1);
  assert.equal(diff.summary.transitivelyReachableSurfacesDelta, 1);
  assert.equal(diff.summary.unreachedFromInvocationSurfacesDelta, -2);
  assert.deepEqual(diff.newlyTransitivelyReachableSurfacePaths, [
    "tools/helper.mjs",
  ]);
  assert.deepEqual(diff.newlyReachableSkillLocalPaths, []);
});

test("fenced-to-inline presentation changes preserve semantic invocation identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-inline-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(path.join(root, "tools", "check.mjs"), "// check\n");
  await writeSkill(root, "# Demo\n\n```sh\nnode tools/check.mjs\n```\n");
  const fenced = (await scan(root)).executableSurfaceInventory;
  assert.ok(fenced);

  await writeSkill(root, "# Demo\n\nRun `node tools/check.mjs`.\n");
  const inline = (await scan(root)).executableSurfaceInventory;
  assert.ok(inline);
  const diff = buildExecutableSurfaceDiff(fenced, inline);

  assert.deepEqual(
    fenced.invocations.map(semanticInvocation),
    inline.invocations.map(semanticInvocation),
  );
  assert.equal(diff.summary.totalInvocationsDelta, 0);
  assert.equal(diff.summary.resolvedInvocationsDelta, 0);
  assert.deepEqual(diff.invocationResolutionChanges, []);
  assert.deepEqual(diff.invocationGovernanceChanges, []);
  assert.equal(
    diff.changedSurfaces.some((surface) =>
      surface.reasons.includes("invocations"),
    ),
    false,
  );
});

test("surface diff uses path identity, reason sets, and line-insensitive invocation identity", async (t) => {
  const root = await inventoryFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const fromSnapshot = await collectRepositorySnapshot(root);
  const fromInventory = fromSnapshot.executableSurfaceInventory;

  await writeFile(
    path.join(root, "skills", "demo", "scripts", "direct.sh"),
    "#!/usr/bin/env bash\necho changed\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    skillBody().replace("# Demo", "\n\n# Demo"),
  );
  await writeFile(path.join(root, "tools", "added.py"), "print('ok')\n");
  const toInventory = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  const diff = buildExecutableSurfaceDiff(fromInventory, toInventory);

  assert.ok(diff.addedSurfacePaths.includes("tools/added.py"));
  assert.deepEqual(
    diff.changedSurfaces.find(
      (surface) => surface.path === "skills/demo/scripts/direct.sh",
    )?.reasons,
    ["content"],
  );
  assert.equal(diff.invocationResolutionChanges.length, 0);
});

test("surface diff deterministically exposes ownership-corrected invocation resolution", async (t) => {
  const root = await inventoryFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const withoutOwner = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;
  await writeFile(
    path.join(root, "skills", "orphan", "SKILL.md"),
    `---
name: orphan
description: Own an orphan fixture helper. Use when surface scope changes need validation.
---
# Orphan
`,
  );
  const withOwner = (await collectRepositorySnapshot(root))
    .executableSurfaceInventory;

  const diff = buildExecutableSurfaceDiff(withOwner, withoutOwner);
  assert.deepEqual(
    diff.invocationResolutionChanges.map((change) => ({
      target: change.target,
      fromResolution: change.fromResolution,
      toResolution: change.toResolution,
    })),
    [
      {
        target: "skills/orphan/scripts/orphan.py",
        fromResolution: "resolved",
        toResolution: "noncanonical",
      },
    ],
  );
  assert.deepEqual(diff, buildExecutableSurfaceDiff(withOwner, withoutOwner));
});

test("zero inventory remains a valid deterministic composed projection", () => {
  const inventory = zeroExecutableSurfaceInventory();
  assert.equal(inventory.summary.totalSurfaces, 0);
  assert.equal(inventory.summary.totalInvocations, 0);
  assert.deepEqual(inventory.summary.interpreterHints, []);
  assert.deepEqual(
    buildExecutableSurfaceInventory({
      artifacts: [],
      documents: [],
      repositoryPaths: new Set(),
      repositoryPathStates: new Map(),
      skillParents: new Map(),
      securityPolicies: [],
    }),
    inventory,
  );
});

async function inventoryFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-surfaces-"));
  await mkdir(path.join(root, "skills", "demo", "references"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", "demo", "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills", "orphan", "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(root, "contexts", "demo", "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(path.join(root, "skills", "demo", "SKILL.md"), skillBody());
  await writeFile(
    path.join(root, "skills", "demo", "references", "index.md"),
    [
      "# Index",
      "",
      "Use scripts/one-hop.js and read references/detail.md.",
      "",
      "```sh",
      "node tools/invoked.mjs",
      "```",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "skills", "demo", "references", "detail.md"),
    "# Detail\n\nUse scripts/deep.py.\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "direct.sh"),
    "#!/usr/bin/env bash\necho direct\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "one-hop.js"),
    "console.log('one hop');\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "deep.py"),
    "print('deep')\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "unreachable.mjs"),
    "console.log('unreachable');\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "binary.py"),
    Buffer.from([0, 1, 2, 3]),
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "indented.py"),
    "  #!/usr/bin/env node\nprint('indented')\n",
  );
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "bom-prefixed.sh"),
    "\uFEFF#!/usr/bin/env bash\necho bom\n",
  );
  await writeFile(
    path.join(root, "skills", "orphan", "scripts", "orphan.py"),
    "print('orphan')\n",
  );
  await writeFile(
    path.join(root, "contexts", "demo", "scripts", "bad.py"),
    "print('noncanonical')\n",
  );
  await writeFile(
    path.join(root, "tools", "invoked.mjs"),
    "console.log('tool');\n",
  );
  await writeFile(
    path.join(root, "tools", "unreferenced.sh"),
    "echo unreferenced\n",
  );
  await writeFile(
    path.join(root, "README.md"),
    "```sh\npython scripts/root.py\n```\n",
  );
  return root;
}

function skillBody(): string {
  return `---
name: demo
description: Exercise local helpers. Use when executable inventory evidence needs validation.
metadata:
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
---
# Demo

Read references/index.md and run scripts/direct.sh.

\`\`\`sh
bash scripts/direct.sh
node tools/invoked.mjs
node tools/invoked.mjs
node tools/missing.mjs
node ../tools/unsafe.mjs
python skills/orphan/scripts/orphan.py
python contexts/demo/scripts/bad.py
\`\`\`

## Required Inputs

A repository.

## Completion Criteria

Complete after verification.
`;
}

async function writeSkill(root: string, body: string): Promise<void> {
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    `---
name: demo
description: Exercise a local workflow. Use when inventory policy boundaries need validation.
---
${body}`,
  );
}

function requiredSurface(
  inventory: ExecutableSurfaceInventory,
  surfacePath: string,
) {
  const surface = inventory.surfaces.find(
    (candidate) => candidate.path === surfacePath,
  );
  assert.ok(surface, surfacePath);
  return surface;
}

function semanticInvocation(
  invocation: ExecutableSurfaceInventory["invocations"][number],
) {
  return {
    sourcePath: invocation.sourcePath,
    launcher: invocation.launcher,
    target: invocation.normalizedTarget ?? invocation.rawTarget,
    resolution: invocation.resolution,
    occurrenceOrdinal: invocation.occurrenceOrdinal,
    governance: invocation.governance,
  };
}

function artifact(sourcePath: string, content: string): Artifact {
  return {
    path: sourcePath,
    absolutePath: `/${sourcePath}`,
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentHash: "sha256:test",
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
