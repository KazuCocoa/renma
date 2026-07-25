import type { SecurityGuardEvidence } from "../markdown-security-view.js";

const FAIL_CLOSED_VARIABLE_RE =
  /\$\{([A-Za-z_][A-Za-z0-9_]*):\?([^}\r\n]+)\}/gu;
const DISCLOSURE_NEGATION_RE =
  /\b(never|do\s+not|don't|must\s+not|may\s+not|without)\b/i;
const DIRECT_NO_DISCLOSURE_RE =
  /\b(never|do\s+not|don't|must\s+not|may\s+not)\b.{0,100}\b(disclose|expose|exfiltrate)\b|\b(without)\b.{0,50}\b(disclos(?:ing|ure)|expos(?:ing|ure))\b/i;
const LOCAL_ONLY_RE =
  /\b(local[- ]only|locally only|keep\b.{0,40}\blocal|remain\b.{0,40}\blocal)\b/i;
const NEGATED_NEGATION_RE =
  /\b(?:do\s+not|don't|never)\s+(?:avoid|prevent|block|stop)\b|\b(?:no|without)\s+(?:need|requirement)\b/i;

export function failClosedVariableGuardNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(FAIL_CLOSED_VARIABLE_RE)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

export function associatedFailClosedVariableGuardNames(
  guards: readonly SecurityGuardEvidence[],
): Set<string> {
  const names = new Set<string>();
  for (const guard of guards) {
    for (const name of failClosedVariableGuardNames(guard.text)) {
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
  if (NEGATED_NEGATION_RE.test(text) || !DISCLOSURE_NEGATION_RE.test(text)) {
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
