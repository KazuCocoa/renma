import { TRUST_GRAPH_SCHEMA_VERSION } from "../src/trust-graph.js";
import { SKILL_AUTHORING_GUIDE_SCHEMA_VERSION } from "../src/guidance/skill-authoring.js";
import { SCAN_JSON_SCHEMA_VERSION } from "../src/types/scan-result.js";
import { REPOSITORY_CONTEXT_BOM_SCHEMA_VERSION } from "../src/commands/bom.js";
import { CATALOG_JSON_SCHEMA_VERSION } from "../src/commands/catalog.js";
import { CI_REPORT_JSON_SCHEMA_VERSION } from "../src/commands/ci-report.js";
import { DIFF_JSON_SCHEMA_VERSION } from "../src/commands/diff.js";
import { EXPERIMENTAL_EXECUTION_CONTRACT_SCHEMA } from "../src/commands/execution-contract.js";
import { GRAPH_JSON_SCHEMA_VERSION } from "../src/commands/graph.js";
import {
  INSPECT_OUTLINE_JSON_SCHEMA_VERSION,
  INSPECT_SLICE_JSON_SCHEMA_VERSION,
} from "../src/commands/inspect.js";
import { OWNERSHIP_JSON_SCHEMA_VERSION } from "../src/commands/ownership.js";
import { READINESS_JSON_SCHEMA_VERSION } from "../src/commands/readiness.js";
import { SCAFFOLD_JSON_SCHEMA_VERSION } from "../src/commands/scaffold.js";
import { SKILL_INDEX_SCHEMA_VERSION } from "../src/commands/skill-index.js";
import { METADATA_SUGGESTION_JSON_SCHEMA_VERSION } from "../src/commands/suggest-metadata.js";
import { SEMANTIC_SPLIT_SUGGESTION_JSON_SCHEMA_VERSION } from "../src/commands/suggest-semantic-split.js";

/** Test inventory of every public top-level JSON document contract. */
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
