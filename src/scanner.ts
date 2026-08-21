import { compareUtf16CodeUnits } from "./canonical-json.js";
import { catalogDiagnosticFindings } from "./catalog-findings.js";
import type { ConfigOverrides } from "./config.js";
import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import { createDiagnosticsV2, createReviewBundles } from "./diagnostics-v2.js";
import { copyFindingWith } from "./finding-repair-guidance.js";
import {
  collectRepositorySnapshot,
  prepareRepositorySnapshotProjections,
  type RepositorySnapshot,
} from "./repository-evidence.js";
import { detectRepeatedContextPatterns } from "./repeated-context.js";
import { buildInspectionCoverage } from "./inspection-coverage.js";
import { runRules } from "./rules.js";
import { analyzeSecurityDiagnostics } from "./security-diagnostics.js";
import {
  plainTextSupportSecurityReachability,
  staticallyExpectedSupportInspection,
} from "./static-support.js";
import { summarizeSecurityPolicyAssetEvidence } from "./security-policy-inventory.js";
import { applySuppressions } from "./suppressions.js";
import {
  canonicalScanBoundary,
  effectiveCiScanBoundary,
} from "./scan-boundary.js";
import { buildTrustGraph } from "./trust-graph.js";
import type { KnownAssetClassificationEvidence } from "./types/classification.js";
import type { Diagnostic, Finding } from "./types/diagnostics.js";
import type { SuppressionConfig } from "./types/diagnostics.js";
import type { ScanResult } from "./types/scan-result.js";

export {
  CATALOG_FINDING_DEFINITIONS,
  CATALOG_FINDING_DIAGNOSTIC_CODES,
  catalogDiagnosticFindings,
} from "./catalog-findings.js";

interface ScanBuilderOptions {
  evaluationDate?: Date | string;
  /** Optional projections may reuse scan evidence without preparing Discovery. */
  includeSkillDiscoveryDiagnostics?: boolean;
  /** CI-only trusted suppression set; repository-local suppressions remain evidence. */
  enforcementSuppressions?: SuppressionConfig[];
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
  prepareRepositorySnapshotProjections(snapshot, [
    "catalog",
    "agent-skills",
    ...(options.includeSkillDiscoveryDiagnostics === false
      ? []
      : (["skill-discovery"] as const)),
    "classifications",
    "security-policies",
    "executable-surfaces",
    "context-lens",
  ]);
  const securityPolicies = snapshot.securityPolicies;
  const securityPolicyInventory =
    summarizeSecurityPolicyAssetEvidence(securityPolicies);
  const ruleOptions =
    options.evaluationDate === undefined
      ? {
          repositoryPaths: snapshot.repositoryPaths,
          repositoryPathStates: snapshot.repositoryPathStates,
          incompleteSupportDirectories:
            snapshot.core.excludedSupportDirectoryPaths,
        }
      : {
          evaluationDate: options.evaluationDate,
          repositoryPaths: snapshot.repositoryPaths,
          repositoryPathStates: snapshot.repositoryPathStates,
          incompleteSupportDirectories:
            snapshot.core.excludedSupportDirectoryPaths,
        };
  const classifications = snapshot.classifications;
  const plainTextSupportReachability = plainTextSupportSecurityReachability(
    snapshot.documents,
    snapshot.repositoryPaths,
    snapshot.core.excludedSupportDirectoryPaths,
  );
  const expectedSupport = staticallyExpectedSupportInspection(
    snapshot.documents,
    [
      ...new Set([
        ...snapshot.repositoryPaths,
        ...snapshot.repositoryPathStates.keys(),
      ]),
    ],
    snapshot.skillParents,
    [...snapshot.core.excludedSupportDirectoryPaths],
  );
  const securityAnalysis = analyzeSecurityDiagnostics(
    snapshot.documents,
    snapshot.config,
    { plainTextSupportReachability },
  );
  const rawFindings = [
    ...runRules(
      snapshot.documents,
      snapshot.config,
      snapshot.catalog,
      ruleOptions,
    ),
    ...detectRepeatedContextPatterns(snapshot.documents),
    ...catalogDiagnosticFindings(snapshot.catalogDiagnostics),
    ...securityAnalysis.findings,
  ]
    .map((finding) => attachFindingClassification(finding, classifications))
    .sort((a, b) => {
      const byPath = compareUtf16CodeUnits(a.evidence.path, b.evidence.path);
      if (byPath !== 0) return byPath;
      return a.evidence.startLine - b.evidence.startLine;
    });
  const evaluationDate =
    options.evaluationDate === undefined
      ? new Date()
      : new Date(options.evaluationDate);
  const suppressed = applySuppressions(
    rawFindings,
    options.enforcementSuppressions ?? snapshot.config.suppressions,
    evaluationDate,
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
    scanBoundary:
      snapshot.evidenceBoundarySources.length === 1
        ? canonicalScanBoundary(
            snapshot.evidenceBoundarySources[0]!,
            evaluationDate,
          )
        : effectiveCiScanBoundary(
            snapshot.evidenceBoundarySources,
            options.enforcementSuppressions ?? [],
            snapshot.artifacts.map((artifact) => artifact.path),
            evaluationDate,
          ),
    inspectionCoverage: buildInspectionCoverage(
      snapshot.repositoryPathStates,
      snapshot.core.repositoryPathConfig,
      snapshot.core.blockedTraversalPaths,
      expectedSupport.paths,
      expectedSupport.incompleteBoundaries,
      snapshot.artifacts,
      snapshot.config,
    ),
    securityAnalysisCoverage: securityAnalysis.coverage,
    scannedFileCount: snapshot.scannedFileCount,
    format: snapshot.config.format,
    agentSkills: snapshot.agentSkills,
    contextLens: snapshot.contextLens,
    executableSurfaceInventory: snapshot.executableSurfaceInventory,
    securityPolicyInventory,
    trustGraph,
    findings: suppressed.findings,
    suppressedFindings: suppressed.suppressedFindings,
    diagnostics: scanDiagnostics,
    diagnosticsV2,
    reviewBundles: createReviewBundles(diagnosticsV2),
    exitThreshold: snapshot.config.failOn,
  };
}

function attachFindingClassification(
  finding: Finding,
  classifications: ReadonlyMap<string, KnownAssetClassificationEvidence>,
): Finding {
  if (!classificationRelevantFinding(finding.id)) return finding;
  const classification = classifications.get(finding.evidence.path);
  if (!classification) return finding;
  const llmHint =
    finding.id === DIAGNOSTIC_IDS.QUAL_SKILL_MIXED_RESPONSIBILITY
      ? finding.llmHint
      : classificationLlmHint(classification, finding.llmHint);
  return copyFindingWith(finding, {
    ...(llmHint ? { llmHint } : {}),
    details: { ...(finding.details ?? {}), classification },
  });
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
  classifications: ReadonlyMap<string, KnownAssetClassificationEvidence>,
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
  classification: KnownAssetClassificationEvidence,
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
