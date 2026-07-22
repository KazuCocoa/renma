import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_CLASSIFICATION_RULES,
  ASSET_DECISION_REASON_CODES,
  type Artifact,
  type Diagnostic,
  type ScanConfig,
  type ScanResult,
} from "../src/types.js";
import { ASSET_CLASSIFICATION_RULES as directClassificationRules } from "../src/types/classification.js";
import { ASSET_DECISION_REASON_CODES as directDecisionReasons } from "../src/types/decision.js";

type EstablishedTypesFacade = Artifact | Diagnostic | ScanConfig | ScanResult;
const establishedTypesFacade: EstablishedTypesFacade | undefined = undefined;
void establishedTypesFacade;

test("the established types deep import re-exports cohesive runtime registries", () => {
  assert.equal(ASSET_CLASSIFICATION_RULES, directClassificationRules);
  assert.equal(ASSET_DECISION_REASON_CODES, directDecisionReasons);
});
