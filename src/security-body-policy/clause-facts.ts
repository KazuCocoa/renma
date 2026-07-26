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
    /\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:(?:all|any)\s+)?(?:(?:use|allow|permit)\s+)?(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\b(?!\s+(?:access|use|usage|connectivity|to)\b)/i,
    /\b(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\s+(?:(?:is|are)\s+(?:not\s+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled)|(?:must|may|should)\s+not\s+be\s+(?:used|available|enabled))\b/i,
    new RegExp(
      String.raw`\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:allow|permit)\s+(?:any|all)\s+(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\b[^.!?\n]{0,40}\b(?:for|throughout|during|within|in)\s+${WORKFLOW_SCOPE_TERMS}\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,40}\b(?:(?:must|shall|will|does)\s+not|cannot|can't|never)\s+(?:use|access)\s+(?:(?:any|all|the)\s+)?(?:external\s+)?(?:network|internet)(?:\s+(?:access|use|usage|connectivity))?\b`,
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
    /\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:perform|allow|permit|make)\s+(?:(?:(?:any|all)\s+)?external\s+uploads?|(?:any|all)\s+uploads?|uploads)\b(?!\s+(?:to|into|onto|of|from|with|containing)\b)/i,
    new RegExp(
      String.raw`\b(?:do\s+not|don't|never|avoid|exclude|disallow|forbid|block)\s+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})\s+(?:(?:anything|everything)(?:\s+externally)?|externally)\b(?!\s+(?:to|into|onto|of|from|with|containing)\b)`,
      "i",
    ),
    /\b(?:(?:all|any)\s+)?(?:external\s+)?uploads?\s+(?:are|is)\s+(?:not\s+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled)\b/i,
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,40}\b(?:(?:must|shall|will|does)\s+not|cannot|can't|never)\s+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})\s+(?:(?:anything|everything)(?:\s+externally)?|externally)\b(?!\s+(?:to|into|onto|of|from|with|containing)\b)`,
      "i",
    ),
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,40}\b(?:(?:must|shall|will|does)\s+not|cannot|can't|never)\s+(?:${EXTERNAL_UPLOAD_ACTION_TERMS})\s+(?:files?|artifacts?|data)\b`,
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
      String.raw`\bwithout\s+(?:(?:any|all)\s+)?(?:(?:access|permission)\s+to\s+|(?:the\s+)?use\s+of\s+)(?:${BODY_SECRET_TARGET_TERMS})\b(?!\s+(?:from|through|via)\b)`,
      "i",
    ),
    /\bno\s+(?:secret|credential|token|password|private[- ]key)\s+(?:access|use|usage)\b/i,
    new RegExp(
      String.raw`\b${WORKFLOW_SCOPE_TERMS}\b[^.!?\n]{0,50}\b(?:(?:must|shall|will|does)\s+not|cannot|can't|never)\s+(?:access|read|load|use|accept|handle)\s+(?:any\s+)?(?:${BODY_SECRET_TARGET_TERMS})\b(?!\s+(?:from|through|via)\b)`,
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
    String.raw`\b(?:do\s+not|don't|never|must\s+not|cannot|can't|forbidden|not\s+allowed|no)\b[^.!?\n]{0,100}?\b${NETWORK_SUBJECT}\b`,
    "i",
  ),
  upload:
    /\b(?:do\s+not|don't|never|must\s+not|cannot|can't|forbidden|not\s+allowed|no)\b[^.!?\n]{0,100}?\b(?:uploads?|uploading|uploaded)\b/i,
  secrets: new RegExp(
    String.raw`\b(?:do\s+not|don't|never|must\s+not|cannot|can't|forbidden|not\s+allowed|no)\b[^.!?\n]{0,100}?${SECRET_EVIDENCE}`,
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
const PROHIBITION_PREDICATE_RE =
  /\b(?:do\s+not|don't|never|must\s+not|shall\s+not|will\s+not|does\s+not|cannot|can't|not\s+(?:allowed|permitted|available)|disallowed|forbidden|blocked|prohibited|disabled|without|no|(?:must|shall|will|has\s+to|needs\s+to)\s+(?:run|operate|work)(?:\s+without)?|keep|run|operate)\b/gi;
const COORDINATED_PREDICATE_RE = /(?:,[ \t]*)?\band\b[ \t]*$/i;
const SHARED_SUBJECT_PREDICATE_BRIDGE_RE =
  /(?:,[ \t]*(?:and(?:[ \t]+(?:also|still|therefore))?)?|[ \t]+and(?:[ \t]+(?:also|still|therefore))?)[ \t]*$/i;
// The shared technical splitter also recognizes semicolons, sentence endings,
// newlines, but, however, yet, and then. Body-policy subject inheritance may
// cross only but, yet, however, or a semicolon immediately followed by
// however. Bare semicolons, sentence endings, hard breaks, and then stay hard
// boundaries.
const CONTRASTIVE_CLAUSE_BRIDGE_RE =
  /^[ \t]*(?:but|yet|however|;[ \t]*however)[ \t]*$/i;
const CONTRASTIVE_PREDICATE_PREFIX_RE = /^[ \t]*(?:,[ \t]*)?(?:it[ \t]+)?$/i;

/** @internal Extract bounded semantic facts from one prepared Markdown clause. */
export function bodyPolicyClauseFacts(
  clause: string,
): readonly BodyPolicyClauseFacts[] {
  const domains = DOMAIN_ORDER.filter((domain) =>
    DOMAIN_EVIDENCE_PATTERNS[domain].test(clause),
  );
  return domains.flatMap((domain) => classifyDomainFacts(clause, domain));
}

/** @internal Project a proven workflow subject across one contrastive boundary. */
export function bodyPolicyContrastiveClauseFacts(
  earlierClause: string,
  separator: string,
  laterClause: string,
): readonly BodyPolicyClauseFacts[] {
  const earlierSemanticClause = CONTRASTIVE_CLAUSE_BRIDGE_RE.test(separator)
    ? earlierClause.replace(/[ \t]*,[ \t]*$/u, "")
    : earlierClause;
  const earlierFacts = bodyPolicyClauseFacts(earlierSemanticClause);
  if (
    separator.includes("\n") ||
    !CONTRASTIVE_CLAUSE_BRIDGE_RE.test(separator)
  ) {
    return earlierFacts;
  }

  const laterOffset = earlierClause.length + separator.length;
  const projectedFacts: BodyPolicyClauseFacts[] = [];
  for (const domain of DOMAIN_ORDER) {
    const earlierFact = earlierFacts.find(
      (fact) => fact.domain === domain && fact.scope === "workflow",
    );
    if (earlierFact === undefined) continue;
    const workflowSubject = workflowSubjectWithinFact(
      earlierSemanticClause,
      earlierFact,
    );
    if (workflowSubject === undefined) continue;
    const projectedFact = contrastiveProjectionFact(
      earlierSemanticClause.slice(workflowSubject.start, workflowSubject.end),
      laterClause,
      domain,
      /;[ \t]*however/i.test(separator),
    );
    if (projectedFact === undefined) continue;
    const projectionPrefixLength =
      workflowSubject.end - workflowSubject.start + 1;
    projectedFacts.push({
      ...projectedFact,
      evidenceStart: workflowSubject.start,
      evidenceEnd:
        laterOffset +
        Math.max(0, projectedFact.evidenceEnd - projectionPrefixLength),
    });
  }
  return [...earlierFacts, ...projectedFacts];
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
  const candidates = independentCandidates(
    [
      ...requirements,
      ...affirmativeRequirements,
      ...supportedProhibitions,
      ...genericProhibitions,
    ],
    clause,
  );
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
    const candidateWorkflowSubject =
      inheritedWorkflowSubject(clause, candidate) ??
      coordinatedWorkflowSubject(clause, candidates[index - 1], candidate);
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
  text: string,
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
      if (
        previous !== undefined &&
        evidenceOverlaps(previous, candidate) &&
        !hasCoordinatedPredicateBoundary(text, previous, candidate)
      ) {
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

function hasCoordinatedPredicateBoundary(
  text: string,
  earlier: DomainCandidate,
  later: DomainCandidate,
): boolean {
  if (
    later.kind === "supported-prohibition" &&
    later.directWorkflowSubject !== undefined &&
    later.predicateStart > earlier.predicateStart
  ) {
    return true;
  }
  if (later.predicateStart < earlier.end) return false;
  return COORDINATED_PREDICATE_RE.test(
    text.slice(earlier.end, later.predicateStart),
  );
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

function coordinatedWorkflowSubject(
  text: string,
  earlier: DomainCandidate | undefined,
  later: DomainCandidate,
): EvidenceRange | undefined {
  // Generic projection may borrow a subject only from the immediately
  // preceding same-domain fact across this small, explicit bridge grammar.
  if (
    earlier === undefined ||
    later.predicateStart <= earlier.predicateStart ||
    later.predicateStart < earlier.end ||
    !SHARED_SUBJECT_PREDICATE_BRIDGE_RE.test(
      text.slice(earlier.end, later.predicateStart),
    )
  ) {
    return undefined;
  }
  return inheritedWorkflowSubject(text, earlier);
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
  const coordinatedNextWorkflowSubject = coordinatedWorkflowSubject(
    text,
    candidate,
    nextCandidate,
  );
  const nextWorkflowSubject =
    nextCandidate.directWorkflowSubject ??
    coordinatedNextWorkflowSubject ??
    inheritedWorkflowSubject(text, nextCandidate);
  const nextStatementStart =
    nextCandidate.start >= candidate.end
      ? nextCandidate.start
      : nextWorkflowSubject !== undefined &&
          nextWorkflowSubject.start >= candidate.end
        ? nextWorkflowSubject.start
        : nextCandidate.predicateStart;
  const between = text.slice(candidate.end, nextStatementStart);
  const connector =
    nextCandidate.directWorkflowSubject === undefined &&
    coordinatedNextWorkflowSubject === undefined
      ? COORDINATED_PREDICATE_RE.exec(between)
      : SHARED_SUBJECT_PREDICATE_BRIDGE_RE.exec(between);
  const untrimmedEnd =
    connector === null ? nextStatementStart : candidate.end + connector.index;
  return text.slice(0, untrimmedEnd).trimEnd().length;
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

function workflowSubjectWithinFact(
  clause: string,
  fact: BodyPolicyClauseFacts,
): EvidenceRange | undefined {
  const matcher = new RegExp(
    WORKFLOW_SCOPE_RE.source,
    WORKFLOW_SCOPE_RE.flags.includes("g")
      ? WORKFLOW_SCOPE_RE.flags
      : `${WORKFLOW_SCOPE_RE.flags}g`,
  );
  for (const match of clause.matchAll(matcher)) {
    if (match.index === undefined) continue;
    const evidence = {
      start: match.index,
      end: match.index + match[0].length,
    };
    if (
      evidence.start >= fact.evidenceStart &&
      evidence.end <= fact.evidenceEnd
    ) {
      return evidence;
    }
  }
  return undefined;
}

function contrastiveProjectionFact(
  workflowSubject: string,
  laterClause: string,
  domain: BodyPolicyDomain,
  requiresLeadingComma: boolean,
): BodyPolicyClauseFacts | undefined {
  const prefix = `${workflowSubject} `;
  const projection = `${prefix}${laterClause}`;
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
      CONTRASTIVE_PREDICATE_PREFIX_RE.test(predicatePrefix) &&
      (!requiresLeadingComma || /^[ \t]*,/u.test(predicatePrefix))
    );
  });
  if (supportedCandidate === undefined) return undefined;
  return bodyPolicyClauseFacts(projection).find(
    (fact) =>
      fact.domain === domain &&
      fact.evidenceStart === 0 &&
      fact.evidenceEnd >= supportedCandidate.end,
  );
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
