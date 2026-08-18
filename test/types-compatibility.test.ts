import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_CLASSIFICATION_RULES,
  ASSET_DECISION_REASON_CODES,
  SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION,
  type Artifact,
  type Diagnostic,
  type ScanConfig,
  type ScanJsonDocument,
  type ScanResult,
} from "../src/types.js";
import { ASSET_CLASSIFICATION_RULES as directClassificationRules } from "../src/types/classification.js";
import { ASSET_DECISION_REASON_CODES as directDecisionReasons } from "../src/types/decision.js";
import { SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION as directSecurityAnalysisCoverageSchemaVersion } from "../src/types/security-analysis-coverage.js";

type EstablishedTypesFacade =
  Artifact | Diagnostic | ScanConfig | ScanJsonDocument | ScanResult;
const establishedTypesFacade: EstablishedTypesFacade | undefined = undefined;
void establishedTypesFacade;

test("the established types deep import re-exports cohesive runtime registries", () => {
  assert.equal(ASSET_CLASSIFICATION_RULES, directClassificationRules);
  assert.equal(ASSET_DECISION_REASON_CODES, directDecisionReasons);
  assert.equal(
    SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION,
    directSecurityAnalysisCoverageSchemaVersion,
  );
});

function assertRemovedConfigurationSurface(config: ScanConfig): void {
  // @ts-expect-error Compatibility-only layout policy is not part of ScanConfig.
  void config.layout;
}
void assertRemovedConfigurationSurface;

// @ts-expect-error LayoutPolicyConfig was removed from the public type surface.
type RemovedLayoutPolicyConfig = import("../src/types.js").LayoutPolicyConfig;
void (undefined as unknown as RemovedLayoutPolicyConfig);
