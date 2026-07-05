import type { AssetStatus, CatalogEntry } from "./model.js";
import type { Diagnostic, Evidence } from "./types.js";

const ACTIVE_STATUSES = new Set<AssetStatus>(["experimental", "stable"]);
const INACTIVE_STATUSES = new Set<AssetStatus>(["deprecated", "archived"]);
const MISSING_SUPERSEDED_BY_MESSAGE =
  "Deprecated shared context asset is missing superseded_by metadata.";

export function lifecycleDiagnostics(entries: CatalogEntry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  for (const entry of entries) {
    if (entry.kind !== "context") continue;

    if (
      entry.metadata.status === "deprecated" &&
      entry.metadata.supersededBy.length === 0
    ) {
      diagnostics.push({
        severity: "warning",
        path: entry.sourcePath,
        message: MISSING_SUPERSEDED_BY_MESSAGE,
        evidence: defaultMetadataEvidence(
          entry,
          "missing superseded_by metadata",
        ),
      });
    }

    for (const [index, targetId] of entry.metadata.supersededBy.entries()) {
      if (targetId === entry.id) {
        diagnostics.push({
          severity: "warning",
          path: entry.sourcePath,
          message: selfReferenceMessage(targetId),
          evidence: metadataListEvidence(entry, "superseded_by", index),
        });
        continue;
      }

      const target = entriesById.get(targetId);
      if (!target) {
        diagnostics.push({
          severity: "warning",
          path: entry.sourcePath,
          message: missingTargetMessage(targetId),
          evidence: metadataListEvidence(entry, "superseded_by", index),
        });
        continue;
      }

      if (isInactiveStatus(target.metadata.status)) {
        diagnostics.push({
          severity: "warning",
          path: entry.sourcePath,
          message: inactiveTargetMessage(targetId, target.metadata.status),
          evidence: metadataListEvidence(entry, "superseded_by", index),
        });
      }
    }
  }

  diagnostics.push(...supersessionCycleDiagnostics(entries, entriesById));
  return diagnostics;
}

function supersessionCycleDiagnostics(
  entries: CatalogEntry[],
  entriesById: Map<string, CatalogEntry>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<string>();

  for (const entry of entries) {
    if (entry.kind !== "context") continue;
    if (entry.metadata.supersededBy.length === 0) continue;

    const path: string[] = [];
    const cycleEntry = firstCycleEntry(entry, entriesById, path);
    if (!cycleEntry) continue;

    const cycleKey = [...new Set(path.slice(path.indexOf(cycleEntry.id)))]
      .sort()
      .join(" -> ");
    if (reported.has(cycleKey)) continue;
    reported.add(cycleKey);

    diagnostics.push({
      severity: "warning",
      path: entry.sourcePath,
      message: cycleMessage(cycleEntry.id),
      evidence: metadataListEvidence(entry, "superseded_by", 0),
    });
  }

  return diagnostics;
}

function firstCycleEntry(
  entry: CatalogEntry,
  entriesById: Map<string, CatalogEntry>,
  path: string[],
): CatalogEntry | undefined {
  if (path.includes(entry.id)) return entry;
  path.push(entry.id);

  for (const targetId of entry.metadata.supersededBy) {
    const target = entriesById.get(targetId);
    if (!target || target.kind !== "context") continue;
    if (isActiveStatus(target.metadata.status)) continue;

    const cycleEntry = firstCycleEntry(target, entriesById, path);
    if (cycleEntry) return cycleEntry;
  }

  path.pop();
  return undefined;
}

function isActiveStatus(status: AssetStatus | undefined): boolean {
  return status !== undefined && ACTIVE_STATUSES.has(status);
}

function isInactiveStatus(status: AssetStatus | undefined): boolean {
  return status !== undefined && INACTIVE_STATUSES.has(status);
}

function selfReferenceMessage(targetId: string): string {
  return `Shared context asset superseded_by references itself: "${targetId}".`;
}

function missingTargetMessage(targetId: string): string {
  return `Shared context asset superseded_by target "${targetId}" does not match a catalog entry.`;
}

function inactiveTargetMessage(
  targetId: string,
  status: AssetStatus | undefined,
): string {
  return `Shared context asset superseded_by target "${targetId}" resolves to a ${status} asset.`;
}

function cycleMessage(entryId: string): string {
  return `Shared context asset superseded_by chain forms a cycle involving "${entryId}".`;
}

function metadataListEvidence(
  entry: CatalogEntry,
  fieldKey: string,
  index: number,
): Evidence {
  const item = entry.metadataListItems[fieldKey]?.[index];
  if (item) {
    return {
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      snippet: item.raw,
    };
  }

  const field = entry.metadataFields[fieldKey];
  if (field) {
    return {
      path: field.path,
      startLine: field.startLine,
      endLine: field.endLine,
      snippet: field.raw,
    };
  }

  return defaultMetadataEvidence(entry, `missing ${fieldKey} metadata`);
}

function defaultMetadataEvidence(
  entry: CatalogEntry,
  snippet: string,
): Evidence {
  return {
    path: entry.sourcePath,
    startLine: 1,
    endLine: 1,
    snippet,
  };
}
