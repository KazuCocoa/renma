import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_CLASSIFICATION_RULES,
  SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION,
  type ArtifactKind,
  type AssetClassificationReasonCode,
  type AssetClassificationRule,
  type Diagnostic,
  type KnownAssetClassificationReasonCode,
  type KnownAssetClassificationRule,
  type ScanJsonDocument,
} from "../src/public-types.js";
import { ASSET_CLASSIFICATION_RULES as directClassificationRules } from "../src/types/classification.js";
import { SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION as directSecurityAnalysisCoverageSchemaVersion } from "../src/types/security-analysis-coverage.js";
import type { ScanResult } from "../src/types/scan-result.js";
import type * as PublicTypes from "../src/public-types.js";
import type * as PublicScanTypes from "../src/public-types/scan-result.js";

type EstablishedTypesFacade = ArtifactKind | Diagnostic | ScanJsonDocument;
const establishedTypesFacade: EstablishedTypesFacade | undefined = undefined;
void establishedTypesFacade;

const futureClassificationRule: AssetClassificationRule = "future-rule";
const futureClassificationReason: AssetClassificationReasonCode =
  "future-reason";
// @ts-expect-error Internal known-rule helpers remain closed and exhaustive.
const unknownKnownRule: KnownAssetClassificationRule = "future-rule";
// @ts-expect-error Internal known-reason helpers remain closed and exhaustive.
const unknownKnownReason: KnownAssetClassificationReasonCode = "future-reason";
void futureClassificationRule;
void futureClassificationReason;
void unknownKnownRule;
void unknownKnownReason;

test("the established types deep import re-exports cohesive runtime registries", () => {
  assert.equal(ASSET_CLASSIFICATION_RULES, directClassificationRules);
  assert.equal(
    SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION,
    directSecurityAnalysisCoverageSchemaVersion,
  );
});

function assertRemovedConfigurationSurface(
  config: import("../src/types/configuration.js").ScanConfig,
): void {
  // @ts-expect-error Compatibility-only layout policy is not part of ScanConfig.
  void config.layout;
}
void assertRemovedConfigurationSurface;

// @ts-expect-error LayoutPolicyConfig was removed from the public type surface.
type RemovedLayoutPolicyConfig = PublicTypes.LayoutPolicyConfig;
void (undefined as unknown as RemovedLayoutPolicyConfig);

// Low-level internal models have no supported public producer.
// @ts-expect-error Raw repository artifacts are not in the public facade.
type RemovedArtifact = PublicTypes.Artifact;
// @ts-expect-error Parsed documents are parser implementation details.
type RemovedParsedDocument = PublicTypes.ParsedDocument;
// @ts-expect-error Normalized runtime configuration is not authored config.
type RemovedScanConfig = PublicTypes.ScanConfig;
// @ts-expect-error Internal suggestion decisions are not a public contract.
type RemovedDecision = PublicTypes.AssetDecisionEvidence;
// @ts-expect-error Internal governance projections are not a public contract.
type RemovedGovernance = PublicTypes.AssetGovernanceEvidence;
// @ts-expect-error ScanResult has no supported public library producer.
type RemovedScanResult = PublicTypes.ScanResult;
void (undefined as unknown as RemovedArtifact);
void (undefined as unknown as RemovedParsedDocument);
void (undefined as unknown as RemovedScanConfig);
void (undefined as unknown as RemovedDecision);
void (undefined as unknown as RemovedGovernance);
void (undefined as unknown as RemovedScanResult);

// Internal orchestration continues using the core result through source imports.
type InternalCoreResult = ScanResult;
void (undefined as unknown as InternalCoreResult);

// @ts-expect-error The focused scan subpath exposes only the wire document.
type RemovedFocusedScanResult = PublicScanTypes.ScanResult;
void (undefined as unknown as RemovedFocusedScanResult);
