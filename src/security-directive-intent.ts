import {
  CONDITIONAL_OR_SUBORDINATE_PREDICATE_START_RE,
  DESCRIPTIVE_SUBJECT_BRIDGE_RE,
} from "./security-body-policy/lexical-recognition.js";
import { quotePairEnclosesOffset } from "./security-body-policy/statement-components.js";

export type DirectiveIntentKind = "imperative-head" | "actor-modal";

export interface DirectiveIntentFact {
  readonly kind: DirectiveIntentKind;
  readonly actionOffset: number;
  readonly clauseStart: number;
}

const MARKDOWN_LIST_CONTAINER_RE = /^[ \t]*(?:(?:[-+*])|(?:\d+[.)]))[ \t]+/u;
const ACTOR_MODAL_PREFIX_RE =
  /^(?:you|the agent|agents?|the workflow|the tool)[ \t]+(?:must|should|shall|needs?[ \t]+to|has[ \t]+to)[ \t]*(?<modifier>.*)$/iu;
const DIRECT_PROHIBITION_PREFIX_RE =
  /^(?:do[ \t]+not|don't|never|avoid|must[ \t]+not|should[ \t]+not)\b/iu;
const EXPLICIT_NOMINAL_SUBJECT_PREFIX_RE =
  /^(?:(?:the|a|an|this|that|these|those|each|every|another|my|our|your|their|his|her|its)[ \t]+|(?:i|we|you|they|he|she|it)[ \t]+)/iu;
const NON_DIRECTIVE_PREFIX_SYNTAX_RE = /[:=]/u;
const INFLECTED_PREDICATE_TOKEN_RE = /(?:ed|ing)$/iu;

/**
 * Project positive directive intent for one already-recognized action.
 *
 * The action vocabulary belongs to the caller. This projection only decides
 * whether that action is the first predicate head of its structural clause or
 * the predicate selected by an actor-modal instruction.
 */
export function directiveIntentAt(
  text: string,
  actionOffset: number,
  predicateOffsets: readonly number[],
): DirectiveIntentFact | undefined {
  if (
    actionOffset < 0 ||
    actionOffset >= text.length ||
    quotePairEnclosesOffset(text, actionOffset)
  ) {
    return undefined;
  }

  const clauseStart = directiveClauseStart(text, actionOffset);
  if (
    predicateOffsets.some(
      (offset) => offset >= clauseStart && offset < actionOffset,
    )
  ) {
    return undefined;
  }

  const prefix = text.slice(clauseStart, actionOffset).trim();
  if (prefix.length === 0) {
    return { kind: "imperative-head", actionOffset, clauseStart };
  }
  if (prefixPrecludesAnyDirective(prefix)) return undefined;

  const actorModal = ACTOR_MODAL_PREFIX_RE.exec(prefix);
  if (actorModal !== null) {
    const modifier = actorModal.groups?.modifier?.trim() ?? "";
    if (modifierIsStructurallyEligible(modifier)) {
      return { kind: "actor-modal", actionOffset, clauseStart };
    }
    return undefined;
  }

  if (EXPLICIT_NOMINAL_SUBJECT_PREFIX_RE.test(prefix)) return undefined;
  if (modifierIsStructurallyEligible(prefix)) {
    return { kind: "imperative-head", actionOffset, clauseStart };
  }
  return undefined;
}

function directiveClauseStart(text: string, actionOffset: number): number {
  let start = 0;
  for (let index = 0; index < actionOffset; index += 1) {
    if (quotePairEnclosesOffset(text, index)) continue;
    if (/[\n,;!?]/u.test(text[index] ?? "")) start = index + 1;
  }
  const container = MARKDOWN_LIST_CONTAINER_RE.exec(
    text.slice(start, actionOffset),
  );
  return start + (container?.[0].length ?? 0);
}

function prefixPrecludesAnyDirective(prefix: string): boolean {
  return (
    CONDITIONAL_OR_SUBORDINATE_PREDICATE_START_RE.test(prefix) ||
    DESCRIPTIVE_SUBJECT_BRIDGE_RE.test(prefix) ||
    DIRECT_PROHIBITION_PREFIX_RE.test(prefix) ||
    NON_DIRECTIVE_PREFIX_SYNTAX_RE.test(prefix)
  );
}

function modifierIsStructurallyEligible(modifier: string): boolean {
  if (modifier.length === 0) return true;
  if (
    prefixPrecludesAnyDirective(modifier) ||
    EXPLICIT_NOMINAL_SUBJECT_PREFIX_RE.test(modifier)
  ) {
    return false;
  }
  const tokens = modifier.match(/[\p{L}\p{N}_'-]+/gu) ?? [];
  if (tokens.length === 0) return false;
  return !tokens.some(
    (token) =>
      INFLECTED_PREDICATE_TOKEN_RE.test(token) && !token.endsWith("ly"),
  );
}
