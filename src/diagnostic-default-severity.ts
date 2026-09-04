import {
  CATALOG_FINDING_DIAGNOSTIC_CODES,
  catalogDiagnosticDefaultFindingSeverity,
} from "./catalog-findings.js";
import { compareUtf16CodeUnits } from "./canonical-json.js";
import { DIAGNOSTIC_IDS, type DiagnosticId } from "./diagnostic-ids.js";
import type { Severity } from "./types/diagnostics.js";

export type DiagnosticFindingDefaultSeverity = Severity | "variable";

export interface DiagnosticFindingSeverityDefinition {
  configurable: true;
  defaultSeverity: DiagnosticFindingDefaultSeverity;
}

/*
 * Finding producers without their own definition registry. This is not an
 * observational snapshot: applyDiagnosticSeverityPolicy verifies every
 * emitted Finding against these definitions before applying an override.
 * Fixed producer changes therefore cannot silently drift from policy diff.
 */
const DIRECT_FINDING_DEFAULT_SEVERITIES: Readonly<
  Partial<Record<DiagnosticId, DiagnosticFindingDefaultSeverity>>
> = {
  [DIAGNOSTIC_IDS.COMPOSITION_DECLARED_CONFLICT]: "medium",
  [DIAGNOSTIC_IDS.COMPOSITION_OPTIONAL_CONFLICT]: "low",
  [DIAGNOSTIC_IDS.COMPOSITION_OPTIONAL_CYCLE]: "low",
  [DIAGNOSTIC_IDS.COMPOSITION_REQUIRED_CYCLE]: "medium",
  [DIAGNOSTIC_IDS.DOCS_LAYOUT_INCONSISTENT]: "low",
  [DIAGNOSTIC_IDS.LAYOUT_CONTEXT_REFERENCE_NON_CANONICAL]: "low",
  [DIAGNOSTIC_IDS.LAYOUT_HELPER_NON_TOOLS]: "medium",
  [DIAGNOSTIC_IDS.MAINT_ASSET_EXPIRED]: "medium",
  [DIAGNOSTIC_IDS.MAINT_ASSET_REFERENCES_SUPERSEDED_ASSET]: "low",
  [DIAGNOSTIC_IDS.MAINT_ASSET_REVIEW_OVERDUE]: "medium",
  [DIAGNOSTIC_IDS.MAINT_CONTEXT_LENS_APPLIES_TO_INACTIVE_CONTEXT]: "low",
  [DIAGNOSTIC_IDS.MAINT_CONTEXT_PATH_NON_SEMANTIC]: "low",
  [DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_ASSET]: "low",
  [DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_LENS]: "low",
  [DIAGNOSTIC_IDS.MAINT_REFERENCE_DEPRECATED_ASSET]: "medium",
  [DIAGNOSTIC_IDS.MAINT_REPEATED_CODE_BLOCK]: "medium",
  [DIAGNOSTIC_IDS.MAINT_REPEATED_CONTEXT_PATTERN]: "medium",
  [DIAGNOSTIC_IDS.MAINT_REPEATED_HEADING]: "low",
  [DIAGNOSTIC_IDS.MAINT_REPEATED_SECTION]: "medium",
  [DIAGNOSTIC_IDS.MAINT_SKILL_CONTEXT_REFERENCE_NOT_DECLARED]: "low",
  [DIAGNOSTIC_IDS.MAINT_SKILL_REFERENCES_SUPERSEDED_ASSET]: "low",
  [DIAGNOSTIC_IDS.MAINT_SUPPORT_ASSET_SHARED_CONTEXT_CANDIDATE]: "low",
  [DIAGNOSTIC_IDS.META_DEPENDENCY_SOURCE_KIND_MISMATCH]: "medium",
  [DIAGNOSTIC_IDS.META_DEPENDENCY_TARGET_KIND_MISMATCH]: "medium",
  [DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID]: "medium",
  [DIAGNOSTIC_IDS.META_DUPLICATE_DECLARED_DEPENDENCY]: "low",
  [DIAGNOSTIC_IDS.META_UNKNOWN_REFERENCE]: "medium",
  [DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_NON_TOOLS]: "low",
  [DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED]: "medium",
  [DIAGNOSTIC_IDS.PROF_MISSING_BASE]: "medium",
  [DIAGNOSTIC_IDS.QUAL_INVALID_TOKEN_BUDGET_OVERRIDE]: "low",
  [DIAGNOSTIC_IDS.QUAL_LOW_HEADING_DENSITY]: "low",
  [DIAGNOSTIC_IDS.QUAL_MISSING_COMPLETION_CRITERIA]: "medium",
  [DIAGNOSTIC_IDS.QUAL_MISSING_DESCRIPTION]: "medium",
  [DIAGNOSTIC_IDS.QUAL_MISSING_EXAMPLES]: "low",
  [DIAGNOSTIC_IDS.QUAL_MISSING_NEGATIVE_ROUTING]: "medium",
  [DIAGNOSTIC_IDS.QUAL_MISSING_PREFLIGHT]: "medium",
  [DIAGNOSTIC_IDS.QUAL_MISSING_REQUIRED_INPUTS]: "medium",
  [DIAGNOSTIC_IDS.QUAL_MISSING_ROUTING_CLARITY]: "low",
  [DIAGNOSTIC_IDS.QUAL_MISSING_VERIFICATION]: "medium",
  [DIAGNOSTIC_IDS.QUAL_RENMA_SCAFFOLD_PLACEHOLDER]: "high",
  [DIAGNOSTIC_IDS.QUAL_SHORT_DESCRIPTION]: "low",
  [DIAGNOSTIC_IDS.QUAL_SKILL_DESCRIPTION_HIGH_RISK_LITERAL]: "medium",
  [DIAGNOSTIC_IDS.QUAL_SKILL_MIXED_RESPONSIBILITY]: "low",
  [DIAGNOSTIC_IDS.QUAL_SKILL_TOKEN_BUDGET]: "variable",
  [DIAGNOSTIC_IDS.QUAL_SUPPORT_ASSET_TOKEN_BUDGET]: "variable",
  [DIAGNOSTIC_IDS.QUAL_USER_LOCAL_PATHS]: "medium",
  [DIAGNOSTIC_IDS.SEC_BODY_POLICY_CONTRADICTION]: "high",
  [DIAGNOSTIC_IDS.SEC_BULK_DATA_SHARING_INSTRUCTION]: "medium",
  [DIAGNOSTIC_IDS.SEC_CLOUD_UPLOAD_INSTRUCTION]: "medium",
  [DIAGNOSTIC_IDS.SEC_CREDENTIAL_IN_COMMAND_ARG]: "high",
  [DIAGNOSTIC_IDS.SEC_DANGEROUS_TOOL_INSTRUCTION]: "high",
  [DIAGNOSTIC_IDS.SEC_DESTRUCTIVE_COMMAND]: "high",
  [DIAGNOSTIC_IDS.SEC_ENV_COPY]: "medium",
  [DIAGNOSTIC_IDS.SEC_EXECUTABLE_AS_POLICY_AUTHORITY]: "medium",
  [DIAGNOSTIC_IDS.SEC_EXTERNAL_UPLOAD_INSTRUCTION]: "variable",
  [DIAGNOSTIC_IDS.SEC_FORBIDDEN_INPUT_INSTRUCTION]: "high",
  [DIAGNOSTIC_IDS.SEC_HIDDEN_FRONTMATTER_INSTRUCTION]: "variable",
  [DIAGNOSTIC_IDS.SEC_HIDDEN_OPERATIONAL_INSTRUCTION]: "variable",
  [DIAGNOSTIC_IDS.SEC_INSTRUCTION_HIERARCHY_OVERRIDE]: "medium",
  [DIAGNOSTIC_IDS.SEC_INSTRUCTION_VIOLATES_POLICY]: "high",
  [DIAGNOSTIC_IDS.SEC_INVALID_CANONICAL_POLICY_METADATA]: "high",
  [DIAGNOSTIC_IDS.SEC_INVALID_RENMA_POLICY_METADATA]: "high",
  [DIAGNOSTIC_IDS.SEC_LITERAL_SECRET]: "high",
  [DIAGNOSTIC_IDS.SEC_MISSING_HUMAN_APPROVAL_GUARD]: "medium",
  [DIAGNOSTIC_IDS.SEC_MISSING_POLICY_METADATA]: "variable",
  [DIAGNOSTIC_IDS.SEC_NO_REDACTION_INSTRUCTION]: "high",
  [DIAGNOSTIC_IDS.SEC_OVERBROAD_CONTEXT_INSTRUCTION]: "medium",
  [DIAGNOSTIC_IDS.SEC_POLICY_CONTRADICTION]: "high",
  [DIAGNOSTIC_IDS.SEC_POLICY_OVERRIDE_CONTRADICTION]: "high",
  [DIAGNOSTIC_IDS.SEC_POLICY_PROFILE_CYCLE]: "high",
  [DIAGNOSTIC_IDS.SEC_POLICY_PROFILE_NOT_FOUND]: "high",
  [DIAGNOSTIC_IDS.SEC_PREDICTABLE_TEMP_PATH]: "variable",
  [DIAGNOSTIC_IDS.SEC_PRIVATE_KEY]: "critical",
  [DIAGNOSTIC_IDS.SEC_PRIVILEGED_COMMAND_WITHOUT_GUARD]: "medium",
  [DIAGNOSTIC_IDS.SEC_REMOTE_DEFAULT]: "medium",
  [DIAGNOSTIC_IDS.SEC_RISKY_OPERATION_ERROR_SUPPRESSION]: "variable",
  [DIAGNOSTIC_IDS.SEC_SAFEGUARD_BYPASS_INSTRUCTION]: "medium",
  [DIAGNOSTIC_IDS.SEC_SECRET_MATERIAL_INSTRUCTION]: "variable",
  [DIAGNOSTIC_IDS.SEC_SENSITIVE_FILE_REFERENCE]: "high",
  [DIAGNOSTIC_IDS.SEC_SUSPICIOUS_BIDI_CONTROL]: "high",
  [DIAGNOSTIC_IDS.SEC_SUSPICIOUS_INVISIBLE_CHARACTER]: "medium",
  [DIAGNOSTIC_IDS.SEC_UNBOUNDED_EXTERNAL_SOURCE_TRAVERSAL]: "variable",
  [DIAGNOSTIC_IDS.SEC_UNAPPROVED_NETWORK_DESTINATION]: "high",
  [DIAGNOSTIC_IDS.SEC_UNAPPROVED_UPLOAD_DESTINATION]: "high",
  [DIAGNOSTIC_IDS.SEC_UNPINNED_DEPENDENCY_INSTALL]: "medium",
  [DIAGNOSTIC_IDS.SEC_UNPINNED_REMOTE_SCRIPT]: "high",
  [DIAGNOSTIC_IDS.SEC_UNTRUSTED_CONTENT_AS_INSTRUCTION]: "medium",
  [DIAGNOSTIC_IDS.SUPPORT_DEEP_REFERENCE_CHAIN]: "low",
  [DIAGNOSTIC_IDS.SUPPORT_MISSING_PATH]: "high",
  [DIAGNOSTIC_IDS.SUPPORT_MISSING_REACHABILITY_GUIDANCE]: "medium",
  [DIAGNOSTIC_IDS.SUPPORT_SYMLINK_PATH]: "medium",
  [DIAGNOSTIC_IDS.SUPPORT_UNREACHABLE_ASSET]: "low",
  [DIAGNOSTIC_IDS.SUPPORT_UNREACHABLE_EXAMPLE]: "low",
  [DIAGNOSTIC_IDS.SUPPORT_UNREACHABLE_PROFILE]: "low",
  [DIAGNOSTIC_IDS.SUPPORT_UNREACHABLE_REFERENCE]: "low",
  [DIAGNOSTIC_IDS.SUPPORT_UNREACHABLE_SCRIPT]: "low",
};

const CATALOG_FINDING_IDS = [
  DIAGNOSTIC_IDS.META_CATALOG_DIAGNOSTIC,
  ...CATALOG_FINDING_DIAGNOSTIC_CODES,
] as const;

/** The complete repository-configurable scan-Finding severity surface. */
export const DIAGNOSTIC_FINDING_SEVERITY_DEFINITIONS: Readonly<
  Partial<Record<DiagnosticId, DiagnosticFindingSeverityDefinition>>
> = Object.freeze(
  Object.fromEntries([
    ...CATALOG_FINDING_IDS.map((diagnosticId) => [
      diagnosticId,
      definition(
        catalogDiagnosticDefaultFindingSeverity(diagnosticId) ?? "variable",
      ),
    ]),
    ...Object.entries(DIRECT_FINDING_DEFAULT_SEVERITIES).map(
      ([diagnosticId, defaultSeverity]) => [
        diagnosticId,
        definition(defaultSeverity),
      ],
    ),
  ]),
);

export const CONFIGURABLE_DIAGNOSTIC_FINDING_IDS = Object.freeze(
  Object.keys(DIAGNOSTIC_FINDING_SEVERITY_DEFINITIONS).sort(
    compareUtf16CodeUnits,
  ),
);

export function diagnosticFindingSeverityDefinition(
  diagnosticId: string,
): DiagnosticFindingSeverityDefinition | undefined {
  return DIAGNOSTIC_FINDING_SEVERITY_DEFINITIONS[diagnosticId as DiagnosticId];
}

export function isConfigurableDiagnosticFindingId(
  diagnosticId: string,
): boolean {
  return diagnosticFindingSeverityDefinition(diagnosticId) !== undefined;
}

/** Resolve built-in scan-Finding severity independently of scan occurrence. */
export function diagnosticDefaultSeverity(
  diagnosticId: string,
): Severity | undefined {
  const defaultSeverity =
    diagnosticFindingSeverityDefinition(diagnosticId)?.defaultSeverity;
  return defaultSeverity === "variable" ? undefined : defaultSeverity;
}

/**
 * Resolve and verify the producer's built-in severity before repository policy
 * is applied. Variable definitions intentionally retain emitted evidence.
 */
export function verifiedDiagnosticFindingSeverity(
  diagnosticId: string,
  emittedSeverity: Severity,
): Severity {
  const severityDefinition = diagnosticFindingSeverityDefinition(diagnosticId);
  if (!severityDefinition) {
    throw new Error(
      `Scan Finding ${JSON.stringify(diagnosticId)} has no configurable severity definition.`,
    );
  }
  if (
    severityDefinition.defaultSeverity !== "variable" &&
    severityDefinition.defaultSeverity !== emittedSeverity
  ) {
    throw new Error(
      `Scan Finding ${JSON.stringify(diagnosticId)} emitted ${JSON.stringify(emittedSeverity)} but its registered built-in severity is ${JSON.stringify(severityDefinition.defaultSeverity)}.`,
    );
  }
  return emittedSeverity;
}

function definition(
  defaultSeverity: DiagnosticFindingDefaultSeverity,
): DiagnosticFindingSeverityDefinition {
  return { configurable: true, defaultSeverity };
}
