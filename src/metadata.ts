import type { AssetMetadata, AssetStatus } from "./model.js";
import { inspectAgentSkill } from "./agent-skills.js";
import {
  DIAGNOSTIC_IDS,
  withDiagnosticId,
  type DiagnosticId,
} from "./diagnostic-ids.js";
import type {
  Diagnostic,
  Evidence,
  MetadataFieldEvidence,
  MetadataValue,
  ParsedDocument,
} from "./types.js";
import { isIsoDate, parseDayDuration } from "./freshness.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import { estimateTokens } from "./token-estimator.js";
import {
  parseAgentSkillFrontmatter,
  type ParsedYamlFrontmatter,
  type YamlFrontmatterField,
} from "./yaml-frontmatter.js";

const STATUSES: AssetStatus[] = [
  "experimental",
  "stable",
  "deprecated",
  "archived",
];

/** Canonical Agent Skills metadata keys understood by the installed Renma version. */
export const CANONICAL_SKILL_METADATA_KEYS = {
  id: "renma.id",
  title: "renma.title",
  version: "renma.version",
  owner: "renma.owner",
  status: "renma.status",
  purpose: "renma.purpose",
  last_reviewed_at: "renma.last-reviewed-at",
  review_cycle: "renma.review-cycle",
  expires_at: "renma.expires-at",
  tags: "renma.tags",
  when_to_use: "renma.when-to-use",
  when_not_to_use: "renma.when-not-to-use",
  requires_context: "renma.requires-context",
  optional_context: "renma.optional-context",
  requires_lens: "renma.requires-lens",
  optional_lens: "renma.optional-lens",
  conflicts: "renma.conflicts",
  superseded_by: "renma.superseded-by",
  continues_with: "renma.continues-with",
} as const;

/** Canonical one-state Skill publication marker, kept out of catalog metadata. */
export const CANONICAL_SKILL_PUBLICATION_METADATA_KEY =
  "renma.published-entrypoint" as const;

type CanonicalSkillOperationalKey = keyof typeof CANONICAL_SKILL_METADATA_KEYS;

const CANONICAL_SKILL_KEY_TO_OPERATIONAL = new Map<string, string>(
  Object.entries(CANONICAL_SKILL_METADATA_KEYS).map(
    ([operationalKey, canonicalKey]) => [canonicalKey, operationalKey],
  ),
);

const CANONICAL_LIST_KEYS = new Set<CanonicalSkillOperationalKey>([
  "tags",
  "when_to_use",
  "when_not_to_use",
  "requires_context",
  "optional_context",
  "requires_lens",
  "optional_lens",
  "conflicts",
  "superseded_by",
]);

export type CanonicalSkillContinuationFieldState =
  | "unsupported"
  | "absent"
  | "ambiguous"
  | "invalid"
  | "valid";

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
  | "unsupported"
  | "absent"
  | "ambiguous"
  | "invalid"
  | "valid";

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
  overrideLimit?: number;
  effectiveLimit?: number;
  tokenBudgetRationale?: string;
  tokenBudgetReviewedAt?: string;
  invalidReasons: string[];
  evidence?: Evidence;
}

const TOKEN_BUDGET_KEYS = [
  "token_budget_override",
  "token_budget_rationale",
  "token_budget_reviewed_at",
] as const;

type TokenBudgetKey = (typeof TOKEN_BUDGET_KEYS)[number];

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
    (document.artifact.kind !== "context" &&
      document.artifact.kind !== "reference" &&
      document.artifact.kind !== "profile" &&
      document.artifact.kind !== "example")
  ) {
    return { status: "absent", invalidReasons: [] };
  }

  const defaultLimit =
    DEFAULT_QUALITY_PROFILE.contentTokenWarn[document.artifact.kind];
  const estimatedTokens = estimateTokens(document.artifact.content);
  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  const parsedFields = frontmatter.fields.filter(isTokenBudgetField);
  const rawFields = rawTokenBudgetFields(document);
  if (parsedFields.length === 0 && rawFields.length === 0) {
    return {
      status: "absent",
      estimatedTokens,
      defaultLimit,
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
  for (const key of TOKEN_BUDGET_KEYS) {
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
      } else if (overrideLimit <= defaultLimit) {
        issues.push({
          reason: `token_budget_override must be greater than the default limit of ${defaultLimit}`,
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

  if (issues.length === 0 && overrideField && estimatedTokens <= defaultLimit) {
    issues.push({
      reason: `token_budget_override is unnecessary because the asset is within the default limit of ${defaultLimit}`,
      evidence: fieldEvidence(document, overrideField),
    });
  }

  if (issues.length > 0) {
    return {
      status: "invalid",
      estimatedTokens,
      defaultLimit,
      ...(overrideLimit !== undefined ? { overrideLimit } : {}),
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
      effectiveLimit: defaultLimit,
      invalidReasons: ["token-budget decision metadata is incomplete"],
      evidence: firstDecisionEvidence,
    };
  }

  return {
    status: "active",
    estimatedTokens,
    defaultLimit,
    overrideLimit,
    effectiveLimit: overrideLimit,
    tokenBudgetRationale: rationale,
    ...(reviewedAt ? { tokenBudgetReviewedAt: reviewedAt } : {}),
    invalidReasons: [],
    evidence: fieldEvidence(document, overrideField),
  };
}

function isTokenBudgetField(
  field: YamlFrontmatterField,
): field is YamlFrontmatterField & { key: TokenBudgetKey } {
  return TOKEN_BUDGET_KEYS.includes(field.key as TokenBudgetKey);
}

function rawTokenBudgetFields(document: ParsedDocument): Array<{
  key: TokenBudgetKey;
  evidence: Evidence;
}> {
  if (document.lines[0]?.replace(/^\uFEFF/, "").trim() !== "---") return [];
  const fields: Array<{ key: TokenBudgetKey; evidence: Evidence }> = [];
  for (let index = 1; index < document.lines.length; index += 1) {
    const line = document.lines[index] ?? "";
    if (/^---\s*$/.test(line)) break;
    const match = line.match(
      /^(token_budget_override|token_budget_rationale|token_budget_reviewed_at)\s*:/,
    );
    if (!match) continue;
    fields.push({
      key: match[1] as TokenBudgetKey,
      evidence: documentLineEvidence(document, index + 1),
    });
  }
  return fields;
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
  const source = operationalMetadataSource(document, diagnostics);
  const rawStatusText = metadataText(source.values.status);
  const rawStatus = source.canonicalSkill
    ? rawStatusText?.trim()
    : rawStatusText;
  const status = parseStatus(rawStatus);
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
    (field) => field.key === "metadata",
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
    (field) => field.key === "metadata",
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
  | { valid: true; items: string[] }
  | { valid: false; reason: string };

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

function operationalMetadataSource(
  document: ParsedDocument,
  diagnostics: Diagnostic[],
): OperationalMetadataSource {
  if (document.artifact.kind !== "skill") {
    return legacyMetadataSource(document);
  }

  const inspection = inspectAgentSkill(document);
  return canonicalSkillMetadataSource(
    document,
    inspection.frontmatter,
    inspection.validation.valid,
    diagnostics,
  );
}

function legacyMetadataSource(
  document: ParsedDocument,
): OperationalMetadataSource {
  return {
    values: document.metadata,
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
    (field) => field.key === "metadata",
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
  if (typeof value !== "string") {
    diagnostics.push(
      invalidCanonicalListDiagnostic(
        document,
        source,
        key,
        canonicalKey,
        "must be a string containing a JSON array of strings",
      ),
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    diagnostics.push(
      invalidCanonicalListDiagnostic(
        document,
        source,
        key,
        canonicalKey,
        "must contain valid JSON for an array of strings",
      ),
    );
    return [];
  }

  if (!Array.isArray(parsed)) {
    diagnostics.push(
      invalidCanonicalListDiagnostic(
        document,
        source,
        key,
        canonicalKey,
        "must contain a JSON array",
      ),
    );
    return [];
  }
  if (parsed.some((item) => typeof item !== "string")) {
    diagnostics.push(
      invalidCanonicalListDiagnostic(
        document,
        source,
        key,
        canonicalKey,
        "must contain only string array members",
      ),
    );
    return [];
  }

  return parsed.map((item) => item.trim()).filter(Boolean);
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
