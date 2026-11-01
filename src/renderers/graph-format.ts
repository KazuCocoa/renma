import type { AssetOwnership } from "../types/governance.js";
import type { AssetBindingDiagnostic } from "../types/asset-bindings.js";
import type { DependencyBinding } from "../model.js";
import type { Diagnostic } from "../types/diagnostics.js";

export function evidenceLabel(
  evidence: Diagnostic["evidence"],
  fallbackPath: string,
): string {
  if (!evidence) return fallbackPath;
  const lines =
    evidence.startLine === evidence.endLine
      ? `L${evidence.startLine}`
      : `L${evidence.startLine}-L${evidence.endLine}`;
  return `${evidence.path}:${lines}`;
}

export function tableText(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function escapeMermaidLabel(label: string): string {
  return singleLine(label).replace(/"/g, '\\"');
}

/** Bound edge labels need quotes because annotations contain square brackets. */
export function escapeMermaidEdgeLabel(label: string): string {
  if (!label.includes("[")) return escapeMermaidLabel(label);
  return `"${singleLine(label).replace(/"/g, "#quot;").replace(/\|/g, "#124;")}"`;
}

export function singleLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
}

/** Compact review label; unbound declarations retain their existing presentation. */
export function bindingLabel(edge: {
  bindings?: DependencyBinding[];
  bindingDiagnostics?: AssetBindingDiagnostic[];
}): string {
  return (
    (edge.bindings
      ?.map(
        (binding) =>
          ` [${binding.alias} @${binding.version ?? `ref ${binding.ref} (unverified)`}${binding.version !== undefined && binding.ref !== undefined ? ` ref ${binding.ref}` : ""}${binding.resolved ? ` commit ${binding.resolved.commit.slice(0, 12)} (supplied)` : ""}: ${binding.satisfied ? "matched" : `${binding.declarationValid ? "" : "invalid declaration; "}${binding.satisfaction.status}`}]`,
      )
      .join("") ?? "") +
    (!edge.bindings?.length && edge.bindingDiagnostics?.length
      ? " [invalid binding declaration]"
      : "")
  );
}

export function formatOwnership(ownership: AssetOwnership): string {
  if (ownership.source === "unowned") return "(unowned)";
  const provenance =
    ownership.source === "inherited" && ownership.inheritedFrom
      ? ` from ${ownership.inheritedFrom.sourcePath}`
      : "";
  return `${ownership.effectiveOwner ?? "(unowned)"} (${ownership.source}${provenance})`;
}
