import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import { buildExecutableSurfaceDiff } from "../src/executable-surface-diff.js";
import {
  buildExecutableSurfaceInventory,
  summarizeExecutableSurfaceInventory,
  type ExecutableSurfaceInventory,
  type ExecutableSurfaceInvocation,
} from "../src/executable-surface-inventory.js";
import { parseDocument } from "../src/markdown.js";
import { formatExecutableSurfaceInventoryText } from "../src/report.js";
import type { RepositoryPathState } from "../src/repository-paths.js";
import type {
  SecurityPolicyAssetEvidence,
  SecurityPolicySource,
} from "../src/security-policy-inventory.js";
import type { Artifact, ArtifactKind } from "../src/types/artifact.js";

const FP_A = fingerprint("a");
const FP_B = fingerprint("b");
const FP_C = fingerprint("c");
const FP_D = fingerprint("d");
const FP_E = fingerprint("e");
const EMPTY_FP = fingerprint("0");

test("invocation governance retains prepared source and owning-Skill policy evidence without merging", () => {
  const fixture = governanceFixture();
  const inventory = fixture.inventory;

  const local = invocation(
    inventory,
    "skills/local/SKILL.md",
    "tools/same-policy.mjs",
  );
  assert.equal(local.governance.owningSkillResolution, "resolved");
  assert.deepEqual(local.governance.policyEvidence, [
    {
      relation: "source-artifact",
      path: "skills/local/SKILL.md",
      hasEffectivePolicy: true,
      policySources: ["local", "repository_config"],
      fingerprint: FP_A,
    },
  ]);
  assert.equal(local.governance.hasEffectivePolicyEvidence, true);
  assert.deepEqual(local.governance.distinctEffectivePolicyFingerprints, [
    FP_A,
  ]);

  const repositoryConfigured = invocation(
    inventory,
    "skills/config/SKILL.md",
    "tools/same-policy.mjs",
  );
  assert.deepEqual(repositoryConfigured.governance.policyEvidence, [
    {
      relation: "source-artifact",
      path: "skills/config/SKILL.md",
      hasEffectivePolicy: true,
      policySources: ["repository_config"],
      fingerprint: FP_A,
    },
  ]);

  const ungovernedSkill = invocation(
    inventory,
    "skills/plain/SKILL.md",
    "tools/mixed.mjs",
  );
  assert.deepEqual(ungovernedSkill.governance.policyEvidence, [
    {
      relation: "source-artifact",
      path: "skills/plain/SKILL.md",
      hasEffectivePolicy: false,
      policySources: [],
    },
  ]);
  assert.equal(ungovernedSkill.governance.hasEffectivePolicyEvidence, false);

  const reference = invocation(
    inventory,
    "skills/ref/references/run.md",
    "tools/different.mjs",
  );
  assert.equal(reference.governance.owningSkillResolution, "resolved");
  assert.deepEqual(reference.governance.policyEvidence, [
    {
      relation: "source-artifact",
      path: "skills/ref/references/run.md",
      hasEffectivePolicy: true,
      policySources: ["repository_config"],
      fingerprint: FP_C,
    },
    {
      relation: "owning-skill",
      path: "skills/ref/SKILL.md",
      hasEffectivePolicy: true,
      policySources: ["local"],
      fingerprint: FP_B,
    },
  ]);
  assert.deepEqual(reference.governance.distinctEffectivePolicyFingerprints, [
    FP_B,
    FP_C,
  ]);
  assert.equal(reference.governance.hasEffectivePolicyEvidence, true);

  const missingOwner = invocation(
    inventory,
    "skills/missing/references/run.md",
    "tools/same.mjs",
  );
  assert.equal(missingOwner.governance.owningSkillResolution, "missing");
  assert.equal(missingOwner.governance.hasEffectivePolicyEvidence, false);

  const ambiguousOwner = invocation(
    inventory,
    "skills/amb/references/run.md",
    "tools/same.mjs",
  );
  assert.equal(ambiguousOwner.governance.owningSkillResolution, "ambiguous");
  assert.equal(
    ambiguousOwner.governance.policyEvidence.some(
      (evidence) => evidence.relation === "owning-skill",
    ),
    false,
  );

  const governedContext = invocation(
    inventory,
    "contexts/governed.md",
    "tools/same.mjs",
  );
  assert.equal(
    governedContext.governance.owningSkillResolution,
    "not-applicable",
  );
  assert.equal(governedContext.governance.hasEffectivePolicyEvidence, true);

  const plainContext = invocation(
    inventory,
    "contexts/plain.md",
    "tools/same.mjs",
  );
  assert.equal(plainContext.governance.owningSkillResolution, "not-applicable");
  assert.equal(plainContext.governance.hasEffectivePolicyEvidence, false);

  const missing = invocation(
    inventory,
    "skills/ref/references/run.md",
    "tools/missing-from-reference.mjs",
  );
  assert.equal(missing.resolution, "missing");
  assert.equal(missing.governance.hasEffectivePolicyEvidence, true);
  assert.deepEqual(
    missing.governance.policyEvidence.map((evidence) => evidence.relation),
    ["source-artifact", "owning-skill"],
  );

  const unsafe = inventory.invocations.find(
    (candidate) =>
      candidate.sourcePath === "skills/local/SKILL.md" &&
      candidate.resolution === "unsafe",
  );
  assert.ok(unsafe);
  assert.equal(unsafe.governance.hasEffectivePolicyEvidence, true);

  const unscoped = inventory.invocations.find(
    (candidate) =>
      candidate.sourcePath === "README.md" &&
      candidate.resolution === "unscoped",
  );
  assert.ok(unscoped);
  assert.equal(unscoped.governance.owningSkillResolution, "not-applicable");
  assert.deepEqual(unscoped.governance.policyEvidence, []);

  assert.deepEqual(fixture.policies, fixture.originalPolicies);
});

test("a reachable reference can retain negative source evidence and effective owning-Skill evidence", () => {
  const inventory = governanceFixture({
    referenceSourceEffective: false,
  }).inventory;
  const reference = invocation(
    inventory,
    "skills/ref/references/run.md",
    "tools/different.mjs",
  );

  assert.deepEqual(
    reference.governance.policyEvidence.map((evidence) => ({
      relation: evidence.relation,
      hasEffectivePolicy: evidence.hasEffectivePolicy,
    })),
    [
      {
        relation: "source-artifact",
        hasEffectivePolicy: false,
      },
      {
        relation: "owning-skill",
        hasEffectivePolicy: true,
      },
    ],
  );
  assert.equal(reference.governance.hasEffectivePolicyEvidence, true);
  assert.deepEqual(reference.governance.distinctEffectivePolicyFingerprints, [
    FP_B,
  ]);
});

test("surface and inventory governance aggregates preserve counts, variants, repetitions, and surface policy", () => {
  const inventory = governanceFixture().inventory;

  const samePolicy = surface(inventory, "tools/same-policy.mjs");
  assert.equal(samePolicy.invocationCount, 2);
  assert.deepEqual(samePolicy.invocationGovernance, {
    invocationsWithEffectivePolicyEvidence: 2,
    invocationsWithoutEffectivePolicyEvidence: 0,
    distinctEffectivePolicyFingerprints: [FP_A],
  });

  const differentPolicy = surface(inventory, "tools/different-policy.mjs");
  assert.equal(differentPolicy.invocationCount, 2);
  assert.deepEqual(differentPolicy.invocationGovernance, {
    invocationsWithEffectivePolicyEvidence: 2,
    invocationsWithoutEffectivePolicyEvidence: 0,
    distinctEffectivePolicyFingerprints: [FP_A, FP_B],
  });

  const mixed = surface(inventory, "tools/mixed.mjs");
  assert.equal(mixed.invocationCount, 2);
  assert.deepEqual(mixed.invocationGovernance, {
    invocationsWithEffectivePolicyEvidence: 1,
    invocationsWithoutEffectivePolicyEvidence: 1,
    distinctEffectivePolicyFingerprints: [FP_B, FP_C],
  });

  const zero = surface(inventory, "tools/zero.mjs");
  assert.deepEqual(zero.invocationGovernance, {
    invocationsWithEffectivePolicyEvidence: 0,
    invocationsWithoutEffectivePolicyEvidence: 0,
    distinctEffectivePolicyFingerprints: [],
  });

  for (const candidate of inventory.surfaces) {
    assert.equal(
      candidate.invocationCount,
      candidate.invocationGovernance.invocationsWithEffectivePolicyEvidence +
        candidate.invocationGovernance
          .invocationsWithoutEffectivePolicyEvidence,
      candidate.path,
    );
  }
  assert.ok(
    inventory.surfaces
      .filter((candidate) => candidate.scope === "repository-tool")
      .every((candidate) => !candidate.securityPolicy.hasEffectivePolicy),
  );

  const repeated = inventory.invocations
    .filter(
      (candidate) =>
        candidate.sourcePath === "skills/local/SKILL.md" &&
        candidate.normalizedTarget === "tools/same.mjs",
    )
    .map((candidate) => candidate.occurrenceOrdinal);
  assert.deepEqual(repeated, [1, 2]);

  const summary = inventory.summary;
  assert.equal(summary.totalInvocations, 19);
  assert.equal(summary.invocationsWithEffectivePolicyEvidence, 14);
  assert.equal(summary.invocationsWithoutEffectivePolicyEvidence, 5);
  assert.equal(summary.resolvedInvocations, 15);
  assert.equal(summary.resolvedInvocationsWithEffectivePolicyEvidence, 11);
  assert.equal(summary.resolvedInvocationsWithoutEffectivePolicyEvidence, 4);
  assert.equal(summary.invocationsWithMultipleEffectivePolicyFingerprints, 3);
  assert.deepEqual(summary.invocationPolicyEvidenceRelations, {
    sourceArtifact: 18,
    owningSkill: 3,
  });
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
});

test("governance fingerprints and semantic invocation identity ignore evidence order and preceding lines", () => {
  const baseline = governanceFixture().inventory;
  const reordered = governanceFixture({
    reversePolicies: true,
    reverseLocalPolicySources: true,
  }).inventory;
  const shifted = governanceFixture({ leadingLines: 4 }).inventory;

  assert.deepEqual(
    baseline.invocations.map((candidate) => candidate.governance),
    reordered.invocations.map((candidate) => candidate.governance),
  );
  assert.deepEqual(
    baseline.invocations.map((candidate) => candidate.governance.fingerprint),
    shifted.invocations.map((candidate) => candidate.governance.fingerprint),
  );

  const lineOnlyDiff = buildExecutableSurfaceDiff(baseline, shifted);
  assert.deepEqual(lineOnlyDiff.invocationGovernanceChanges, []);
  assert.deepEqual(lineOnlyDiff.invocationResolutionChanges, []);
  assert.deepEqual(lineOnlyDiff.addedSurfacePaths, []);
  assert.deepEqual(lineOnlyDiff.removedSurfacePaths, []);
});

test("diff separates invocation governance from surface policy and resolution evidence", () => {
  const baseline = governanceFixture().inventory;
  const sourceChanged = governanceFixture({
    localFingerprint: FP_E,
  }).inventory;
  const ownerChanged = governanceFixture({
    referenceOwnerFingerprint: FP_E,
  }).inventory;

  const sourceDiff = buildExecutableSurfaceDiff(baseline, sourceChanged);
  assert.ok(sourceDiff.invocationGovernanceChanges.length > 0);
  assert.ok(sourceDiff.invocationsGainedEffectivePolicyEvidence.length === 0);
  assert.ok(sourceDiff.invocationsLostEffectivePolicyEvidence.length === 0);
  assert.deepEqual(sourceDiff.invocationResolutionChanges, []);
  assert.ok(
    sourceDiff.changedSurfaces.some(
      (change) =>
        change.path === "tools/same-policy.mjs" &&
        change.reasons.includes("invocation-governance") &&
        !change.reasons.includes("security-policy"),
    ),
  );

  const ownerDiff = buildExecutableSurfaceDiff(baseline, ownerChanged);
  assert.equal(
    ownerDiff.invocationGovernanceChanges.filter(
      (change) => change.sourcePath === "skills/ref/references/run.md",
    ).length,
    3,
  );
  assert.equal(
    ownerDiff.invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints
      .length,
    3,
  );
  assert.deepEqual(ownerDiff.invocationResolutionChanges, []);
  assert.deepEqual(
    sourceDiff,
    buildExecutableSurfaceDiff(baseline, sourceChanged),
  );
});

test("diff classifies new, gained, and lost invocation policy evidence without path-problem inflation", () => {
  const baseline = governanceFixture({ includePlainPolicy: false }).inventory;
  const gainedInventory = governanceFixture({
    includePlainPolicy: true,
  }).inventory;
  const gained = buildExecutableSurfaceDiff(baseline, gainedInventory);
  assert.equal(gained.invocationsGainedEffectivePolicyEvidence.length, 1);
  assert.equal(gained.invocationsLostEffectivePolicyEvidence.length, 0);
  assert.deepEqual(gained.newProblematicInvocations, []);

  const lost = buildExecutableSurfaceDiff(gainedInventory, baseline);
  assert.equal(lost.invocationsLostEffectivePolicyEvidence.length, 1);
  assert.equal(lost.invocationsGainedEffectivePolicyEvidence.length, 0);
  assert.deepEqual(lost.newProblematicInvocations, []);

  const empty = buildExecutableSurfaceInventory({
    artifacts: [],
    documents: [],
    repositoryPaths: new Set(),
    repositoryPathStates: new Map(),
    skillParents: new Map(),
    securityPolicies: [],
  });
  const added = buildExecutableSurfaceDiff(empty, baseline);
  assert.equal(
    added.newInvocationsWithoutEffectivePolicyEvidence.length,
    baseline.summary.invocationsWithoutEffectivePolicyEvidence,
  );
  assert.equal(
    added.newProblematicInvocations.length,
    baseline.invocations.filter(
      (candidate) => candidate.resolution !== "resolved",
    ).length,
  );
  assert.equal(
    added.newInvocationsWithMultipleEffectivePolicyFingerprints.length,
    baseline.summary.invocationsWithMultipleEffectivePolicyFingerprints,
  );
  const newlyAddedMultiple =
    added.newInvocationsWithMultipleEffectivePolicyFingerprints.find(
      (candidate) =>
        candidate.sourcePath === "skills/ref/references/run.md" &&
        candidate.target === "tools/different.mjs",
    );
  assert.ok(newlyAddedMultiple);
  assert.equal(
    newlyAddedMultiple.distinctEffectivePolicyFingerprints.length,
    2,
  );
  assert.equal(
    added.newInvocationsWithoutEffectivePolicyEvidence.some(
      (candidate) =>
        candidate.sourcePath === newlyAddedMultiple.sourcePath &&
        candidate.target === newlyAddedMultiple.target,
    ),
    false,
  );
  assert.equal(
    added.newProblematicInvocations.some(
      (candidate) =>
        candidate.sourcePath === newlyAddedMultiple.sourcePath &&
        candidate.target === newlyAddedMultiple.target,
    ),
    false,
  );
  assert.equal(
    added.newInvocationsWithMultipleEffectivePolicyFingerprints.some(
      (candidate) =>
        candidate.sourcePath === "skills/local/SKILL.md" &&
        candidate.target === "tools/same-policy.mjs",
    ),
    false,
  );

  const oneFingerprintReference = governanceFixture({
    referenceSourceEffective: false,
  }).inventory;
  const oneToTwo = buildExecutableSurfaceDiff(
    oneFingerprintReference,
    baseline,
  );
  assert.equal(
    oneToTwo.invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints
      .length,
    3,
  );
  assert.deepEqual(
    oneToTwo.newInvocationsWithMultipleEffectivePolicyFingerprints,
    [],
  );

  const removed = buildExecutableSurfaceDiff(baseline, empty);
  assert.equal(
    removed.summary.invocationsWithMultipleEffectivePolicyFingerprintsDelta,
    -baseline.summary.invocationsWithMultipleEffectivePolicyFingerprints,
  );
  assert.deepEqual(
    removed.newInvocationsWithMultipleEffectivePolicyFingerprints,
    [],
  );
  assert.deepEqual(removed, buildExecutableSurfaceDiff(baseline, empty));
});

test("text rendering expands only neutral invocation-governance review evidence", () => {
  const lines = formatExecutableSurfaceInventoryText(
    governanceFixture().inventory,
  ).join("\n");
  assert.match(lines, /^Executable Surface Review$/m);
  assert.match(
    lines,
    /Executable surfaces: 6; static reachability 5 direct, 0 transitive; invocations 15\/19 resolved; invocation-context policy evidence 14\/19/,
  );
  assert.match(lines, /tools\/mixed\.mjs/);
  assert.match(lines, /policy-variants 2/);
  assert.doesNotMatch(lines, /tools\/same-policy\.mjs/);
  assert.match(
    lines,
    /skills\/ref\/references\/run\.md.*invocation-context policy evidence with/,
  );
  assert.doesNotMatch(lines, /sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(lines, /unprotected|unsafe policy|noncompliant/i);
});

test("bounded generated invocation summaries preserve governance partitions and relation-row counts", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          resolved: fc.boolean(),
          sourceEffective: fc.boolean(),
          includeOwner: fc.boolean(),
          ownerEffective: fc.boolean(),
        }),
        { maxLength: 40 },
      ),
      (rows) => {
        const invocations: ExecutableSurfaceInvocation[] = rows.map(
          (row, index) => {
            const fingerprints = [
              ...(row.sourceEffective ? [FP_A] : []),
              ...(row.includeOwner && row.ownerEffective ? [FP_B] : []),
            ];
            const sourcePolicySources: SecurityPolicySource[] =
              row.sourceEffective ? ["local"] : [];
            const ownerPolicySources: SecurityPolicySource[] =
              row.ownerEffective ? ["repository_config"] : [];
            const policyEvidence = [
              {
                relation: "source-artifact" as const,
                path: `contexts/source-${index}.md`,
                hasEffectivePolicy: row.sourceEffective,
                policySources: sourcePolicySources,
                ...(row.sourceEffective ? { fingerprint: FP_A } : {}),
              },
              ...(row.includeOwner
                ? [
                    {
                      relation: "owning-skill" as const,
                      path: `skills/owner-${index}/SKILL.md`,
                      hasEffectivePolicy: row.ownerEffective,
                      policySources: ownerPolicySources,
                      ...(row.ownerEffective ? { fingerprint: FP_B } : {}),
                    },
                  ]
                : []),
            ] satisfies ExecutableSurfaceInvocation["governance"]["policyEvidence"];
            return {
              sourcePath: `contexts/source-${index}.md`,
              line: index + 1,
              snippet: "node tools/check.mjs",
              launcher: "node",
              rawTarget: "tools/check.mjs",
              normalizedTarget: "tools/check.mjs",
              resolution: row.resolved ? "resolved" : "missing",
              occurrenceOrdinal: 1,
              governance: {
                owningSkillResolution: row.includeOwner
                  ? "resolved"
                  : "not-applicable",
                policyEvidence,
                hasEffectivePolicyEvidence: fingerprints.length > 0,
                distinctEffectivePolicyFingerprints: fingerprints,
                fingerprint: FP_D,
              },
            };
          },
        );
        const summary = summarizeExecutableSurfaceInventory([], invocations);

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
          summary.invocationsWithMultipleEffectivePolicyFingerprints,
          rows.filter(
            (row) =>
              row.sourceEffective && row.includeOwner && row.ownerEffective,
          ).length,
        );
        assert.deepEqual(summary.invocationPolicyEvidenceRelations, {
          sourceArtifact: rows.length,
          owningSkill: rows.filter((row) => row.includeOwner).length,
        });
      },
    ),
    { numRuns: 60 },
  );
});

interface GovernanceFixtureOptions {
  leadingLines?: number;
  reversePolicies?: boolean;
  reverseLocalPolicySources?: boolean;
  localFingerprint?: string;
  referenceOwnerFingerprint?: string;
  referenceSourceEffective?: boolean;
  includePlainPolicy?: boolean;
}

function governanceFixture(options: GovernanceFixtureOptions = {}): {
  inventory: ExecutableSurfaceInventory;
  policies: SecurityPolicyAssetEvidence[];
  originalPolicies: SecurityPolicyAssetEvidence[];
} {
  const sources = [
    markdownArtifact(
      "skills/local/SKILL.md",
      "skill",
      commandDocument(
        [
          "node tools/same.mjs",
          "node tools/same.mjs",
          "node tools/different.mjs",
          "node tools/same-policy.mjs",
          "node tools/different-policy.mjs",
          "node tools/missing.mjs",
          "node ../tools/unsafe.mjs",
        ],
        options.leadingLines,
      ),
    ),
    markdownArtifact(
      "skills/config/SKILL.md",
      "skill",
      commandDocument(["node tools/same.mjs", "node tools/same-policy.mjs"]),
    ),
    markdownArtifact(
      "skills/other/SKILL.md",
      "skill",
      commandDocument(["node tools/different-policy.mjs"]),
    ),
    markdownArtifact(
      "skills/plain/SKILL.md",
      "skill",
      commandDocument(["node tools/mixed.mjs"]),
    ),
    markdownArtifact("skills/ref/SKILL.md", "skill", "# Reference owner\n"),
    markdownArtifact(
      "skills/ref/references/run.md",
      "reference",
      commandDocument([
        "node tools/different.mjs",
        "node tools/mixed.mjs",
        "node tools/missing-from-reference.mjs",
      ]),
    ),
    markdownArtifact(
      "skills/missing/references/run.md",
      "reference",
      commandDocument(["node tools/same.mjs"]),
    ),
    markdownArtifact(
      "skills/amb/references/run.md",
      "reference",
      commandDocument(["node tools/same.mjs"]),
    ),
    markdownArtifact(
      "contexts/governed.md",
      "context",
      commandDocument(["node tools/same.mjs"]),
    ),
    markdownArtifact(
      "contexts/plain.md",
      "context",
      commandDocument(["node tools/same.mjs"]),
    ),
    markdownArtifact(
      "README.md",
      "unknown",
      commandDocument(["python scripts/root.py"]),
    ),
  ];
  const tools = [
    "tools/same.mjs",
    "tools/different.mjs",
    "tools/mixed.mjs",
    "tools/same-policy.mjs",
    "tools/different-policy.mjs",
    "tools/zero.mjs",
  ].map((toolPath) => executableArtifact(toolPath));
  const artifacts = [...sources, ...tools];
  const repositoryPathStates = new Map<string, RepositoryPathState>(
    tools.map((tool) => [tool.path, "parsed"] as const),
  );
  repositoryPathStates.set("tools/missing.mjs", "absent");
  repositoryPathStates.set("tools/missing-from-reference.mjs", "absent");

  const localSources: SecurityPolicySource[] = options.reverseLocalPolicySources
    ? ["local", "repository_config"]
    : ["repository_config", "local"];
  const policies = [
    policyEvidence(
      "skills/local/SKILL.md",
      true,
      options.localFingerprint ?? FP_A,
      localSources,
      "skill",
    ),
    policyEvidence(
      "skills/config/SKILL.md",
      true,
      FP_A,
      ["repository_config"],
      "skill",
    ),
    policyEvidence("skills/other/SKILL.md", true, FP_B, ["local"], "skill"),
    policyEvidence(
      "skills/plain/SKILL.md",
      options.includePlainPolicy === true,
      options.includePlainPolicy === true ? FP_D : EMPTY_FP,
      options.includePlainPolicy === true ? ["local"] : [],
      "skill",
    ),
    policyEvidence(
      "skills/ref/SKILL.md",
      true,
      options.referenceOwnerFingerprint ?? FP_B,
      ["local"],
      "skill",
    ),
    policyEvidence(
      "skills/ref/references/run.md",
      options.referenceSourceEffective !== false,
      options.referenceSourceEffective !== false ? FP_C : EMPTY_FP,
      options.referenceSourceEffective !== false ? ["repository_config"] : [],
      "reference",
    ),
    policyEvidence(
      "skills/missing/references/run.md",
      false,
      EMPTY_FP,
      [],
      "reference",
    ),
    policyEvidence(
      "skills/amb/references/run.md",
      false,
      EMPTY_FP,
      [],
      "reference",
    ),
    policyEvidence("contexts/governed.md", true, FP_D, ["local"], "context"),
    policyEvidence("contexts/plain.md", false, EMPTY_FP, [], "context"),
  ];
  if (options.reversePolicies) policies.reverse();
  const originalPolicies = structuredClone(policies);
  const inventory = buildExecutableSurfaceInventory({
    artifacts,
    documents: artifacts.map(parseDocument),
    repositoryPaths: new Set(artifacts.map((artifact) => artifact.path)),
    repositoryPathStates,
    skillParents: new Map([
      ["skills/local", [parent("skills/local/SKILL.md")]],
      ["skills/config", [parent("skills/config/SKILL.md")]],
      ["skills/other", [parent("skills/other/SKILL.md")]],
      ["skills/plain", [parent("skills/plain/SKILL.md")]],
      ["skills/ref", [parent("skills/ref/SKILL.md")]],
      [
        "skills/amb",
        [parent("skills/amb/SKILL.md"), parent("skills/amb/skill.md")],
      ],
    ]),
    securityPolicies: policies,
  });
  return { inventory, policies, originalPolicies };
}

function commandDocument(commands: string[], leadingLines = 0): string {
  return `${"\n".repeat(leadingLines)}# Commands

\`\`\`sh
${commands.join("\n")}
\`\`\`
`;
}

function parent(sourcePath: string) {
  return {
    owner: "platform",
    id: sourcePath,
    sourcePath,
  };
}

function policyEvidence(
  policyPath: string,
  hasEffectivePolicy: boolean,
  effectiveFingerprint: string,
  policySources: SecurityPolicySource[],
  kind: ArtifactKind,
): SecurityPolicyAssetEvidence {
  return {
    path: policyPath,
    kind,
    hasLocalPolicyMetadata: policySources.includes("local"),
    hasEffectivePolicy,
    policySources,
    profileResolution: "none",
    profileChain: [],
    effectivePolicy: {
      fingerprint: effectiveFingerprint,
      allowedData: [],
      forbiddenInputs: [],
      networkAllowed: null,
      externalUploadAllowed: null,
      secretsAllowed: null,
      humanApprovalRequired: null,
      approvedNetworkDestinations: [],
      approvedUploadDestinations: [],
      disallowedCommands: [],
    },
    evidence: {
      policyFields: [],
    },
  };
}

function invocation(
  inventory: ExecutableSurfaceInventory,
  sourcePath: string,
  targetPath: string,
) {
  const result = inventory.invocations.find(
    (candidate) =>
      candidate.sourcePath === sourcePath &&
      candidate.normalizedTarget === targetPath,
  );
  assert.ok(result, `${sourcePath} -> ${targetPath}`);
  return result;
}

function surface(inventory: ExecutableSurfaceInventory, surfacePath: string) {
  const result = inventory.surfaces.find(
    (candidate) => candidate.path === surfacePath,
  );
  assert.ok(result, surfacePath);
  return result;
}

function markdownArtifact(
  artifactPath: string,
  kind: ArtifactKind,
  content: string,
): Artifact {
  return {
    path: artifactPath,
    absolutePath: `/${artifactPath}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentHash: fingerprint("1"),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

function executableArtifact(artifactPath: string): Artifact {
  const content = "console.log('tool');\n";
  return {
    path: artifactPath,
    absolutePath: `/${artifactPath}`,
    kind: "unknown",
    sizeBytes: Buffer.byteLength(content),
    contentHash: fingerprint("2"),
    contentClassification: "text",
    markdownParserEligible: false,
    content,
  };
}

function fingerprint(hex: string): string {
  return `sha256:${hex.repeat(64)}`;
}
