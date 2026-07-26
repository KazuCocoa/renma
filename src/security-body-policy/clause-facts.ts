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

/** @internal Extract bounded semantic facts from one prepared Markdown clause. */
export function bodyPolicyClauseFacts(
  clause: string,
): readonly BodyPolicyClauseFacts[] {
  const domains = DOMAIN_ORDER.filter((domain) =>
    DOMAIN_EVIDENCE_PATTERNS[domain].test(clause),
  );
  return domains.flatMap((domain) => classifyDomainFacts(clause, domain));
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
  ).filter(
    (candidate) =>
      !requirements.some((requirement) =>
        evidenceOverlaps(candidate, requirement),
      ),
  );
  const genericProhibitions = candidateEvidence(
    clause,
    [GENERIC_PROHIBITION_PATTERNS[domain]],
    "generic-prohibition",
  ).filter(
    (candidate) =>
      !requirements.some((requirement) =>
        evidenceOverlaps(candidate, requirement),
      ) &&
      !affirmativeRequirements.some((requirement) =>
        evidenceOverlaps(candidate, requirement),
      ) &&
      !supportedProhibitions.some((prohibition) =>
        evidenceOverlaps(candidate, prohibition),
      ),
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
    const context = clause.slice(candidate.start, contextEnd);
    const evidence = {
      start: 0,
      end: Math.min(candidate.end, contextEnd) - candidate.start,
    };
    const baseModality =
      candidate.kind === "not-required"
        ? "not-required"
        : candidate.kind === "affirmative-requirement"
          ? "unknown"
          : "prohibited";
    const scope = classifyScope(context, domain, baseModality, evidence);
    const modality =
      baseModality !== "prohibited"
        ? baseModality
        : isLocalSafeguard(context, domain, scope.scope)
          ? "local-safeguard"
          : candidate.kind === "supported-prohibition" ||
              scope.scope === "local-step" ||
              scope.scope === "specific-target" ||
              scope.scope === "specific-source"
            ? "prohibited"
            : "unknown";
    return facts(
      domain,
      modality,
      scope,
      candidate.start,
      clause.slice(candidate.start, boundaryEnd),
    );
  });
}

function facts(
  domain: BodyPolicyDomain,
  modality: BodyPolicyModality,
  scope: ScopeClassification,
  evidenceStart: number,
  clause: string,
): BodyPolicyClauseFacts {
  return {
    domain,
    modality,
    scope: scope.scope,
    completeness: TRIVIAL_REMAINDER_RE.test(clause.slice(scope.supportedEnd))
      ? "complete"
      : "unsupported-remainder",
    evidenceStart,
    evidenceEnd: evidenceStart + scope.supportedEnd,
  };
}

function classifyScope(
  clause: string,
  domain: BodyPolicyDomain,
  modality: BodyPolicyModality,
  evidence: EvidenceRange,
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
      candidates.push({
        kind,
        start: match.index,
        end: match.index + match[0].length,
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
      left.start - right.start ||
      candidateKindOrder(left.kind) - candidateKindOrder(right.kind) ||
      right.end - left.end,
  );
  const selected: DomainCandidate[] = [];
  for (const candidate of ordered) {
    const duplicate = selected.find(
      (existing) =>
        existing.kind === candidate.kind &&
        existing.start === candidate.start &&
        existing.end === candidate.end,
    );
    if (duplicate !== undefined) continue;

    const overlappingIndex = selected.findIndex((existing) =>
      evidenceOverlaps(existing, candidate),
    );
    if (overlappingIndex < 0) {
      selected.push(candidate);
      continue;
    }

    const existing = selected[overlappingIndex];
    if (
      existing !== undefined &&
      candidateKindOrder(candidate.kind) < candidateKindOrder(existing.kind)
    ) {
      selected[overlappingIndex] = candidate;
    }
  }
  return selected.sort(
    (left, right) =>
      left.start - right.start ||
      candidateKindOrder(left.kind) - candidateKindOrder(right.kind),
  );
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
  const between = text.slice(candidate.end, nextCandidate.start);
  const connector = /(?:,[ \t]*)?\band\b[ \t]*$/i.exec(between);
  const untrimmedEnd =
    connector === null ? nextCandidate.start : candidate.end + connector.index;
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
