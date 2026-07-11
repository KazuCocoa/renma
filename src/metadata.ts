import type { AssetMetadata, AssetStatus, SkillGovernance } from "./model.js";
import type { Diagnostic, ParsedDocument } from "./types.js";
import { isIsoDate, parseDayDuration } from "./freshness.js";
import {
  metadataValueAsList,
  metadataValueAsText,
  readCanonicalRenmaMetadataField,
  readCanonicalRenmaMetadataValue,
  readLegacyRenmaMetadataField,
  readLegacyRenmaMetadataValue,
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
  const diagnostics: Diagnostic[] = [];
  const governance =
    document.artifact.kind === "skill"
      ? parseSkillGovernance(document)
      : undefined;
  const rawStatus =
    governance?.lifecycle.status ?? metadataText(document, "status");
  const status = parseStatus(rawStatus);
  const lastReviewedAt = optionalText(
    metadataText(document, "last_reviewed_at"),
  );
  const reviewCycle = optionalText(metadataText(document, "review_cycle"));
  const expiresAt = optionalText(metadataText(document, "expires_at"));
  const metadata: AssetMetadata = {
    tags: metadataList(document, "tags"),
    whenToUse:
      governance?.selection.useWhen ?? metadataList(document, "when_to_use"),
    whenNotToUse:
      governance?.selection.doNotUseWhen ??
      metadataList(document, "when_not_to_use"),
    requiresContext:
      governance?.dependencies.requiredContext ??
      metadataList(document, "requires_context"),
    optionalContext:
      governance?.dependencies.optionalContext ??
      metadataList(document, "optional_context"),
    conflicts:
      governance?.dependencies.conflicts ?? metadataList(document, "conflicts"),
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

  assignOptional(
    metadata,
    "id",
    governance?.id ?? optionalText(metadataText(document, "id")),
  );
  assignOptional(
    metadata,
    "title",
    governance?.title ?? optionalText(metadataText(document, "title")),
  );
  assignOptional(
    metadata,
    "type",
    optionalText(metadataText(document, "type")),
  );
  assignOptional(
    metadata,
    "version",
    governance?.lifecycle.version ??
      optionalText(metadataText(document, "version")),
  );
  assignOptional(
    metadata,
    "owner",
    governance?.owner ?? optionalText(metadataText(document, "owner")),
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
    governance?.dependencies.requiredLens ??
      metadataList(document, "requires_lens"),
  );
  assignOptionalList(
    metadata,
    "optionalLens",
    governance?.dependencies.optionalLens ??
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

/** Adapt canonical metadata.renma.* serialization into durable Skill semantics. */
export function parseSkillGovernance(
  document: ParsedDocument,
): SkillGovernance {
  if (document.artifact.kind !== "skill") {
    throw new Error(
      "Skill governance can only be parsed from a Skill artifact.",
    );
  }
  const text = (key: LegacyRenmaMetadataKey) =>
    metadataValueAsText(readCanonicalRenmaMetadataValue(document, key));
  const list = (key: LegacyRenmaMetadataKey) =>
    metadataValueAsList(readCanonicalRenmaMetadataValue(document, key));
  const bool = (key: LegacyRenmaMetadataKey) => {
    const value = text(key)?.toLowerCase();
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  };
  const extensionMetadata = Object.fromEntries(
    Object.entries(document.metadata).flatMap(([key, value]) => {
      if (!key.startsWith("metadata.") || typeof value !== "string") return [];
      return [[key.slice("metadata.".length), value]];
    }),
  );
  return {
    ...(text("id") ? { id: text("id") } : {}),
    ...(text("title") ? { title: text("title") } : {}),
    ...(text("owner") ? { owner: text("owner") } : {}),
    lifecycle: {
      ...(text("status") ? { status: text("status") } : {}),
      ...(text("version") ? { version: text("version") } : {}),
      ...(text("last_reviewed_at")
        ? { lastReviewedAt: text("last_reviewed_at") }
        : {}),
      ...(text("review_cycle") ? { reviewCycle: text("review_cycle") } : {}),
      ...(text("expires_at") ? { expiresAt: text("expires_at") } : {}),
    },
    selection: {
      useWhen: list("when_to_use"),
      doNotUseWhen: list("when_not_to_use"),
    },
    dependencies: {
      requiredContext: list("requires_context"),
      optionalContext: list("optional_context"),
      requiredLens: list("requires_lens"),
      optionalLens: list("optional_lens"),
      conflicts: list("conflicts"),
    },
    security: {
      ...(bool("network_allowed") !== undefined
        ? { networkAllowed: bool("network_allowed") }
        : {}),
      ...(bool("external_upload_allowed") !== undefined
        ? { externalUploadAllowed: bool("external_upload_allowed") }
        : {}),
      ...(bool("secrets_allowed") !== undefined
        ? { secretsAllowed: bool("secrets_allowed") }
        : {}),
      ...(bool("requires_human_approval") !== undefined
        ? { humanApprovalRequired: bool("requires_human_approval") }
        : {}),
      allowedData: list("allowed_data"),
      forbiddenInputs: list("forbidden_inputs"),
      approvedNetworkDestinations: list("approved_network_destinations"),
      approvedUploadDestinations: list("approved_upload_destinations"),
      ...(text("security_profile")
        ? { profile: text("security_profile") }
        : {}),
    },
    extensionMetadata,
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
  return metadataValueAsText(metadataValue(document, key));
}

function metadataList(
  document: ParsedDocument,
  key: LegacyRenmaMetadataKey,
): string[] {
  return metadataValueAsList(metadataValue(document, key));
}

function metadataFieldEvidence(
  document: ParsedDocument,
  key: LegacyRenmaMetadataKey,
) {
  const field =
    document.artifact.kind === "skill"
      ? readCanonicalRenmaMetadataField(document, key)
      : readLegacyRenmaMetadataField(document, key);
  if (!field) return undefined;
  return {
    path: field.path,
    startLine: field.startLine,
    endLine: field.endLine,
    snippet: field.raw,
  };
}

function metadataValue(document: ParsedDocument, key: LegacyRenmaMetadataKey) {
  return document.artifact.kind === "skill"
    ? readCanonicalRenmaMetadataValue(document, key)
    : readLegacyRenmaMetadataValue(document, key);
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
