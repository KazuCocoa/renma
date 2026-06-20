import type { Catalog } from "./model.js";
import type { Finding, ParsedDocument } from "./types.js";

/** Shared input passed to each deterministic rule. */
export interface RuleContext {
  documents: ParsedDocument[];
  catalog?: Catalog;
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
): Finding[] {
  const context: RuleContext =
    catalog === undefined ? { documents } : { documents, catalog };
  return rules.flatMap((rule) => rule.run(context));
}
