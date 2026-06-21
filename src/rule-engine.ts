import type { Catalog } from "./model.js";
import type { Finding, ParsedDocument, ScanConfig } from "./types.js";

/** Shared input passed to each deterministic rule. */
export interface RuleContext {
  documents: ParsedDocument[];
  catalog?: Catalog;
  config: ScanConfig;
}

/** Deterministic rule that can emit findings from a shared rule context. */
export interface Rule {
  id: string;
  run(context: RuleContext): Finding[];
}

/** Run a list of deterministic rules and concatenate their findings. */
export function runRuleRegistry(
  documents: ParsedDocument[],
  rules: Rule[],
  catalog?: Catalog,
  config?: ScanConfig,
): Finding[] {
  if (!config) throw new Error("Rule registry requires scan config.");
  const context: RuleContext =
    catalog === undefined
      ? { documents, config }
      : { documents, catalog, config };
  return rules.flatMap((rule) => rule.run(context));
}
