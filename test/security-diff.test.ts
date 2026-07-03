import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSecurityDiffSummary,
  zeroSecurityPolicyInventoryDelta,
} from "../src/security-diff.js";
import { zeroSecurityPolicyInventorySummary } from "../src/security-policy-inventory.js";
import { zeroSecurityPostureSummary } from "../src/security-posture.js";
import type { SecurityPolicyInventorySummary } from "../src/security-policy-inventory.js";

test("empty security diff returns zero posture and policy deltas", () => {
  const summary = buildSecurityDiffSummary({
    addedFindings: [],
    removedFindings: [],
  });

  assert.deepEqual(summary.posture.added, zeroSecurityPostureSummary());
  assert.deepEqual(summary.posture.resolved, zeroSecurityPostureSummary());
  assert.deepEqual(summary.policyInventory, zeroSecurityPolicyInventoryDelta());
});

test("added and removed findings are summarized separately", () => {
  const summary = buildSecurityDiffSummary({
    addedFindings: [
      finding("SEC-LITERAL-SECRET", "high", "violation"),
      finding("CUSTOM-SUSPICIOUS", "medium", "suspicious"),
      finding("QUAL-MISSING-EXAMPLES", "high"),
    ],
    removedFindings: [
      finding("SEC-MISSING-POLICY-METADATA", "medium", "advisory"),
    ],
  });

  assert.equal(summary.posture.added.totalSecurityFindings, 2);
  assert.equal(summary.posture.added.riskClasses.violation, 1);
  assert.equal(summary.posture.added.riskClasses.suspicious, 1);
  assert.equal(summary.posture.added.highOrCritical, 1);
  assert.equal(summary.posture.resolved.totalSecurityFindings, 1);
  assert.equal(summary.posture.resolved.riskClasses.advisory, 1);
});

test("policy inventory deltas compute target minus base", () => {
  const from = inventory((summary) => {
    summary.totalPolicyAssets = 5;
    summary.assetsWithPolicyMetadata = 3;
    summary.assetsMissingPolicyMetadata = 2;
    summary.approvedNetworkDestinationCount = 4;
    summary.approvedUploadDestinationCount = 2;
    summary.forbiddenInputCount = 1;
    summary.disallowedCommandCount = 3;
  });
  const to = inventory((summary) => {
    summary.totalPolicyAssets = 7;
    summary.assetsWithPolicyMetadata = 6;
    summary.assetsMissingPolicyMetadata = 1;
    summary.approvedNetworkDestinationCount = 5;
    summary.approvedUploadDestinationCount = 1;
    summary.forbiddenInputCount = 4;
    summary.disallowedCommandCount = 5;
  });

  const summary = buildSecurityDiffSummary({
    addedFindings: [],
    removedFindings: [],
    fromPolicyInventory: from,
    toPolicyInventory: to,
  });

  assert.equal(summary.policyInventory.totalPolicyAssets, 2);
  assert.equal(summary.policyInventory.assetsWithPolicyMetadata, 3);
  assert.equal(summary.policyInventory.assetsMissingPolicyMetadata, -1);
  assert.equal(summary.policyInventory.approvedNetworkDestinationCount, 1);
  assert.equal(summary.policyInventory.approvedUploadDestinationCount, -1);
  assert.equal(summary.policyInventory.forbiddenInputCount, 3);
  assert.equal(summary.policyInventory.disallowedCommandCount, 2);
});

test("missing inventories are treated as zero", () => {
  const target = inventory((summary) => {
    summary.totalPolicyAssets = 2;
    summary.assetsWithPolicyMetadata = 1;
    summary.securityProfiles.missing = 1;
  });

  assert.deepEqual(
    buildSecurityDiffSummary({
      addedFindings: [],
      removedFindings: [],
      toPolicyInventory: target,
    }).policyInventory,
    {
      ...zeroSecurityPolicyInventoryDelta(),
      totalPolicyAssets: 2,
      assetsWithPolicyMetadata: 1,
      securityProfiles: {
        referenced: 0,
        resolved: 0,
        missing: 1,
        cyclic: 0,
        none: 0,
      },
    },
  );
  assert.equal(
    buildSecurityDiffSummary({
      addedFindings: [],
      removedFindings: [],
      fromPolicyInventory: target,
    }).policyInventory.totalPolicyAssets,
    -2,
  );
});

test("policy boolean deltas are computed per bucket", () => {
  const from = inventory((summary) => {
    summary.networkAllowed.true = 1;
    summary.networkAllowed.false = 2;
    summary.networkAllowed.unspecified = 3;
    summary.externalUploadAllowed.true = 2;
    summary.externalUploadAllowed.false = 1;
    summary.externalUploadAllowed.unspecified = 0;
  });
  const to = inventory((summary) => {
    summary.networkAllowed.true = 3;
    summary.networkAllowed.false = 1;
    summary.networkAllowed.unspecified = 1;
    summary.externalUploadAllowed.true = 1;
    summary.externalUploadAllowed.false = 4;
    summary.externalUploadAllowed.unspecified = 2;
  });

  const summary = buildSecurityDiffSummary({
    addedFindings: [],
    removedFindings: [],
    fromPolicyInventory: from,
    toPolicyInventory: to,
  });

  assert.deepEqual(summary.policyInventory.networkAllowed, {
    true: 2,
    false: -1,
    unspecified: -2,
  });
  assert.deepEqual(summary.policyInventory.externalUploadAllowed, {
    true: -1,
    false: 3,
    unspecified: 2,
  });
});

test("security profile resolution deltas are computed per bucket", () => {
  const from = inventory((summary) => {
    summary.securityProfiles.referenced = 1;
    summary.securityProfiles.resolved = 1;
    summary.securityProfiles.missing = 0;
    summary.securityProfiles.cyclic = 0;
    summary.securityProfiles.none = 4;
  });
  const to = inventory((summary) => {
    summary.securityProfiles.referenced = 3;
    summary.securityProfiles.resolved = 1;
    summary.securityProfiles.missing = 1;
    summary.securityProfiles.cyclic = 1;
    summary.securityProfiles.none = 2;
  });

  const summary = buildSecurityDiffSummary({
    addedFindings: [],
    removedFindings: [],
    fromPolicyInventory: from,
    toPolicyInventory: to,
  });

  assert.deepEqual(summary.policyInventory.securityProfiles, {
    referenced: 2,
    resolved: 0,
    missing: 1,
    cyclic: 1,
    none: -2,
  });
});

function finding(id: string, severity: string, riskClass?: string) {
  return {
    id,
    severity,
    ...(riskClass ? { riskClass } : {}),
  };
}

function inventory(
  update: (summary: SecurityPolicyInventorySummary) => void,
): SecurityPolicyInventorySummary {
  const summary = zeroSecurityPolicyInventorySummary();
  update(summary);
  return summary;
}
