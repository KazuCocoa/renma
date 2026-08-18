import { TRUST_GRAPH_SCHEMA_VERSION } from "../trust-graph.js";
import { SKILL_AUTHORING_GUIDE_SCHEMA_VERSION } from "../guidance/skill-authoring.js";
import { SCAN_JSON_SCHEMA_VERSION } from "../types/scan-result.js";
import { REPOSITORY_CONTEXT_BOM_SCHEMA_VERSION } from "./bom.js";
import { CATALOG_JSON_SCHEMA_VERSION } from "./catalog.js";
import { CI_REPORT_JSON_SCHEMA_VERSION } from "./ci-report.js";
import { DIFF_JSON_SCHEMA_VERSION } from "./diff.js";
import { EXPERIMENTAL_EXECUTION_CONTRACT_SCHEMA } from "./execution-contract.js";
import { GRAPH_JSON_SCHEMA_VERSION } from "./graph.js";
import {
  INSPECT_OUTLINE_JSON_SCHEMA_VERSION,
  INSPECT_SLICE_JSON_SCHEMA_VERSION,
} from "./inspect.js";
import { OWNERSHIP_JSON_SCHEMA_VERSION } from "./ownership.js";
import { READINESS_JSON_SCHEMA_VERSION } from "./readiness.js";
import { SCAFFOLD_JSON_SCHEMA_VERSION } from "./scaffold.js";
import { SKILL_INDEX_SCHEMA_VERSION } from "./skill-index.js";
import { METADATA_SUGGESTION_JSON_SCHEMA_VERSION } from "./suggest-metadata.js";
import { SEMANTIC_SPLIT_SUGGESTION_JSON_SCHEMA_VERSION } from "./suggest-semantic-split.js";

/** Internal inventory of every public top-level JSON document contract. */
export const PUBLIC_JSON_SCHEMA_VERSIONS = {
  stable: {
    scan: SCAN_JSON_SCHEMA_VERSION,
    catalog: CATALOG_JSON_SCHEMA_VERSION,
    graph: GRAPH_JSON_SCHEMA_VERSION,
    readiness: READINESS_JSON_SCHEMA_VERSION,
    ownership: OWNERSHIP_JSON_SCHEMA_VERSION,
    diff: DIFF_JSON_SCHEMA_VERSION,
    "ci-report": CI_REPORT_JSON_SCHEMA_VERSION,
    "inspect outline": INSPECT_OUTLINE_JSON_SCHEMA_VERSION,
    "inspect --lines": INSPECT_SLICE_JSON_SCHEMA_VERSION,
    "guide skill": SKILL_AUTHORING_GUIDE_SCHEMA_VERSION,
    scaffold: SCAFFOLD_JSON_SCHEMA_VERSION,
    "suggest-metadata": METADATA_SUGGESTION_JSON_SCHEMA_VERSION,
    "suggest-semantic-split": SEMANTIC_SPLIT_SUGGESTION_JSON_SCHEMA_VERSION,
    "skill-index": SKILL_INDEX_SCHEMA_VERSION,
    "trust-graph": TRUST_GRAPH_SCHEMA_VERSION,
    bom: REPOSITORY_CONTEXT_BOM_SCHEMA_VERSION,
  },
  experimental: {
    "execution-contract": EXPERIMENTAL_EXECUTION_CONTRACT_SCHEMA,
  },
} as const;
