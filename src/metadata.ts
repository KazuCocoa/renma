import type { AssetMetadata, AssetStatus } from "./model.js";
import type { Diagnostic, MetadataValue, ParsedDocument } from "./types.js";
import { isIsoDate, parseDayDuration } from "./freshness.js";

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
  const diagnostics: Diagnostic[] = [];
  const rawStatus = metadataText(document.metadata.status);
  const status = parseStatus(rawStatus);
  const lastReviewedAt = optionalText(
    metadataText(document.metadata.last_reviewed_at),
  );
  const reviewCycle = optionalText(
    metadataText(document.metadata.review_cycle),
  );
  const expiresAt = optionalText(metadataText(document.metadata.expires_at));
  const metadata: AssetMetadata = {
    tags: listValue(document.metadata.tags),
    whenToUse: listValue(document.metadata.when_to_use),
    whenNotToUse: listValue(document.metadata.when_not_to_use),
    requiresContext: listValue(document.metadata.requires_context),
    optionalContext: listValue(document.metadata.optional_context),
    conflicts: listValue(document.metadata.conflicts),
    supersededBy: listValue(document.metadata.superseded_by),
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

  assignOptional(
    metadata,
    "id",
    optionalText(metadataText(document.metadata.id)),
  );
  assignOptional(
    metadata,
    "version",
    optionalText(metadataText(document.metadata.version)),
  );
  assignOptional(
    metadata,
    "owner",
    optionalText(metadataText(document.metadata.owner)),
  );
  assignOptional(metadata, "status", status);
  assignOptional(metadata, "lastReviewedAt", lastReviewedAt);
  assignOptional(metadata, "reviewCycle", reviewCycle);
  assignOptional(metadata, "expiresAt", expiresAt);

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
  field: string,
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

function metadataText(value: MetadataValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function metadataFieldEvidence(document: ParsedDocument, key: string) {
  const field = document.metadataFields[key];
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
