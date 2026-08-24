import {
  BODY_SECRET_TARGET_TERMS,
  EXTERNAL_UPLOAD_ACTION_TERMS,
  WORKFLOW_SCOPE_TERMS,
} from "../security-prose-vocabulary.js";
import type {
  BodyPolicyDomain,
  LexicalCandidate,
  ModalNegationForm,
  ModalNegationSyntax,
  ModalNegationWord,
  PatternProvenance,
  SourceRange,
} from "./model.js";

/** Bounded lexical forms only; semantic eligibility remains in clause-facts. */
export const NETWORK_SUBJECT = String.raw`(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?`;
const UPLOAD_SUBJECT = String.raw`(?:external\s+)?uploads?`;
const SECRET_ACCESS_SUBJECT = String.raw`(?:(?:secret|credential|token|password|private[- ]key)\s+(?:access|use|usage)|${BODY_SECRET_TARGET_TERMS})`;
export const SECRET_EVIDENCE = String.raw`(?<![A-Za-z0-9_])(?:${BODY_SECRET_TARGET_TERMS})\b`;
const MODAL_WORD = String.raw`(?:must|shall|will|should|would|may|might|can|could)`;
const MODAL_NEVER = String.raw`${MODAL_WORD}[ \t]+never`;
const MODAL_NOT = String.raw`${MODAL_WORD}[ \t]+not`;
const MODAL_NEGATION_RE = new RegExp(
  String.raw`\b(?<modal>must|shall|will|should|would|may|might|can|could)[ \t]+(?:(?<never>never)\b|not\b(?<after>[^.!?\n]{0,48}))`,
  "i",
);
const FINITE_EXTERNAL_UPLOAD_ACTION = String.raw`(?:uploads|sends|posts|shares|attaches|submits|syncs|pushes|publishes)`;
const FINITE_SECRET_ACTION = String.raw`(?:accesses|reads|loads|uses|accepts|handles)`;

export const DOMAIN_EVIDENCE_PATTERNS = {
  network:
    /\b(?:(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?|offline|air[- ]gapped)\b/i,
  upload:
    /\b(?:uploads?|uploading|uploaded|send|post|share|attach|submit|sync|push|publish)\b/i,
  secrets: new RegExp(SECRET_EVIDENCE, "i"),
} satisfies Record<BodyPolicyDomain, RegExp>;

export const NO_REQUIREMENT_PATTERNS = {
  network: noRequirementPatterns(NETWORK_SUBJECT),
  upload: noRequirementPatterns(UPLOAD_SUBJECT),
  secrets: noRequirementPatterns(SECRET_ACCESS_SUBJECT),
} satisfies Record<BodyPolicyDomain, readonly RegExp[]>;

export const AFFIRMATIVE_REQUIREMENT_PATTERNS = {
  network: affirmativeRequirementPatterns(NETWORK_SUBJECT),
  upload: affirmativeRequirementPatterns(UPLOAD_SUBJECT),
  secrets: affirmativeRequirementPatterns(SECRET_ACCESS_SUBJECT),
} satisfies Record<BodyPolicyDomain, readonly RegExp[]>;

export const PROHIBITED_PATTERNS = {
  network: [
    /\b(?:no|without)\s+(?:(?:any|all)\s+)?(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\b(?!\s+(?:access|use|usage|connectivity|to)\b)/i,
    new RegExp(
      String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|avoid|exclude|disallow|forbid|block)[ \t]+(?:(?:all|any)[ \t]+)?(?:(?:use|allow|permit)[ \t]+)?(?:the[ \t]+)?(?:external[ \t]+)?(?:network|internet)(?:[ \t]+(?:access|use|usage|connectivity))?\b(?![ \t]+(?:access|use|usage|connectivity|to)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\bnever[ \t]+(?:uses|accesses)[ \t]+(?:(?:any|all|the)[ \t]+)?(?:external[ \t]+)?(?:network|internet)(?:[ \t]+(?:access|use|usage|connectivity))?\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\s+(?:(?:is|are)\s+(?:not\s+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled)|${MODAL_NOT}[ \t]+be[ \t]+(?:used|allowed|permitted|available|enabled))\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:allow|permit)\s+(?:any|all)\s+(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\b[^.!?\n]{0,40}\b(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,80}\b(?:(?:${MODAL_NEVER}|${MODAL_NOT}|(?:does|do)[ \t]+not|cannot|can't|never)[ \t]+(?:use|access)|never[ \t]+(?:uses|accesses))[ \t]+(?:(?:any|all|the)[ \t]+)?(?:external[ \t]+)?(?:network|internet)(?:[ \t]+(?:access|use|usage|connectivity))?\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,40}\b(?:must|shall|will|has\s+to|needs\s+to)\s+(?:run|operate|work)\s+(?:(?:entirely|completely)\s+)?(?:offline|air[- ]gapped)\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:keep|run|operate)\s+${WORKFLOW_SCOPE_TERMS}\s+(?:(?:entirely|completely)\s+)?(?:offline|air[- ]gapped)\b`,
      "i",
    ),
  ],
  upload: [
    /\b(?:no|without)\s+(?:(?:any|all)\s+)?(?:external\s+)?uploads\b(?!\s+(?:to|into|onto|of|from|with|containing)\b)/i,
    new RegExp(
      String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|avoid|exclude|disallow|forbid|block)[ \t]+(?:perform|allow|permit|make)[ \t]+(?:(?:(?:any|all)[ \t]+)?external[ \t]+uploads?|(?:any|all)[ \t]+uploads?|uploads)\b(?![ \t]+(?:to|into|onto|of|from|with|containing)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|avoid|exclude|disallow|forbid|block)[ \t]+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})[ \t]+(?:(?:anything|everything)(?:[ \t]+externally)?|externally)\b(?![ \t]+(?:to|into|onto|of|from|with|containing)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:(?:${MODAL_NEVER}|never)[ \t]+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})|never[ \t]+${FINITE_EXTERNAL_UPLOAD_ACTION})[ \t]+(?:files?|artifacts?|data)\b(?![ \t]+(?:to|into|onto|of|from|with|containing)\b)`,
      "i",
    ),
    /\b(?:(?:all|any)\s+)?(?:external\s+)?uploads?\s+(?:are|is)\s+(?:not\s+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled)\b/i,
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,80}\b(?:${MODAL_NEVER}|${MODAL_NOT}|does[ \t]+not|cannot|can't|never)[ \t]+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})[ \t]+(?:(?:anything|everything)(?:[ \t]+externally)?|externally)\b(?![ \t]+(?:to|into|onto|of|from|with|containing)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,80}\b(?:(?:${MODAL_NEVER}|${MODAL_NOT}|does[ \t]+not|cannot|can't|never)[ \t]+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})|never[ \t]+${FINITE_EXTERNAL_UPLOAD_ACTION})[ \t]+(?:files?|artifacts?|data)\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})\s+(?:any\s+|all\s+)?files?\s+externally\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:(?:all|any)\s+)?(?:external\s+)?uploads?\s+${MODAL_NOT}\s+be\s+(?:performed|made|allowed|permitted|available)(?:\s+(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b)?`,
      "i",
    ),
  ],
  secrets: [
    new RegExp(
      String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|avoid|exclude|disallow|forbid|block)[ \t]+(?:access|read|load|use|accept|handle)[ \t]+(?:any[ \t]+)?(?:${BODY_SECRET_TARGET_TERMS})\b(?![ \t]+(?:from|through|via)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\bnever[ \t]+${FINITE_SECRET_ACTION}[ \t]+(?:any[ \t]+)?(?:${BODY_SECRET_TARGET_TERMS})\b(?![ \t]+(?:from|through|via)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\bwithout\s+(?:(?:any|all)\s+)?(?:(?:access|permission)\s+to\s+|(?:the\s+)?use\s+of\s+)(?:${BODY_SECRET_TARGET_TERMS})\b(?!\s+(?:from|through|via)\b)`,
      "i",
    ),
    /\bno\s+(?:secret|credential|token|password|private[- ]key)\s+(?:access|use|usage)\b/i,
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,80}\b(?:(?:${MODAL_NEVER}|${MODAL_NOT}|does[ \t]+not|cannot|can't|never)[ \t]+(?:access|read|load|use|accept|handle)|never[ \t]+${FINITE_SECRET_ACTION})[ \t]+(?:any[ \t]+)?(?:${BODY_SECRET_TARGET_TERMS})\b(?![ \t]+(?:from|through|via)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:access|read|load|use|accept|handle)\s+(?:any\s+)?(?:${BODY_SECRET_TARGET_TERMS})\b[^.!?\n]{0,40}\b(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:${BODY_SECRET_TARGET_TERMS})\s+(?:are|is)\s+(?:not\s+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled)(?:\s+(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS})?(?=[.!?]|$)`,
      "i",
    ),
    new RegExp(
      String.raw`\bno\s+(?:${BODY_SECRET_TARGET_TERMS})\s+(?:are|is)\s+(?:allowed|permitted|available)(?:\s+(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS})?(?=[.!?]|$)`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,50}\bwithout\s+(?:any\s+)?(?:${BODY_SECRET_TARGET_TERMS})\b(?!\s+(?:from|through|via)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:${BODY_SECRET_TARGET_TERMS})\s+${MODAL_NOT}\s+be\s+(?:accessed|read|loaded|used|accepted|handled|allowed|permitted|available)(?:\s+(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b)?`,
      "i",
    ),
    new RegExp(
      String.raw`\bno\s+(?:${BODY_SECRET_TARGET_TERMS})\s+(?:may|must|should|can)\s+be\s+(?:accessed|read|loaded|used|accepted|handled)\s+(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b`,
      "i",
    ),
  ],
} satisfies Record<BodyPolicyDomain, readonly RegExp[]>;

export const GENERIC_PROHIBITION_PATTERNS = {
  network: new RegExp(
    String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|${MODAL_NOT}|never|cannot|can't|forbidden|not[ \t]+allowed|no)\b[^.!?\n]{0,100}?\b${NETWORK_SUBJECT}\b`,
    "i",
  ),
  upload: new RegExp(
    String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|${MODAL_NOT}|never|cannot|can't|forbidden|not[ \t]+allowed|no)\b[^.!?\n]{0,100}?\b(?:uploads?|uploading|uploaded)\b`,
    "i",
  ),
  secrets: new RegExp(
    String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|${MODAL_NOT}|never|cannot|can't|forbidden|not[ \t]+allowed|no)\b[^.!?\n]{0,100}?${SECRET_EVIDENCE}`,
    "i",
  ),
} satisfies Record<BodyPolicyDomain, RegExp>;

export const NO_ALLOWANCE_SUFFIX_RE =
  /^[ \t]+(?:is|are|was|were)[ \t]+(?:allowed|permitted|available)\b/i;
const SCOPE_QUALIFIER_PREFIX = String.raw`[ \t]+(?:for|throughout|during|within|in)[ \t]+`;
export const WORKFLOW_SCOPE_QUALIFIER_RE = new RegExp(
  String.raw`^${SCOPE_QUALIFIER_PREFIX}${WORKFLOW_SCOPE_TERMS}\b`,
  "i",
);
const LOCAL_SCOPE_TERMS = String.raw`(?:local[ \t]+(?:setup|installation|validation|run|mode|step|phase|command)|(?:(?:this|the|a|an)[ \t]+)?(?:setup|installation|validation|command|step|phase)(?:[ \t]+(?:step|phase))?)`;
export const LOCAL_SCOPE_QUALIFIER_RE = new RegExp(
  String.raw`^${SCOPE_QUALIFIER_PREFIX}${LOCAL_SCOPE_TERMS}\b`,
  "i",
);
export const UNKNOWN_SCOPE_QUALIFIER_RE = new RegExp(
  String.raw`^${SCOPE_QUALIFIER_PREFIX}`,
  "i",
);
export const REQUIREMENT_WORKFLOW_SCOPE_RE = new RegExp(
  String.raw`^[ \t]+(?:by|for|throughout|during|within|in)[ \t]+${WORKFLOW_SCOPE_TERMS}\b`,
  "i",
);
export const TRIVIAL_REMAINDER_RE =
  /^[ \t]*(?:[.!?…]+)?[)"'\]}>*_~`\\]*[ \t]*$/u;
export const WORKFLOW_SCOPE_RE = new RegExp(
  String.raw`\b${WORKFLOW_SCOPE_TERMS}\b`,
  "i",
);
export const LOCAL_SCOPE_RE = new RegExp(
  String.raw`\b${LOCAL_SCOPE_TERMS}\b`,
  "i",
);
export const NOT_REQUIREMENT_PREDICATE_RE =
  /\b(?:does\s+not\s+require|(?:is|are|was|were)\s+(?:not\s+(?:required|needed|necessary)|unnecessary|optional)|(?:should|will|would|may)\s+not\s+be\s+(?:required|needed|necessary)|no\s+requirement|no)\b/gi;
export const AFFIRMATIVE_REQUIREMENT_PREDICATE_RE =
  /\b(?:requires|(?:is|are|was|were)\s+(?:required|needed|necessary)|(?:should|will|would|may)\s+be\s+(?:required|needed|necessary))\b/gi;
export const PROHIBITION_PREDICATE_RE = new RegExp(
  String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|${MODAL_NOT}|never|does[ \t]+not|cannot|can't|not[ \t]+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled|without|no|(?:must|shall|will|has[ \t]+to|needs[ \t]+to)[ \t]+(?:run|operate|work)(?:[ \t]+without)?|keep|run|operate)\b`,
  "gi",
);
const STATEMENT_SHORT_MODIFIER = String.raw`(?:also|still|therefore|always|explicitly|directly|strictly|categorically)`;
const SUBJECTLESS_AUXILIARY_HEAD = String.raw`(?:is|are|was|were|has|have|had|does|do|did|will|would|shall|should|can|could|may|might|must|cannot|can't|needs|requires)`;
const SUBJECTLESS_ORDINARY_VERB_HEAD = String.raw`(?:accepts?|adapts?|analyzes?|applies|audits?|builds?|checks?|classifies|collects?|compares?|compiles?|completes?|configures?|creates?|detects?|documents?|emits?|evaluates?|executes?|generates?|handles?|inspects?|loads?|logs?|maps?|normalizes?|parses?|prepares?|processes|produces?|reads?|records?|reports?|resolves?|reviews?|runs?|scans?|selects?|stores?|summarizes?|tracks?|transforms?|updates?|uses?|validates?|verifies|writes?)`;
const SUBJECTLESS_POLICY_VERB_HEAD = String.raw`(?:never|no|without|don't|keep|operates?|works?|access(?:es)?|attach(?:es)?|handles?|loads?|posts?|publish(?:es)?|push(?:es)?|reads?|sends?|shares?|submits?|syncs?|uploads?|uses?)`;
const SUBJECTLESS_PREDICATE_HEAD = String.raw`(?:${SUBJECTLESS_AUXILIARY_HEAD}|${SUBJECTLESS_ORDINARY_VERB_HEAD}|${SUBJECTLESS_POLICY_VERB_HEAD})`;
const SUBJECTLESS_PREDICATE_PREFIX = String.raw`(?:[ \t]*(?:,[ \t]*)?)(?:(?:it|${STATEMENT_SHORT_MODIFIER})[ \t]+){0,4}`;
export const ORDINARY_STATEMENT_SEPARATOR_RE =
  /(?:,[ \t]*and\b|[ \t]+and\b|,)(?=[ \t]+)/gi;
export const INHERITED_STATEMENT_SEPARATOR_RE = new RegExp(
  String.raw`^[ \t]*(?:(?:,[ \t]*)?and|,|(?:,[ \t]*)?(?:but|yet|however[ \t]*,?)|;[ \t]*however[ \t]*,|;|(?:,[ \t]*)?then)[ \t]*$`,
  "i",
);
export const SUBJECTLESS_PREDICATE_START_RE = new RegExp(
  String.raw`^${SUBJECTLESS_PREDICATE_PREFIX}${SUBJECTLESS_PREDICATE_HEAD}\b`,
  "i",
);
export const EXPLICIT_SUPPORTED_PREDICATE_PREFIX_START_RE = new RegExp(
  String.raw`^[ \t]*(?:,[ \t]*)?(?:(?:it)[ \t]+)?(?:${MODAL_NEVER}|(?:${STATEMENT_SHORT_MODIFIER})[ \t]+(?:(?:(?:it|${STATEMENT_SHORT_MODIFIER})[ \t]+){0,3}${SUBJECTLESS_PREDICATE_HEAD})\b)`,
  "i",
);
export const CONDITIONAL_OR_SUBORDINATE_PREDICATE_START_RE =
  /^[ \t]*(?:if|unless|when|whenever|while|although|because|before|after|once|whereas|despite|provided|assuming)\b/i;
export const EXPLICIT_CHANGED_SUBJECT_START_RE = new RegExp(
  String.raw`^[ \t]*(?:(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+)?[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3}[ \t]+${SUBJECTLESS_PREDICATE_HEAD}\b`,
  "i",
);
export const STRONG_CHANGED_SUBJECT_START_RE = new RegExp(
  String.raw`^[ \t]*(?!(?:it|${STATEMENT_SHORT_MODIFIER})\b)(?:(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+)?[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3}[ \t]+(?:${SUBJECTLESS_AUXILIARY_HEAD}|requires?|needs?|contains?|includes?|never)\b`,
  "i",
);
export const SECURITY_ACTION_CHANGED_SUBJECT_START_RE = new RegExp(
  String.raw`^[ \t]*(?!(?:it|${STATEMENT_SHORT_MODIFIER}|must|shall|will|should|would|may|might|can|could|does|do|did|cannot|can't|never|no|without)\b)(?:(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+)?[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3}?[ \t]+(?:(?:uses?|access(?:es)?)[ \t]+(?:(?:the|any|all)[ \t]+)?(?:${NETWORK_SUBJECT}|${BODY_SECRET_TARGET_TERMS})|(?:uploads?|sends?|shares?|attach(?:es)?|publish(?:es)?|syncs?)[ \t]+(?:(?:any|all|the)[ \t]+)?(?:files?|artifacts?|data|reports?|(?:${BODY_SECRET_TARGET_TERMS})))\b`,
  "i",
);
export const DOMAIN_PREDICATE_START_RE = new RegExp(
  String.raw`^[ \t]*(?:,[ \t]*)?(?:(?:${STATEMENT_SHORT_MODIFIER})[ \t]+)*(?:${NETWORK_SUBJECT}|${UPLOAD_SUBJECT}|${SECRET_ACCESS_SUBJECT})[ \t]+(?:(?:is|are|was|were)[ \t]+|(?:must|shall|should|may|can|will|would)[ \t]+)`,
  "i",
);
export const LEADING_WORKFLOW_SUBJECT_RE = new RegExp(
  String.raw`^[ \t]*(?:,[ \t]*)?(?:(?:${STATEMENT_SHORT_MODIFIER})[ \t]+)*(?<subject>${WORKFLOW_SCOPE_TERMS})\b`,
  "i",
);
export const DIRECT_SUBJECT_SHORT_MODIFIER_RE = new RegExp(
  String.raw`^(?:(?:it|${STATEMENT_SHORT_MODIFIER}|may|might|can|could|should|would|will|shall)[ \t]+)`,
  "i",
);
export const DIRECT_SUBJECT_OFFLINE_AUXILIARY_RE =
  /^(?:(?:must|shall|will|has[ \t]+to|needs[ \t]+to)[ \t]+)?(?:run|operate|work)[ \t]+/i;
export const DIRECT_SUBJECT_PUNCTUATION_RE = /^(?::|--?|[–—])[ \t]*/u;
export const DIRECT_SUBJECT_RELATIVE_MODIFIER_RE = new RegExp(
  String.raw`^(?:that|which)[ \t]+${SUBJECTLESS_PREDICATE_HEAD}\b(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,5}`,
  "i",
);
export const PAIRED_OBJECT_RELATIVE_MODIFIER_RE = new RegExp(
  String.raw`^(?:that|which)[ \t]+(?:(?:the|a|an|this|that|these|those|each|every|another)[ \t]+)?[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3}?[ \t]+(?:${SUBJECTLESS_PREDICATE_HEAD}|says?|states?|documents?|describes?|quotes?|notes?|explains?|mentions?|reports?|shows?|lists?)\b(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,8}$`,
  "i",
);
export const DIRECT_SUBJECT_PARENTHETICAL_RE =
  /^\((?<content>[^()"'\n]{1,64})\)/u;
export const DIRECT_SUBJECT_PAIRED_COMMA_MODIFIER_RE =
  /^,[ \t]*(?<content>[^,()"'\n]{1,80}?)[ \t]*,[ \t]*/u;
export const DESCRIPTIVE_SUBJECT_BRIDGE_RE =
  /\b(?:says?|states?|documents?|describes?|quotes?|notes?|explains?|mentions?|reports?|shows?|lists?)\b/i;
export const CONDITIONAL_SUBJECT_BRIDGE_RE =
  /\b(?:if|unless|when|whenever|while|although|because|before|after|once|whereas|provided|assuming)\b/i;
export const CHANGED_SUBJECT_BRIDGE_RE =
  /\b(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,2}[ \t]*$/i;
export const SUPPORTED_POLICY_LABEL_PREFIX_RE =
  /^(?:policy|requirement)[ \t]*:[ \t]*$/i;
export const SUPPORTED_DIRECTIVE_PREFIX_RE =
  /^(?:please|for[ \t]+safety|as[ \t]+a[ \t]+rule|(?:please[ \t]+)?ensure(?:[ \t]+that)?|make[ \t]+sure(?:[ \t]+that)?)[ \t]*[:,–—-]?[ \t]*$/iu;
export const SUPPORTED_COMPOSED_DIRECTIVE_PREFIX_RE =
  /^(?:for[ \t]+safety|as[ \t]+a[ \t]+rule)[ \t]*,[ \t]*(?:please(?:[ \t]+ensure(?:[ \t]+that)?)?|ensure(?:[ \t]+that)?|make[ \t]+sure(?:[ \t]+that)?)[ \t]*[:,–—-]?[ \t]*$/iu;
export const SUPPORTED_COMPOSED_PREFIX_RE = new RegExp(
  String.raw`^(?:(?<label>(?:policy|requirement)[ \t]*:[ \t]*))?(?:(?<directive>(?:(?:for[ \t]+safety|as[ \t]+a[ \t]+rule)[ \t]*,[ \t]*(?:(?:please)(?:[ \t]+ensure(?:[ \t]+that)?)?|ensure(?:[ \t]+that)?|make[ \t]+sure(?:[ \t]+that)?)|(?:for[ \t]+safety|as[ \t]+a[ \t]+rule)|(?:please)(?:[ \t]+ensure(?:[ \t]+that)?)?|ensure(?:[ \t]+that)?|make[ \t]+sure(?:[ \t]+that)?)[ \t]*[:,–—-]?[ \t]*))?$`,
  "iu",
);

/** @internal Return bounded lexical candidates without semantic eligibility. */
export function recognizeCandidateRanges(
  text: string,
  patterns: readonly RegExp[],
  provenance: PatternProvenance,
): readonly LexicalCandidate[] {
  const candidates: LexicalCandidate[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      if (match.index === undefined || match[0].length === 0) continue;
      candidates.push({
        provenance,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return candidates;
}

/** @internal Match physical evidence without assigning policy meaning. */
export function recognizeEvidenceRange(
  text: string,
  pattern: RegExp,
): SourceRange | undefined {
  const match = pattern.exec(text);
  if (match?.index === undefined) return undefined;
  return { start: match.index, end: match.index + match[0].length };
}

/** @internal Parse modal-negation syntax independently from modal meaning. */
export function recognizeModalNegation(
  text: string,
): ModalNegationSyntax | undefined {
  const match = MODAL_NEGATION_RE.exec(text);
  const word = match?.groups?.modal?.toLowerCase() as
    ModalNegationWord | undefined;
  if (word === undefined) return undefined;
  const after = match?.groups?.after?.trimStart() ?? "";
  const form: ModalNegationForm =
    match?.groups?.never !== undefined
      ? "never"
      : /^be[ \t]+(?:available|enabled|capable)\b/i.test(after)
        ? "availability-state"
        : /^be[ \t]+(?:allowed|permitted)\b/i.test(after)
          ? "permission-state"
          : /^be[ \t]+(?:used|performed|made|accessed|read|loaded|accepted|handled)\b/i.test(
                after,
              )
            ? "passive-action"
            : "active-action";
  return { word, form };
}

function noRequirementPatterns(subject: string): readonly RegExp[] {
  return [
    new RegExp(
      String.raw`(?<![A-Za-z0-9_])no[ \t]+${subject}[ \t]+(?:(?:is|are|was|were)[ \t]+(?:not[ \t]+)?(?:required|needed|necessary|unnecessary|optional)|(?:should|will|would|may)[ \t]+(?:not[ \t]+)?be[ \t]+(?:required|needed|necessary))\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b${subject}[ \t]+(?:(?:is|are|was|were)[ \t]+(?:(?:not[ \t]+(?:required|needed|necessary))|unnecessary|optional)|(?:should|will|would|may)[ \t]+not[ \t]+be[ \t]+(?:required|needed|necessary))\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:there[ \t]+is[ \t]+)?no[ \t]+requirement[ \t]+for[ \t]+${subject}\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}[ \t]+does[ \t]+not[ \t]+require[ \t]+${subject}\b`,
      "i",
    ),
  ];
}

function affirmativeRequirementPatterns(subject: string): readonly RegExp[] {
  return [
    new RegExp(
      String.raw`\b${subject}[ \t]+(?:(?:is|are|was|were)[ \t]+(?:required|needed|necessary)|(?:should|will|would|may)[ \t]+be[ \t]+(?:required|needed|necessary))\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}[ \t]+requires[ \t]+${subject}\b`,
      "i",
    ),
  ];
}
