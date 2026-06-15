import type { AssetMetadata, AssetStatus } from "./model.js";
import type { Diagnostic, ParsedDocument } from "./types.js";

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
  const rawStatus = document.metadata.status;
  const status = parseStatus(rawStatus);
  const metadata: AssetMetadata = {
    whenToUse: listValue(document.metadata.when_to_use),
    whenNotToUse: listValue(document.metadata.when_not_to_use),
    requiresContext: listValue(document.metadata.requires_context),
    optionalContext: listValue(document.metadata.optional_context),
    conflicts: listValue(document.metadata.conflicts),
  };

  if (rawStatus !== undefined && status === undefined) {
    diagnostics.push({
      severity: "warning",
      path: document.artifact.path,
      message: `Invalid status "${rawStatus}". Expected one of: ${STATUSES.join(", ")}.`,
    });
  }

  assignOptional(metadata, "id", optionalText(document.metadata.id));
  assignOptional(metadata, "version", optionalText(document.metadata.version));
  assignOptional(metadata, "owner", optionalText(document.metadata.owner));
  assignOptional(metadata, "status", status);

  return {
    metadata,
    diagnostics,
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

function listValue(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
