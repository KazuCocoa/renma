import type { SecurityGuardEvidence } from "../markdown-security-view.js";

export type DisclosureActionKind =
  | "stdout-or-log"
  | "prompt-or-context"
  | "external-upload"
  | "network";

export type DisclosureAction = {
  action: string;
  kind: DisclosureActionKind;
  start: number;
  end: number;
  clauseStart: number;
  clauseEnd: number;
};

const EXECUTABLE_FAIL_CLOSED_GUARD_RE =
  /^\s*:\s+(?:"\$\{([A-Za-z_][A-Za-z0-9_]*):\?([^}"\r\n]+)\}"|\$\{([A-Za-z_][A-Za-z0-9_]*):\?([^}\s\r\n]+)\})\s*(?:#.*)?$/u;
const AMBIGUOUS_GUARD_CONTROL_FLOW_RE =
  /(?:&&|\|\||[|;&`]|\$\(|<\(|>\(|\\\s*$)|\b(?:if|then|elif|else|fi|case|esac|for|while|until|select|function|coproc)\b/imu;
const DISCLOSURE_NEGATION_RE =
  /\b(never|do\s+not|don't|must\s+not|may\s+not|without)\b/i;
const ACTION_NEGATION_RE =
  /\b(?:never|do\s+not|don't|avoid|exclude|skip|omit|must\s+not|may\s+not|without)\b/giu;
const DISCLOSURE_ACTION_RE =
  /\b(console\.log|print|logger|log|dump|echo|output|cat|attach|include|load|provide|copy|paste|put|upload|send|share|post|publish|curl|wget)\b/giu;
const CLAUSE_BOUNDARY_RE =
  /(?:[;!?\n]+|\.(?=\s|$)|\b(?:but|however|yet|then)\b)/giu;
const DIRECT_NO_DISCLOSURE_RE =
  /\b(never|do\s+not|don't|must\s+not|may\s+not)\b.{0,100}\b(disclose|expose|exfiltrate)\b|\b(without)\b.{0,50}\b(disclos(?:ing|ure)|expos(?:ing|ure))\b/i;
const LOCAL_ONLY_RE =
  /\b(local[- ]only|locally only|keep\b.{0,40}\blocal|remain\b.{0,40}\blocal)\b/i;
const NEGATED_NEGATION_RE =
  /\b(?:do\s+not|don't|never)\s+(?:avoid|prevent|block|stop)\b|\b(?:no|without)\s+(?:need|requirement)\b/i;

export function executableFailClosedVariableGuardNames(
  evidence: SecurityGuardEvidence,
): Set<string> {
  const names = new Set<string>();
  if (
    evidence.kind !== "same-instruction" ||
    AMBIGUOUS_GUARD_CONTROL_FLOW_RE.test(evidence.text)
  ) {
    return names;
  }
  for (const line of evidence.text.split(/\r?\n/u)) {
    const match = line.match(EXECUTABLE_FAIL_CLOSED_GUARD_RE);
    const name = match?.[1] ?? match?.[3];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

export function associatedFailClosedVariableGuardNames(
  guards: readonly SecurityGuardEvidence[],
): Set<string> {
  const names = new Set<string>();
  for (const guard of guards) {
    for (const name of executableFailClosedVariableGuardNames(guard)) {
      names.add(name);
    }
  }
  return names;
}

export function explicitNoDisclosureGuards(
  guards: readonly SecurityGuardEvidence[],
): SecurityGuardEvidence[] {
  return guards.filter(({ text }) => isExplicitNoDisclosureGuard(text));
}

export function isExplicitNoDisclosureGuard(text: string): boolean {
  if (
    NEGATED_NEGATION_RE.test(text) ||
    !DISCLOSURE_NEGATION_RE.test(text) ||
    hasPositiveDisclosureAction(text)
  ) {
    return false;
  }
  if (DIRECT_NO_DISCLOSURE_RE.test(text)) return true;

  const categories = [
    /\b(print|stdout|standard output|echo|cat|output)\b/i,
    /\b(log|logs|logging|console)\b/i,
    /\b(prompt|context|tool input|request|message)\b/i,
    /\b(upload|attach|send|share|post|publish|network|external)\b/i,
  ].filter((pattern) => pattern.test(text)).length;
  return categories >= 3 || (LOCAL_ONLY_RE.test(text) && categories >= 1);
}

export function positiveDisclosureActions(text: string): DisclosureAction[] {
  const actions: DisclosureAction[] = [];
  for (const clause of disclosureClauses(text)) {
    for (const match of clause.text.matchAll(DISCLOSURE_ACTION_RE)) {
      if (match.index === undefined) continue;
      const raw = match[0];
      const start = clause.start + match.index;
      if (isNegatedDisclosureAction(clause.text, match.index)) continue;
      for (const kind of disclosureActionKinds(raw, clause.text)) {
        actions.push({
          action: raw,
          kind,
          start,
          end: start + raw.length,
          clauseStart: clause.start,
          clauseEnd: clause.end,
        });
      }
    }
  }
  return actions;
}

export function hasPositiveDisclosureAction(text: string): boolean {
  return positiveDisclosureActions(text).length > 0;
}

function disclosureClauses(
  text: string,
): Array<{ text: string; start: number; end: number }> {
  const clauses: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (const boundary of text.matchAll(CLAUSE_BOUNDARY_RE)) {
    if (boundary.index === undefined) continue;
    const end = boundary.index;
    if (end > start) {
      clauses.push({ text: text.slice(start, end), start, end });
    }
    start = end + boundary[0].length;
  }
  if (start < text.length) {
    clauses.push({ text: text.slice(start), start, end: text.length });
  }
  return clauses;
}

function isNegatedDisclosureAction(
  clause: string,
  actionOffset: number,
): boolean {
  const prefix = clause.slice(0, actionOffset);
  const negations = [...prefix.matchAll(ACTION_NEGATION_RE)];
  const lastNegation = negations[negations.length - 1];
  if (lastNegation?.index === undefined) return false;
  return !NEGATED_NEGATION_RE.test(prefix.slice(lastNegation.index));
}

function disclosureActionKinds(
  rawAction: string,
  clause: string,
): DisclosureActionKind[] {
  const action = rawAction.toLowerCase();
  const kinds: DisclosureActionKind[] = [];
  if (
    /^(?:console\.log|print|logger|log|dump|echo|output|cat)$/u.test(action)
  ) {
    kinds.push("stdout-or-log");
  }
  if (
    action === "include" ||
    (/^(?:attach|load|provide|copy|paste|put|send)$/u.test(action) &&
      /\b(?:prompt|agent context|context|tool input|request|message)\b/i.test(
        clause,
      ))
  ) {
    kinds.push("prompt-or-context");
  }
  if (/^(?:upload|attach|send|share|post|publish)$/u.test(action)) {
    kinds.push("external-upload");
  }
  if (/^(?:curl|wget)$/u.test(action)) {
    kinds.push("network");
  }
  return kinds;
}
