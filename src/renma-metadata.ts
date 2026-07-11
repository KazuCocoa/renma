import type {
  Diagnostic,
  MetadataFieldEvidence,
  MetadataValue,
  ParsedDocument,
  ParsedMetadata,
} from "./types.js";

/**
 * Agent Skills permits client-specific string metadata under the top-level
 * `metadata` mapping. Renma writes its extension values as `renma.*` keys there
 * while continuing to read the historical top-level snake_case fields.
 */
export const RENMA_METADATA_KEYS = {
  id: "id",
  title: "title",
  type: "type",
  version: "version",
  owner: "owner",
  status: "status",
  purpose: "purpose",
  last_reviewed_at: "last-reviewed-at",
  review_cycle: "review-cycle",
  expires_at: "expires-at",
  tags: "tags",
  when_to_use: "when-to-use",
  when_not_to_use: "when-not-to-use",
  requires_context: "requires-context",
  optional_context: "optional-context",
  requires_lens: "requires-lens",
  optional_lens: "optional-lens",
  applies_to: "applies-to",
  focus: "focus",
  expected_outputs: "expected-outputs",
  conflicts: "conflicts",
  superseded_by: "superseded-by",
  allowed_data: "allowed-data",
  network_allowed: "network-allowed",
  external_upload_allowed: "external-upload-allowed",
  secrets_allowed: "secrets-allowed",
  requires_human_approval: "requires-human-approval",
  forbidden_inputs: "forbidden-inputs",
  approved_network_destinations: "approved-network-destinations",
  approved_upload_destinations: "approved-upload-destinations",
  security_profile: "security-profile",
} as const;

export type LegacyRenmaMetadataKey = keyof typeof RENMA_METADATA_KEYS;

export const RENMA_LIST_METADATA_KEYS = new Set<LegacyRenmaMetadataKey>([
  "tags",
  "when_to_use",
  "when_not_to_use",
  "requires_context",
  "optional_context",
  "requires_lens",
  "optional_lens",
  "applies_to",
  "focus",
  "expected_outputs",
  "conflicts",
  "superseded_by",
  "allowed_data",
  "forbidden_inputs",
  "approved_network_destinations",
  "approved_upload_destinations",
]);

const RENMA_CANONICAL_PREFIX = "metadata.renma.";

export function canonicalRenmaMetadataKey(
  legacyKey: LegacyRenmaMetadataKey,
): string {
  return `${RENMA_CANONICAL_PREFIX}${RENMA_METADATA_KEYS[legacyKey]}`;
}

export function isLegacyRenmaMetadataKey(
  value: string,
): value is LegacyRenmaMetadataKey {
  return Object.hasOwn(RENMA_METADATA_KEYS, value);
}

export function isCanonicalRenmaMetadataKey(value: string): boolean {
  return value.startsWith(RENMA_CANONICAL_PREFIX);
}

export function readRenmaMetadataValue(
  document: ParsedDocument,
  legacyKey: LegacyRenmaMetadataKey,
): MetadataValue | undefined {
  return (
    document.metadata[canonicalRenmaMetadataKey(legacyKey)] ??
    document.metadata[legacyKey]
  );
}

export function readRenmaMetadataField(
  document: ParsedDocument,
  legacyKey: LegacyRenmaMetadataKey,
): MetadataFieldEvidence | undefined {
  return (
    document.metadataFields[canonicalRenmaMetadataKey(legacyKey)] ??
    document.metadataFields[legacyKey]
  );
}

export function readRenmaMetadataListItems(
  document: ParsedDocument,
  legacyKey: LegacyRenmaMetadataKey,
): MetadataFieldEvidence[] {
  return (
    document.metadataListItems[canonicalRenmaMetadataKey(legacyKey)] ??
    document.metadataListItems[legacyKey] ??
    []
  );
}

/**
 * Add evidence aliases for existing catalog and graph code. Values stay
 * separate so canonical-vs-legacy conflicts can still be detected.
 */
export function applyRenmaMetadataEvidenceAliases(
  metadata: ParsedMetadata,
): ParsedMetadata {
  for (const legacyKey of Object.keys(
    RENMA_METADATA_KEYS,
  ) as LegacyRenmaMetadataKey[]) {
    const canonicalKey = canonicalRenmaMetadataKey(legacyKey);
    if (metadata.fields[canonicalKey]) {
      metadata.fields[legacyKey] = metadata.fields[canonicalKey];
    }
    if (metadata.listItems[canonicalKey]) {
      metadata.listItems[legacyKey] = metadata.listItems[canonicalKey];
    }
  }
  return metadata;
}

export function legacyRenmaMetadataFields(
  document: ParsedDocument,
): LegacyRenmaMetadataKey[] {
  return (Object.keys(RENMA_METADATA_KEYS) as LegacyRenmaMetadataKey[]).filter(
    (key) => document.metadata[key] !== undefined,
  );
}

export function canonicalRenmaMetadataFields(
  document: ParsedDocument,
): string[] {
  return Object.keys(document.metadata)
    .filter(isCanonicalRenmaMetadataKey)
    .sort((a, b) => a.localeCompare(b));
}

export function renmaMetadataConflictDiagnostics(
  document: ParsedDocument,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const legacyKey of Object.keys(
    RENMA_METADATA_KEYS,
  ) as LegacyRenmaMetadataKey[]) {
    const canonicalKey = canonicalRenmaMetadataKey(legacyKey);
    const canonical = document.metadata[canonicalKey];
    const legacy = document.metadata[legacyKey];
    if (canonical === undefined || legacy === undefined) continue;

    const canonicalNormalized = normalizedMetadataValue(
      canonical,
      RENMA_LIST_METADATA_KEYS.has(legacyKey),
    );
    const legacyNormalized = normalizedMetadataValue(
      legacy,
      RENMA_LIST_METADATA_KEYS.has(legacyKey),
    );
    if (canonicalNormalized === legacyNormalized) continue;

    const field = document.metadataFields[canonicalKey];
    diagnostics.push({
      code: "RENMA-METADATA-CONFLICTING-SOURCES",
      severity: "warning",
      path: document.artifact.path,
      message: `Renma metadata field "${legacyKey}" differs between canonical ${canonicalKey} and the legacy top-level field. The canonical Agent Skills metadata value takes precedence.`,
      ...(field
        ? {
            evidence: {
              path: field.path,
              startLine: field.startLine,
              endLine: field.endLine,
              snippet: field.raw,
            },
          }
        : {}),
      repairConstraints: [
        {
          kind: "must_preserve",
          text: "Preserve the reviewed semantic value while removing the duplicate legacy field.",
        },
        {
          kind: "requires_human_decision",
          text: "A human owner must decide which conflicting value is correct.",
        },
      ],
      verificationSteps: [
        {
          text: "Rerun Renma scan after resolving the duplicate metadata source.",
          command: "renma scan .",
        },
      ],
      llmHint:
        "Do not silently choose between conflicting values. Keep metadata.renma.* as the destination and request human review for the semantic value.",
      details: {
        canonicalKey,
        legacyKey,
        canonicalValue: canonical,
        legacyValue: legacy,
      },
    });
  }

  return diagnostics;
}

export function metadataValueAsText(
  value: MetadataValue | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function metadataValueAsList(
  value: MetadataValue | undefined,
): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every((item): item is string => typeof item === "string")
      ) {
        return parsed.map((item) => item.trim()).filter(Boolean);
      }
    } catch {
      // Fall through to the backward-compatible comma-separated representation.
    }
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function encodeRenmaMetadataList(values: string[]): string {
  return JSON.stringify(values);
}

export function yamlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizedMetadataValue(value: MetadataValue, list: boolean): string {
  if (list) return JSON.stringify(metadataValueAsList(value));
  if (Array.isArray(value)) return JSON.stringify(value);
  return value.trim();
}
