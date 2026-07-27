import {
  BODY_SECRET_TARGET_TERMS,
  EXTERNAL_UPLOAD_ACTION_TERMS,
  WORKFLOW_SCOPE_TERMS,
} from "../security-prose-vocabulary.js";

export type BodyPolicyDomain = "network" | "upload" | "secrets";

export type BodyPolicyModality =
  | "prohibited"
  | "not-required"
  | "local-safeguard"
  | "unknown";

export type BodyPolicyScope =
  | "workflow"
  | "local-step"
  | "specific-target"
  | "specific-source"
  | "unknown";

export interface BodyPolicyClauseFacts {
  readonly domain: BodyPolicyDomain | undefined;
  readonly modality: BodyPolicyModality;
  readonly scope: BodyPolicyScope;
  readonly completeness: "complete" | "unsupported-remainder";
  readonly evidenceStart: number;
  readonly evidenceEnd: number;
}

interface EvidenceRange {
  readonly start: number;
  readonly end: number;
}

interface ScopeClassification {
  readonly scope: BodyPolicyScope;
  readonly supportedEnd: number;
}

type DomainCandidateKind =
  | "not-required"
  | "affirmative-requirement"
  | "supported-prohibition"
  | "generic-prohibition";

interface DomainCandidate extends EvidenceRange {
  readonly kind: DomainCandidateKind;
  readonly predicateStart: number;
  readonly directWorkflowSubject: EvidenceRange | undefined;
}

const DOMAIN_ORDER: readonly BodyPolicyDomain[] = [
  "network",
  "upload",
  "secrets",
];

const NETWORK_SUBJECT = String.raw`(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?`;
const UPLOAD_SUBJECT = String.raw`(?:external\s+)?uploads?`;
const SECRET_ACCESS_SUBJECT = String.raw`(?:(?:secret|credential|token|password|private[- ]key)\s+(?:access|use|usage)|${BODY_SECRET_TARGET_TERMS})`;
const SECRET_EVIDENCE = String.raw`(?<![A-Za-z0-9_])(?:${BODY_SECRET_TARGET_TERMS})\b`;
const MODAL_NEVER = String.raw`(?:must|shall|will|should|would|may|might|can|could)[ \t]+never`;

const DOMAIN_EVIDENCE_PATTERNS = {
  network:
    /\b(?:(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?|offline|air[- ]gapped)\b/i,
  upload:
    /\b(?:uploads?|uploading|uploaded|send|post|share|attach|submit|sync|push|publish)\b/i,
  secrets: new RegExp(SECRET_EVIDENCE, "i"),
} satisfies Record<BodyPolicyDomain, RegExp>;

const NO_REQUIREMENT_PATTERNS = {
  network: noRequirementPatterns(NETWORK_SUBJECT),
  upload: noRequirementPatterns(UPLOAD_SUBJECT),
  secrets: noRequirementPatterns(SECRET_ACCESS_SUBJECT),
} satisfies Record<BodyPolicyDomain, readonly RegExp[]>;

const AFFIRMATIVE_REQUIREMENT_PATTERNS = {
  network: affirmativeRequirementPatterns(NETWORK_SUBJECT),
  upload: affirmativeRequirementPatterns(UPLOAD_SUBJECT),
  secrets: affirmativeRequirementPatterns(SECRET_ACCESS_SUBJECT),
} satisfies Record<BodyPolicyDomain, readonly RegExp[]>;

const PROHIBITED_PATTERNS = {
  network: [
    /\b(?:no|without)\s+(?:(?:any|all)\s+)?(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\b(?!\s+(?:access|use|usage|connectivity|to)\b)/i,
    new RegExp(
      String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|avoid|exclude|disallow|forbid|block)[ \t]+(?:(?:all|any)[ \t]+)?(?:(?:use|allow|permit)[ \t]+)?(?:the[ \t]+)?(?:external[ \t]+)?(?:network|internet)(?:[ \t]+(?:access|use|usage|connectivity))?\b(?![ \t]+(?:access|use|usage|connectivity|to)\b)`,
      "i",
    ),
    /\b(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\s+(?:(?:is|are)\s+(?:not\s+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled)|(?:must|may|should)\s+not\s+be\s+(?:used|available|enabled))\b/i,
    new RegExp(
      String.raw`\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:allow|permit)\s+(?:any|all)\s+(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\b[^.!?\n]{0,40}\b(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,80}\b(?:${MODAL_NEVER}|(?:must|shall|will|does|do)[ \t]+not|cannot|can't|never)[ \t]+(?:use|access)[ \t]+(?:(?:any|all|the)[ \t]+)?(?:external[ \t]+)?(?:network|internet)(?:[ \t]+(?:access|use|usage|connectivity))?\b`,
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
    /\b(?:(?:all|any)\s+)?(?:external\s+)?uploads?\s+(?:are|is)\s+(?:not\s+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled)\b/i,
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,80}\b(?:${MODAL_NEVER}|(?:must|shall|will|does)[ \t]+not|cannot|can't|never)[ \t]+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})[ \t]+(?:(?:anything|everything)(?:[ \t]+externally)?|externally)\b(?![ \t]+(?:to|into|onto|of|from|with|containing)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,80}\b(?:${MODAL_NEVER}|(?:must|shall|will|does)[ \t]+not|cannot|can't|never)[ \t]+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})[ \t]+(?:files?|artifacts?|data)\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})\s+(?:any\s+|all\s+)?files?\s+externally\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:(?:all|any)\s+)?(?:external\s+)?uploads?\s+(?:must|shall|should|may)\s+not\s+be\s+(?:performed|made|allowed|permitted)\s+(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b`,
      "i",
    ),
  ],
  secrets: [
    new RegExp(
      String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|avoid|exclude|disallow|forbid|block)[ \t]+(?:access|read|load|use|accept|handle)[ \t]+(?:any[ \t]+)?(?:${BODY_SECRET_TARGET_TERMS})\b(?![ \t]+(?:from|through|via)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\bwithout\s+(?:(?:any|all)\s+)?(?:(?:access|permission)\s+to\s+|(?:the\s+)?use\s+of\s+)(?:${BODY_SECRET_TARGET_TERMS})\b(?!\s+(?:from|through|via)\b)`,
      "i",
    ),
    /\bno\s+(?:secret|credential|token|password|private[- ]key)\s+(?:access|use|usage)\b/i,
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,80}\b(?:${MODAL_NEVER}|(?:must|shall|will|does)[ \t]+not|cannot|can't|never)[ \t]+(?:access|read|load|use|accept|handle)[ \t]+(?:any[ \t]+)?(?:${BODY_SECRET_TARGET_TERMS})\b(?![ \t]+(?:from|through|via)\b)`,
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
      String.raw`\b(?:${BODY_SECRET_TARGET_TERMS})\s+(?:must|shall|should|may)\s+not\s+be\s+(?:accessed|read|loaded|used|accepted|handled)\s+(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b`,
      "i",
    ),
    new RegExp(
      String.raw`\bno\s+(?:${BODY_SECRET_TARGET_TERMS})\s+(?:may|must|should|can)\s+be\s+(?:accessed|read|loaded|used|accepted|handled)\s+(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b`,
      "i",
    ),
  ],
} satisfies Record<BodyPolicyDomain, readonly RegExp[]>;

const GENERIC_PROHIBITION_PATTERNS = {
  network: new RegExp(
    String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|must[ \t]+not|cannot|can't|forbidden|not[ \t]+allowed|no)\b[^.!?\n]{0,100}?\b${NETWORK_SUBJECT}\b`,
    "i",
  ),
  upload: new RegExp(
    String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|must[ \t]+not|cannot|can't|forbidden|not[ \t]+allowed|no)\b[^.!?\n]{0,100}?\b(?:uploads?|uploading|uploaded)\b`,
    "i",
  ),
  secrets: new RegExp(
    String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|must[ \t]+not|cannot|can't|forbidden|not[ \t]+allowed|no)\b[^.!?\n]{0,100}?${SECRET_EVIDENCE}`,
    "i",
  ),
} satisfies Record<BodyPolicyDomain, RegExp>;

const NO_ALLOWANCE_SUFFIX_RE =
  /^[ \t]+(?:is|are|was|were)[ \t]+(?:allowed|permitted|available)\b/i;
const SCOPE_QUALIFIER_PREFIX = String.raw`[ \t]+(?:for|throughout|during|within|in)[ \t]+`;
const WORKFLOW_SCOPE_QUALIFIER_RE = new RegExp(
  String.raw`^${SCOPE_QUALIFIER_PREFIX}${WORKFLOW_SCOPE_TERMS}\b`,
  "i",
);
const LOCAL_SCOPE_TERMS = String.raw`(?:local[ \t]+(?:setup|installation|validation|run|mode|step|phase|command)|(?:(?:this|the|a|an)[ \t]+)?(?:setup|installation|validation|command|step|phase)(?:[ \t]+(?:step|phase))?)`;
const LOCAL_SCOPE_QUALIFIER_RE = new RegExp(
  String.raw`^${SCOPE_QUALIFIER_PREFIX}${LOCAL_SCOPE_TERMS}\b`,
  "i",
);
const UNKNOWN_SCOPE_QUALIFIER_RE = new RegExp(
  String.raw`^${SCOPE_QUALIFIER_PREFIX}`,
  "i",
);
const REQUIREMENT_WORKFLOW_SCOPE_RE = new RegExp(
  String.raw`^[ \t]+(?:by|for|throughout|during|within|in)[ \t]+${WORKFLOW_SCOPE_TERMS}\b`,
  "i",
);
const TRIVIAL_REMAINDER_RE = /^[ \t]*(?:[.!?…]+)?[)"'\]}>*_~`\\]*[ \t]*$/u;
const WORKFLOW_SCOPE_RE = new RegExp(
  String.raw`\b${WORKFLOW_SCOPE_TERMS}\b`,
  "i",
);
const LOCAL_SCOPE_RE = new RegExp(String.raw`\b${LOCAL_SCOPE_TERMS}\b`, "i");
const NOT_REQUIREMENT_PREDICATE_RE =
  /\b(?:does\s+not\s+require|(?:is|are|was|were)\s+(?:not\s+(?:required|needed|necessary)|unnecessary|optional)|(?:should|will|would|may)\s+not\s+be\s+(?:required|needed|necessary)|no\s+requirement|no)\b/gi;
const AFFIRMATIVE_REQUIREMENT_PREDICATE_RE =
  /\b(?:requires|(?:is|are|was|were)\s+(?:required|needed|necessary)|(?:should|will|would|may)\s+be\s+(?:required|needed|necessary))\b/gi;
const PROHIBITION_PREDICATE_RE = new RegExp(
  String.raw`\b(?:do[ \t]+not|don't|${MODAL_NEVER}|never|must[ \t]+not|shall[ \t]+not|will[ \t]+not|does[ \t]+not|cannot|can't|not[ \t]+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled|without|no|(?:must|shall|will|has[ \t]+to|needs[ \t]+to)[ \t]+(?:run|operate|work)(?:[ \t]+without)?|keep|run|operate)\b`,
  "gi",
);
const STATEMENT_MODIFIER = String.raw`(?:also|still|therefore)`;
const SUBJECTLESS_AUXILIARY_HEAD = String.raw`(?:is|are|was|were|has|have|had|does|do|did|will|would|shall|should|can|could|may|might|must|cannot|can't|needs|requires)`;
const SUBJECTLESS_ORDINARY_VERB_HEAD = String.raw`(?:accepts?|adapts?|analyzes?|applies|audits?|builds?|checks?|classifies|collects?|compares?|compiles?|completes?|configures?|creates?|detects?|documents?|emits?|evaluates?|executes?|generates?|handles?|inspects?|loads?|logs?|maps?|normalizes?|parses?|prepares?|processes|produces?|reads?|records?|reports?|resolves?|reviews?|runs?|scans?|selects?|stores?|summarizes?|tracks?|transforms?|updates?|uses?|validates?|verifies|writes?)`;
const SUBJECTLESS_POLICY_VERB_HEAD = String.raw`(?:never|without|don't|keep|operates?|works?|access(?:es)?|attach(?:es)?|handles?|loads?|posts?|publish(?:es)?|push(?:es)?|reads?|sends?|shares?|submits?|syncs?|uploads?|uses?)`;
const SUBJECTLESS_PREDICATE_HEAD = String.raw`(?:${SUBJECTLESS_AUXILIARY_HEAD}|${SUBJECTLESS_ORDINARY_VERB_HEAD}|${SUBJECTLESS_POLICY_VERB_HEAD})`;
const SUBJECTLESS_PREDICATE_PREFIX = String.raw`(?:[ \t]*(?:,[ \t]*)?)(?:(?:it|${STATEMENT_MODIFIER})[ \t]+){0,4}`;
const ORDINARY_STATEMENT_SEPARATOR_RE =
  /(?:,[ \t]*and\b|[ \t]+and\b|,)(?=[ \t]+)/gi;
const INHERITED_STATEMENT_SEPARATOR_RE = new RegExp(
  String.raw`^[ \t]*(?:(?:,[ \t]*)?and|,|(?:,[ \t]*)?(?:but|yet|however[ \t]*,?)|;[ \t]*however[ \t]*,|;|then)[ \t]*$`,
  "i",
);
const SUBJECTLESS_PREDICATE_START_RE = new RegExp(
  String.raw`^${SUBJECTLESS_PREDICATE_PREFIX}${SUBJECTLESS_PREDICATE_HEAD}\b`,
  "i",
);
const CONDITIONAL_OR_SUBORDINATE_PREDICATE_START_RE =
  /^[ \t]*(?:if|unless|when|whenever|while|although|because|before|after|once|whereas|despite|provided|assuming)\b/i;
const EXPLICIT_CHANGED_SUBJECT_START_RE = new RegExp(
  String.raw`^[ \t]*(?:(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+)?[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3}[ \t]+${SUBJECTLESS_PREDICATE_HEAD}\b`,
  "i",
);
const STRONG_CHANGED_SUBJECT_START_RE = new RegExp(
  String.raw`^[ \t]*(?!(?:it|${STATEMENT_MODIFIER})\b)(?:(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+)?[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3}[ \t]+(?:${SUBJECTLESS_AUXILIARY_HEAD}|requires?|needs?|contains?|includes?|never)\b`,
  "i",
);
const DOMAIN_PREDICATE_START_RE = new RegExp(
  String.raw`^[ \t]*(?:,[ \t]*)?(?:(?:${STATEMENT_MODIFIER})[ \t]+)*(?:${NETWORK_SUBJECT}|${UPLOAD_SUBJECT}|${SECRET_ACCESS_SUBJECT})[ \t]+(?:(?:is|are|was|were)[ \t]+|(?:must|shall|should|may|can|will|would)[ \t]+)`,
  "i",
);
const LEADING_WORKFLOW_SUBJECT_RE = new RegExp(
  String.raw`^[ \t]*(?:,[ \t]*)?(?:(?:${STATEMENT_MODIFIER})[ \t]+)*(?<subject>${WORKFLOW_SCOPE_TERMS})\b`,
  "i",
);
const DIRECT_SUBJECT_SHORT_MODIFIER_RE = new RegExp(
  String.raw`^(?:(?:it|${STATEMENT_MODIFIER}|always|explicitly|directly|strictly|categorically|may|might|can|could|should|would|will|shall)[ \t]+)`,
  "i",
);
const DIRECT_SUBJECT_OFFLINE_AUXILIARY_RE =
  /^(?:(?:must|shall|will|has[ \t]+to|needs[ \t]+to)[ \t]+)?(?:run|operate|work)[ \t]+/i;
const DIRECT_SUBJECT_PUNCTUATION_RE = /^(?::|--?|[–—])[ \t]*/u;
const DIRECT_SUBJECT_RELATIVE_MODIFIER_RE = new RegExp(
  String.raw`^(?:that|which)[ \t]+${SUBJECTLESS_PREDICATE_HEAD}\b(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,5}`,
  "i",
);
const DIRECT_SUBJECT_PARENTHETICAL_RE = /^\((?<content>[^()"'\n]{1,64})\)/u;
const DIRECT_SUBJECT_PAIRED_COMMA_MODIFIER_RE =
  /^,[ \t]*(?<content>[^,()"'\n]{1,80}?)[ \t]*,[ \t]*/u;
const DESCRIPTIVE_SUBJECT_BRIDGE_RE =
  /\b(?:says?|states?|documents?|describes?|quotes?|notes?|explains?|mentions?|reports?|shows?|lists?)\b/i;
const CONDITIONAL_SUBJECT_BRIDGE_RE =
  /\b(?:if|unless|when|whenever|while|although|because|before|after|once|whereas|provided|assuming)\b/i;
const CHANGED_SUBJECT_BRIDGE_RE =
  /\b(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,2}[ \t]*$/i;

type PredicateStartClassification =
  | "explicit-workflow-subject"
  | "supported-subjectless"
  | "explicit-changed-subject"
  | "conditional-or-subordinate"
  | "unsupported";

type DirectSubjectBridgeClassification =
  | "immediate"
  | "composed"
  | "explicit-changed-subject"
  | "conditional-or-subordinate"
  | "local-step-scope"
  | "specific-source-or-target"
  | "exception-or-allowance"
  | "quoted-or-descriptive"
  | "unsupported";

type WorkflowScopeProof =
  | "standalone-default"
  | "explicit-workflow-subject"
  | "prefixed-workflow-subject"
  | "inherited-workflow-subject"
  | "explicit-workflow-qualifier"
  | "no-workflow-proof";

type StandalonePolicyPrefixClassification =
  | "plain-start"
  | "directive-prefix"
  | "policy-label"
  | "descriptive-prefix"
  | "changed-subject-prefix"
  | "unsupported-prefix";

interface BodyPolicyPredicateSegment {
  readonly range: EvidenceRange;
  readonly separator: EvidenceRange;
  readonly boundary: "start" | "inherited" | "hard";
  readonly startClassification: PredicateStartClassification;
  readonly explicitSubject: EvidenceRange | undefined;
  readonly inheritedSubject: EvidenceRange | undefined;
  readonly independentStandaloneBoundary: boolean;
}

interface BodyPolicyStatementGroup {
  readonly sourceText: string;
  readonly range: EvidenceRange;
  readonly explicitSubject: EvidenceRange | undefined;
  readonly predicates: readonly BodyPolicyPredicateSegment[];
}

/** @internal Extract bounded semantic facts from one prepared Markdown clause. */
function bodyPolicyClauseFacts(
  clause: string,
): readonly BodyPolicyClauseFacts[] {
  const domains = DOMAIN_ORDER.filter((domain) =>
    DOMAIN_EVIDENCE_PATTERNS[domain].test(clause),
  );
  return domains.flatMap((domain) => classifyDomainFacts(clause, domain));
}

/**
 * @internal Build body-policy facts only after bounded statement groups have
 * established explicit and inherited workflow subjects.
 */
export function bodyPolicyStatementGroupFacts(
  text: string,
  clauseRanges: readonly EvidenceRange[],
): readonly BodyPolicyClauseFacts[] {
  const classified: BodyPolicyClauseFacts[] = [];
  for (const group of bodyPolicyStatementGroups(text, clauseRanges)) {
    for (const predicate of group.predicates) {
      const predicateText = text.slice(
        predicate.range.start,
        predicate.range.end,
      );
      const explicitSubject =
        predicate.explicitSubject === undefined
          ? undefined
          : {
              start: predicate.explicitSubject.start - predicate.range.start,
              end: predicate.explicitSubject.end - predicate.range.start,
            };
      const inheritedSubject = predicate.inheritedSubject;
      const projectedFacts =
        inheritedSubject === undefined
          ? []
          : DOMAIN_ORDER.flatMap((domain) => {
              const projected = projectedStatementFact(
                text,
                predicate,
                inheritedSubject,
                domain,
              );
              return projected === undefined ? [] : [projected];
            });
      const projectedDomains = new Set(
        projectedFacts.flatMap(({ domain }) =>
          domain === undefined ? [] : [domain],
        ),
      );
      const directFacts = bodyPolicyClauseFacts(predicateText).map((fact) => {
        const scopeProof = directFactWorkflowScopeProof(
          predicateText,
          predicate,
          fact,
          explicitSubject,
        );
        const scopedFact = applyWorkflowScopeProof(fact, scopeProof);
        const evidenceStart =
          scopeProof === "explicit-workflow-subject" &&
          explicitSubject !== undefined
            ? Math.min(scopedFact.evidenceStart, explicitSubject.start)
            : scopeProof === "standalone-default" ||
                scopeProof === "prefixed-workflow-subject" ||
                scopeProof === "explicit-workflow-qualifier"
              ? 0
              : scopedFact.evidenceStart;
        return {
          ...scopedFact,
          evidenceStart: predicate.range.start + evidenceStart,
          evidenceEnd: predicate.range.start + scopedFact.evidenceEnd,
        };
      });
      for (const direct of directFacts) {
        if (
          direct.domain !== undefined &&
          projectedDomains.has(direct.domain)
        ) {
          continue;
        }
        classified.push(direct);
      }
      classified.push(...projectedFacts);
    }
  }
  return deduplicateStatementFacts(classified);
}

function classifyDomainFacts(
  clause: string,
  domain: BodyPolicyDomain,
): readonly BodyPolicyClauseFacts[] {
  const domainEvidence = evidenceForPattern(
    clause,
    DOMAIN_EVIDENCE_PATTERNS[domain],
  ) ?? {
    start: 0,
    end: 0,
  };
  const requirements = candidateEvidence(
    clause,
    NO_REQUIREMENT_PATTERNS[domain],
    "not-required",
  );
  const affirmativeRequirements = candidateEvidence(
    clause,
    AFFIRMATIVE_REQUIREMENT_PATTERNS[domain],
    "affirmative-requirement",
  ).filter(
    (candidate) =>
      !requirements.some((requirement) =>
        evidenceOverlaps(candidate, requirement),
      ),
  );
  const supportedProhibitions = candidateEvidence(
    clause,
    PROHIBITED_PATTERNS[domain],
    "supported-prohibition",
  );
  const genericProhibitions = candidateEvidence(
    clause,
    [GENERIC_PROHIBITION_PATTERNS[domain]],
    "generic-prohibition",
  );
  const candidates = independentCandidates([
    ...requirements,
    ...affirmativeRequirements,
    ...supportedProhibitions,
    ...genericProhibitions,
  ]);
  if (candidates.length === 0) {
    return [
      {
        domain,
        modality: "unknown",
        scope: WORKFLOW_SCOPE_RE.test(clause) ? "workflow" : "unknown",
        completeness: "complete",
        evidenceStart: domainEvidence.start,
        evidenceEnd: domainEvidence.end,
      },
    ];
  }

  return candidates.map((candidate, index) => {
    const nextCandidate = candidates[index + 1];
    const boundaryEnd = candidateBoundaryEnd(clause, candidate, nextCandidate);
    const contextEnd = candidateContextEnd(clause, candidate, boundaryEnd);
    const context = clause.slice(candidate.predicateStart, contextEnd);
    const candidateWorkflowSubject = inheritedWorkflowSubject(
      clause,
      candidate,
    );
    const projectedSupportedEnd =
      candidate.kind === "generic-prohibition" &&
      candidateWorkflowSubject !== undefined
        ? projectedSupportedPredicateEnd(
            clause.slice(
              candidateWorkflowSubject.start,
              candidateWorkflowSubject.end,
            ),
            context,
            domain,
          )
        : undefined;
    const workflowSubject = candidateWorkflowSubject;
    const inheritsWorkflowScope =
      workflowSubject !== undefined &&
      (candidate.kind !== "generic-prohibition" ||
        projectedSupportedEnd !== undefined);
    const evidence = {
      start: 0,
      end:
        projectedSupportedEnd ??
        Math.min(candidate.end, contextEnd) - candidate.predicateStart,
    };
    const supportedProhibition =
      candidate.kind === "supported-prohibition" ||
      projectedSupportedEnd !== undefined;
    const baseModality =
      candidate.kind === "not-required"
        ? "not-required"
        : candidate.kind === "affirmative-requirement"
          ? "unknown"
          : "prohibited";
    const scopeModality =
      baseModality === "prohibited" && !supportedProhibition
        ? "unknown"
        : baseModality;
    const scope = classifyScope(
      context,
      domain,
      scopeModality,
      evidence,
      inheritsWorkflowScope,
    );
    const modality =
      baseModality !== "prohibited"
        ? baseModality
        : isLocalSafeguard(context, domain, scope.scope)
          ? "local-safeguard"
          : supportedProhibition ||
              scope.scope === "local-step" ||
              scope.scope === "specific-target" ||
              scope.scope === "specific-source"
            ? "prohibited"
            : "unknown";
    const supportedEnd = candidate.predicateStart + scope.supportedEnd;
    return {
      domain,
      modality,
      scope: scope.scope,
      completeness: TRIVIAL_REMAINDER_RE.test(
        clause.slice(supportedEnd, boundaryEnd),
      )
        ? "complete"
        : "unsupported-remainder",
      evidenceStart: workflowSubject?.start ?? candidate.start,
      evidenceEnd: supportedEnd,
    };
  });
}

function classifyScope(
  clause: string,
  domain: BodyPolicyDomain,
  modality: BodyPolicyModality,
  evidence: EvidenceRange,
  inheritedWorkflowScope = false,
): ScopeClassification {
  const semanticEnd = semanticContentEnd(clause);
  if (hasSpecificSourceScope(clause, domain)) {
    return { scope: "specific-source", supportedEnd: semanticEnd };
  }
  if (hasSpecificTargetScope(clause, domain)) {
    return { scope: "specific-target", supportedEnd: semanticEnd };
  }

  const supportedEnd = allowanceBridgeEnd(
    clause,
    clause.slice(evidence.start, evidence.end),
    evidence.end,
  );
  const suffix = clause.slice(supportedEnd);
  const workflowQualifier =
    WORKFLOW_SCOPE_QUALIFIER_RE.exec(suffix) ??
    (modality === "not-required"
      ? REQUIREMENT_WORKFLOW_SCOPE_RE.exec(suffix)
      : null);
  if (workflowQualifier !== null) {
    return {
      scope: "workflow",
      supportedEnd: supportedEnd + workflowQualifier[0].length,
    };
  }
  const localQualifier = LOCAL_SCOPE_QUALIFIER_RE.exec(suffix);
  if (localQualifier !== null) {
    return {
      scope: "local-step",
      supportedEnd: supportedEnd + localQualifier[0].length,
    };
  }
  const unknownQualifier = UNKNOWN_SCOPE_QUALIFIER_RE.exec(suffix);
  if (unknownQualifier !== null) {
    return { scope: "unknown", supportedEnd: semanticEnd };
  }
  if (LOCAL_SCOPE_RE.test(clause)) {
    return { scope: "local-step", supportedEnd: semanticEnd };
  }
  if (WORKFLOW_SCOPE_RE.test(clause)) {
    return { scope: "workflow", supportedEnd };
  }
  if (inheritedWorkflowScope) {
    return { scope: "workflow", supportedEnd };
  }
  if (modality === "prohibited") {
    return { scope: "workflow", supportedEnd };
  }
  return { scope: "unknown", supportedEnd };
}

function hasSpecificSourceScope(
  clause: string,
  domain: BodyPolicyDomain,
): boolean {
  if (domain === "secrets") {
    return new RegExp(
      String.raw`${SECRET_EVIDENCE}[ \t]+(?:from|through|via)\b`,
      "i",
    ).test(clause);
  }
  if (domain === "network") {
    return /\bdownload\b[^.!?\n]{0,80}\bfrom\s+(?:the\s+)?internet\b/i.test(
      clause,
    );
  }
  return false;
}

function hasSpecificTargetScope(
  clause: string,
  domain: BodyPolicyDomain,
): boolean {
  if (domain === "upload") {
    return new RegExp(
      String.raw`\b(?:${EXTERNAL_UPLOAD_ACTION_TERMS}|uploads?)\b[^.!?\n]{0,80}\b(?:to|into|onto)\b`,
      "i",
    ).test(clause);
  }
  if (domain === "secrets") {
    return new RegExp(
      String.raw`\b(?:print|log|write|include|pass|place|put|upload|send|share|attach)\b[^.!?\n]{0,80}${SECRET_EVIDENCE}[^.!?\n]{0,40}\b(?:to|in|into|onto)\b|${SECRET_EVIDENCE}[^.!?\n]{0,40}\bin[ \t]+(?:command[ \t]+arguments?|logs?|stdout)\b`,
      "i",
    ).test(clause);
  }
  return new RegExp(String.raw`\b${NETWORK_SUBJECT}\b[ \t]+to[ \t]+`, "i").test(
    clause,
  );
}

function isLocalSafeguard(
  clause: string,
  domain: BodyPolicyDomain,
  scope: BodyPolicyScope,
): boolean {
  if (/\b(?:npx|npm|command|git\s+remote\s+api)\b/i.test(clause)) {
    return true;
  }
  if (domain === "network" && scope === "specific-target") return true;
  if (
    domain === "secrets" &&
    /\b(?:print|log|write|include|pass|place|put|upload|send|share|attach)\b/i.test(
      clause,
    )
  ) {
    return true;
  }
  return (
    scope === "specific-target" &&
    /\bupload(?:s|ed|ing)?\b/i.test(clause) &&
    new RegExp(SECRET_EVIDENCE, "i").test(clause)
  );
}

function allowanceBridgeEnd(
  text: string,
  matchedText: string,
  matchEnd: number,
): number {
  if (!/\bno\b/i.test(matchedText)) return matchEnd;
  const allowance = NO_ALLOWANCE_SUFFIX_RE.exec(text.slice(matchEnd));
  return allowance === null ? matchEnd : matchEnd + allowance[0].length;
}

function semanticContentEnd(text: string): number {
  const closing = /[.!?…]+[)"'\]}>*_~`\\]*[ \t]*$/u.exec(text);
  return closing === null ? text.trimEnd().length : closing.index;
}

function candidateEvidence(
  text: string,
  patterns: readonly RegExp[],
  kind: DomainCandidateKind,
): readonly DomainCandidate[] {
  const candidates: DomainCandidate[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      if (match.index === undefined || match[0].length === 0) continue;
      const start = match.index;
      const end = match.index + match[0].length;
      const directWorkflowSubject =
        kind === "supported-prohibition"
          ? leadingWorkflowSubject(text, start, end)
          : undefined;
      candidates.push({
        kind,
        start,
        end,
        predicateStart: candidatePredicateStart(
          text,
          start,
          end,
          kind,
          directWorkflowSubject !== undefined,
        ),
        directWorkflowSubject,
      });
    }
  }
  return candidates;
}

function independentCandidates(
  candidates: readonly DomainCandidate[],
): readonly DomainCandidate[] {
  const ordered = [...candidates].sort(
    (left, right) =>
      left.predicateStart - right.predicateStart ||
      candidateKindOrder(left.kind) - candidateKindOrder(right.kind) ||
      left.start - right.start ||
      right.end - left.end,
  );
  const selected: DomainCandidate[] = [];
  for (const candidate of ordered) {
    const samePredicateIndex = selected.findIndex(
      (existing) => existing.predicateStart === candidate.predicateStart,
    );
    if (samePredicateIndex < 0) {
      const previous = selected[selected.length - 1];
      if (previous !== undefined && evidenceOverlaps(previous, candidate)) {
        continue;
      }
      selected.push(candidate);
      continue;
    }

    const existing = selected[samePredicateIndex];
    if (
      existing !== undefined &&
      candidateKindOrder(candidate.kind) < candidateKindOrder(existing.kind)
    ) {
      selected[samePredicateIndex] = candidate;
    }
  }
  return selected.sort(
    (left, right) =>
      left.predicateStart - right.predicateStart ||
      candidateKindOrder(left.kind) - candidateKindOrder(right.kind),
  );
}

function candidatePredicateStart(
  text: string,
  start: number,
  end: number,
  kind: DomainCandidateKind,
  directWorkflowPrefix: boolean,
): number {
  const predicatePattern =
    kind === "not-required"
      ? NOT_REQUIREMENT_PREDICATE_RE
      : kind === "affirmative-requirement"
        ? AFFIRMATIVE_REQUIREMENT_PREDICATE_RE
        : PROHIBITION_PREDICATE_RE;
  const candidateText = text.slice(start, end);
  const matches = [...candidateText.matchAll(predicatePattern)].flatMap(
    (match) => (match.index === undefined ? [] : [{ index: match.index }]),
  );
  if (kind === "supported-prohibition" || kind === "generic-prohibition") {
    if (directWorkflowPrefix) {
      const predicate = matches[matches.length - 1];
      return predicate === undefined ? start : start + predicate.index;
    }
    const connector = /(?:,[ \t]*)?\band\b[ \t]*/gi;
    let predicateFloor = 0;
    for (const match of candidateText.matchAll(connector)) {
      if (match.index !== undefined) {
        predicateFloor = match.index + match[0].length;
      }
    }
    const predicate = matches.find((match) => match.index >= predicateFloor);
    return predicate === undefined ? start : start + predicate.index;
  }
  const predicate = matches[matches.length - 1];
  return predicate === undefined ? start : start + predicate.index;
}

function projectedSupportedPredicateEnd(
  workflowSubject: string,
  predicateContext: string,
  domain: BodyPolicyDomain,
): number | undefined {
  const prefix = `${workflowSubject} `;
  const projection = `${prefix}${predicateContext}`;
  let selectedEnd: number | undefined;
  for (const pattern of PROHIBITED_PATTERNS[domain]) {
    const evidence = evidenceForPattern(projection, pattern);
    if (evidence === undefined || evidence.end <= prefix.length) continue;
    const predicateEnd = evidence.end - prefix.length;
    if (selectedEnd === undefined || predicateEnd > selectedEnd) {
      selectedEnd = predicateEnd;
    }
  }
  return selectedEnd;
}

function inheritedWorkflowSubject(
  text: string,
  candidate: DomainCandidate,
): EvidenceRange | undefined {
  if (candidate.directWorkflowSubject !== undefined) {
    return candidate.directWorkflowSubject;
  }
  const matcher = new RegExp(
    WORKFLOW_SCOPE_RE.source,
    WORKFLOW_SCOPE_RE.flags.includes("g")
      ? WORKFLOW_SCOPE_RE.flags
      : `${WORKFLOW_SCOPE_RE.flags}g`,
  );
  let selected: EvidenceRange | undefined;
  for (const match of text
    .slice(0, candidate.predicateStart)
    .matchAll(matcher)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const end = start + match[0].length;
    const suffix = text.slice(end, candidate.predicateStart);
    if (start >= candidate.start || /^[ \t]*$/.test(suffix)) {
      selected = { start, end };
    }
  }
  return selected;
}

function candidateKindOrder(kind: DomainCandidateKind): number {
  return {
    "not-required": 0,
    "affirmative-requirement": 1,
    "supported-prohibition": 2,
    "generic-prohibition": 3,
  }[kind];
}

function evidenceOverlaps(left: EvidenceRange, right: EvidenceRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function candidateBoundaryEnd(
  text: string,
  candidate: DomainCandidate,
  nextCandidate: DomainCandidate | undefined,
): number {
  // Only a recognized later candidate shortens the completeness boundary.
  // Otherwise coordinated trailing prose remains an unsupported remainder.
  if (nextCandidate === undefined) return semanticContentEnd(text);
  const nextWorkflowSubject =
    nextCandidate.directWorkflowSubject ??
    inheritedWorkflowSubject(text, nextCandidate);
  const nextStatementStart =
    nextCandidate.start >= candidate.end
      ? nextCandidate.start
      : nextWorkflowSubject !== undefined &&
          nextWorkflowSubject.start >= candidate.end
        ? nextWorkflowSubject.start
        : nextCandidate.predicateStart;
  return text.slice(0, nextStatementStart).trimEnd().length;
}

function candidateContextEnd(
  text: string,
  candidate: DomainCandidate,
  boundaryEnd: number,
): number {
  // Scope and safeguard language belongs to this coordinated statement even
  // when unrelated trailing prose must still count toward completeness.
  const between = text.slice(candidate.end, boundaryEnd);
  const connector = /(?:,[ \t]*)?\band\b/i.exec(between);
  const untrimmedEnd =
    connector === null ? boundaryEnd : candidate.end + connector.index;
  return text.slice(0, untrimmedEnd).trimEnd().length;
}

function evidenceForPattern(
  text: string,
  pattern: RegExp,
): EvidenceRange | undefined {
  const match = pattern.exec(text);
  if (match?.index === undefined) return undefined;
  return { start: match.index, end: match.index + match[0].length };
}

function bodyPolicyStatementGroups(
  text: string,
  clauseRanges: readonly EvidenceRange[],
): readonly BodyPolicyStatementGroup[] {
  const predicateRanges = clauseRanges
    .filter(
      ({ start, end }) =>
        !/^[ \t]*[;:,.!?–—-]+[ \t]*$/u.test(text.slice(start, end)),
    )
    .flatMap((range) => splitOrdinaryPredicateRanges(text, range))
    .map((range) => trimPredicateRange(text, range))
    .filter(({ start, end }) => start < end)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const groups: BodyPolicyStatementGroup[] = [];
  let activeSubject: EvidenceRange | undefined;
  let predicates: BodyPolicyPredicateSegment[] = [];
  let groupStart = 0;
  for (const [index, range] of predicateRanges.entries()) {
    const previous = predicateRanges[index - 1];
    const separator = {
      start: previous?.end ?? range.start,
      end: range.start,
    };
    const separatorText = text.slice(separator.start, separator.end);
    const boundary =
      previous === undefined
        ? "start"
        : statementSeparatorSupportsInheritance(separatorText)
          ? "inherited"
          : "hard";
    const explicitSubject = leadingWorkflowSubjectInRange(text, range);
    const startClassification = classifyPredicateStart(
      text.slice(range.start, range.end),
      explicitSubject !== undefined,
    );
    const inheritsSubject =
      explicitSubject === undefined &&
      boundary === "inherited" &&
      activeSubject !== undefined &&
      startClassification === "supported-subjectless";
    const previousPredicate = predicates[predicates.length - 1];
    const independentStandaloneBoundary =
      explicitSubject === undefined &&
      boundary === "inherited" &&
      activeSubject === undefined &&
      previousPredicate !== undefined &&
      (bareSemicolonSeparatesIndependentPolicies(separatorText) ||
        predicateAllowsIndependentPolicyContinuation(text, previousPredicate));
    if (boundary === "hard") {
      if (predicates.length > 0) {
        groups.push(
          statementGroup(text, predicates, groupStart, previous?.end),
        );
      }
      predicates = [];
      groupStart = range.start;
      activeSubject = undefined;
    } else if (predicates.length === 0) {
      groupStart = range.start;
    }
    const inheritedSubject = inheritsSubject ? activeSubject : undefined;
    predicates.push({
      range,
      separator,
      boundary,
      startClassification,
      explicitSubject,
      inheritedSubject,
      independentStandaloneBoundary,
    });
    activeSubject =
      explicitSubject ??
      (inheritedSubject === undefined ? undefined : activeSubject);
  }
  if (predicates.length > 0) {
    groups.push(
      statementGroup(
        text,
        predicates,
        groupStart,
        predicateRanges[predicateRanges.length - 1]?.end,
      ),
    );
  }
  return groups;
}

function statementGroup(
  text: string,
  predicates: readonly BodyPolicyPredicateSegment[],
  start: number,
  end: number | undefined,
): BodyPolicyStatementGroup {
  const range = { start, end: end ?? start };
  return {
    sourceText: text.slice(range.start, range.end),
    range,
    explicitSubject: [...predicates]
      .reverse()
      .find(({ explicitSubject }) => explicitSubject !== undefined)
      ?.explicitSubject,
    predicates,
  };
}

function predicateAllowsIndependentPolicyContinuation(
  text: string,
  predicate: BodyPolicyPredicateSegment,
): boolean {
  if (
    predicate.explicitSubject !== undefined ||
    predicate.inheritedSubject !== undefined
  ) {
    return false;
  }
  if (predicate.startClassification === "supported-subjectless") return true;
  return directlySupportedProhibitionStartsText(
    text.slice(predicate.range.start, predicate.range.end),
  );
}

function bareSemicolonSeparatesIndependentPolicies(separator: string): boolean {
  return !separator.includes("\n") && /^[ \t]*;[ \t]*$/u.test(separator);
}

function splitOrdinaryPredicateRanges(
  text: string,
  sourceRange: EvidenceRange,
): readonly EvidenceRange[] {
  const ranges: EvidenceRange[] = [];
  let start = sourceRange.start;
  const source = text.slice(sourceRange.start, sourceRange.end);
  const pairedCommaModifier = leadingPairedCommaModifierRange(
    text,
    sourceRange,
  );
  for (const match of source.matchAll(ORDINARY_STATEMENT_SEPARATOR_RE)) {
    if (match.index === undefined) continue;
    const separatorStart = sourceRange.start + match.index;
    const separatorEnd = separatorStart + match[0].length;
    if (
      pairedCommaModifier !== undefined &&
      separatorStart >= pairedCommaModifier.start &&
      separatorStart < pairedCommaModifier.end
    ) {
      continue;
    }
    const commaPrefixClassification = standalonePolicyPrefixClassification(
      source.slice(0, match.index),
    );
    if (
      /^,[ \t]*$/u.test(match[0]) &&
      (commaPrefixClassification === "directive-prefix" ||
        commaPrefixClassification === "policy-label")
    ) {
      continue;
    }
    if (!startsStatementPredicate(text.slice(separatorEnd, sourceRange.end))) {
      continue;
    }
    if (separatorStart > start) ranges.push({ start, end: separatorStart });
    start = separatorEnd;
  }
  if (start < sourceRange.end) ranges.push({ start, end: sourceRange.end });
  return ranges;
}

function leadingPairedCommaModifierRange(
  text: string,
  sourceRange: EvidenceRange,
): EvidenceRange | undefined {
  const subject = leadingWorkflowSubjectInRange(text, sourceRange);
  if (subject === undefined) return undefined;
  const match = DIRECT_SUBJECT_PAIRED_COMMA_MODIFIER_RE.exec(
    text.slice(subject.end, sourceRange.end),
  );
  if (match === null) return undefined;
  return {
    start: subject.end,
    end: subject.end + match[0].length,
  };
}

function startsStatementPredicate(text: string): boolean {
  const startClassification = classifyPredicateStart(
    text,
    LEADING_WORKFLOW_SUBJECT_RE.test(text),
  );
  return (
    startClassification === "explicit-workflow-subject" ||
    directlySupportedProhibitionStartsText(text) ||
    DOMAIN_PREDICATE_START_RE.test(text) ||
    ((startClassification === "supported-subjectless" ||
      startClassification === "explicit-changed-subject") &&
      DOMAIN_ORDER.some((domain) =>
        DOMAIN_EVIDENCE_PATTERNS[domain].test(text),
      ))
  );
}

function directlySupportedProhibitionStartsText(text: string): boolean {
  return DOMAIN_ORDER.some((domain) =>
    candidateEvidence(
      text,
      PROHIBITED_PATTERNS[domain],
      "supported-prohibition",
    ).some((candidate) => text.slice(0, candidate.start).trim().length === 0),
  );
}

function classifyPredicateStart(
  text: string,
  hasExplicitWorkflowSubject: boolean,
): PredicateStartClassification {
  if (hasExplicitWorkflowSubject) return "explicit-workflow-subject";
  if (CONDITIONAL_OR_SUBORDINATE_PREDICATE_START_RE.test(text)) {
    return "conditional-or-subordinate";
  }
  if (STRONG_CHANGED_SUBJECT_START_RE.test(text)) {
    return "explicit-changed-subject";
  }
  if (SUBJECTLESS_PREDICATE_START_RE.test(text)) {
    return "supported-subjectless";
  }
  if (EXPLICIT_CHANGED_SUBJECT_START_RE.test(text)) {
    return "explicit-changed-subject";
  }
  return "unsupported";
}

function trimPredicateRange(text: string, range: EvidenceRange): EvidenceRange {
  const source = text.slice(range.start, range.end);
  const leading = /^[ \t]*(?:,[ \t]*)?/u.exec(source)?.[0].length ?? 0;
  const trailing = /(?:,[ \t]*|[ \t]+)$/u.exec(source)?.[0].length ?? 0;
  return {
    start: range.start + leading,
    end: Math.max(range.start + leading, range.end - trailing),
  };
}

function statementSeparatorSupportsInheritance(separator: string): boolean {
  return (
    !separator.includes("\n") &&
    INHERITED_STATEMENT_SEPARATOR_RE.test(separator)
  );
}

function leadingWorkflowSubjectInRange(
  text: string,
  range: EvidenceRange,
): EvidenceRange | undefined {
  const match = LEADING_WORKFLOW_SUBJECT_RE.exec(
    text.slice(range.start, range.end),
  );
  const subject = match?.groups?.subject;
  if (match === null || subject === undefined) return undefined;
  const subjectOffset = match[0]
    .toLowerCase()
    .lastIndexOf(subject.toLowerCase());
  if (subjectOffset < 0) return undefined;
  const start = range.start + subjectOffset;
  return { start, end: start + subject.length };
}

function supportedCandidatesForFact(
  predicate: string,
  fact: BodyPolicyClauseFacts,
): readonly DomainCandidate[] {
  const domain = fact.domain;
  if (domain === undefined) return [];
  return candidateEvidence(
    predicate,
    PROHIBITED_PATTERNS[domain],
    "supported-prohibition",
  ).filter(
    (candidate) =>
      candidate.predicateStart >= fact.evidenceStart &&
      candidate.end <= fact.evidenceEnd,
  );
}

function standalonePolicyPrefixClassification(
  prefix: string,
): StandalonePolicyPrefixClassification {
  const normalized = prefix.trim();
  if (normalized.length === 0) return "plain-start";
  if (
    /["'“”‘’`]/u.test(normalized) ||
    DESCRIPTIVE_SUBJECT_BRIDGE_RE.test(normalized)
  ) {
    return "descriptive-prefix";
  }
  if (/^(?:policy|requirement)[ \t]*:[ \t]*$/i.test(normalized)) {
    return "policy-label";
  }
  if (
    /^(?:please|for[ \t]+safety|ensure|make[ \t]+sure|as[ \t]+a[ \t]+rule)[ \t]*[:,–—-]?[ \t]*$/iu.test(
      normalized,
    )
  ) {
    return "directive-prefix";
  }
  if (
    /^(?:(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+)?[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3}(?:[ \t]+(?:must|shall|should|will|would|may|might|can|could|does|do|did))?[ \t]*$/i.test(
      normalized,
    )
  ) {
    return "changed-subject-prefix";
  }
  return "unsupported-prefix";
}

function standalonePolicyPrefixSupportsScope(
  classification: StandalonePolicyPrefixClassification,
): boolean {
  return (
    classification === "plain-start" ||
    classification === "directive-prefix" ||
    classification === "policy-label"
  );
}

function outerPrefixSupportsEmbeddedWorkflowSubject(
  classification: StandalonePolicyPrefixClassification,
): boolean {
  return (
    classification === "directive-prefix" || classification === "policy-label"
  );
}

function candidateHasSupportedDirectWorkflowBridge(
  predicate: string,
  candidate: DomainCandidate,
  domain: BodyPolicyDomain,
): boolean {
  const subject = candidate.directWorkflowSubject;
  return (
    subject !== undefined &&
    directSubjectBridgeSupportsProhibition(
      classifyDirectSubjectBridge(
        predicate.slice(subject.end, candidate.predicateStart),
        domain,
      ),
    )
  );
}

function directFactWorkflowScopeProof(
  predicate: string,
  segment: BodyPolicyPredicateSegment,
  fact: BodyPolicyClauseFacts,
  explicitSubject: EvidenceRange | undefined,
): WorkflowScopeProof {
  const domain = fact.domain;
  if (
    domain === undefined ||
    fact.modality !== "prohibited" ||
    fact.scope !== "workflow"
  ) {
    return "no-workflow-proof";
  }

  const candidates = supportedCandidatesForFact(predicate, fact);
  const standaloneCandidates = candidates.filter(
    (candidate) =>
      candidate.directWorkflowSubject === undefined &&
      standalonePolicyPrefixSupportsScope(
        standalonePolicyPrefixClassification(
          predicate.slice(0, candidate.start),
        ),
      ),
  );
  if (
    standaloneCandidates.length > 0 &&
    factHasExplicitWorkflowQualifier(predicate, fact)
  ) {
    return "explicit-workflow-qualifier";
  }
  if (
    explicitSubject !== undefined &&
    candidates.some((candidate) =>
      directSubjectBridgeSupportsProhibition(
        classifyDirectSubjectBridge(
          predicate.slice(explicitSubject.end, candidate.predicateStart),
          domain,
        ),
      ),
    )
  ) {
    return "explicit-workflow-subject";
  }
  if (
    explicitSubject === undefined &&
    candidates.some(
      (candidate) =>
        outerPrefixSupportsEmbeddedWorkflowSubject(
          standalonePolicyPrefixClassification(
            predicate.slice(0, candidate.start),
          ),
        ) &&
        candidateHasSupportedDirectWorkflowBridge(predicate, candidate, domain),
    )
  ) {
    return "prefixed-workflow-subject";
  }

  if (
    explicitSubject === undefined &&
    segment.inheritedSubject === undefined &&
    standaloneCandidates.length > 0 &&
    (segment.boundary === "start" ||
      segment.independentStandaloneBoundary ||
      (segment.boundary === "hard" &&
        standaloneCandidates.some((candidate) =>
          candidateSupportsIndependentStatementDefault(predicate, candidate),
        )))
  ) {
    return "standalone-default";
  }

  return "no-workflow-proof";
}

function candidateSupportsIndependentStatementDefault(
  predicate: string,
  candidate: DomainCandidate,
): boolean {
  if (candidate.predicateStart > candidate.start) return true;
  return /^(?:no|without|do[ \t]+not|don't|never|avoid|exclude|disallow|forbid|block)\b/i.test(
    predicate.slice(candidate.start, candidate.end),
  );
}

function factHasExplicitWorkflowQualifier(
  predicate: string,
  fact: BodyPolicyClauseFacts,
): boolean {
  return new RegExp(
    String.raw`\b(?:for|throughout|during|within|in)[ \t]+${WORKFLOW_SCOPE_TERMS}\b`,
    "i",
  ).test(predicate.slice(fact.evidenceStart, fact.evidenceEnd));
}

function applyWorkflowScopeProof(
  fact: BodyPolicyClauseFacts,
  proof: WorkflowScopeProof,
): BodyPolicyClauseFacts {
  if (
    fact.modality !== "prohibited" ||
    fact.scope !== "workflow" ||
    proof !== "no-workflow-proof"
  ) {
    return fact;
  }
  return {
    ...fact,
    scope: "unknown",
  };
}

function bridgeHasLocalScope(bridge: string): boolean {
  return (
    LOCAL_SCOPE_RE.test(bridge) ||
    /\b(?:during|within|for|only[ \t]+for)[ \t]+[^()"'\n]{0,32}\b(?:validation|setup|installation|command|step|phase)\b/i.test(
      bridge,
    )
  );
}

function modifierHasSpecificScope(
  modifier: string,
  domain: BodyPolicyDomain,
  nakedPreposition: boolean,
): boolean {
  if (
    hasSpecificSourceScope(modifier, domain) ||
    hasSpecificTargetScope(modifier, domain)
  ) {
    return true;
  }
  if (!nakedPreposition) return false;
  if (domain === "upload") {
    return /^(?:to|into|onto)\b/i.test(modifier.trim());
  }
  if (domain === "secrets") {
    return /^(?:from|through|via|to|into|onto)\b/i.test(modifier.trim());
  }
  return /^(?:to|from|through|via)\b/i.test(modifier.trim());
}

function isBoundedRelativeModifier(modifier: string): boolean {
  const relative = DIRECT_SUBJECT_RELATIVE_MODIFIER_RE.exec(modifier.trim());
  return (
    relative !== null &&
    modifier.trim().slice(relative[0].length).trim().length === 0
  );
}

function bridgeQualificationClassification(
  bridge: string,
  domain: BodyPolicyDomain,
  nakedPreposition: boolean,
): DirectSubjectBridgeClassification | undefined {
  if (/["'“”‘’`]/u.test(bridge) || DESCRIPTIVE_SUBJECT_BRIDGE_RE.test(bridge)) {
    return "quoted-or-descriptive";
  }
  if (CONDITIONAL_SUBJECT_BRIDGE_RE.test(bridge)) {
    return "conditional-or-subordinate";
  }
  if (
    /\b(?:except|excluding|unless|only|allow(?:ed|ance)?|permit(?:ted|s)?)\b/i.test(
      bridge,
    )
  ) {
    return "exception-or-allowance";
  }
  if (bridgeHasLocalScope(bridge)) {
    return "local-step-scope";
  }
  if (modifierHasSpecificScope(bridge, domain, nakedPreposition)) {
    return "specific-source-or-target";
  }
  return undefined;
}

function classifyDirectSubjectBridge(
  bridge: string,
  domain: BodyPolicyDomain,
): DirectSubjectBridgeClassification {
  let remainder = bridge.trimStart();
  if (remainder.trim().length === 0) return "immediate";
  let consumedComponent = false;
  const punctuation = DIRECT_SUBJECT_PUNCTUATION_RE.exec(remainder);
  if (punctuation !== null) {
    remainder = remainder.slice(punctuation[0].length);
    consumedComponent = true;
  }
  for (let count = 0; count < 4; count += 1) {
    const modifier = DIRECT_SUBJECT_SHORT_MODIFIER_RE.exec(remainder);
    if (modifier === null) break;
    remainder = remainder.slice(modifier[0].length);
    consumedComponent = true;
  }
  const offlineAuxiliary = DIRECT_SUBJECT_OFFLINE_AUXILIARY_RE.exec(remainder);
  if (offlineAuxiliary !== null) {
    remainder = remainder.slice(offlineAuxiliary[0].length);
    consumedComponent = true;
  }

  const pairedComma = DIRECT_SUBJECT_PAIRED_COMMA_MODIFIER_RE.exec(remainder);
  if (pairedComma?.groups?.content !== undefined) {
    const content = pairedComma.groups.content.trim();
    if (!isBoundedRelativeModifier(content)) {
      const qualification = bridgeQualificationClassification(
        content,
        domain,
        true,
      );
      if (qualification !== undefined) return qualification;
      return classifyPredicateStart(content, false) ===
        "explicit-changed-subject"
        ? "explicit-changed-subject"
        : "unsupported";
    }
    remainder = remainder.slice(pairedComma[0].length).trimStart();
    consumedComponent = true;
  } else {
    const relative = DIRECT_SUBJECT_RELATIVE_MODIFIER_RE.exec(remainder);
    if (relative !== null) {
      remainder = remainder.slice(relative[0].length).trim();
      consumedComponent = true;
    } else {
      const parenthetical = DIRECT_SUBJECT_PARENTHETICAL_RE.exec(remainder);
      if (
        parenthetical?.groups?.content !== undefined &&
        !new RegExp(PROHIBITION_PREDICATE_RE.source, "i").test(
          parenthetical.groups.content,
        )
      ) {
        const qualification = bridgeQualificationClassification(
          parenthetical.groups.content,
          domain,
          true,
        );
        if (qualification !== undefined) return qualification;
        remainder = remainder.slice(parenthetical[0].length).trimStart();
        consumedComponent = true;
      }
    }
  }

  if (consumedComponent && remainder.trim().length === 0) {
    return "composed";
  }
  const qualification = bridgeQualificationClassification(
    remainder,
    domain,
    true,
  );
  if (qualification !== undefined) return qualification;
  return CHANGED_SUBJECT_BRIDGE_RE.test(bridge)
    ? "explicit-changed-subject"
    : "unsupported";
}

function directSubjectBridgeSupportsProhibition(
  classification: DirectSubjectBridgeClassification,
): boolean {
  return classification === "immediate" || classification === "composed";
}

function projectedStatementFact(
  source: string,
  predicate: BodyPolicyPredicateSegment,
  workflowSubject: EvidenceRange,
  domain: BodyPolicyDomain,
): BodyPolicyClauseFacts | undefined {
  const subject = source.slice(workflowSubject.start, workflowSubject.end);
  const predicateText = source.slice(
    predicate.range.start,
    predicate.range.end,
  );
  const prefix = `${subject} `;
  const projection = `${prefix}${predicateText}`;
  const supportedCandidate = candidateEvidence(
    projection,
    PROHIBITED_PATTERNS[domain],
    "supported-prohibition",
  ).find((candidate) => {
    const predicatePrefix = projection.slice(
      prefix.length,
      candidate.predicateStart,
    );
    return (
      candidate.directWorkflowSubject !== undefined &&
      candidate.predicateStart >= prefix.length &&
      directSubjectBridgeSupportsProhibition(
        classifyDirectSubjectBridge(predicatePrefix, domain),
      )
    );
  });
  if (supportedCandidate === undefined) return undefined;
  const fact = bodyPolicyClauseFacts(projection).find(
    (fact) =>
      fact.domain === domain &&
      fact.evidenceStart === 0 &&
      fact.evidenceEnd >= supportedCandidate.end,
  );
  if (fact === undefined) return undefined;
  const inheritedFact = applyWorkflowScopeProof(
    fact,
    "inherited-workflow-subject",
  );
  return {
    ...inheritedFact,
    evidenceStart: workflowSubject.start,
    evidenceEnd:
      predicate.range.start +
      Math.max(0, inheritedFact.evidenceEnd - prefix.length),
  };
}

function deduplicateStatementFacts(
  facts: readonly BodyPolicyClauseFacts[],
): readonly BodyPolicyClauseFacts[] {
  const selected = new Map<string, BodyPolicyClauseFacts>();
  for (const fact of facts) {
    const key = [
      fact.domain ?? "",
      fact.modality,
      fact.scope,
      fact.completeness,
      fact.evidenceStart,
      fact.evidenceEnd,
    ].join(":");
    selected.set(key, fact);
  }
  return [...selected.values()].sort(
    (left, right) =>
      left.evidenceStart - right.evidenceStart ||
      left.evidenceEnd - right.evidenceEnd ||
      domainOrder(left.domain) - domainOrder(right.domain),
  );
}

function domainOrder(domain: BodyPolicyDomain | undefined): number {
  return domain === undefined
    ? DOMAIN_ORDER.length
    : DOMAIN_ORDER.indexOf(domain);
}

function leadingWorkflowSubject(
  text: string,
  start: number,
  end: number,
): EvidenceRange | undefined {
  const evidence = evidenceForPattern(
    text.slice(start, end),
    WORKFLOW_SCOPE_RE,
  );
  if (evidence?.start !== 0) return undefined;
  return {
    start: start + evidence.start,
    end: start + evidence.end,
  };
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
