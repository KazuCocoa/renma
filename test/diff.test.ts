import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildCiReportFromDiff,
  formatCiReport,
} from "../src/commands/ci-report.js";
import { buildDiffReport, diff, formatDiff } from "../src/commands/diff.js";
import { ConfigError } from "../src/config.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import {
  type ExecutableSurfaceInventory,
  zeroExecutableSurfaceInventory,
} from "../src/executable-surface-inventory.js";
import {
  zeroSecurityPolicyInventorySummary,
  type SecurityPolicyInventorySummary,
} from "../src/security-policy-inventory.js";
import type { SkillDiscoveryIndex } from "../src/skill-discovery.js";
import { estimateTokens, markdownBody } from "../src/token-estimator.js";

const execFile = promisify(execFileCallback);

test("required-metadata details retain field identity for active and suppressed findings", () => {
  const findingId = DIAGNOSTIC_IDS.META_POLICY_REQUIRED_FIELD_MISSING;
  const path = "skills/demo/SKILL.md";
  const owner = finding(findingId, "high", path, 4, undefined, {
    requiredField: "owner",
    expectedSerializedKey: "metadata.renma.owner",
  });
  const tags = finding(findingId, "high", path, 4, undefined, {
    requiredField: "tags",
    expectedSerializedKey: "metadata.renma.tags",
  });
  const suppressedFindings = [owner, tags].map((item) => ({
    suppression: {
      id: findingId,
      matchedPath: path,
      reason: "reviewed fixture",
      expires: "never" as const,
    },
    finding: item,
  }));
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {}),
    snapshot("head", {
      findings: [owner, tags],
      suppressedFindings,
    }),
  );

  assert.deepEqual(
    report.findings.added.map((item) => item.details?.requiredField),
    ["owner", "tags"],
  );
  assert.deepEqual(
    report.findings.suppressed.added.map(
      (item) => item.finding.details?.requiredField,
    ),
    ["owner", "tags"],
  );
});

test("buildDiffReport compares deterministic readiness snapshots", () => {
  const fromSnapshot = snapshot("base", {
    score: 82,
    level: "not_ready",
    totalAssets: 2,
    ownedAssets: 1,
    ownershipCoveragePercent: 50,
    graphResolutionPercent: 50,
    nodes: [
      node("skill", "skills/demo/SKILL.md", "skill", "platform", "draft"),
      node("old-context", "contexts/old.md", "context", "docs", "stable"),
    ],
    edges: [
      edge(
        "skill",
        "shared-context",
        "requires",
        false,
        "skills/demo/SKILL.md",
      ),
      edge(
        "skill",
        "regressed-context",
        "requires",
        true,
        "skills/demo/SKILL.md",
      ),
    ],
    checks: [
      check(
        "workflow.completion_criteria",
        "warn",
        "warning",
        "Missing criteria",
      ),
    ],
    findings: [
      finding(
        "QUAL-MISSING-COMPLETION-CRITERIA",
        "high",
        "skills/demo/SKILL.md",
        12,
      ),
      finding(
        "SEC-MISSING-POLICY-METADATA",
        "medium",
        "skills/demo/SKILL.md",
        4,
        "advisory",
      ),
    ],
    securityPolicyInventory: policyInventory({
      totalPolicyAssets: 2,
      assetsWithLocalPolicyMetadata: 1,
      assetsWithoutEffectivePolicy: 1,
      networkDenied: 1,
      uploadDenied: 1,
      secretsDenied: 1,
      approvedNetworkDestinationCount: 1,
      approvedUploadDestinationCount: 1,
      forbiddenInputCount: 2,
      cyclicSecurityProfiles: 1,
    }),
  });
  const toSnapshot = snapshot("head", {
    score: 91,
    level: "ready",
    totalAssets: 3,
    ownedAssets: 3,
    ownershipCoveragePercent: 100,
    graphResolutionPercent: 75,
    nodes: [
      node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
      node("new-context", "contexts/new.md", "context", "docs", "stable"),
    ],
    edges: [
      edge("skill", "shared-context", "requires", true, "skills/demo/SKILL.md"),
      edge(
        "skill",
        "missing-context",
        "requires",
        false,
        "skills/demo/SKILL.md",
      ),
      edge(
        "skill",
        "regressed-context",
        "requires",
        false,
        "skills/demo/SKILL.md",
      ),
    ],
    checks: [
      check("workflow.completion_criteria", "pass", "info", "Criteria present"),
    ],
    findings: [
      finding("MAINT-REPEATED-CODE-BLOCK", "low", "docs/guide.md", 2),
      finding(
        "SEC-DESTRUCTIVE-COMMAND",
        "critical",
        "skills/demo/SKILL.md",
        20,
        "violation",
      ),
    ],
    securityPolicyInventory: policyInventory({
      totalPolicyAssets: 4,
      assetsWithLocalPolicyMetadata: 3,
      assetsWithoutEffectivePolicy: 0,
      networkAllowed: 1,
      networkDenied: 1,
      uploadDenied: 2,
      secretsAllowed: 1,
      secretsDenied: 1,
      humanApprovalRequired: 1,
      approvedNetworkDestinationCount: 3,
      approvedUploadDestinationCount: 1,
      forbiddenInputCount: 3,
      missingSecurityProfiles: 1,
    }),
  });

  const report = buildDiffReport("/repo", fromSnapshot, toSnapshot);

  assert.deepEqual(report.summary, {
    readinessScoreDelta: 9,
    readinessLevelChanged: true,
    totalAssetsDelta: 1,
    ownershipCoverageDelta: 50,
    graphResolutionDelta: 25,
    findingsDelta: 0,
    highOrCriticalFindingsDelta: 0,
  });
  assert.deepEqual(report.from.ownership, {
    ownedAssets: 1,
    eligibleAssets: 2,
    coveragePercent: 50,
  });
  assert.deepEqual(report.to.ownership, {
    ownedAssets: 3,
    eligibleAssets: 3,
    coveragePercent: 100,
  });
  assert.deepEqual(
    report.catalog.addedAssets.map((asset) => asset.id),
    ["new-context"],
  );
  assert.equal(report.catalog.addedAssets[0]?.declaredOwner, "docs");
  assert.equal(report.catalog.addedAssets[0]?.effectiveOwner, "docs");
  assert.deepEqual(
    report.catalog.removedAssets.map((asset) => asset.id),
    ["old-context"],
  );
  assert.deepEqual(report.catalog.changedAssets[0]?.changedFields, ["status"]);
  assert.deepEqual(
    report.graph.newUnresolvedEdges.map((edge) => edge.target),
    ["missing-context", "regressed-context"],
  );
  assert.deepEqual(
    report.graph.resolvedEdges.map((edge) => edge.target),
    ["shared-context"],
  );
  assert.deepEqual(report.readiness.checkChanges[0], {
    id: "workflow.completion_criteria",
    title: "Completion criteria",
    fromStatus: "warn",
    toStatus: "pass",
    fromSeverity: "warning",
    toSeverity: "info",
    summaryChanged: true,
  });
  assert.deepEqual(
    report.findings.countById.map((entry) => [entry.id, entry.delta]),
    [
      ["MAINT-REPEATED-CODE-BLOCK", 1],
      ["QUAL-MISSING-COMPLETION-CRITERIA", -1],
      ["SEC-DESTRUCTIVE-COMMAND", 1],
      ["SEC-MISSING-POLICY-METADATA", -1],
    ],
  );
  assert.equal(
    report.findings.added.some(
      (finding) => finding.title === "SEC-DESTRUCTIVE-COMMAND",
    ),
    true,
  );
  assert.equal("message" in report.findings.added[0]!, false);
  assert.equal(report.security.posture.added.totalSecurityFindings, 1);
  assert.equal(report.security.posture.added.riskClasses.violation, 1);
  assert.equal(report.security.posture.resolved.totalSecurityFindings, 1);
  assert.equal(report.security.posture.resolved.riskClasses.advisory, 1);
  assert.equal(report.security.policyInventory.totalPolicyAssets, 2);
  assert.equal(
    report.security.policyInventory.assetsWithLocalPolicyMetadata,
    2,
  );
  assert.equal(
    report.security.policyInventory.assetsWithoutEffectivePolicy,
    -1,
  );
  assert.equal(report.security.policyInventory.networkAllowed.true, 1);
  assert.equal(report.security.policyInventory.securityProfiles.missing, 1);
  assert.equal(report.security.policyInventory.securityProfiles.cyclic, -1);
});

test("content identity changes are neutral, deterministic, reversible, and legacy-compatible", () => {
  const unchanged = {
    ...node("context", "contexts/context.md", "context", "docs", "stable"),
    contentHash: `sha256:${"a".repeat(64)}`,
  };
  const before = {
    ...node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
    contentHash: `sha256:${"b".repeat(64)}`,
  };
  const after = {
    ...before,
    contentHash: `sha256:${"c".repeat(64)}`,
  };
  const from = snapshot("base", {
    score: 100,
    level: "ready",
    totalAssets: 2,
    ownedAssets: 2,
    ownershipCoveragePercent: 100,
    graphResolutionPercent: 100,
    nodes: [before, unchanged],
  });
  const to = snapshot("head", {
    score: 100,
    level: "ready",
    totalAssets: 2,
    ownedAssets: 2,
    ownershipCoveragePercent: 100,
    graphResolutionPercent: 100,
    nodes: [unchanged, after],
  });

  const forward = buildDiffReport("/repo", from, to);
  const reordered = buildDiffReport(
    "/repo",
    snapshot("base", {
      score: 100,
      level: "ready",
      totalAssets: 2,
      ownedAssets: 2,
      ownershipCoveragePercent: 100,
      graphResolutionPercent: 100,
      nodes: [unchanged, before],
    }),
    snapshot("head", {
      score: 100,
      level: "ready",
      totalAssets: 2,
      ownedAssets: 2,
      ownershipCoveragePercent: 100,
      graphResolutionPercent: 100,
      nodes: [after, unchanged],
    }),
  );
  const reverse = buildDiffReport("/repo", to, from);

  assert.equal(forward.summary.contentChangedAssets, 1);
  assert.deepEqual(
    forward.catalog.changedAssets,
    reordered.catalog.changedAssets,
  );
  assert.deepEqual(forward.catalog.changedAssets[0], {
    id: "skill",
    path: "skills/demo/SKILL.md",
    changedFields: [],
    contentChanged: true,
    from: {
      id: "skill",
      path: "skills/demo/SKILL.md",
      kind: "skill",
      contentHash: before.contentHash,
      declaredOwner: "platform",
      effectiveOwner: "platform",
      status: "stable",
    },
    to: {
      id: "skill",
      path: "skills/demo/SKILL.md",
      kind: "skill",
      contentHash: after.contentHash,
      declaredOwner: "platform",
      effectiveOwner: "platform",
      status: "stable",
    },
  });
  assert.equal(reverse.catalog.changedAssets[0]?.contentChanged, true);
  assert.equal(
    reverse.catalog.changedAssets[0]?.from.contentHash,
    after.contentHash,
  );
  assert.equal(
    reverse.catalog.changedAssets[0]?.to.contentHash,
    before.contentHash,
  );

  const ci = buildCiReportFromDiff(forward);
  const ciJson = JSON.parse(formatCiReport(ci, "json")) as typeof ci;
  const diffJson = JSON.parse(formatDiff(forward, "json")) as typeof forward;
  const ciMarkdown = formatCiReport(ci, "markdown");
  const diffMarkdown = formatDiff(forward, "markdown");
  assert.equal(ci.status, "pass");
  assert.equal(ciJson.diff.summary.contentChangedAssets, 1);
  assert.equal(ciJson.diff.catalog.changedAssets[0]?.contentChanged, true);
  assert.equal(
    ciJson.diff.catalog.changedAssets[0]?.from.contentHash,
    before.contentHash,
  );
  assert.equal(diffJson.summary.contentChangedAssets, 1);
  assert.equal(diffJson.catalog.changedAssets[0]?.contentChanged, true);
  assert.equal(
    diffJson.catalog.changedAssets[0]?.to.contentHash,
    after.contentHash,
  );
  assert.match(ciMarkdown, /- Content changes: 1/u);
  assert.match(ciMarkdown, /- Changed assets: 1/u);
  assert.match(ciMarkdown, /- Content changed: yes/u);
  assert.match(diffMarkdown, /- Content changes: 1/u);
  assert.match(diffMarkdown, /- Content-changed assets: 1/u);

  const legacy = buildDiffReport(
    "/repo",
    snapshot("base", {
      nodes: [
        node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
      ],
    }),
    snapshot("head", {
      nodes: [
        node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
      ],
    }),
  );
  assert.equal(legacy.catalog.changedAssets.length, 0);
  assert.equal(legacy.summary.contentChangedAssets, undefined);

  const legacyGovernanceChange = buildDiffReport(
    "/repo",
    snapshot("base", {
      nodes: [
        node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
      ],
    }),
    snapshot("head", {
      nodes: [
        node("skill", "skills/demo/SKILL.md", "skill", "security", "stable"),
      ],
    }),
  );
  const legacyChange = legacyGovernanceChange.catalog.changedAssets[0];
  assert.ok(legacyChange);
  assert.deepEqual(legacyChange.changedFields, [
    "declaredOwner",
    "effectiveOwner",
  ]);
  assert.equal(legacyChange.contentChanged, undefined);
  assert.equal(legacyGovernanceChange.summary.contentChangedAssets, undefined);

  const legacyDiffMarkdown = formatDiff(legacyGovernanceChange, "markdown");
  const legacyCiMarkdown = formatCiReport(
    buildCiReportFromDiff(legacyGovernanceChange),
    "markdown",
  );
  for (const markdown of [legacyDiffMarkdown, legacyCiMarkdown]) {
    assert.doesNotMatch(markdown, /Content changes:/iu);
    assert.doesNotMatch(markdown, /Content-changed assets:/iu);
    assert.doesNotMatch(markdown, /content changed: no/iu);
  }

  const oneSidedIdentity = buildDiffReport(
    "/repo",
    snapshot("base", {
      nodes: [
        {
          ...node(
            "skill",
            "skills/demo/SKILL.md",
            "skill",
            "platform",
            "stable",
          ),
          contentHash: `sha256:${"d".repeat(64)}`,
        },
      ],
    }),
    snapshot("head", {
      nodes: [
        node("skill", "skills/demo/SKILL.md", "skill", "security", "stable"),
      ],
    }),
  );
  assert.equal(
    oneSidedIdentity.catalog.changedAssets[0]?.contentChanged,
    undefined,
  );
  assert.equal(oneSidedIdentity.summary.contentChangedAssets, undefined);
});

test("partial content identity remains explicit without fabricating a complete summary", () => {
  const comparableBefore = {
    ...node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
    contentHash: `sha256:${"a".repeat(64)}`,
  };
  const comparableAfter = {
    ...comparableBefore,
    contentHash: `sha256:${"b".repeat(64)}`,
  };
  const legacyBefore = node(
    "context",
    "contexts/context.md",
    "context",
    "docs",
    "stable",
  );
  const legacyAfter = node(
    "context",
    "contexts/context.md",
    "context",
    "security",
    "stable",
  );
  const report = buildDiffReport(
    "/repo",
    snapshot("base", { nodes: [comparableBefore, legacyBefore] }),
    snapshot("head", { nodes: [legacyAfter, comparableAfter] }),
  );

  assert.equal(report.summary.contentChangedAssets, undefined);
  assert.equal(report.catalog.changedAssets.length, 2);
  assert.equal(
    report.catalog.changedAssets.find(({ id }) => id === "skill")
      ?.contentChanged,
    true,
  );
  assert.equal(
    report.catalog.changedAssets.find(({ id }) => id === "context")
      ?.contentChanged,
    undefined,
  );

  const markdownReports = [
    formatDiff(report, "markdown"),
    formatCiReport(buildCiReportFromDiff(report), "markdown"),
  ];
  for (const markdown of markdownReports) {
    assert.doesNotMatch(markdown, /Content changes:/iu);
    assert.doesNotMatch(markdown, /Content-changed assets:/iu);
    assert.match(markdown, /content changed: yes/iu);
    assert.doesNotMatch(markdown, /content changed: no/iu);
  }
});

test("buildDiffReport exposes canonical declared and effective owner changes", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      totalAssets: 3,
      ownedAssets: 3,
      ownershipCoveragePercent: 100,
      nodes: [
        canonicalNode(
          "skill.release-prep",
          "skills/release-prep/SKILL.md",
          "skill",
          "team-a",
          "team-a",
          "stable",
        ),
        canonicalNode(
          "skill.inherited-owner",
          "skills/inherited-owner/SKILL.md",
          "skill",
          null,
          "team-a",
          "stable",
        ),
        canonicalNode(
          "skill.owner-removed",
          "skills/owner-removed/SKILL.md",
          "skill",
          "team-c",
          "team-c",
          "stable",
        ),
      ],
    }),
    snapshot("head", {
      totalAssets: 6,
      ownedAssets: 4,
      ownershipCoveragePercent: 67,
      nodes: [
        canonicalNode(
          "skill.z-added",
          "skills/z-added/SKILL.md",
          "skill",
          "team-z",
          "team-z",
          "stable",
        ),
        canonicalNode(
          "skill.release-prep",
          "skills/release-prep/SKILL.md",
          "skill",
          "team-b",
          "team-b",
          "stable",
        ),
        canonicalNode(
          "skill.inherited-owner",
          "skills/inherited-owner/SKILL.md",
          "skill",
          null,
          "team-b",
          "stable",
        ),
        canonicalNode(
          "skill.owner-removed",
          "skills/owner-removed/SKILL.md",
          "skill",
          null,
          null,
          "stable",
        ),
        canonicalNode(
          "skill.a-added",
          "skills/a-added/SKILL.md",
          "skill",
          null,
          "inherited-team",
          "stable",
        ),
        canonicalNode(
          "skill.m-unowned",
          "skills/m-unowned/SKILL.md",
          "skill",
          null,
          null,
          "stable",
        ),
      ],
    }),
  );

  assert.deepEqual(
    report.catalog.addedAssets.map((asset) => asset.id),
    ["skill.a-added", "skill.m-unowned", "skill.z-added"],
  );
  assert.deepEqual(report.catalog.addedAssets[0], {
    id: "skill.a-added",
    path: "skills/a-added/SKILL.md",
    kind: "skill",
    declaredOwner: null,
    effectiveOwner: "inherited-team",
    status: "stable",
  });
  assert.deepEqual(report.catalog.addedAssets[1], {
    id: "skill.m-unowned",
    path: "skills/m-unowned/SKILL.md",
    kind: "skill",
    declaredOwner: null,
    effectiveOwner: null,
    status: "stable",
  });
  assert.deepEqual(report.catalog.addedAssets[2], {
    id: "skill.z-added",
    path: "skills/z-added/SKILL.md",
    kind: "skill",
    declaredOwner: "team-z",
    effectiveOwner: "team-z",
    status: "stable",
  });
  const declaredChange = report.catalog.changedAssets.find(
    (change) => change.id === "skill.release-prep",
  );
  const effectiveChange = report.catalog.changedAssets.find(
    (change) => change.id === "skill.inherited-owner",
  );
  const ownerRemoval = report.catalog.changedAssets.find(
    (change) => change.id === "skill.owner-removed",
  );
  assert.deepEqual(declaredChange?.changedFields, [
    "declaredOwner",
    "effectiveOwner",
  ]);
  assert.equal(declaredChange?.from.declaredOwner, "team-a");
  assert.equal(declaredChange?.to.effectiveOwner, "team-b");
  assert.deepEqual(effectiveChange?.changedFields, ["effectiveOwner"]);
  assert.equal(effectiveChange?.from.declaredOwner, null);
  assert.equal(effectiveChange?.to.effectiveOwner, "team-b");
  assert.deepEqual(ownerRemoval?.changedFields, [
    "declaredOwner",
    "effectiveOwner",
  ]);
  assert.equal(ownerRemoval?.to.declaredOwner, null);
  assert.equal(ownerRemoval?.to.effectiveOwner, null);
  assert.equal(report.summary.ownershipCoverageDelta, -33);
});

test("buildDiffReport uses null when canonical ownership is absent and ignores top-level owner", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      totalAssets: 1,
      ownedAssets: 0,
      nodes: [
        {
          id: "context.existing",
          sourcePath: "contexts/existing.md",
          kind: "context",
          owner: "team-a",
          status: "stable",
        },
      ],
    }),
    snapshot("head", {
      totalAssets: 2,
      ownedAssets: 0,
      nodes: [
        {
          id: "context.existing",
          sourcePath: "contexts/existing.md",
          kind: "context",
          owner: "team-b",
          status: "stable",
        },
        {
          id: "context.added",
          sourcePath: "contexts/added.md",
          kind: "context",
          owner: "team-c",
          status: "stable",
        },
      ],
    }),
  );

  assert.deepEqual(report.catalog.changedAssets, []);
  assert.deepEqual(report.catalog.addedAssets, [
    {
      id: "context.added",
      path: "contexts/added.md",
      kind: "context",
      declaredOwner: null,
      effectiveOwner: null,
      status: "stable",
    },
  ]);
  assert.equal("owner" in report.catalog.addedAssets[0]!, false);
});

test("buildDiffReport preserves readiness ownership behavior for an empty eligible set", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      totalAssets: 0,
      ownedAssets: 0,
      ownershipCoveragePercent: 100,
    }),
    snapshot("head", {
      totalAssets: 0,
      ownedAssets: 0,
      ownershipCoveragePercent: 100,
    }),
  );

  assert.deepEqual(report.from.ownership, {
    ownedAssets: 0,
    eligibleAssets: 0,
    coveragePercent: 100,
  });
  assert.deepEqual(report.to.ownership, report.from.ownership);
  assert.equal(report.summary.ownershipCoverageDelta, 0);
});

test("semantic diff compares lifecycle status, reason, and changed date independently", () => {
  const fromNode = {
    ...canonicalNode(
      "context.lifecycle",
      "contexts/lifecycle.md",
      "context",
      "qa",
      "qa",
      "stable",
    ),
    statusReason: "Initial stable review.",
    statusChangedAt: "2026-08-01",
  };
  const toNode = {
    ...fromNode,
    status: "suspended",
    statusReason: "Temporarily disabled while issue QE-1234 is corrected.",
    statusChangedAt: "2026-08-03",
  };
  const transition = buildDiffReport(
    "/repo",
    snapshot("base", { totalAssets: 1, nodes: [fromNode] }),
    snapshot("head", { totalAssets: 1, nodes: [toNode] }),
  );

  assert.deepEqual(transition.catalog.changedAssets[0]?.changedFields, [
    "status",
    "statusReason",
    "statusChangedAt",
  ]);
  assert.equal(
    transition.catalog.changedAssets[0]?.to.statusReason,
    "Temporarily disabled while issue QE-1234 is corrected.",
  );
  assert.match(formatDiff(transition, "markdown"), /statusReason/);

  const evidenceOnly = buildDiffReport(
    "/repo",
    snapshot("base", { totalAssets: 1, nodes: [toNode] }),
    snapshot("head", {
      totalAssets: 1,
      nodes: [
        {
          ...toNode,
          statusReason: "Corrective work is under independent review.",
          statusChangedAt: "2026-08-04",
        },
      ],
    }),
  );
  assert.deepEqual(evidenceOnly.catalog.changedAssets[0]?.changedFields, [
    "statusReason",
    "statusChangedAt",
  ]);

  const restored = buildDiffReport(
    "/repo",
    snapshot("base", { totalAssets: 1, nodes: [toNode] }),
    snapshot("head", {
      totalAssets: 1,
      nodes: [
        {
          ...toNode,
          status: "stable",
          statusReason: "Fix for QE-1234 was validated and approved.",
          statusChangedAt: "2026-08-06",
        },
      ],
    }),
  );
  assert.deepEqual(restored.catalog.changedAssets[0]?.changedFields, [
    "status",
    "statusReason",
    "statusChangedAt",
  ]);
});

test("graph edge identity ignores source asset path moves", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      totalAssets: 2,
      ownedAssets: 2,
      ownershipCoveragePercent: 100,
      graphResolutionPercent: 100,
      nodes: [
        canonicalNode(
          "skill.demo",
          "skills/old/SKILL.md",
          "skill",
          "platform",
          "platform",
          "stable",
        ),
        canonicalNode(
          "context.shared",
          "contexts/shared.md",
          "context",
          "docs",
          "docs",
          "stable",
        ),
      ],
      edges: [
        graphEdge(
          "skill.demo",
          "context.shared",
          "requires",
          "skills/old/SKILL.md",
          true,
          "context.shared",
        ),
      ],
    }),
    snapshot("head", {
      totalAssets: 2,
      ownedAssets: 2,
      ownershipCoveragePercent: 100,
      graphResolutionPercent: 100,
      nodes: [
        canonicalNode(
          "skill.demo",
          "skills/new/SKILL.md",
          "skill",
          "platform",
          "platform",
          "stable",
        ),
        canonicalNode(
          "context.shared",
          "contexts/shared.md",
          "context",
          "docs",
          "docs",
          "stable",
        ),
      ],
      edges: [
        graphEdge(
          "skill.demo",
          "context.shared",
          "requires",
          "skills/new/SKILL.md",
          true,
          "context.shared",
        ),
      ],
    }),
  );

  assert.deepEqual(report.graph.addedEdges, []);
  assert.deepEqual(report.graph.removedEdges, []);
  assert.deepEqual(report.graph.newUnresolvedEdges, []);
  assert.deepEqual(report.graph.resolvedEdges, []);
});

test("moving a source with an existing unresolved required edge stays PASS", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      totalAssets: 1,
      ownedAssets: 1,
      ownershipCoveragePercent: 100,
      graphResolutionPercent: 0,
      nodes: [
        canonicalNode(
          "skill.demo",
          "skills/old/SKILL.md",
          "skill",
          "platform",
          "platform",
          "stable",
        ),
      ],
      edges: [
        graphEdge(
          "skill.demo",
          "context.missing",
          "requires",
          "skills/old/SKILL.md",
          false,
        ),
      ],
    }),
    snapshot("head", {
      totalAssets: 1,
      ownedAssets: 1,
      ownershipCoveragePercent: 100,
      graphResolutionPercent: 0,
      nodes: [
        canonicalNode(
          "skill.demo",
          "skills/new/SKILL.md",
          "skill",
          "platform",
          "platform",
          "stable",
        ),
      ],
      edges: [
        graphEdge(
          "skill.demo",
          "context.missing",
          "requires",
          "skills/new/SKILL.md",
          false,
        ),
      ],
    }),
  );

  assert.deepEqual(report.graph.addedEdges, []);
  assert.deepEqual(report.graph.removedEdges, []);
  assert.deepEqual(report.graph.newUnresolvedEdges, []);
  assert.equal(buildCiReportFromDiff(report).status, "pass");
});

test("path declaration resolution is a resolved edge transition", () => {
  const nodes = [
    canonicalNode(
      "skill.demo",
      "skills/demo/SKILL.md",
      "skill",
      "platform",
      "platform",
      "stable",
    ),
    canonicalNode(
      "context.shared",
      "contexts/shared.md",
      "context",
      "docs",
      "docs",
      "stable",
    ),
  ];
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      totalAssets: 2,
      ownedAssets: 2,
      ownershipCoveragePercent: 100,
      graphResolutionPercent: 0,
      nodes,
      edges: [
        graphEdge(
          "skill.demo",
          "contexts/shared.md",
          "requires",
          "skills/demo/SKILL.md",
          false,
        ),
      ],
    }),
    snapshot("head", {
      totalAssets: 2,
      ownedAssets: 2,
      ownershipCoveragePercent: 100,
      graphResolutionPercent: 100,
      nodes,
      edges: [
        graphEdge(
          "skill.demo",
          "contexts/shared.md",
          "requires",
          "skills/demo/SKILL.md",
          true,
          "context.shared",
        ),
      ],
    }),
  );

  assert.deepEqual(report.graph.addedEdges, []);
  assert.deepEqual(report.graph.removedEdges, []);
  assert.deepEqual(report.graph.newUnresolvedEdges, []);
  assert.deepEqual(report.graph.resolvedEdges, [
    {
      source: "skill.demo",
      target: "context.shared",
      kind: "requires",
      resolved: true,
      evidence: undefined,
    },
  ]);
  assert.equal(buildCiReportFromDiff(report).status, "pass");
});

test("buildDiffReport accepts legacy snapshots without Discovery indexes", () => {
  const { discovery: fromDiscovery, ...fromSnapshot } = snapshot("base", {
    totalAssets: 1,
    nodes: [
      node("old-context", "contexts/old.md", "context", "docs", "stable"),
    ],
  });
  const { discovery: toDiscovery, ...toSnapshot } = snapshot("head", {
    score: 10,
    totalAssets: 1,
    nodes: [
      node("new-context", "contexts/new.md", "context", "docs", "stable"),
    ],
  });
  assert.ok(fromDiscovery);
  assert.ok(toDiscovery);

  const report = buildDiffReport("/repo", fromSnapshot, toSnapshot);
  const expected = buildDiffReport(
    "/repo",
    { ...fromSnapshot, discovery: fromDiscovery },
    { ...toSnapshot, discovery: toDiscovery },
  );
  const { discovery: expectedDiscovery, ...expectedExistingFields } = expected;
  const { discovery: actualDiscovery, ...actualExistingFields } = report;
  void expectedDiscovery;
  void actualDiscovery;

  assert.deepEqual(report.discovery, {
    schemaVersion: "renma.skill-discovery-diff.v1",
    adoption: {
      from: "not-adopted",
      to: "not-adopted",
      changed: false,
    },
    coverage: {
      from: "not-evaluated",
      to: "not-evaluated",
      changed: false,
    },
    summary: {
      publishedEntrypointCountDelta: 0,
      routeEligibleSkillCountDelta: 0,
      reachableSkillCountDelta: 0,
      notReachedSkillCountDelta: 0,
      unroutedSkillCountDelta: 0,
      usableRouteCountDelta: 0,
      unusableRouteCountDelta: 0,
      unresolvedRouteCountDelta: 0,
      cycleComponentCountDelta: 0,
    },
    publishedEntrypoints: {
      added: [],
      removed: [],
    },
    reachability: {
      newlyReachable: [],
      newlyNotReached: [],
    },
    unroutedSkills: {
      newlyUnrouted: [],
      resolvedUnrouted: [],
    },
    routes: {
      added: [],
      removed: [],
      changed: [],
    },
    cycles: {
      added: [],
      resolved: [],
    },
  });
  assert.deepEqual(
    report.catalog.addedAssets.map((asset) => asset.id),
    ["new-context"],
  );
  assert.deepEqual(
    report.catalog.removedAssets.map((asset) => asset.id),
    ["old-context"],
  );
  assert.equal(report.summary.readinessScoreDelta, 10);
  assert.deepEqual(actualExistingFields, expectedExistingFields);
  assert.doesNotMatch(
    JSON.stringify(report.discovery),
    /diagnostics|declarationIndex|repositoryPaths|documents|artifacts/,
  );
});

test("formatDiff renders markdown summaries", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      securityPolicyInventory: policyInventory({
        totalPolicyAssets: 1,
        assetsWithoutEffectivePolicy: 1,
        networkDenied: 1,
      }),
    }),
    snapshot("head", {
      score: 90,
      scannedFileCount: 6,
      totalAssets: 1,
      nodes: [
        node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
      ],
      findings: [
        finding("MAINT-REPEATED-CODE-BLOCK", "high", "docs/guide.md", 12),
        finding(
          "SEC-LITERAL-SECRET",
          "high",
          "skills/demo/SKILL.md",
          4,
          "violation",
        ),
      ],
      securityPolicyInventory: policyInventory({
        totalPolicyAssets: 3,
        assetsWithLocalPolicyMetadata: 2,
        assetsWithoutEffectivePolicy: 0,
        networkAllowed: 1,
        networkDenied: 1,
        missingSecurityProfiles: 1,
      }),
    }),
  );

  const markdown = formatDiff(report, "markdown");
  const parsed = JSON.parse(formatDiff(report, "json"));

  assert.equal(parsed.schemaVersion, "renma.diff.v1");
  assert.match(markdown, /# Renma semantic diff/);
  assert.match(markdown, /Refs: `base` -> `head`/);
  assert.match(markdown, /Readiness score: 90 \(\+90\)/);
  assert.match(markdown, /Scanned files: 6 \(\+6\)/);
  assert.match(markdown, /Total assets: 1 \(\+1\)/);
  assert.match(markdown, /^## Skill Discovery Changes$/m);
  assert.match(markdown, /- Adoption: not-adopted -> not-adopted/);
  assert.equal(parsed.discovery.schemaVersion, "renma.skill-discovery-diff.v1");
  assert.doesNotMatch(markdown, /- Assets:/);
  assert.match(markdown, /Added assets: 1/);
  assert.match(markdown, /^## Security Changes$/m);
  assert.match(markdown, /- Added security findings: 1/);
  assert.match(markdown, /- Resolved security findings: 0/);
  assert.match(markdown, /- Added violations: 1/);
  assert.match(markdown, /- Policy assets: \+2/);
  assert.match(markdown, /- Assets with local policy metadata: \+2/);
  assert.match(markdown, /- Assets without effective policy: -1/);
  assert.match(markdown, /- Network allowed: \+1/);
  assert.match(markdown, /- Missing security profiles: \+1/);
  assert.ok(
    markdown.indexOf("## Security Changes") <
      markdown.indexOf("### Added findings"),
  );
  assert.match(
    markdown,
    /- MAINT-REPEATED-CODE-BLOCK \(high\) at docs\/guide\.md/,
  );
  assert.match(
    markdown,
    /- HIGH \[violation\] SEC-LITERAL-SECRET at skills\/demo\/SKILL\.md/,
  );
  assert.equal(parsed.security.posture.added.totalSecurityFindings, 1);
  assert.equal(parsed.security.policyInventory.totalPolicyAssets, 2);
});

test("formatDiff surfaces canonical per-asset security policy relaxations before aggregate metrics", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {}),
    snapshot("head", {}),
  );
  report.security.policyTransitions = [
    {
      kind: "scalar",
      asset: {
        id: "skill.ops.deploy",
        path: "skills/ops/deploy/SKILL.md",
        kind: "skill",
      },
      property: "networkAllowed",
      fromState: false,
      toState: true,
      provenance: {
        mode: "direct",
        sources: [
          {
            type: "asset",
            id: "skill.ops.deploy",
            path: "skills/ops/deploy/SKILL.md",
          },
        ],
      },
    },
    {
      kind: "list",
      asset: {
        id: "skill.ops.deploy",
        path: "skills/ops/deploy/SKILL.md",
        kind: "skill",
      },
      property: "approvedNetworkDestinations",
      added: ["telemetry.vendor.io"],
      removed: [],
      provenance: {
        mode: "direct",
        sources: [
          {
            type: "asset",
            id: "skill.ops.deploy",
            path: "skills/ops/deploy/SKILL.md",
          },
        ],
      },
    },
  ];

  const markdown = formatDiff(report, "markdown");
  const parsed = JSON.parse(formatDiff(report, "json"));

  assert.match(markdown, /^### Security policy relaxations$/m);
  assert.match(
    markdown,
    /skill\.ops\.deploy[\s\S]*networkAllowed false -> true/,
  );
  assert.match(
    markdown,
    /approvedNetworkDestinations — allowed value added: `telemetry\.vendor\.io`/,
  );
  assert.ok(
    markdown.indexOf("### Security policy relaxations") <
      markdown.indexOf("### Aggregate security metrics"),
  );
  assert.ok(
    markdown.indexOf("### Aggregate security metrics") <
      markdown.indexOf("- Added security findings:"),
  );
  assert.deepEqual(
    parsed.security.policyTransitions,
    report.security.policyTransitions,
  );
});

test("formatDiff deterministically exposes corrected invocation states", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      executableSurfaceInventory: inventoryWithInvocation("resolved"),
    }),
    snapshot("head", {
      executableSurfaceInventory: inventoryWithInvocation("noncanonical"),
    }),
  );

  const markdown = formatDiff(report, "markdown");
  const parsed = JSON.parse(formatDiff(report, "json"));

  assert.equal(markdown, formatDiff(report, "markdown"));
  assert.match(
    markdown,
    /node `skills\/orphan\/scripts\/run\.mjs` #1: resolved -> noncanonical/,
  );
  assert.equal(
    parsed.executableSurface.invocationResolutionChanges[0].toResolution,
    "noncanonical",
  );
});

test("formatDiff renders line-insensitive invocation governance changes separately from surface policy", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      executableSurfaceInventory: inventoryWithInvocation("resolved"),
    }),
    snapshot("head", {
      executableSurfaceInventory: inventoryWithInvocation("resolved", [
        `sha256:${"a".repeat(64)}`,
        `sha256:${"b".repeat(64)}`,
      ]),
    }),
  );

  const markdown = formatDiff(report, "markdown");
  const parsed = JSON.parse(formatDiff(report, "json"));

  assert.match(markdown, /- Invocation governance changes: 1/);
  assert.match(
    markdown,
    /- Invocation-context policy evidence: 1 with \(\+1\), 0 without \(-1\)/,
  );
  assert.match(markdown, /policy evidence without -> with/);
  assert.match(markdown, /effective fingerprints 0 -> 2/);
  assert.doesNotMatch(markdown, /sha256:[a-f0-9]{64}/);
  assert.equal(
    parsed.executableSurface.invocationGovernanceChanges[0]
      .toHasEffectivePolicyEvidence,
    true,
  );
  assert.deepEqual(parsed.executableSurface.newProblematicInvocations, []);
});

test("formatDiff JSON unconditionally exposes newly added multi-fingerprint invocations", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {
      executableSurfaceInventory: zeroExecutableSurfaceInventory(),
    }),
    snapshot("head", {
      executableSurfaceInventory: inventoryWithInvocation("resolved", [
        `sha256:${"a".repeat(64)}`,
        `sha256:${"b".repeat(64)}`,
      ]),
    }),
  );

  const parsed = JSON.parse(formatDiff(report, "json"));
  assert.equal(
    parsed.executableSurface
      .newInvocationsWithMultipleEffectivePolicyFingerprints.length,
    1,
  );
  assert.deepEqual(
    parsed.executableSurface.newInvocationsWithoutEffectivePolicyEvidence,
    [],
  );
  assert.deepEqual(parsed.executableSurface.newProblematicInvocations, []);
});

test("formatDiff renders legacy reports without a Discovery section", () => {
  const fullReport = buildDiffReport(
    "/repo",
    snapshot("base", {}),
    snapshot("head", {
      totalAssets: 1,
      nodes: [
        node("skill", "skills/demo/SKILL.md", "skill", "platform", "stable"),
      ],
    }),
  );
  const { discovery, ...legacyReport } = fullReport;
  void discovery;
  const serializedLegacyReport = JSON.stringify(legacyReport);
  const parsedLegacyReport = JSON.parse(
    serializedLegacyReport,
  ) as typeof legacyReport;

  const markdown = formatDiff(parsedLegacyReport, "markdown");
  const json = JSON.parse(formatDiff(parsedLegacyReport, "json")) as Record<
    string,
    unknown
  >;
  const expectedMarkdown = formatDiff(fullReport, "markdown").replace(
    /\n## Skill Discovery Changes\n[\s\S]*?\n## Scan Boundary/,
    "\n## Scan Boundary",
  );

  assert.equal(markdown, expectedMarkdown);
  assert.doesNotMatch(markdown, /^## Skill Discovery Changes$/m);
  assert.match(markdown, /^## Catalog$/m);
  assert.match(markdown, /- Added assets: 1/);
  assert.match(markdown, /^## Graph$/m);
  assert.match(markdown, /- Added edges: 0/);
  assert.match(markdown, /^## Readiness checks$/m);
  assert.match(markdown, /- \(none\)/);
  assert.match(markdown, /^## Findings$/m);
  assert.match(markdown, /- Added findings: 0/);
  assert.match(markdown, /^## Security Changes$/m);
  assert.match(markdown, /- Added security findings: 0/);
  assert.equal("discovery" in json, false);
});

test("diff collects and prepares each archived ref exactly once", async () => {
  const repo = await createGitRepo();
  const counts = {
    from: instrumentationCounts(),
    to: instrumentationCounts(),
  };
  try {
    const report = await diff(repo, {
      fromRef: "base",
      toRef: "HEAD",
      instrumentation: {
        from: instrumentation(counts.from),
        to: instrumentation(counts.to),
      },
    });

    assert.equal(
      report.discovery.schemaVersion,
      "renma.skill-discovery-diff.v1",
    );
    for (const refCounts of [counts.from, counts.to]) {
      assert.equal(refCounts.discovery, 1);
      assert.equal(refCounts.projections.get("catalog"), 1);
      assert.equal(refCounts.projections.get("agent-skills"), 1);
      assert.equal(refCounts.projections.get("skill-discovery"), 1);
      assert.equal(
        refCounts.parsedPaths.length,
        new Set(refCounts.parsedPaths).size,
      );
    }
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("diff rejects historical aliases in either archived endpoint", async () => {
  const repo = await createArchivedAliasConflictRepo();
  try {
    for (const [fromRef, toRef] of [
      ["valid-profile", "conflicting-profile"],
      ["conflicting-profile", "fixed-profile"],
    ] as const) {
      await assert.rejects(
        diff(repo, { fromRef, toRef }),
        (error: unknown) =>
          error instanceof ConfigError &&
          /security\.profiles\.restricted/.test(error.message) &&
          /Unsupported historical security profile keys found/.test(
            error.message,
          ) &&
          /"networkAllowed" -> use "network_allowed"/.test(error.message),
      );
    }
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("diff evaluates Skill token-budget findings with each revision's quality configuration", async () => {
  const repo = await createQualityThresholdRepo({
    warning: 4000,
    high: 7000,
  });
  try {
    const report = await diff(repo, { fromRef: "base", toRef: "HEAD" });
    const added = report.findings.added.find(
      (finding) => finding.id === "QUAL-SKILL-TOKEN-BUDGET",
    );

    assert.equal(added?.severity, "medium");
    assert.equal(added?.evidence?.path, "skills/token-budget/SKILL.md");
    assert.ok(
      !report.findings.removed.some(
        (finding) => finding.id === "QUAL-SKILL-TOKEN-BUDGET",
      ),
    );
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("diff evaluates content token-budget findings with each revision's quality configuration", async () => {
  const repo = await createContentQualityThresholdRepo({
    warning: 4000,
    high: 8000,
  });
  try {
    const report = await diff(repo, { fromRef: "base", toRef: "HEAD" });
    const added = report.findings.added.find(
      (finding) => finding.id === "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
    );

    assert.equal(added?.severity, "medium");
    assert.equal(added?.evidence?.path, "contexts/token-budget.md");
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("formatDiff tolerates legacy reports without security diff", () => {
  const report = buildDiffReport(
    "/repo",
    snapshot("base", {}),
    snapshot("head", {}),
  );
  delete (report as Partial<typeof report>).security;

  const markdown = formatDiff(report, "markdown");

  assert.match(markdown, /^## Security Changes$/m);
  assert.match(markdown, /- Added security findings: 0/);
  assert.match(markdown, /- Policy assets: \+0/);
});

test("diff resolves the git repository from an absolute target path", async () => {
  const repo = await createGitRepo();
  const outside = await mkdtemp(join(tmpdir(), "renma-diff-outside-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(outside);
    const report = await diff(repo, { fromRef: "base", toRef: "HEAD" });
    assert.equal(report.root, await realpath(repo));
    assert.equal(report.from.totalAssets, 1);
    assert.equal(report.to.totalAssets, 2);
    assert.equal(report.summary.totalAssetsDelta, 1);
  } finally {
    process.chdir(previousCwd);
    await rm(repo, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  }
});

test("diff reports invalid refs with git context", async () => {
  const repo = await createGitRepo();
  try {
    await assert.rejects(
      diff(repo, { fromRef: "missing-ref", toRef: "HEAD" }),
      /git archive .*missing-ref/i,
    );
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

test("diff does not mutate the working tree", async () => {
  const repo = await createGitRepo();
  try {
    await writeFile(
      join(repo, "skills", "demo", "SKILL.md"),
      skillMarkdown("demo", "changed"),
    );
    await writeFile(join(repo, "notes.txt"), "local note\n");
    const before = await git(repo, ["status", "--short"]);
    await diff(repo, { fromRef: "base", toRef: "HEAD" });
    const after = await git(repo, ["status", "--short"]);
    assert.equal(after, before);
  } finally {
    await rm(repo, { force: true, recursive: true });
  }
});

function snapshot(ref: string, overrides: Partial<SnapshotInput>) {
  const input = {
    score: 0,
    level: "not_ready",
    totalAssets: 0,
    ownedAssets: 0,
    scannedFileCount: 0,
    ownershipCoveragePercent: 0,
    graphResolutionPercent: 0,
    nodes: [],
    edges: [],
    checks: [],
    findings: [],
    suppressedFindings: [],
    ...overrides,
  };
  return {
    ref,
    root: `/tmp/${ref}`,
    readiness: {
      root: `/tmp/${ref}`,
      scannedFileCount: input.scannedFileCount,
      score: input.score,
      level: input.level,
      summary: {
        totalAssets: input.totalAssets,
        ownedAssets: input.ownedAssets,
        unownedAssets: input.totalAssets - input.ownedAssets,
        ownershipCoveragePercent: input.ownershipCoveragePercent,
        nodeCount: input.nodes.length,
        edgeCount: input.edges.length,
        resolvedEdges: input.edges.filter((item) => item.resolved).length,
        unresolvedEdges: input.edges.filter((item) => !item.resolved).length,
        graphResolutionPercent: input.graphResolutionPercent,
        diagnosticCounts: { error: 0, warning: 0, info: 0 },
        workflow: {
          skillEntrypoints: 0,
          checks: 0,
          pass: 0,
          warn: 0,
          fail: 0,
          readinessPercent: 0,
        },
        securityPolicyInventory: input.securityPolicyInventory,
      },
      checks: input.checks,
      findings: input.findings,
    },
    graph: {
      root: `/tmp/${ref}`,
      scannedFileCount: input.totalAssets,
      nodeCount: input.nodes.length,
      edgeCount: input.edges.length,
      nodes: input.nodes,
      edges: input.edges,
    },
    executableSurfaceInventory: input.executableSurfaceInventory,
    suppressedFindings: input.suppressedFindings,
    discovery: emptySkillDiscoveryIndex(),
  } as unknown as Parameters<typeof buildDiffReport>[1];
}

function emptySkillDiscoveryIndex(): SkillDiscoveryIndex {
  return {
    skills: [],
    routes: [],
    adoption: {
      state: "not-adopted",
      discoveryMetadataPresent: false,
      repositoryWideAdopted: false,
      publishedEntrypointCount: 0,
      reason: "no-discovery-metadata-or-repository-adoption",
    },
    coverage: {
      scope: "repository",
      mode: "not-evaluated",
      reason: "discovery-not-adopted",
      complete: null,
      sourceEntrypointIds: [],
      eligibleSkillCount: 0,
      reachableSkillCount: 0,
      notReachedSkillCount: 0,
    },
    publishedEntrypointIds: [],
    reachableDiscoveryEligibleSkillIds: [],
    notReachedDiscoveryEligibleSkillIds: [],
    structuralRootIds: [],
    standaloneSkillIds: [],
    unroutedSkillIds: [],
    summary: {
      visibleSkillCount: 0,
      routeEligibleSkillCount: 0,
      declaredRouteCount: 0,
      usableRouteCount: 0,
      unresolvedRouteCount: 0,
      ambiguousRouteCount: 0,
      unresolvedOrAmbiguousRouteCount: 0,
      invalidRouteCount: 0,
      structuralRootCount: 0,
      standaloneSkillCount: 0,
      unroutedSkillCount: 0,
      publishedEntrypointCount: 0,
      reachableSkillCount: 0,
      notReachedSkillCount: 0,
    },
    diagnostics: [],
  };
}

interface SnapshotInput {
  score: number;
  level: string;
  totalAssets: number;
  ownedAssets: number;
  scannedFileCount: number;
  ownershipCoveragePercent: number;
  graphResolutionPercent: number;
  nodes: unknown[];
  edges: Array<ReturnType<typeof edge> | ReturnType<typeof graphEdge>>;
  checks: Array<ReturnType<typeof check>>;
  findings: Array<ReturnType<typeof finding>>;
  suppressedFindings: unknown[];
  securityPolicyInventory?: SecurityPolicyInventorySummary | undefined;
  executableSurfaceInventory?: ExecutableSurfaceInventory | undefined;
}

function inventoryWithInvocation(
  resolution: "resolved" | "noncanonical",
  policyFingerprints: string[] = [],
): ExecutableSurfaceInventory {
  const inventory = zeroExecutableSurfaceInventory();
  const hasEffectivePolicyEvidence = policyFingerprints.length > 0;
  const policyEvidence = policyFingerprints.map((fingerprint, index) => ({
    relation:
      index === 0 ? ("source-artifact" as const) : ("owning-skill" as const),
    path:
      index === 0 ? "skills/demo/SKILL.md" : "skills/demo/references/owner.md",
    hasEffectivePolicy: true,
    policySources: ["local" as const],
    fingerprint,
  }));
  inventory.invocations = [
    {
      sourcePath: "skills/demo/SKILL.md",
      line: 7,
      snippet: "node skills/orphan/scripts/run.mjs",
      launcher: "node",
      rawTarget: "skills/orphan/scripts/run.mjs",
      normalizedTarget: "skills/orphan/scripts/run.mjs",
      sourceSkillDirectory: "skills/demo",
      resolution,
      targetPathState: "parsed",
      occurrenceOrdinal: 1,
      governance: {
        owningSkillResolution: hasEffectivePolicyEvidence
          ? "resolved"
          : "missing",
        policyEvidence,
        hasEffectivePolicyEvidence,
        distinctEffectivePolicyFingerprints: [...policyFingerprints].sort(),
        fingerprint: hasEffectivePolicyEvidence
          ? `sha256:${"f".repeat(64)}`
          : `sha256:${"0".repeat(64)}`,
      },
    },
  ];
  inventory.summary.totalInvocations = 1;
  inventory.summary.resolvedInvocations = resolution === "resolved" ? 1 : 0;
  inventory.summary.noncanonicalInvocations =
    resolution === "noncanonical" ? 1 : 0;
  inventory.summary.invocationsWithEffectivePolicyEvidence =
    hasEffectivePolicyEvidence ? 1 : 0;
  inventory.summary.invocationsWithoutEffectivePolicyEvidence =
    hasEffectivePolicyEvidence ? 0 : 1;
  inventory.summary.resolvedInvocationsWithEffectivePolicyEvidence =
    resolution === "resolved" && hasEffectivePolicyEvidence ? 1 : 0;
  inventory.summary.resolvedInvocationsWithoutEffectivePolicyEvidence =
    resolution === "resolved" && !hasEffectivePolicyEvidence ? 1 : 0;
  inventory.summary.invocationsWithMultipleEffectivePolicyFingerprints =
    policyFingerprints.length > 1 ? 1 : 0;
  inventory.summary.invocationPolicyEvidenceRelations = {
    sourceArtifact: policyEvidence.filter(
      (evidence) => evidence.relation === "source-artifact",
    ).length,
    owningSkill: policyEvidence.filter(
      (evidence) => evidence.relation === "owning-skill",
    ).length,
  };
  return inventory;
}

interface PolicyInventoryInput {
  totalPolicyAssets?: number | undefined;
  assetsWithLocalPolicyMetadata?: number | undefined;
  assetsWithoutEffectivePolicy?: number | undefined;
  networkAllowed?: number | undefined;
  networkDenied?: number | undefined;
  uploadAllowed?: number | undefined;
  uploadDenied?: number | undefined;
  secretsAllowed?: number | undefined;
  secretsDenied?: number | undefined;
  humanApprovalRequired?: number | undefined;
  approvedNetworkDestinationCount?: number | undefined;
  approvedUploadDestinationCount?: number | undefined;
  forbiddenInputCount?: number | undefined;
  missingSecurityProfiles?: number | undefined;
  cyclicSecurityProfiles?: number | undefined;
}

function policyInventory(
  input: PolicyInventoryInput,
): SecurityPolicyInventorySummary {
  const inventory = zeroSecurityPolicyInventorySummary();
  inventory.totalPolicyAssets = input.totalPolicyAssets ?? 0;
  inventory.assetsWithLocalPolicyMetadata =
    input.assetsWithLocalPolicyMetadata ?? 0;
  inventory.assetsWithoutEffectivePolicy =
    input.assetsWithoutEffectivePolicy ?? 0;
  inventory.networkAllowed.true = input.networkAllowed ?? 0;
  inventory.networkAllowed.false = input.networkDenied ?? 0;
  inventory.externalUploadAllowed.true = input.uploadAllowed ?? 0;
  inventory.externalUploadAllowed.false = input.uploadDenied ?? 0;
  inventory.externalUploadGovernance.denied = input.uploadDenied ?? 0;
  inventory.externalUploadGovernance.allowedNoApprovalRequired =
    input.uploadAllowed ?? 0;
  inventory.externalUploadGovernance.unspecified = Math.max(
    0,
    inventory.totalPolicyAssets -
      inventory.externalUploadGovernance.denied -
      inventory.externalUploadGovernance.allowedNoApprovalRequired,
  );
  inventory.secretsAllowed.true = input.secretsAllowed ?? 0;
  inventory.secretsAllowed.false = input.secretsDenied ?? 0;
  inventory.humanApprovalRequired.true = input.humanApprovalRequired ?? 0;
  inventory.approvedNetworkDestinationCount =
    input.approvedNetworkDestinationCount ?? 0;
  inventory.approvedUploadDestinationCount =
    input.approvedUploadDestinationCount ?? 0;
  inventory.forbiddenInputCount = input.forbiddenInputCount ?? 0;
  inventory.securityProfiles.missing = input.missingSecurityProfiles ?? 0;
  inventory.securityProfiles.cyclic = input.cyclicSecurityProfiles ?? 0;
  return inventory;
}

function node(
  id: string,
  sourcePath: string,
  kind: string,
  declaredOwner: string,
  status: string,
) {
  return {
    id,
    sourcePath,
    kind,
    ownership: {
      declaredOwner,
      effectiveOwner: declaredOwner,
      source: "declared",
    },
    status,
  };
}

function canonicalNode(
  id: string,
  sourcePath: string,
  kind: string,
  declaredOwner: string | null,
  effectiveOwner: string | null,
  status: string,
) {
  return {
    id,
    sourcePath,
    kind,
    ownership: {
      declaredOwner,
      effectiveOwner,
      source: declaredOwner === null ? "inherited" : "declared",
    },
    status,
  };
}

function edge(
  source: string,
  target: string,
  kind: string,
  resolved: boolean,
  path: string,
) {
  return {
    source,
    target,
    kind,
    resolved,
    evidence: { path, startLine: 1, endLine: 1, snippet: target },
  };
}

function graphEdge(
  from: string,
  to: string,
  kind: string,
  sourcePath: string,
  resolved: boolean,
  targetId?: string,
) {
  return {
    from,
    to,
    kind,
    sourcePath,
    resolved,
    ...(targetId ? { targetId } : {}),
  };
}

function check(id: string, status: string, severity: string, summary: string) {
  return {
    id,
    title: "Completion criteria",
    status,
    severity,
    summary,
  };
}

function finding(
  id: string,
  severity: string,
  path: string,
  line: number,
  riskClass?: string,
  details?: Record<string, unknown>,
) {
  return {
    id,
    severity,
    ...(riskClass ? { riskClass } : {}),
    ...(details ? { details } : {}),
    title: id,
    evidence: { path, startLine: line, endLine: line, snippet: id },
  };
}

async function createGitRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "renma-diff-repo-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  await writeSkill(repo, "demo", "draft");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base"]);
  await git(repo, ["tag", "base"]);
  await writeSkill(repo, "extra", "stable");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "head"]);
  return repo;
}

async function createQualityThresholdRepo(target: {
  warning: number;
  high: number;
}): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "renma-quality-diff-repo-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  const skillDirectory = join(repo, "skills", "token-budget");
  await mkdir(skillDirectory, { recursive: true });
  const skill = `---\nname: token-budget\ndescription: Review repositories. Use when token-budget governance needs review.\n---\n${Array.from({ length: 6000 }, (_, index) => `word${index}`).join(" ")}`;
  assert.equal(estimateTokens(markdownBody(skill)), 6000);
  await writeFile(join(skillDirectory, "SKILL.md"), skill);
  await writeQualityConfig(repo, 6500, 7500);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base quality policy"]);
  await git(repo, ["tag", "base"]);
  await writeQualityConfig(repo, target.warning, target.high);
  await git(repo, ["add", "renma.config.json"]);
  await git(repo, ["commit", "-m", "change quality policy"]);
  return repo;
}

async function writeQualityConfig(
  repo: string,
  warning: number,
  high: number,
): Promise<void> {
  await writeFile(
    join(repo, "renma.config.json"),
    `${JSON.stringify({
      quality: {
        skill_token_warning: warning,
        skill_token_high: high,
      },
    })}\n`,
  );
}

async function createContentQualityThresholdRepo(target: {
  warning: number;
  high: number;
}): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "renma-content-quality-diff-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  await mkdir(join(repo, "contexts"), { recursive: true });
  const context = `---
id: context.token-budget
owner: platform
status: stable
when_to_use:
  - Reviewing token budgets
when_not_to_use:
  - Runtime selection
---
${Array.from({ length: 6000 }, (_, index) => `word${index}`).join(" ")}`;
  assert.ok(estimateTokens(context) > 6000);
  assert.ok(estimateTokens(context) < 6100);
  await writeFile(join(repo, "contexts", "token-budget.md"), context);
  await writeContentQualityConfig(repo, 7000, 9000);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base content quality policy"]);
  await git(repo, ["tag", "base"]);
  await writeContentQualityConfig(repo, target.warning, target.high);
  await git(repo, ["add", "renma.config.json"]);
  await git(repo, ["commit", "-m", "change content quality policy"]);
  return repo;
}

async function writeContentQualityConfig(
  repo: string,
  warning: number,
  high: number,
): Promise<void> {
  await writeFile(
    join(repo, "renma.config.json"),
    `${JSON.stringify({
      quality: {
        context_token_warning: warning,
        context_token_high: high,
      },
    })}\n`,
  );
}

async function createArchivedAliasConflictRepo(): Promise<string> {
  const repo = await createGitRepo();
  await writeFile(
    join(repo, "renma.config.json"),
    JSON.stringify({
      security: {
        profiles: { restricted: { network_allowed: false } },
      },
    }),
  );
  await git(repo, ["add", "renma.config.json"]);
  await git(repo, ["commit", "-m", "valid security profile"]);
  await git(repo, ["tag", "valid-profile"]);

  await writeFile(
    join(repo, "renma.config.json"),
    JSON.stringify({
      security: {
        profiles: {
          restricted: {
            networkAllowed: false,
          },
        },
      },
    }),
  );
  await git(repo, ["add", "renma.config.json"]);
  await git(repo, ["commit", "-m", "ambiguous security profile"]);
  await git(repo, ["tag", "conflicting-profile"]);

  await writeFile(
    join(repo, "renma.config.json"),
    JSON.stringify({
      security: {
        profiles: { restricted: { network_allowed: false } },
      },
    }),
  );
  await git(repo, ["add", "renma.config.json"]);
  await git(repo, ["commit", "-m", "fix security profile"]);
  await git(repo, ["tag", "fixed-profile"]);
  return repo;
}

async function writeSkill(
  repo: string,
  id: string,
  status: string,
): Promise<void> {
  const directory = join(repo, "skills", id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), skillMarkdown(id, status));
}

function skillMarkdown(id: string, status: string): string {
  return `---\nid: ${id}\nowner: platform\nstatus: ${status}\ntags: []\n---\n# ${id}\n\nUse this skill when testing semantic diff.\n`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

interface InstrumentationCounts {
  discovery: number;
  parsedPaths: string[];
  projections: Map<string, number>;
}

function instrumentationCounts(): InstrumentationCounts {
  return {
    discovery: 0,
    parsedPaths: [],
    projections: new Map(),
  };
}

function instrumentation(counts: InstrumentationCounts) {
  return {
    onDiscovery() {
      counts.discovery += 1;
    },
    onDocumentParse(path: string) {
      counts.parsedPaths.push(path);
    },
    onProjection(name: string) {
      counts.projections.set(name, (counts.projections.get(name) ?? 0) + 1);
    },
  };
}
