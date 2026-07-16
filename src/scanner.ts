import { validateAgentSkills } from "./agent-skills.js";
import type { ConfigOverrides } from "./config.js";
import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
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
import type {
  AssetClassificationEvidence,
  Diagnostic,
  Finding,
  ScanResult,
} from "./types.js";

interface ScanBuilderOptions {
  evaluationDate?: Date | string;
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
    snapshot.artifacts,
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
    ...securityDiagnosticFindings(snapshot.artifacts, snapshot.config),
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
  const scanDiagnostics = [
    ...snapshot.discoveryDiagnostics,
    ...snapshot.contextLensDiagnostics,
    ...suppressed.diagnostics,
  ].map((diagnostic) =>
    attachDiagnosticClassification(diagnostic, classifications),
  );
  const diagnosticsV2 = createDiagnosticsV2({
    findings: suppressed.findings,
    diagnostics: scanDiagnostics,
  });
  const trustGraph = buildTrustGraph({
    catalog: snapshot.catalog,
    findings: suppressed.findings,
    diagnostics: scanDiagnostics,
    securityPolicies,
  });

  return {
    root: snapshot.root,
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    scannedFileCount: snapshot.scannedFileCount,
    format: snapshot.config.format,
    agentSkills: validateAgentSkills(snapshot.documents),
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

function catalogDiagnosticFindings(diagnostics: Diagnostic[]): Finding[] {
  const findingDiagnostics = diagnostics.filter(
    (diagnostic) =>
      !/missing an owner/i.test(diagnostic.message) &&
      diagnostic.code !== DIAGNOSTIC_IDS.COMPOSITION_DECLARED_CONFLICT,
  );
  return findingDiagnostics.map((diagnostic) => {
    const path = diagnostic.path ?? "(catalog)";
    const invalidStatus = diagnostic.message.match(/Invalid status "([^"]+)"/);
    if (invalidStatus) {
      return {
        id: DIAGNOSTIC_IDS.META_INVALID_STATUS,
        title: "Asset metadata uses an invalid lifecycle status",
        category: "maintenance",
        severity: "medium",
        confidence: "high",
        evidence: diagnostic.evidence ?? {
          path,
          startLine: 1,
          endLine: 1,
          snippet: diagnostic.message,
        },
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
        ...(diagnostic.details ? { details: diagnostic.details } : {}),
      };
    }

    const invalidLastReviewedAt = /Invalid last_reviewed_at/i.test(
      diagnostic.message,
    );
    const invalidExpiresAt = /Invalid expires_at/i.test(diagnostic.message);
    const invalidReviewCycle = /Invalid review_cycle/i.test(diagnostic.message);
    if (invalidLastReviewedAt || invalidExpiresAt || invalidReviewCycle) {
      return {
        id: invalidLastReviewedAt
          ? DIAGNOSTIC_IDS.META_INVALID_LAST_REVIEWED_AT
          : invalidExpiresAt
            ? DIAGNOSTIC_IDS.META_INVALID_EXPIRES_AT
            : DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE,
        title: invalidLastReviewedAt
          ? "Freshness metadata uses an invalid last review date"
          : invalidExpiresAt
            ? "Freshness metadata uses an invalid expiration date"
            : "Freshness metadata uses an unsupported review cycle",
        category: "maintenance",
        severity: "medium",
        confidence: "high",
        evidence: diagnostic.evidence ?? {
          path,
          startLine: 1,
          endLine: 1,
          snippet: diagnostic.message,
        },
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
        ...(diagnostic.details ? { details: diagnostic.details } : {}),
      };
    }

    const frontmatterTooLarge = /Frontmatter metadata is too large/i.test(
      diagnostic.message,
    );
    const metadataListItemTooLong = /Metadata list item is too long/i.test(
      diagnostic.message,
    );
    if (frontmatterTooLarge || metadataListItemTooLong) {
      return {
        id: frontmatterTooLarge
          ? DIAGNOSTIC_IDS.META_FRONTMATTER_TOO_LARGE
          : DIAGNOSTIC_IDS.META_LIST_ITEM_TOO_LONG,
        title: frontmatterTooLarge
          ? "Frontmatter metadata is too large"
          : "Metadata list item is too long",
        category: "maintenance",
        severity: "low",
        confidence: "high",
        evidence: diagnostic.evidence ?? {
          path,
          startLine: 1,
          endLine: 1,
          snippet: diagnostic.message,
        },
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
        ...(diagnostic.details ? { details: diagnostic.details } : {}),
      };
    }

    const missingContextWhenToUse = /missing when_to_use metadata/i.test(
      diagnostic.message,
    );
    const missingContextWhenNotToUse = /missing when_not_to_use metadata/i.test(
      diagnostic.message,
    );
    const placeholderUsageBoundary =
      /usage-boundary metadata contains placeholder values/i.test(
        diagnostic.message,
      );
    if (
      missingContextWhenToUse ||
      missingContextWhenNotToUse ||
      placeholderUsageBoundary
    ) {
      return {
        id: missingContextWhenToUse
          ? DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_TO_USE
          : missingContextWhenNotToUse
            ? DIAGNOSTIC_IDS.META_CONTEXT_MISSING_WHEN_NOT_TO_USE
            : DIAGNOSTIC_IDS.META_CONTEXT_PLACEHOLDER_USAGE_BOUNDARY,
        title: missingContextWhenToUse
          ? "Shared context asset is missing when_to_use metadata"
          : missingContextWhenNotToUse
            ? "Shared context asset is missing when_not_to_use metadata"
            : "Shared context usage-boundary metadata contains placeholders",
        category: "maintenance",
        severity: "low",
        confidence: "high",
        evidence: diagnostic.evidence ?? {
          path,
          startLine: 1,
          endLine: 1,
          snippet: diagnostic.message,
        },
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
        ...(diagnostic.details ? { details: diagnostic.details } : {}),
      };
    }

    const missingId = /missing an id/i.test(diagnostic.message);
    const unknownDependency = /does not match a catalog entry/i.test(
      diagnostic.message,
    );
    const inactiveDependency = /targets a (deprecated|archived) asset/i.test(
      diagnostic.message,
    );
    return {
      id: missingId
        ? DIAGNOSTIC_IDS.META_MISSING_ID
        : unknownDependency
          ? DIAGNOSTIC_IDS.META_UNKNOWN_DEPENDENCY
          : inactiveDependency
            ? DIAGNOSTIC_IDS.META_INACTIVE_DEPENDENCY
            : DIAGNOSTIC_IDS.META_CATALOG_DIAGNOSTIC,
      title: missingId
        ? "Asset is missing an id"
        : unknownDependency
          ? "Metadata dependency target is unknown"
          : inactiveDependency
            ? "Metadata dependency targets an inactive asset"
            : "Catalog metadata diagnostic",
      category: "maintenance",
      severity: "medium",
      confidence: "high",
      evidence: diagnostic.evidence ?? {
        path,
        startLine: 1,
        endLine: 1,
        snippet: diagnostic.message,
      },
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
      ...(diagnostic.details ? { details: diagnostic.details } : {}),
    };
  });
}
