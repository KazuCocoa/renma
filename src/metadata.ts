import type { AssetMetadata, AssetStatus } from "./model.js";
import type { Diagnostic, ParsedDocument } from "./types.js";
import { isIsoDate, parseDayDuration } from "./freshness.js";
import {
  metadataValueAsList,
  metadataValueAsText,
  readRenmaMetadataField,
  readRenmaMetadataValue,
  renmaMetadataConflictDiagnostics,
  type LegacyRenmaMetadataKey,
} from "./renma-metadata.js";

const STATUSES: AssetStatus[] = [
  "experimental",
  "stable",
  "deprecated",
  "archived",
];

/** Normalize parsed frontmatter into asset metadata plus validation diagnostics. */
export function parseAssetMetadata(document: ParsedDocument): {
  metadata: AssetMetadata;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [
    ...renmaMetadataConflictDiagnostics(document),
  ];
  const rawStatus = metadataText(document, "status");
  const status = parseStatus(rawStatus);
  const lastReviewedAt = optionalText(
    metadataText(document, "last_reviewed_at"),
  );
  const reviewCycle = optionalText(metadataText(document, "review_cycle"));
  const expiresAt = optionalText(metadataText(document, "expires_at"));
  const metadata: AssetMetadata = {
    tags: metadataList(document, "tags"),
    whenToUse: metadataList(document, "when_to_use"),
    whenNotToUse: metadataList(document, "when_not_to_use"),
    requiresContext: metadataList(document, "requires_context"),
    optionalContext: metadataList(document, "optional_context"),
    conflicts: metadataList(document, "conflicts"),
    supersededBy: metadataList(document, "superseded_by"),
  };

  if (rawStatus !== undefined && status === undefined) {
    const evidence = metadataFieldEvidence(document, "status");
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: `Invalid status "${rawStatus}". Expected one of: ${STATUSES.join(", ")}.`,
      ...(evidence ? { evidence } : {}),
    });
  }

  assignOptional(metadata, "id", optionalText(metadataText(document, "id")));
  assignOptional(
    metadata,
    "type",
    optionalText(metadataText(document, "type")),
  );
  assignOptional(
    metadata,
    "version",
    optionalText(metadataText(document, "version")),
  );
  assignOptional(
    metadata,
    "owner",
    optionalText(metadataText(document, "owner")),
  );
  assignOptional(metadata, "status", status);
  assignOptional(
    metadata,
    "purpose",
    optionalText(metadataText(document, "purpose")),
  );
  assignOptional(metadata, "lastReviewedAt", lastReviewedAt);
  assignOptional(metadata, "reviewCycle", reviewCycle);
  assignOptional(metadata, "expiresAt", expiresAt);
  assignOptionalList(
    metadata,
    "appliesTo",
    metadataList(document, "applies_to"),
  );
  assignOptionalList(metadata, "focus", metadataList(document, "focus"));
  assignOptionalList(
    metadata,
    "expectedOutputs",
    metadataList(document, "expected_outputs"),
  );
  assignOptionalList(
    metadata,
    "requiresLens",
    metadataList(document, "requires_lens"),
  );
  assignOptionalList(
    metadata,
    "optionalLens",
    metadataList(document, "optional_lens"),
  );

  if (lastReviewedAt !== undefined && !isIsoDate(lastReviewedAt)) {
    diagnostics.push(
      invalidMetadataDiagnostic(
        document,
        "last_reviewed_at",
        `Invalid last_reviewed_at "${lastReviewedAt}". Expected ISO date YYYY-MM-DD.`,
      ),
    );
  }

  if (expiresAt !== undefined && !isIsoDate(expiresAt)) {
    diagnostics.push(
      invalidMetadataDiagnostic(
        document,
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
        "review_cycle",
        `Invalid review_cycle "${reviewCycle}". Expected supported ISO 8601 day duration such as P90D.`,
      ),
    );
  }

  return {
    metadata,
    diagnostics,
  };
}

function invalidMetadataDiagnostic(
  document: ParsedDocument,
  field: LegacyRenmaMetadataKey,
  message: string,
): Diagnostic {
  const evidence = metadataFieldEvidence(document, field);
  return {
    severity: "warning",
    path: document.artifact.path,
    message,
    ...(evidence ? { evidence } : {}),
  };
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

function metadataText(
  document: ParsedDocument,
  key: LegacyRenmaMetadataKey,
): string | undefined {
  return metadataValueAsText(readRenmaMetadataValue(document, key));
}

function metadataList(
  document: ParsedDocument,
  key: LegacyRenmaMetadataKey,
): string[] {
  return metadataValueAsList(readRenmaMetadataValue(document, key));
}

function metadataFieldEvidence(
  document: ParsedDocument,
  key: LegacyRenmaMetadataKey,
) {
  const field = readRenmaMetadataField(document, key);
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
