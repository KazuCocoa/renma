import type { AssetMetadata, AssetStatus } from "./model.js";
import { inspectAgentSkill } from "./agent-skills.js";
import {
  DIAGNOSTIC_IDS,
  withDiagnosticId,
  type DiagnosticId,
} from "./diagnostic-ids.js";
import type { Diagnostic, Evidence } from "./types/diagnostics.js";
import type {
  MetadataFieldEvidence,
  MetadataValue,
  ParsedDocument,
} from "./types/metadata.js";
import { isIsoDate, parseDayDuration } from "./freshness.js";
import {
  DEFAULT_QUALITY_PROFILE,
  TOKEN_BUDGET_OVERRIDE_VALIDATION_BASELINE,
} from "./quality-profile.js";
import { estimateTokens } from "./token-estimator.js";
import {
  AGENT_SKILL_TOP_LEVEL_KEYS,
  CANONICAL_SKILL_METADATA_KEYS,
  CANONICAL_SKILL_PUBLICATION_METADATA_KEY,
  NON_SKILL_AUXILIARY_METADATA_KEYS,
  NON_SKILL_CATALOG_METADATA_KEYS,
  SUPPORT_ASSET_TOKEN_BUDGET_KINDS,
  SUPPORT_ASSET_TOKEN_BUDGET_METADATA_KEYS,
} from "./metadata-definitions.js";
import {
  ensureYamlFrontmatterForDocument,
  recognizedMalformedTopLevelKeys,
  type ParsedYamlFrontmatter,
  type YamlFrontmatterField,
} from "./yaml-frontmatter.js";

const STATUSES: AssetStatus[] = [
  "experimental",
  "stable",
  "suspended",
  "deprecated",
  "archived",
];

type CanonicalSkillOperationalKey = keyof typeof CANONICAL_SKILL_METADATA_KEYS;

const CANONICAL_SKILL_KEY_TO_OPERATIONAL = new Map<string, string>(
  Object.entries(CANONICAL_SKILL_METADATA_KEYS).map(
    ([operationalKey, canonicalKey]) => [canonicalKey, operationalKey],
  ),
);

const CANONICAL_LIST_KEYS = new Set<CanonicalSkillOperationalKey>([
  "tags",
  "requires_context",
  "optional_context",
  "requires_lens",
  "optional_lens",
  "conflicts",
  "superseded_by",
]);

export type CanonicalSkillContinuationFieldState =
  "unsupported" | "absent" | "ambiguous" | "invalid" | "valid";

export interface CanonicalSkillContinuationItem {
  declarationIndex: number;
  rawTarget: string;
  target: string;
  evidence: MetadataFieldEvidence;
}

/** Canonical continuation field evidence retained independently from route usability. */
export interface CanonicalSkillContinuationField {
  state: CanonicalSkillContinuationFieldState;
  canonicalKey: typeof CANONICAL_SKILL_METADATA_KEYS.continues_with;
  agentSkillValid: boolean;
  items: CanonicalSkillContinuationItem[];
  fieldEvidence?: MetadataFieldEvidence;
  reason?: string;
}

export type CanonicalSkillPublicationFieldState =
  "unsupported" | "absent" | "ambiguous" | "invalid" | "valid";

/** Canonical publication marker evidence retained independently from eligibility. */
export interface CanonicalSkillPublicationField {
  state: CanonicalSkillPublicationFieldState;
  canonicalKey: typeof CANONICAL_SKILL_PUBLICATION_METADATA_KEY;
  agentSkillValid: boolean;
  rawValue?: unknown;
  fieldEvidence?: MetadataFieldEvidence;
  reason?: string;
}

interface OperationalMetadataSource {
  values: Record<string, unknown>;
  fields: Record<string, MetadataFieldEvidence>;
  listItems: Record<string, MetadataFieldEvidence[]>;
  canonicalSkill: boolean;
}

export interface SupportAssetTokenBudgetDecision {
  status: "absent" | "invalid" | "active";
  estimatedTokens?: number;
  defaultLimit?: number;
  overrideValidationBaseline?: number;
  overrideLimit?: number;
  declaredOverrideLimit?: number;
  overrideAffectsDefaultWarning?: boolean;
  effectiveLimit?: number;
  tokenBudgetRationale?: string;
  tokenBudgetReviewedAt?: string;
  invalidReasons: string[];
  evidence?: Evidence;
}

type TokenBudgetKey = (typeof SUPPORT_ASSET_TOKEN_BUDGET_METADATA_KEYS)[number];

const NON_SKILL_CATALOG_KEY_SET = new Set<string>(
  Object.values(NON_SKILL_CATALOG_METADATA_KEYS),
);
const NON_SKILL_OPERATIONAL_METADATA_KEY_SET = new Set<string>([
  ...NON_SKILL_CATALOG_KEY_SET,
  ...Object.values(NON_SKILL_AUXILIARY_METADATA_KEYS),
]);

const SUPPORT_ASSET_TOKEN_BUDGET_KIND_SET = new Set<string>(
  SUPPORT_ASSET_TOKEN_BUDGET_KINDS,
);
const SUPPORT_ASSET_TOKEN_BUDGET_METADATA_KEY_SET = new Set<string>(
  SUPPORT_ASSET_TOKEN_BUDGET_METADATA_KEYS,
);

type SupportAssetTokenBudgetKind =
  (typeof SUPPORT_ASSET_TOKEN_BUDGET_KINDS)[number];

interface TokenBudgetDecisionIssue {
  reason: string;
  evidence: Evidence;
}

/** Validate one declared support-asset token-budget decision without selecting ambiguous values. */
export function parseSupportAssetTokenBudgetDecision(
  document: ParsedDocument,
): SupportAssetTokenBudgetDecision {
  if (
    document.artifact.markdownParserEligible !== true ||
    !isSupportAssetTokenBudgetKind(document.artifact.kind)
  ) {
    return { status: "absent", invalidReasons: [] };
  }

  const defaultLimit =
    DEFAULT_QUALITY_PROFILE.contentTokenWarning[document.artifact.kind];
  const overrideValidationBaseline =
    TOKEN_BUDGET_OVERRIDE_VALIDATION_BASELINE[document.artifact.kind];
  const estimatedTokens = estimateTokens(document.artifact.content);
  const frontmatter = ensureYamlFrontmatterForDocument(document);
  const parsedFields = frontmatter.fields.filter(isTokenBudgetField);
  const rawFields = rawTokenBudgetFields(document, frontmatter);
  if (parsedFields.length === 0 && rawFields.length === 0) {
    return {
      status: "absent",
      estimatedTokens,
      defaultLimit,
      overrideValidationBaseline,
      effectiveLimit: defaultLimit,
      invalidReasons: [],
    };
  }

  const issues: TokenBudgetDecisionIssue[] = [];
  const firstDecisionEvidence =
    (parsedFields[0] ? fieldEvidence(document, parsedFields[0]) : undefined) ??
    rawFields[0]?.evidence ??
    documentLineEvidence(document, 1);

  if (!frontmatter.closed) {
    issues.push({
      reason: "token-budget decision frontmatter must be closed",
      evidence: firstDecisionEvidence,
    });
  } else if (!frontmatter.mapping) {
    issues.push({
      reason: "token-budget decision frontmatter must be a YAML mapping",
      evidence: firstDecisionEvidence,
    });
  }
  for (const error of frontmatter.errors) {
    issues.push({
      reason: `token-budget decision metadata has invalid YAML (${error.code})`,
      evidence: documentLineEvidence(document, error.line),
    });
  }
  for (const duplicate of frontmatter.duplicateFields.filter(
    isTokenBudgetField,
  )) {
    issues.push({
      reason: `${duplicate.key} is declared more than once`,
      evidence: fieldEvidence(document, duplicate),
    });
  }

  const fieldsByKey = new Map<TokenBudgetKey, YamlFrontmatterField[]>();
  for (const key of SUPPORT_ASSET_TOKEN_BUDGET_METADATA_KEYS) {
    fieldsByKey.set(
      key,
      parsedFields.filter((field) => field.key === key),
    );
  }
  const uniqueField = (key: TokenBudgetKey) => {
    const fields = fieldsByKey.get(key) ?? [];
    return fields.length === 1 ? fields[0] : undefined;
  };
  const overrideField = uniqueField("token_budget_override");
  const rationaleField = uniqueField("token_budget_rationale");
  const reviewedAtField = uniqueField("token_budget_reviewed_at");
  let overrideLimit: number | undefined;
  let rationale: string | undefined;
  let reviewedAt: string | undefined;

  if (!overrideField) {
    if (rationaleField) {
      issues.push({
        reason: "token_budget_rationale requires token_budget_override",
        evidence: fieldEvidence(document, rationaleField),
      });
    }
    if (reviewedAtField) {
      issues.push({
        reason: "token_budget_reviewed_at requires token_budget_override",
        evidence: fieldEvidence(document, reviewedAtField),
      });
    }
  } else {
    if (
      typeof overrideField.value !== "number" ||
      !Number.isInteger(overrideField.value)
    ) {
      issues.push({
        reason: "token_budget_override must be an integer",
        evidence: fieldEvidence(document, overrideField),
      });
    } else if (!Number.isSafeInteger(overrideField.value)) {
      issues.push({
        reason: "token_budget_override must be a safe integer",
        evidence: fieldEvidence(document, overrideField),
      });
    } else {
      overrideLimit = overrideField.value;
      if (overrideLimit <= 0) {
        issues.push({
          reason: "token_budget_override must be positive",
          evidence: fieldEvidence(document, overrideField),
        });
      } else if (overrideLimit <= overrideValidationBaseline) {
        issues.push({
          reason: `token_budget_override must be greater than the compatibility validation baseline of ${overrideValidationBaseline}`,
          evidence: fieldEvidence(document, overrideField),
        });
      }
    }

    if (!rationaleField) {
      issues.push({
        reason:
          "token_budget_rationale must be a non-empty string when an override is present",
        evidence: fieldEvidence(document, overrideField),
      });
    } else if (
      typeof rationaleField.value !== "string" ||
      rationaleField.value.trim().length === 0
    ) {
      issues.push({
        reason: "token_budget_rationale must be a non-empty string",
        evidence: fieldEvidence(document, rationaleField),
      });
    } else {
      rationale = rationaleField.value.trim();
    }

    if (reviewedAtField) {
      if (
        typeof reviewedAtField.value !== "string" ||
        !isIsoDate(reviewedAtField.value)
      ) {
        issues.push({
          reason: "token_budget_reviewed_at must be a valid YYYY-MM-DD date",
          evidence: fieldEvidence(document, reviewedAtField),
        });
      } else {
        reviewedAt = reviewedAtField.value;
      }
    }
  }

  if (
    issues.length === 0 &&
    overrideField &&
    estimatedTokens <= overrideValidationBaseline
  ) {
    issues.push({
      reason: `token_budget_override is unnecessary because the asset is within the compatibility validation baseline of ${overrideValidationBaseline}`,
      evidence: fieldEvidence(document, overrideField),
    });
  }

  if (issues.length > 0) {
    return {
      status: "invalid",
      estimatedTokens,
      defaultLimit,
      overrideValidationBaseline,
      ...(overrideLimit !== undefined ? { overrideLimit } : {}),
      ...(overrideLimit !== undefined
        ? { declaredOverrideLimit: overrideLimit }
        : {}),
      effectiveLimit: defaultLimit,
      ...(rationale ? { tokenBudgetRationale: rationale } : {}),
      ...(reviewedAt ? { tokenBudgetReviewedAt: reviewedAt } : {}),
      invalidReasons: issues.map((issue) => issue.reason),
      evidence: issues[0]?.evidence ?? firstDecisionEvidence,
    };
  }

  if (overrideLimit === undefined || rationale === undefined) {
    return {
      status: "invalid",
      estimatedTokens,
      defaultLimit,
      overrideValidationBaseline,
      effectiveLimit: defaultLimit,
      invalidReasons: ["token-budget decision metadata is incomplete"],
      evidence: firstDecisionEvidence,
    };
  }

  return {
    status: "active",
    estimatedTokens,
    defaultLimit,
    overrideValidationBaseline,
    overrideLimit,
    declaredOverrideLimit: overrideLimit,
    overrideAffectsDefaultWarning: overrideLimit > defaultLimit,
    effectiveLimit: Math.max(defaultLimit, overrideLimit),
    tokenBudgetRationale: rationale,
    ...(reviewedAt ? { tokenBudgetReviewedAt: reviewedAt } : {}),
    invalidReasons: [],
    evidence: fieldEvidence(document, overrideField),
  };
}

function isSupportAssetTokenBudgetKind(
  kind: string,
): kind is SupportAssetTokenBudgetKind {
  return SUPPORT_ASSET_TOKEN_BUDGET_KIND_SET.has(kind);
}

function isTokenBudgetField(
  field: YamlFrontmatterField,
): field is YamlFrontmatterField & { key: TokenBudgetKey } {
  return SUPPORT_ASSET_TOKEN_BUDGET_METADATA_KEYS.includes(
    field.key as TokenBudgetKey,
  );
}

function rawTokenBudgetFields(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
): Array<{
  key: TokenBudgetKey;
  evidence: Evidence;
}> {
  return recognizedMalformedTopLevelKeys(
    document.artifact.content,
    frontmatter,
    SUPPORT_ASSET_TOKEN_BUDGET_METADATA_KEY_SET,
  ).map((field) => ({
    key: field.key as TokenBudgetKey,
    evidence: documentLineEvidence(document, field.startLine),
  }));
}

function fieldEvidence(
  document: ParsedDocument,
  field: YamlFrontmatterField | undefined,
): Evidence {
  if (!field) return documentLineEvidence(document, 1);
  return {
    path: document.artifact.path,
    startLine: field.startLine,
    endLine: field.endLine,
    snippet: document.lines
      .slice(field.startLine - 1, field.endLine)
      .join("\n"),
  };
}

function documentLineEvidence(
  document: ParsedDocument,
  requestedLine: number,
): Evidence {
  const line = Math.min(Math.max(requestedLine, 1), document.lines.length || 1);
  return {
    path: document.artifact.path,
    startLine: line,
    endLine: line,
    snippet: document.lines[line - 1] ?? "",
  };
}

/** Normalize parsed frontmatter into asset metadata plus validation diagnostics. */
export function parseAssetMetadata(document: ParsedDocument): {
  metadata: AssetMetadata;
  tokenBudgetDecision: SupportAssetTokenBudgetDecision;
  metadataFields: Record<string, MetadataFieldEvidence>;
  metadataListItems: Record<string, MetadataFieldEvidence[]>;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...unsupportedCompatibilityMetadataDiagnostics(document));
  const source = operationalMetadataSource(document, diagnostics);
  const rawStatusText = metadataText(source.values.status);
  const rawStatus = source.canonicalSkill
    ? rawStatusText?.trim()
    : rawStatusText;
  const status = parseStatus(rawStatus);
  const statusReason = optionalText(metadataText(source.values.status_reason));
  const statusChangedAt = optionalText(
    metadataText(source.values.status_changed_at),
  );
  const lastReviewedAt = optionalText(
    metadataText(source.values.last_reviewed_at),
  );
  const reviewCycle = optionalText(metadataText(source.values.review_cycle));
  const expiresAt = optionalText(metadataText(source.values.expires_at));
  const tokenBudget = parseSupportAssetTokenBudgetDecision(document);
  const metadata: AssetMetadata = {
    tags: operationalListValue(document, source, "tags", diagnostics),
    whenToUse: operationalListValue(
      document,
      source,
      "when_to_use",
      diagnostics,
    ),
    whenNotToUse: operationalListValue(
      document,
      source,
      "when_not_to_use",
      diagnostics,
    ),
    requiresContext: operationalListValue(
      document,
      source,
      "requires_context",
      diagnostics,
    ),
    optionalContext: operationalListValue(
      document,
      source,
      "optional_context",
      diagnostics,
    ),
    conflicts: operationalListValue(document, source, "conflicts", diagnostics),
    supersededBy: operationalListValue(
      document,
      source,
      "superseded_by",
      diagnostics,
    ),
  };

  if (rawStatus !== undefined && status === undefined) {
    const evidence = metadataFieldEvidence(source, "status");
    diagnostics.push(
      withDiagnosticId(DIAGNOSTIC_IDS.META_INVALID_STATUS, {
        severity: "warning",
        path: document.artifact.path,
        message: `Invalid status "${rawStatus}". Expected one of: ${STATUSES.join(", ")}.`,
        ...(evidence ? { evidence } : {}),
      }),
    );
  }

  assignOptional(metadata, "id", optionalText(metadataText(source.values.id)));
  if (document.artifact.kind === "skill") {
    assignOptional(
      metadata,
      "title",
      optionalText(metadataText(source.values.title)),
    );
  }
  assignOptional(
    metadata,
    "type",
    optionalText(metadataText(source.values.type)),
  );
  assignOptional(
    metadata,
    "version",
    optionalText(metadataText(source.values.version)),
  );
  assignOptional(
    metadata,
    "owner",
    optionalText(metadataText(source.values.owner)),
  );
  assignOptional(metadata, "status", status);
  assignOptional(metadata, "statusReason", statusReason);
  assignOptional(metadata, "statusChangedAt", statusChangedAt);
  assignOptional(
    metadata,
    "purpose",
    optionalText(metadataText(source.values.purpose)),
  );
  assignOptional(metadata, "lastReviewedAt", lastReviewedAt);
  assignOptional(metadata, "reviewCycle", reviewCycle);
  assignOptional(metadata, "expiresAt", expiresAt);
  if (tokenBudget.status === "active") {
    assignOptional(metadata, "tokenBudgetOverride", tokenBudget.overrideLimit);
    assignOptional(
      metadata,
      "tokenBudgetRationale",
      tokenBudget.tokenBudgetRationale,
    );
    assignOptional(
      metadata,
      "tokenBudgetReviewedAt",
      tokenBudget.tokenBudgetReviewedAt,
    );
  }
  assignOptionalList(
    metadata,
    "appliesTo",
    operationalListValue(document, source, "applies_to", diagnostics),
  );
  assignOptionalList(
    metadata,
    "focus",
    operationalListValue(document, source, "focus", diagnostics),
  );
  assignOptionalList(
    metadata,
    "expectedOutputs",
    operationalListValue(document, source, "expected_outputs", diagnostics),
  );
  assignOptionalList(
    metadata,
    "requiresLens",
    operationalListValue(document, source, "requires_lens", diagnostics),
  );
  assignOptionalList(
    metadata,
    "optionalLens",
    operationalListValue(document, source, "optional_lens", diagnostics),
  );

  if (source.canonicalSkill) {
    const continuesWith = parseContinuationValue(source.values.continues_with);
    if (continuesWith.valid) {
      metadata.continuesWith = continuesWith.items.map((item) => item.trim());
    }
  }

  if (lastReviewedAt !== undefined && !isIsoDate(lastReviewedAt)) {
    diagnostics.push(
      invalidMetadataDiagnostic(
        document,
        source,
        "last_reviewed_at",
        `Invalid last_reviewed_at "${lastReviewedAt}". Expected ISO date YYYY-MM-DD.`,
        DIAGNOSTIC_IDS.META_INVALID_LAST_REVIEWED_AT,
      ),
    );
  }

  if (expiresAt !== undefined && !isIsoDate(expiresAt)) {
    diagnostics.push(
      invalidMetadataDiagnostic(
        document,
        source,
        "expires_at",
        `Invalid expires_at "${expiresAt}". Expected ISO date YYYY-MM-DD.`,
        DIAGNOSTIC_IDS.META_INVALID_EXPIRES_AT,
      ),
    );
  }

  const statusChangedAtValid =
    statusChangedAt === undefined || isIsoDate(statusChangedAt);
  if (!statusChangedAtValid) {
    diagnostics.push(
      statusChangedAtDiagnostic(document, source, status, statusChangedAt!),
    );
  }

  if (status === "suspended") {
    const missingFields = [
      ...(statusReason === undefined ? ["status_reason"] : []),
      ...(statusChangedAt === undefined ? ["status_changed_at"] : []),
    ];
    if (missingFields.length > 0) {
      diagnostics.push(
        suspendedMetadataIncompleteDiagnostic(
          document,
          source,
          statusReason,
          statusChangedAt,
          missingFields,
        ),
      );
    }
  }

  if (
    reviewCycle !== undefined &&
    parseDayDuration(reviewCycle) === undefined
  ) {
    diagnostics.push(
      invalidMetadataDiagnostic(
        document,
        source,
        "review_cycle",
        `Invalid review_cycle "${reviewCycle}". Expected supported ISO 8601 day duration such as P90D.`,
        DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE,
      ),
    );
  }

  return {
    metadata,
    tokenBudgetDecision: tokenBudget,
    metadataFields: source.fields,
    metadataListItems: source.listItems,
    diagnostics,
  };
}

function unsupportedCompatibilityMetadataDiagnostics(
  document: ParsedDocument,
): Diagnostic[] {
  if (document.artifact.kind === "skill") return [];
  const frontmatter = ensureYamlFrontmatterForDocument(document);
  const field = frontmatter.fields.find(
    (candidate) => candidate.key === "canonical_context",
  );
  if (!field) return [];
  return [
    withDiagnosticId(DIAGNOSTIC_IDS.META_UNSUPPORTED_CANONICAL_CONTEXT, {
      severity: "warning",
      path: document.artifact.path,
      message:
        'Metadata field "canonical_context" is not supported in Renma v1 and is not interpreted. Use the existing superseded_by relationship when this asset has a reviewed canonical replacement, then update Skill Context relationships or placement as appropriate.',
      evidence: fieldEvidence(document, field),
    }),
  ];
}

/** Parse the explicit canonical Skill continuation field without selecting legacy fallbacks. */
export function parseCanonicalSkillContinuationField(
  document: ParsedDocument,
): CanonicalSkillContinuationField {
  const canonicalKey = CANONICAL_SKILL_METADATA_KEYS.continues_with;
  if (
    document.artifact.kind !== "skill" ||
    document.artifact.path.replaceAll("\\", "/").split("/").at(-1) !==
      "SKILL.md"
  ) {
    return {
      state: "unsupported",
      canonicalKey,
      agentSkillValid: false,
      items: [],
    };
  }

  const inspection = inspectAgentSkill(document);
  const fields = inspection.frontmatter.metadataFields.filter(
    (field) => field.key === canonicalKey,
  );
  if (fields.length === 0) {
    return {
      state: "absent",
      canonicalKey,
      agentSkillValid: inspection.validation.valid,
      items: [],
    };
  }

  const first = fields[0]!;
  const fieldEvidence = metadataEvidenceFromYamlField(document, first);
  const duplicateMetadataMapping = inspection.frontmatter.duplicateFields.some(
    (field) => field.key === AGENT_SKILL_TOP_LEVEL_KEYS.metadata,
  );
  if (duplicateMetadataMapping || fields.length !== 1) {
    return {
      state: "ambiguous",
      canonicalKey,
      agentSkillValid: inspection.validation.valid,
      items: [],
      fieldEvidence,
      reason: duplicateMetadataMapping
        ? "the top-level metadata mapping is declared more than once"
        : `metadata.${canonicalKey} is declared more than once`,
    };
  }

  const parsed = parseContinuationValue(first.value);
  if (!parsed.valid) {
    return {
      state: "invalid",
      canonicalKey,
      agentSkillValid: inspection.validation.valid,
      items: [],
      fieldEvidence,
      reason: parsed.reason,
    };
  }

  return {
    state: "valid",
    canonicalKey,
    agentSkillValid: inspection.validation.valid,
    fieldEvidence,
    items: parsed.items.map((rawTarget, declarationIndex) => ({
      declarationIndex,
      rawTarget,
      target: rawTarget.trim(),
      evidence: { ...fieldEvidence },
    })),
  };
}

/** Parse the one-state canonical Skill publication marker without aliases or legacy fallback. */
export function parseCanonicalSkillPublicationField(
  document: ParsedDocument,
): CanonicalSkillPublicationField {
  const canonicalKey = CANONICAL_SKILL_PUBLICATION_METADATA_KEY;
  if (
    document.artifact.kind !== "skill" ||
    document.artifact.path.replaceAll("\\", "/").split("/").at(-1) !==
      "SKILL.md"
  ) {
    return {
      state: "unsupported",
      canonicalKey,
      agentSkillValid: false,
    };
  }

  const inspection = inspectAgentSkill(document);
  const fields = inspection.frontmatter.metadataFields.filter(
    (field) => field.key === canonicalKey,
  );
  if (fields.length === 0) {
    return {
      state: "absent",
      canonicalKey,
      agentSkillValid: inspection.validation.valid,
    };
  }

  const first = fields[0]!;
  const fieldEvidence = metadataEvidenceFromYamlField(document, first);
  const duplicateMetadataMapping = inspection.frontmatter.duplicateFields.some(
    (field) => field.key === AGENT_SKILL_TOP_LEVEL_KEYS.metadata,
  );
  if (duplicateMetadataMapping || fields.length !== 1) {
    return {
      state: "ambiguous",
      canonicalKey,
      agentSkillValid: inspection.validation.valid,
      rawValue: first.value,
      fieldEvidence,
      reason: duplicateMetadataMapping
        ? "the top-level metadata mapping is declared more than once"
        : `metadata.${canonicalKey} is declared more than once`,
    };
  }

  if (first.value !== "true") {
    return {
      state: "invalid",
      canonicalKey,
      agentSkillValid: inspection.validation.valid,
      rawValue: first.value,
      fieldEvidence,
      reason: 'must be the exact YAML string "true"',
    };
  }

  return {
    state: "valid",
    canonicalKey,
    agentSkillValid: inspection.validation.valid,
    rawValue: first.value,
    fieldEvidence,
  };
}

type ContinuationValueParseResult =
  { valid: true; items: string[] } | { valid: false; reason: string };

function parseContinuationValue(value: unknown): ContinuationValueParseResult {
  if (typeof value !== "string") {
    return {
      valid: false,
      reason: "must be a string containing a JSON array of non-empty strings",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      valid: false,
      reason:
        "must be a string containing valid JSON for an array of non-empty strings",
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      valid: false,
      reason: "must contain a JSON array",
    };
  }
  const nonStringIndex = parsed.findIndex((item) => typeof item !== "string");
  if (nonStringIndex >= 0) {
    return {
      valid: false,
      reason: `array member ${nonStringIndex} must be a string`,
    };
  }
  const items = parsed as string[];
  const emptyIndex = items.findIndex((item) => item.trim().length === 0);
  if (emptyIndex >= 0) {
    return {
      valid: false,
      reason: `array member ${emptyIndex} must be non-empty after trimming`,
    };
  }
  return { valid: true, items };
}

function metadataEvidenceFromYamlField(
  document: ParsedDocument,
  field: YamlFrontmatterField,
): MetadataFieldEvidence {
  return {
    path: document.artifact.path,
    key: field.key,
    startLine: field.startLine,
    endLine: field.endLine,
    raw: document.lines.slice(field.startLine - 1, field.endLine).join("\n"),
  };
}

function invalidMetadataDiagnostic(
  document: ParsedDocument,
  source: OperationalMetadataSource,
  field: string,
  message: string,
  code?: DiagnosticId,
): Diagnostic {
  const evidence = metadataFieldEvidence(source, field);
  const diagnostic: Diagnostic = {
    severity: "warning",
    path: document.artifact.path,
    message,
    ...(evidence ? { evidence } : {}),
  };
  return code ? withDiagnosticId(code, diagnostic) : diagnostic;
}

function statusChangedAtDiagnostic(
  document: ParsedDocument,
  source: OperationalMetadataSource,
  status: AssetStatus | undefined,
  statusChangedAt: string,
): Diagnostic {
  const suspended = status === "suspended";
  const evidence = metadataFieldEvidence(source, "status_changed_at");
  return withDiagnosticId(DIAGNOSTIC_IDS.META_INVALID_STATUS_CHANGED_AT, {
    severity: suspended ? "error" : "warning",
    path: document.artifact.path,
    message: `Invalid status_changed_at "${statusChangedAt}". Expected a real ISO calendar date in YYYY-MM-DD format.`,
    ...(evidence ? { evidence } : {}),
    repairConstraints: [
      {
        kind: "must_preserve",
        text: "Preserve the reviewed lifecycle status and reason while correcting only the declared transition date.",
      },
      {
        kind: "must_not_change",
        text: "Do not infer the date from Git history, file timestamps, the current date, or pull-request metadata.",
      },
      {
        kind: "requires_human_decision",
        text: "Confirm the real date of the latest reviewed lifecycle transition.",
      },
    ],
    verificationSteps: [
      {
        text: "Use a real YYYY-MM-DD calendar date and rerun metadata validation.",
        command: "renma scan . --format json",
        expected: `No ${DIAGNOSTIC_IDS.META_INVALID_STATUS_CHANGED_AT} diagnostic remains for this field.`,
      },
    ],
    llmHint:
      "Correct status_changed_at only from reviewed repository evidence. Do not invent, repair heuristically, or derive a transition date from Git or filesystem timestamps.",
    details: {
      assetId:
        optionalText(metadataText(source.values.id)) ?? document.artifact.path,
      sourcePath: document.artifact.path,
      ...(status ? { status } : {}),
      statusChangedAt,
      metadataKey: source.canonicalSkill
        ? `metadata.${CANONICAL_SKILL_METADATA_KEYS.status_changed_at}`
        : NON_SKILL_CATALOG_METADATA_KEYS.status_changed_at,
    },
  });
}

function suspendedMetadataIncompleteDiagnostic(
  document: ParsedDocument,
  source: OperationalMetadataSource,
  statusReason: string | undefined,
  statusChangedAt: string | undefined,
  missingFields: string[],
): Diagnostic {
  const statusEvidence = metadataFieldEvidence(source, "status");
  return withDiagnosticId(
    DIAGNOSTIC_IDS.META_SUSPENDED_STATUS_METADATA_INCOMPLETE,
    {
      severity: "error",
      path: document.artifact.path,
      message: `Suspended lifecycle metadata is incomplete. Add ${missingFields.join(" and ")} with reviewed transition evidence.`,
      ...(statusEvidence ? { evidence: statusEvidence } : {}),
      repairConstraints: [
        {
          kind: "must_preserve",
          text: "Preserve the suspended asset, its contents, inventory evidence, and the reviewed reason/date declarations that already exist.",
        },
        {
          kind: "must_not_change",
          text: "Do not reactivate, archive, delete, automatically restore, or invent lifecycle evidence merely to clear this diagnostic.",
        },
        {
          kind: "allowed_change",
          text: "Add a non-blank reason and a real YYYY-MM-DD date for the latest reviewed lifecycle transition.",
        },
        {
          kind: "requires_human_decision",
          text: "Confirm the reason and date of the reviewed suspension decision.",
        },
      ],
      verificationSteps: [
        {
          text: "Add the missing canonical lifecycle fields and rerun metadata validation.",
          command: "renma scan . --format json",
          expected: `No ${DIAGNOSTIC_IDS.META_SUSPENDED_STATUS_METADATA_INCOMPLETE} diagnostic remains for this asset.`,
        },
      ],
      llmHint:
        "Keep the asset suspended and add only human-reviewed lifecycle transition evidence. Skills use flat metadata.renma.status-reason and metadata.renma.status-changed-at strings; non-Skills use status_reason and status_changed_at.",
      details: {
        assetId:
          optionalText(metadataText(source.values.id)) ??
          document.artifact.path,
        sourcePath: document.artifact.path,
        status: "suspended",
        missingFields,
        ...(statusReason ? { statusReason } : {}),
        ...(statusChangedAt ? { statusChangedAt } : {}),
      },
    },
  );
}

function operationalMetadataSource(
  document: ParsedDocument,
  diagnostics: Diagnostic[],
): OperationalMetadataSource {
  if (document.artifact.kind !== "skill") {
    return renmaMetadataSource(document, diagnostics);
  }

  const inspection = inspectAgentSkill(document);
  return canonicalSkillMetadataSource(
    document,
    inspection.frontmatter,
    inspection.validation.valid,
    diagnostics,
  );
}

function renmaMetadataSource(
  document: ParsedDocument,
  diagnostics: Diagnostic[],
): OperationalMetadataSource {
  const frontmatter = ensureYamlFrontmatterForDocument(document);
  const malformed =
    frontmatter.present &&
    (!frontmatter.closed ||
      !frontmatter.mapping ||
      frontmatter.errors.length > 0);
  if (malformed) {
    const error = frontmatter.errors[0];
    diagnostics.push(
      withDiagnosticId(DIAGNOSTIC_IDS.META_INVALID_RENMA_FRONTMATTER, {
        severity: "error",
        path: document.artifact.path,
        message: !frontmatter.closed
          ? "Non-Skill Renma frontmatter is not closed. No operational metadata was selected."
          : error === undefined
            ? "Non-Skill Renma frontmatter must be a YAML mapping. No operational metadata was selected."
            : `Non-Skill Renma frontmatter contains invalid YAML (${error.code}). No operational metadata was selected.`,
        evidence: documentLineEvidence(document, error?.line ?? 1),
      }),
    );
  }

  for (const duplicate of frontmatter.duplicateFields.filter((field) =>
    NON_SKILL_OPERATIONAL_METADATA_KEY_SET.has(field.key),
  )) {
    diagnostics.push(
      withDiagnosticId(DIAGNOSTIC_IDS.META_INVALID_RENMA_FRONTMATTER, {
        severity: "error",
        path: document.artifact.path,
        message: `Non-Skill operational metadata field "${duplicate.key}" is declared more than once. No value was selected for that field.`,
        evidence: fieldEvidence(document, duplicate),
      }),
    );
  }

  return {
    values: Object.fromEntries(
      Object.entries(document.metadata).filter(([key]) =>
        NON_SKILL_CATALOG_KEY_SET.has(key),
      ),
    ),
    fields: document.metadataFields,
    listItems: document.metadataListItems,
    canonicalSkill: false,
  };
}

function canonicalSkillMetadataSource(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
  validAgentSkill: boolean,
  diagnostics: Diagnostic[],
): OperationalMetadataSource {
  const values: Record<string, unknown> = {};
  const fields: Record<string, MetadataFieldEvidence> = {};
  const listItems: Record<string, MetadataFieldEvidence[]> = {};
  const duplicateMetadataMapping = frontmatter.duplicateFields.find(
    (field) => field.key === AGENT_SKILL_TOP_LEVEL_KEYS.metadata,
  );

  if (duplicateMetadataMapping) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message:
        "Canonical Agent Skills metadata is ambiguous because the top-level metadata mapping is declared more than once. No metadata.renma.* values were selected.",
      evidence: {
        path: document.artifact.path,
        startLine: duplicateMetadataMapping.startLine,
        endLine: duplicateMetadataMapping.endLine,
        snippet: document.lines
          .slice(
            duplicateMetadataMapping.startLine - 1,
            duplicateMetadataMapping.endLine,
          )
          .join("\n"),
      },
    });
  }

  if (!validAgentSkill) {
    return { values, fields, listItems, canonicalSkill: true };
  }

  const duplicateKeys = new Set(
    frontmatter.duplicateMetadataKeys.map((field) => field.key),
  );

  for (const field of frontmatter.metadataFields) {
    // Agent Skills validation diagnoses duplicate canonical metadata keys. Do not guess which
    // duplicate value should become operational, and never fall back to legacy.
    if (duplicateKeys.has(field.key)) continue;
    const operationalKey = CANONICAL_SKILL_KEY_TO_OPERATIONAL.get(field.key);
    if (!operationalKey) continue;
    values[operationalKey] = field.value;
    fields[operationalKey] = {
      path: document.artifact.path,
      key: field.key,
      startLine: field.startLine,
      endLine: field.endLine,
      raw: document.lines.slice(field.startLine - 1, field.endLine).join("\n"),
    };
    listItems[operationalKey] = [];
  }

  return { values, fields, listItems, canonicalSkill: true };
}

function operationalListValue(
  document: ParsedDocument,
  source: OperationalMetadataSource,
  key: string,
  diagnostics: Diagnostic[],
): string[] {
  const value = source.values[key];
  if (!source.canonicalSkill) {
    return listValue(value as MetadataValue | undefined);
  }
  if (!CANONICAL_LIST_KEYS.has(key as CanonicalSkillOperationalKey)) {
    return [];
  }
  if (value === undefined) return [];

  const canonicalKey =
    CANONICAL_SKILL_METADATA_KEYS[key as CanonicalSkillOperationalKey];
  const parsed = parseCanonicalCatalogListValue(value);
  if (!parsed.valid) {
    diagnostics.push(
      invalidCanonicalListDiagnostic(
        document,
        source,
        key,
        canonicalKey,
        parsed.reason,
      ),
    );
    return [];
  }

  return parsed.values;
}

export type CanonicalCatalogListParseResult =
  { valid: true; values: string[] } | { valid: false; reason: string };

/** Parse the established canonical Skill JSON-array string encoding. */
export function parseCanonicalCatalogListValue(
  value: unknown,
): CanonicalCatalogListParseResult {
  if (typeof value !== "string") {
    return {
      valid: false,
      reason: "must be a string containing a JSON array of strings",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      valid: false,
      reason: "must contain valid JSON for an array of strings",
    };
  }
  if (!Array.isArray(parsed)) {
    return { valid: false, reason: "must contain a JSON array" };
  }
  if (parsed.some((item) => typeof item !== "string")) {
    return {
      valid: false,
      reason: "must contain only string array members",
    };
  }
  return {
    valid: true,
    values: parsed.map((item) => item.trim()).filter(Boolean),
  };
}

function invalidCanonicalListDiagnostic(
  document: ParsedDocument,
  source: OperationalMetadataSource,
  operationalKey: string,
  canonicalKey: string,
  reason: string,
): Diagnostic {
  return invalidMetadataDiagnostic(
    document,
    source,
    operationalKey,
    `Invalid metadata.${canonicalKey}: ${reason}.`,
  );
}

function parseStatus(value: string | undefined): AssetStatus | undefined {
  if (!value) return undefined;
  return STATUSES.includes(value as AssetStatus)
    ? (value as AssetStatus)
    : undefined;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function listValue(value: MetadataValue | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function metadataText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function metadataFieldEvidence(source: OperationalMetadataSource, key: string) {
  const field = source.fields[key];
  if (!field) return undefined;
  return {
    path: field.path,
    startLine: field.startLine,
    endLine: field.endLine,
    snippet: field.raw,
  };
}

function assignOptional<K extends keyof AssetMetadata>(
  metadata: AssetMetadata,
  key: K,
  value: AssetMetadata[K] | undefined,
): void {
  if (value !== undefined) {
    metadata[key] = value;
  }
}

function assignOptionalList<K extends keyof AssetMetadata>(
  metadata: AssetMetadata,
  key: K,
  value: string[],
): void {
  if (value.length > 0) {
    metadata[key] = value as AssetMetadata[K];
  }
}
