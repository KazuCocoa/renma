import {
  DIAGNOSTIC_IDS,
  isOmittedFromCatalogFindings,
  type DiagnosticId,
} from "./diagnostic-ids.js";
import type {
  Diagnostic,
  Finding,
  RepairConstraint,
  VerificationStep,
} from "./types/diagnostics.js";

interface CatalogFindingDefinition {
  code: DiagnosticId;
  title: string;
  category: Finding["category"];
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  whyItMatters: string;
  remediation: string;
  repairConstraints: readonly RepairConstraint[];
  verificationSteps: readonly VerificationStep[];
  llmHint: string;
}

const STATUS_FINDING = {
  category: "maintenance",
  severity: "medium",
  confidence: "high",
  whyItMatters:
    "Lifecycle status is part of the repository governance contract. Invalid status values make it harder for humans and agents to understand whether a skill, context asset, or support file is experimental, stable, suspended, deprecated, or archived.",
  remediation:
    "Use one of the supported lifecycle status values: experimental, stable, suspended, deprecated, archived. Do not use migration or relationship states such as active or delegated as lifecycle status.",
  repairConstraints: [
    {
      kind: "must_not_change",
      text: "Do not introduce runtime context resolution.",
    },
    { kind: "must_not_change", text: "Do not create prompt packages." },
    {
      kind: "must_not_change",
      text: "Do not silently rewrite metadata during scan.",
    },
    {
      kind: "must_preserve",
      text: "Keep lifecycle status separate from provenance, delegation, or replacement relationships.",
    },
  ],
  verificationSteps: [
    { text: "Run renma scan.", command: "renma scan" },
    {
      text: "Run renma catalog.",
      command: "renma catalog",
      expected: "Catalog output resolves relevant assets and dependencies.",
    },
    {
      text: "Run any project-specific validation checks that apply to this repository.",
    },
  ],
  llmHint:
    "Replace invalid lifecycle status values with supported values. If a file was replaced by a shared context asset, consider a deprecated lifecycle status plus a separate supersession reference. Skills use metadata.renma.status and metadata.renma.superseded-by; non-Skills keep status and superseded_by. Pre-0.16 Skill fields are migration input only.",
} as const;

const FRESHNESS_FINDING = {
  category: "maintenance",
  severity: "medium",
  confidence: "high",
  whyItMatters:
    "Freshness metadata is a human review contract. Invalid dates or unsupported review cycles make deterministic freshness checks unreliable.",
  remediation:
    "Use ISO date values such as 2026-06-28 for last_reviewed_at and expires_at, and day-based ISO 8601 durations such as P90D for review_cycle.",
  repairConstraints: [
    {
      kind: "must_not_change",
      text: "Do not infer freshness from file modification time.",
    },
    {
      kind: "must_not_change",
      text: "Do not introduce runtime context resolution.",
    },
    { kind: "must_not_change", text: "Do not create prompt packages." },
    {
      kind: "must_not_change",
      text: "Do not silently rewrite metadata during scan.",
    },
  ],
  verificationSteps: [
    { text: "Run renma scan.", command: "renma scan" },
    {
      text: "Run renma catalog.",
      command: "renma catalog",
      expected: "Catalog output resolves relevant assets and dependencies.",
    },
    { text: "Confirm freshness metadata reflects human review." },
  ],
  llmHint:
    "Repair only the explicit freshness metadata fields. Do not add modified_at or infer review freshness from Git history.",
} as const;

const METADATA_BUDGET_FINDING = {
  category: "maintenance",
  severity: "low",
  confidence: "high",
  whyItMatters:
    "Frontmatter metadata is part of the LLM-facing catalog surface. Overgrown metadata increases token use and catalog noise, and often means detailed guidance belongs in the markdown body or a referenced context asset instead.",
  remediation:
    "Keep frontmatter as a compact deterministic index. Move long explanations, routing prose, examples, procedures, and detailed policy text into the markdown body or referenced context assets.",
  repairConstraints: [
    {
      kind: "must_not_change",
      text: "Do not add new metadata fields to hide long prose.",
    },
    {
      kind: "must_not_change",
      text: "Do not delete substantive guidance just to satisfy the check.",
    },
    {
      kind: "must_preserve",
      text: "Preserve detailed knowledge in the asset body or referenced context assets.",
    },
    {
      kind: "must_preserve",
      text: "Keep metadata useful for deterministic cataloging, graph checks, readiness checks, and security diagnostics.",
    },
  ],
  verificationSteps: [
    { text: "Run renma scan.", command: "renma scan" },
    {
      text: "Run renma catalog.",
      command: "renma catalog",
      expected: "Catalog output resolves relevant assets and dependencies.",
    },
    {
      text: "Confirm the frontmatter is shorter and detailed guidance remains preserved outside metadata.",
    },
  ],
  llmHint:
    "Shorten metadata without losing knowledge: keep concise routing/index fields in frontmatter, move long prose into body sections or referenced context assets, and preserve existing references.",
} as const;

const USAGE_BOUNDARY_FINDING = {
  category: "maintenance",
  severity: "low",
  confidence: "high",
  whyItMatters:
    "Usage boundaries are part of the deterministic catalog surface for shared context assets. Missing or placeholder boundaries force humans and agents to infer when reusable knowledge applies, which increases over-application risk.",
  remediation:
    "Add compact, reviewed when_to_use and when_not_to_use entries. Keep detailed routing explanations, examples, procedures, and rationale in the markdown body or referenced context assets.",
  repairConstraints: [
    {
      kind: "must_not_change",
      text: "Do not infer missing boundaries from broad body prose.",
    },
    {
      kind: "must_not_change",
      text: "Do not replace missing boundaries with TODO, TBD, unknown, none, or similar placeholders.",
    },
    {
      kind: "must_not_change",
      text: "Do not introduce runtime context resolution.",
    },
    { kind: "must_not_change", text: "Do not create prompt packages." },
    {
      kind: "must_preserve",
      text: "Keep metadata compact and preserve detailed guidance outside frontmatter.",
    },
  ],
  verificationSteps: [
    { text: "Run renma scan.", command: "renma scan" },
    {
      text: "Run renma catalog.",
      command: "renma catalog",
      expected: "Catalog output resolves relevant assets and dependencies.",
    },
    {
      text: "Confirm shared context assets declare compact positive and negative usage boundaries.",
    },
  ],
  llmHint:
    "Ask the asset owner for concise positive and negative usage boundaries. Do not invent domain exclusions, owners, policies, or runtime routing behavior.",
} as const;

const GENERIC_CATALOG_FINDING = {
  code: DIAGNOSTIC_IDS.META_CATALOG_DIAGNOSTIC,
  title: "Catalog metadata diagnostic",
  category: "maintenance",
  severity: "medium",
  confidence: "high",
  whyItMatters:
    "Catalog metadata is part of the repository governance contract. Missing or malformed metadata makes asset ownership, lifecycle, and relationships harder to review and validate.",
  remediation:
    "Update the asset metadata so catalog construction can identify the asset and validate declared relationships.",
  repairConstraints: [
    {
      kind: "must_not_change",
      text: "Do not introduce runtime context resolution.",
    },
    { kind: "must_not_change", text: "Do not create prompt packages." },
    {
      kind: "must_not_change",
      text: "Do not silently rewrite metadata during scan.",
    },
  ],
  verificationSteps: [
    { text: "Run renma scan.", command: "renma scan" },
    {
      text: "Run renma catalog.",
      command: "renma catalog",
      expected: "Catalog output resolves relevant assets and dependencies.",
    },
    {
      text: "Run any project-specific validation checks that apply to this repository.",
    },
  ],
  llmHint:
    "Add or correct asset governance metadata using the repository's existing frontmatter style, then rerun scan and catalog.",
} as const satisfies CatalogFindingDefinition;

const CATALOG_FINDING_DEFINITION_LIST = [
  {
    code: DIAGNOSTIC_IDS.META_INVALID_STATUS,
    title: "Asset metadata uses an invalid lifecycle status",
    ...STATUS_FINDING,
  },
  {
    code: DIAGNOSTIC_IDS.META_INVALID_LAST_REVIEWED_AT,
    title: "Freshness metadata uses an invalid last review date",
    ...FRESHNESS_FINDING,
  },
  {
    code: DIAGNOSTIC_IDS.META_INVALID_EXPIRES_AT,
    title: "Freshness metadata uses an invalid expiration date",
    ...FRESHNESS_FINDING,
  },
  {
    code: DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE,
    title: "Freshness metadata uses an unsupported review cycle",
    ...FRESHNESS_FINDING,
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_INVALID_RENMA_FRONTMATTER,
    title: "Non-Skill Renma frontmatter is invalid or ambiguous",
    severity: "high",
    whyItMatters:
      "Malformed YAML or duplicate operational keys cannot provide deterministic catalog and governance metadata.",
    remediation:
      "Repair the exact Renma frontmatter envelope and keep one valid YAML declaration per operational field.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not recover metadata values from raw lines.",
      },
      {
        kind: "must_not_change",
        text: "Do not broaden the exact non-Skill delimiter contract.",
      },
      {
        kind: "must_not_change",
        text: "Do not guess which duplicate declaration was intended.",
      },
    ],
    verificationSteps: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the frontmatter parses as one YAML mapping without duplicate operational keys.",
      },
    ],
    llmHint:
      "Repair the YAML structure or duplicate declaration only after preserving and confirming the intended metadata value.",
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_INVALID_STATUS_CHANGED_AT,
    title: "Lifecycle metadata uses an invalid status transition date",
    severity: "medium",
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_SUSPENDED_STATUS_METADATA_INCOMPLETE,
    title: "Suspended lifecycle metadata is incomplete",
    severity: "medium",
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_REQUIRED_SUSPENDED_DEPENDENCY,
    title: "Required dependency targets a suspended asset",
    severity: "medium",
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_OPTIONAL_SUSPENDED_DEPENDENCY,
    title: "Optional dependency targets a suspended asset",
    severity: "low",
  },
  {
    code: DIAGNOSTIC_IDS.META_FRONTMATTER_TOO_LARGE,
    title: "Frontmatter metadata is too large",
    ...METADATA_BUDGET_FINDING,
  },
  {
    code: DIAGNOSTIC_IDS.META_LIST_ITEM_TOO_LONG,
    title: "Metadata list item is too long",
    ...METADATA_BUDGET_FINDING,
  },
  {
    code: DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_TO_USE,
    title: "Shared context asset is missing when_to_use metadata",
    ...USAGE_BOUNDARY_FINDING,
  },
  {
    code: DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_NOT_TO_USE,
    title: "Shared context asset is missing when_not_to_use metadata",
    ...USAGE_BOUNDARY_FINDING,
  },
  {
    code: DIAGNOSTIC_IDS.META_CONTEXT_PLACEHOLDER_USAGE_BOUNDARY,
    title: "Shared context usage-boundary metadata contains placeholders",
    ...USAGE_BOUNDARY_FINDING,
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_MISSING_ID,
    title: "Asset is missing an id",
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_POLICY_REQUIRED_FIELD_MISSING,
    title: "Repository-required metadata is missing or invalid",
    severity: "high",
    whyItMatters:
      "The repository explicitly requires this declared metadata field for every applicable catalog asset. Missing, empty, invalid, ambiguous, legacy, or inherited values do not meet that governance contract.",
    remediation:
      "Add the reviewed field using the exact Skill metadata.renma.* spelling or registered top-level non-Skill spelling identified in the finding. Do not infer or fabricate a value.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not infer metadata from Git history, filesystem ownership, CODEOWNERS, nearby files, or inherited effective values.",
      },
      {
        kind: "must_not_change",
        text: "Do not rewrite or add metadata during scan.",
      },
      {
        kind: "must_preserve",
        text: "Preserve portable Agent Skills validity and use only canonical metadata.renma.* Skill declarations.",
      },
    ],
    verificationSteps: [
      { text: "Run renma scan . --format json.", command: "renma scan" },
      {
        text: "Confirm the required field is valid, non-empty, and explicitly declared on the asset.",
      },
    ],
    llmHint:
      "Use the expectedSerializedKey in finding details and obtain a human-reviewed value. Do not invent metadata or use inherited ownership as a declaration.",
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_UNKNOWN_DEPENDENCY,
    title: "Metadata dependency target is unknown",
  },
  {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_INACTIVE_DEPENDENCY,
    title: "Metadata dependency targets an inactive asset",
  },
] as const satisfies readonly CatalogFindingDefinition[];

type CatalogFindingDefinitionRegistry<
  Definitions extends readonly CatalogFindingDefinition[],
> = {
  readonly [
    Definition in Definitions[number] as Definition["code"]
  ]: Definition;
};

type CatalogFindingDefinitionCodes<
  Definitions extends readonly CatalogFindingDefinition[],
> = {
  readonly [Index in keyof Definitions]: Definitions[Index]["code"];
};

export const CATALOG_FINDING_DEFINITIONS = definitionRegistry(
  CATALOG_FINDING_DEFINITION_LIST,
);

export const CATALOG_FINDING_DIAGNOSTIC_CODES = definitionCodes(
  CATALOG_FINDING_DEFINITION_LIST,
);

const CATALOG_FINDING_DEFINITION_BY_CODE: ReadonlyMap<
  string,
  CatalogFindingDefinition
> = new Map(
  CATALOG_FINDING_DEFINITION_LIST.map((definition) => [
    definition.code,
    definition,
  ]),
);

/** Convert catalog diagnostics by stable producer identity, never by prose. */
export function catalogDiagnosticFindings(
  diagnostics: readonly Diagnostic[],
): Finding[] {
  return diagnostics
    .filter(
      (diagnostic) =>
        !isOmittedFromCatalogFindings(diagnostic) &&
        diagnostic.code !== DIAGNOSTIC_IDS.COMPOSITION_DECLARED_CONFLICT,
    )
    .map((diagnostic) => {
      const definition =
        (diagnostic.code
          ? CATALOG_FINDING_DEFINITION_BY_CODE.get(diagnostic.code)
          : undefined) ?? GENERIC_CATALOG_FINDING;
      return findingFromCatalogDiagnostic(diagnostic, definition);
    });
}

function findingFromCatalogDiagnostic(
  diagnostic: Diagnostic,
  definition: CatalogFindingDefinition,
): Finding {
  const definitionRepairConstraints = [...definition.repairConstraints];
  const definitionVerificationSteps = [...definition.verificationSteps];
  return {
    id: definition.code,
    title: definition.title,
    category: definition.category,
    severity: diagnostic.severity === "error" ? "high" : definition.severity,
    confidence: definition.confidence,
    evidence: diagnostic.evidence ?? {
      path: diagnostic.path ?? "(catalog)",
      startLine: 1,
      endLine: 1,
      snippet: diagnostic.message,
    },
    whyItMatters: definition.whyItMatters,
    remediation: definition.remediation,
    repairConstraints: diagnostic.repairConstraints
      ? [...diagnostic.repairConstraints, ...definitionRepairConstraints]
      : definitionRepairConstraints,
    verificationSteps:
      diagnostic.verificationSteps ?? definitionVerificationSteps,
    llmHint: diagnostic.llmHint ?? definition.llmHint,
    ...(diagnostic.details ? { details: diagnostic.details } : {}),
  };
}

function definitionRegistry<
  const Definitions extends readonly CatalogFindingDefinition[],
>(definitions: Definitions): CatalogFindingDefinitionRegistry<Definitions> {
  return Object.fromEntries(
    definitions.map((definition) => [definition.code, definition]),
  ) as CatalogFindingDefinitionRegistry<Definitions>;
}

function definitionCodes<
  const Definitions extends readonly CatalogFindingDefinition[],
>(definitions: Definitions): CatalogFindingDefinitionCodes<Definitions> {
  return definitions.map(
    (definition) => definition.code,
  ) as CatalogFindingDefinitionCodes<Definitions>;
}
