import type { Finding, ParsedDocument } from "./types.js";

/** Shared input passed to each deterministic rule. */
export interface RuleContext {
  documents: ParsedDocument[];
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
): Finding[] {
  const context = { documents };
  return rules.flatMap((rule) => rule.run(context));
}
