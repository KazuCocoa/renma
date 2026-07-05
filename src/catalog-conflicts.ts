import type { CatalogEntry } from "./model.js";
import type { Diagnostic, Evidence } from "./types.js";

export function conflictDiagnostics(entries: CatalogEntry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const conflictPairs = new Set<string>();

  for (const entry of entries) {
    for (const [index, targetId] of entry.metadata.conflicts.entries()) {
      if (targetId === entry.id) {
        diagnostics.push({
          severity: "warning",
          path: entry.sourcePath,
          message: `Asset conflicts metadata references itself: "${targetId}".`,
          evidence: metadataListEvidence(entry, "conflicts", index),
        });
        continue;
      }

      if (!entriesById.has(targetId)) {
        diagnostics.push({
          severity: "warning",
          path: entry.sourcePath,
          message: `Asset conflicts target "${targetId}" does not match a catalog entry.`,
          evidence: metadataListEvidence(entry, "conflicts", index),
        });
        continue;
      }

      conflictPairs.add(pairKey(entry.id, targetId));
    }
  }

  diagnostics.push(...requiredConflictDiagnostics(entries, conflictPairs));
  return diagnostics;
}

function requiredConflictDiagnostics(
  entries: CatalogEntry[],
  conflictPairs: Set<string>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const entry of entries) {
    if (entry.kind !== "skill") continue;

    for (
      let leftIndex = 0;
      leftIndex < entry.requiredContext.length;
      leftIndex += 1
    ) {
      const left = entry.requiredContext[leftIndex];
      if (left === undefined) continue;

      for (
        let rightIndex = leftIndex + 1;
        rightIndex < entry.requiredContext.length;
        rightIndex += 1
      ) {
        const right = entry.requiredContext[rightIndex];
        if (right === undefined) continue;
        if (!conflictPairs.has(pairKey(left, right))) continue;

        diagnostics.push({
          severity: "warning",
          path: entry.sourcePath,
          message: `Skill requires conflicting context assets "${left}" and "${right}".`,
          evidence: metadataListEvidence(entry, "requires_context", rightIndex),
        });
      }
    }
  }

  return diagnostics;
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
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

  return {
    path: entry.sourcePath,
    startLine: 1,
    endLine: 1,
    snippet: `${fieldKey} metadata`,
  };
}
