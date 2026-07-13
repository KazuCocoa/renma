import type { AssetMetadata, AssetStatus } from "./model.js";
import { inspectAgentSkill } from "./agent-skills.js";
import type {
  Diagnostic,
  MetadataFieldEvidence,
  MetadataValue,
  ParsedDocument,
} from "./types.js";
import { isIsoDate, parseDayDuration } from "./freshness.js";
import {
  parseAgentSkillFrontmatter,
  type ParsedYamlFrontmatter,
} from "./yaml-frontmatter.js";

const STATUSES: AssetStatus[] = [
  "experimental",
  "stable",
  "deprecated",
  "archived",
];

const CANONICAL_SKILL_METADATA_KEYS = {
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
} as const;

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

interface OperationalMetadataSource {
  values: Record<string, unknown>;
  fields: Record<string, MetadataFieldEvidence>;
  listItems: Record<string, MetadataFieldEvidence[]>;
  canonicalSkill: boolean;
}

export interface SupportAssetTokenBudgetMetadata {
  overridePresent: boolean;
  overrideValue?: unknown;
  rationalePresent: boolean;
  rationaleValue?: unknown;
  reviewedAtPresent: boolean;
  reviewedAtValue?: unknown;
}

/** Read the opt-in support-asset budget decision fields with YAML scalar types intact. */
export function parseSupportAssetTokenBudgetMetadata(
  document: ParsedDocument,
): SupportAssetTokenBudgetMetadata {
  if (
    document.artifact.kind !== "context" &&
    document.artifact.kind !== "reference" &&
    document.artifact.kind !== "profile" &&
    document.artifact.kind !== "example"
  ) {
    return {
      overridePresent: false,
      rationalePresent: false,
      reviewedAtPresent: false,
    };
  }
  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  const fields = new Map(
    frontmatter.fields.map((field) => [field.key, field.value]),
  );
  return {
    overridePresent: fields.has("token_budget_override"),
    overrideValue: fields.get("token_budget_override"),
    rationalePresent: fields.has("token_budget_rationale"),
    rationaleValue: fields.get("token_budget_rationale"),
    reviewedAtPresent: fields.has("token_budget_reviewed_at"),
    reviewedAtValue: fields.get("token_budget_reviewed_at"),
  };
}

/** Normalize parsed frontmatter into asset metadata plus validation diagnostics. */
export function parseAssetMetadata(document: ParsedDocument): {
  metadata: AssetMetadata;
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
  const tokenBudget = parseSupportAssetTokenBudgetMetadata(document);
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
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: `Invalid status "${rawStatus}". Expected one of: ${STATUSES.join(", ")}.`,
      ...(evidence ? { evidence } : {}),
    });
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
  if (
    typeof tokenBudget.overrideValue === "number" &&
    Number.isInteger(tokenBudget.overrideValue)
  ) {
    metadata.tokenBudgetOverride = tokenBudget.overrideValue;
  }
  assignOptional(
    metadata,
    "tokenBudgetRationale",
    optionalText(metadataText(tokenBudget.rationaleValue)),
  );
  assignOptional(
    metadata,
    "tokenBudgetReviewedAt",
    optionalText(metadataText(tokenBudget.reviewedAtValue)),
  );
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

  if (lastReviewedAt !== undefined && !isIsoDate(lastReviewedAt)) {
    diagnostics.push(
      invalidMetadataDiagnostic(
        document,
        source,
        "last_reviewed_at",
        `Invalid last_reviewed_at "${lastReviewedAt}". Expected ISO date YYYY-MM-DD.`,
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
      ),
    );
  }

  return {
    metadata,
    metadataFields: source.fields,
    metadataListItems: source.listItems,
    diagnostics,
  };
}

function invalidMetadataDiagnostic(
  document: ParsedDocument,
  source: OperationalMetadataSource,
  field: string,
  message: string,
): Diagnostic {
  const evidence = metadataFieldEvidence(source, field);
  return {
    severity: "warning",
    path: document.artifact.path,
    message,
    ...(evidence ? { evidence } : {}),
  };
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
