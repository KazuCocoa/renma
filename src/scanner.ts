import type { ConfigOverrides } from "./config.js";
import {
  DIAGNOSTIC_IDS,
  isOmittedFromCatalogFindings,
  type DiagnosticId,
} from "./diagnostic-ids.js";
import { createDiagnosticsV2, createReviewBundles } from "./diagnostics-v2.js";
import {
  collectRepositorySnapshot,
  type RepositorySnapshot,
} from "./repository-evidence.js";
import { detectRepeatedContextPatterns } from "./repeated-context.js";
import { runRules } from "./rules.js";
import { securityDiagnosticFindings } from "./security-diagnostics.js";
import { summarizeSecurityPolicyInventory } from "./security-policy-inventory.js";
import { applySuppressions } from "./suppressions.js";
import { buildTrustGraph } from "./trust-graph.js";
import type { AssetClassificationEvidence } from "./types/classification.js";
import type { Diagnostic, Finding } from "./types/diagnostics.js";
import type { ScanResult } from "./types/scan-result.js";

interface ScanBuilderOptions {
  evaluationDate?: Date | string;
  /** Deferred projections may reuse scan evidence without adopting Discovery. */
  includeSkillDiscoveryDiagnostics?: boolean;
}

/** Run the complete deterministic scan pipeline for a target path. */
export async function scan(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<ScanResult> {
  return scanFromRepositorySnapshot(
    await collectRepositorySnapshot(targetPath, overrides),
  );
}

export function scanFromRepositorySnapshot(
  snapshot: RepositorySnapshot,
  options: ScanBuilderOptions = {},
): ScanResult {
  const securityPolicyInventory = summarizeSecurityPolicyInventory(
    snapshot.documents,
    snapshot.config.security,
  );
  const securityPolicies = snapshot.securityPolicies;
  const ruleOptions =
    options.evaluationDate === undefined
      ? {
          repositoryPaths: snapshot.repositoryPaths,
          repositoryPathStates: snapshot.repositoryPathStates,
        }
      : {
          evaluationDate: options.evaluationDate,
          repositoryPaths: snapshot.repositoryPaths,
          repositoryPathStates: snapshot.repositoryPathStates,
        };
  const classifications = snapshot.classifications;
  const rawFindings = [
    ...runRules(
      snapshot.documents,
      snapshot.config,
      snapshot.catalog,
      ruleOptions,
    ),
    ...detectRepeatedContextPatterns(snapshot.documents),
    ...catalogDiagnosticFindings(snapshot.catalogDiagnostics),
    ...securityDiagnosticFindings(snapshot.documents, snapshot.config),
  ]
    .map((finding) => attachFindingClassification(finding, classifications))
    .sort((a, b) => {
      const byPath = a.evidence.path.localeCompare(b.evidence.path);
      if (byPath !== 0) return byPath;
      return a.evidence.startLine - b.evidence.startLine;
    });
  const suppressed = applySuppressions(
    rawFindings,
    snapshot.config.suppressions,
  );
  const discoveryDiagnostics = snapshot.discoveryDiagnostics.map((diagnostic) =>
    attachDiagnosticClassification(diagnostic, classifications),
  );
  const skillDiscoveryDiagnostics =
    options.includeSkillDiscoveryDiagnostics === false
      ? []
      : snapshot.skillDiscoveryDiagnostics.map((diagnostic) =>
          attachDiagnosticClassification(diagnostic, classifications),
        );
  const remainingDiagnostics = [
    ...snapshot.contextLensDiagnostics,
    ...suppressed.diagnostics,
  ].map((diagnostic) =>
    attachDiagnosticClassification(diagnostic, classifications),
  );
  const scanDiagnostics = [
    ...discoveryDiagnostics,
    ...skillDiscoveryDiagnostics,
    ...remainingDiagnostics,
  ];
  const diagnosticsV2 = createDiagnosticsV2({
    findings: suppressed.findings,
    diagnostics: scanDiagnostics,
  });
  const trustGraph = buildTrustGraph({
    catalog: snapshot.catalog,
    findings: suppressed.findings,
    diagnostics: [...discoveryDiagnostics, ...remainingDiagnostics],
    securityPolicies,
  });

  return {
    root: snapshot.root,
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    scannedFileCount: snapshot.scannedFileCount,
    format: snapshot.config.format,
    agentSkills: snapshot.agentSkills,
    contextLens: snapshot.contextLens,
    securityPolicyInventory,
    trustGraph,
    findings: suppressed.findings,
    diagnostics: scanDiagnostics,
    diagnosticsV2,
    reviewBundles: createReviewBundles(diagnosticsV2),
    exitThreshold: snapshot.config.failOn,
  };
}

function attachFindingClassification(
  finding: Finding,
  classifications: ReadonlyMap<string, AssetClassificationEvidence>,
): Finding {
  if (!classificationRelevantFinding(finding.id)) return finding;
  const classification = classifications.get(finding.evidence.path);
  if (!classification) return finding;
  const llmHint =
    finding.id === DIAGNOSTIC_IDS.QUAL_SKILL_MIXED_RESPONSIBILITY
      ? finding.llmHint
      : classificationLlmHint(classification, finding.llmHint);
  return {
    ...finding,
    ...(llmHint ? { llmHint } : {}),
    details: { ...(finding.details ?? {}), classification },
  };
}

function classificationRelevantFinding(id: string): boolean {
  return (
    id.startsWith("META-") ||
    id.startsWith("LAYOUT-") ||
    id.startsWith("SUPPORT-") ||
    id.startsWith("SEC-") ||
    id.startsWith("PATH-") ||
    id === DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_ASSET ||
    id === DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_LENS ||
    id === DIAGNOSTIC_IDS.MAINT_SKILL_REUSABLE_CONTEXT_CANDIDATE ||
    id === DIAGNOSTIC_IDS.MAINT_SUPPORT_ASSET_SHARED_CONTEXT_CANDIDATE ||
    id === DIAGNOSTIC_IDS.QUAL_SKILL_MIXED_RESPONSIBILITY
  );
}

function attachDiagnosticClassification(
  diagnostic: Diagnostic,
  classifications: ReadonlyMap<string, AssetClassificationEvidence>,
): Diagnostic {
  const classification = diagnostic.path
    ? classifications.get(diagnostic.path)
    : undefined;
  if (!classification) return diagnostic;
  return {
    ...diagnostic,
    llmHint: classificationLlmHint(classification, diagnostic.llmHint),
    details: { ...(diagnostic.details ?? {}), classification },
  };
}

function classificationLlmHint(
  classification: AssetClassificationEvidence,
  existing: string | undefined,
): string {
  return [
    existing,
    `Observed fact: ${classification.reason}`,
    `Deterministic interpretation: matched ${classification.matchedRule} with ${classification.scope} scope.`,
    "Permitted repair: follow the diagnostic remediation while preserving declared semantics and repository boundaries.",
    "Human decision still required: confirm any owner, policy, lifecycle, or placement intent that repository evidence does not declare.",
    "Verification: rerun renma scan . --fail-on high --format json after an intended change.",
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

interface CatalogFindingDefinition {
  code: DiagnosticId;
  title: string;
  category: Finding["category"];
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  whyItMatters: string;
  remediation: string;
  constraints: readonly string[];
  verificationSteps: readonly string[];
  llmHint: string;
}

const STATUS_FINDING = {
  category: "maintenance",
  severity: "medium",
  confidence: "high",
  whyItMatters:
    "Lifecycle status is part of the repository governance contract. Invalid status values make it harder for humans and agents to understand whether a skill, context asset, or support file is experimental, stable, deprecated, or archived.",
  remediation:
    "Use one of the supported lifecycle status values: experimental, stable, deprecated, archived. Do not use migration or relationship states such as active or delegated as lifecycle status.",
  constraints: [
    "Do not introduce runtime context resolution.",
    "Do not create prompt packages.",
    "Do not silently rewrite metadata during scan.",
    "Keep lifecycle status separate from provenance, delegation, or replacement relationships.",
  ],
  verificationSteps: [
    "Run renma scan.",
    "Run renma catalog.",
    "Run any project-specific validation checks that apply to this repository.",
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
  constraints: [
    "Do not infer freshness from file modification time.",
    "Do not introduce runtime context resolution.",
    "Do not create prompt packages.",
    "Do not silently rewrite metadata during scan.",
  ],
  verificationSteps: [
    "Run renma scan.",
    "Run renma catalog.",
    "Confirm freshness metadata reflects human review.",
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
  constraints: [
    "Do not add new metadata fields to hide long prose.",
    "Do not delete substantive guidance just to satisfy the check.",
    "Preserve detailed knowledge in the asset body or referenced context assets.",
    "Keep metadata useful for deterministic cataloging, graph checks, readiness checks, and security diagnostics.",
  ],
  verificationSteps: [
    "Run renma scan.",
    "Run renma catalog.",
    "Confirm the frontmatter is shorter and detailed guidance remains preserved outside metadata.",
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
  constraints: [
    "Do not infer missing boundaries from broad body prose.",
    "Do not replace missing boundaries with TODO, TBD, unknown, none, or similar placeholders.",
    "Do not introduce runtime context resolution.",
    "Do not create prompt packages.",
    "Keep metadata compact and preserve detailed guidance outside frontmatter.",
  ],
  verificationSteps: [
    "Run renma scan.",
    "Run renma catalog.",
    "Confirm shared context assets declare compact positive and negative usage boundaries.",
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
  constraints: [
    "Do not introduce runtime context resolution.",
    "Do not create prompt packages.",
    "Do not silently rewrite metadata during scan.",
  ],
  verificationSteps: [
    "Run renma scan.",
    "Run renma catalog.",
    "Run any project-specific validation checks that apply to this repository.",
  ],
  llmHint:
    "Add or correct asset governance metadata using the repository's existing frontmatter style, then rerun scan and catalog.",
} as const satisfies CatalogFindingDefinition;

export const CATALOG_FINDING_DIAGNOSTIC_CODES = [
  DIAGNOSTIC_IDS.META_INVALID_STATUS,
  DIAGNOSTIC_IDS.META_INVALID_LAST_REVIEWED_AT,
  DIAGNOSTIC_IDS.META_INVALID_EXPIRES_AT,
  DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE,
  DIAGNOSTIC_IDS.META_FRONTMATTER_TOO_LARGE,
  DIAGNOSTIC_IDS.META_LIST_ITEM_TOO_LONG,
  DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_TO_USE,
  DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_NOT_TO_USE,
  DIAGNOSTIC_IDS.META_CONTEXT_PLACEHOLDER_USAGE_BOUNDARY,
  DIAGNOSTIC_IDS.META_MISSING_ID,
  DIAGNOSTIC_IDS.META_UNKNOWN_DEPENDENCY,
  DIAGNOSTIC_IDS.META_INACTIVE_DEPENDENCY,
] as const;

type CatalogFindingDiagnosticCode =
  (typeof CATALOG_FINDING_DIAGNOSTIC_CODES)[number];

export const CATALOG_FINDING_DEFINITIONS = {
  [DIAGNOSTIC_IDS.META_INVALID_STATUS]: {
    code: DIAGNOSTIC_IDS.META_INVALID_STATUS,
    title: "Asset metadata uses an invalid lifecycle status",
    ...STATUS_FINDING,
  },
  [DIAGNOSTIC_IDS.META_INVALID_LAST_REVIEWED_AT]: {
    code: DIAGNOSTIC_IDS.META_INVALID_LAST_REVIEWED_AT,
    title: "Freshness metadata uses an invalid last review date",
    ...FRESHNESS_FINDING,
  },
  [DIAGNOSTIC_IDS.META_INVALID_EXPIRES_AT]: {
    code: DIAGNOSTIC_IDS.META_INVALID_EXPIRES_AT,
    title: "Freshness metadata uses an invalid expiration date",
    ...FRESHNESS_FINDING,
  },
  [DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE]: {
    code: DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE,
    title: "Freshness metadata uses an unsupported review cycle",
    ...FRESHNESS_FINDING,
  },
  [DIAGNOSTIC_IDS.META_FRONTMATTER_TOO_LARGE]: {
    code: DIAGNOSTIC_IDS.META_FRONTMATTER_TOO_LARGE,
    title: "Frontmatter metadata is too large",
    ...METADATA_BUDGET_FINDING,
  },
  [DIAGNOSTIC_IDS.META_LIST_ITEM_TOO_LONG]: {
    code: DIAGNOSTIC_IDS.META_LIST_ITEM_TOO_LONG,
    title: "Metadata list item is too long",
    ...METADATA_BUDGET_FINDING,
  },
  [DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_TO_USE]: {
    code: DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_TO_USE,
    title: "Shared context asset is missing when_to_use metadata",
    ...USAGE_BOUNDARY_FINDING,
  },
  [DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_NOT_TO_USE]: {
    code: DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_NOT_TO_USE,
    title: "Shared context asset is missing when_not_to_use metadata",
    ...USAGE_BOUNDARY_FINDING,
  },
  [DIAGNOSTIC_IDS.META_CONTEXT_PLACEHOLDER_USAGE_BOUNDARY]: {
    code: DIAGNOSTIC_IDS.META_CONTEXT_PLACEHOLDER_USAGE_BOUNDARY,
    title: "Shared context usage-boundary metadata contains placeholders",
    ...USAGE_BOUNDARY_FINDING,
  },
  [DIAGNOSTIC_IDS.META_MISSING_ID]: {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_MISSING_ID,
    title: "Asset is missing an id",
  },
  [DIAGNOSTIC_IDS.META_UNKNOWN_DEPENDENCY]: {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_UNKNOWN_DEPENDENCY,
    title: "Metadata dependency target is unknown",
  },
  [DIAGNOSTIC_IDS.META_INACTIVE_DEPENDENCY]: {
    ...GENERIC_CATALOG_FINDING,
    code: DIAGNOSTIC_IDS.META_INACTIVE_DEPENDENCY,
    title: "Metadata dependency targets an inactive asset",
  },
} as const satisfies Record<
  CatalogFindingDiagnosticCode,
  CatalogFindingDefinition
>;

const CATALOG_FINDING_DEFINITION_BY_CODE: ReadonlyMap<
  string,
  CatalogFindingDefinition
> = new Map(
  Object.values(CATALOG_FINDING_DEFINITIONS).map((definition) => [
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
  return {
    id: definition.code,
    title: definition.title,
    category: definition.category,
    severity: definition.severity,
    confidence: definition.confidence,
    evidence: diagnostic.evidence ?? {
      path: diagnostic.path ?? "(catalog)",
      startLine: 1,
      endLine: 1,
      snippet: diagnostic.message,
    },
    whyItMatters: definition.whyItMatters,
    remediation: definition.remediation,
    constraints: [...definition.constraints],
    verificationSteps: [...definition.verificationSteps],
    llmHint: definition.llmHint,
    ...(diagnostic.details ? { details: diagnostic.details } : {}),
  };
}
