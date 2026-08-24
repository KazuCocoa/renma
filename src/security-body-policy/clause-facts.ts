import {
  EXTERNAL_UPLOAD_ACTION_TERMS,
  WORKFLOW_SCOPE_TERMS,
} from "../security-prose-vocabulary.js";
import {
  AFFIRMATIVE_REQUIREMENT_PATTERNS,
  AFFIRMATIVE_REQUIREMENT_PREDICATE_RE,
  CHANGED_SUBJECT_BRIDGE_RE,
  CONDITIONAL_SUBJECT_BRIDGE_RE,
  DESCRIPTIVE_SUBJECT_BRIDGE_RE,
  DIRECT_SUBJECT_OFFLINE_AUXILIARY_RE,
  DIRECT_SUBJECT_PAIRED_COMMA_MODIFIER_RE,
  DIRECT_SUBJECT_PARENTHETICAL_RE,
  DIRECT_SUBJECT_PUNCTUATION_RE,
  DIRECT_SUBJECT_RELATIVE_MODIFIER_RE,
  DIRECT_SUBJECT_SHORT_MODIFIER_RE,
  DOMAIN_EVIDENCE_PATTERNS,
  GENERIC_PROHIBITION_PATTERNS,
  LOCAL_SCOPE_QUALIFIER_RE,
  LOCAL_SCOPE_RE,
  NETWORK_SUBJECT,
  NOT_REQUIREMENT_PREDICATE_RE,
  NO_ALLOWANCE_SUFFIX_RE,
  NO_REQUIREMENT_PATTERNS,
  PROHIBITED_PATTERNS,
  PROHIBITION_PREDICATE_RE,
  REQUIREMENT_WORKFLOW_SCOPE_RE,
  SECRET_EVIDENCE,
  TRIVIAL_REMAINDER_RE,
  UNKNOWN_SCOPE_QUALIFIER_RE,
  WORKFLOW_SCOPE_QUALIFIER_RE,
  WORKFLOW_SCOPE_RE,
  recognizeCandidateRanges,
  recognizeEvidenceRange,
  recognizeModalNegation,
} from "./lexical-recognition.js";
import { deduplicateBodyPolicyFacts } from "./fact-projection.js";
import type {
  BodyPolicyClauseFacts,
  BodyPolicyDomain,
  BodyPolicyModality,
  BodyPolicyScope,
  DirectSubjectBridgeClassification,
  DomainCandidate,
  EvidenceRange,
  ModalNegationClassification,
  ModalNegationSemantics,
  PatternProvenance,
  PolicyContextMatch,
  PredicateSegment,
  ScopeClassification,
  StatementAnalysisState,
  WorkflowScopeProof,
  WorkflowSubjectMatch,
} from "./model.js";
import { BODY_POLICY_DOMAIN_ORDER } from "./model.js";
import {
  outerPrefixSupportsEmbeddedWorkflowSubject,
  prefixClassificationProvidesPolicyContext,
  standalonePolicyPrefixClassification,
  standalonePolicyPrefixSupportsScope,
} from "./policy-context.js";
import {
  bodyPolicyStatementGroups,
  classifyPredicateStart,
  directlySupportedProhibitionStartsText,
  leadingBoundedPairedRelativeRange,
  pairedRelativePredicateComponent,
  pairedRelativeSubjectRelationship,
  supportedWorkflowSubjectInRange,
} from "./statement-components.js";

/** @internal Extract bounded semantic facts from one prepared Markdown clause. */
function bodyPolicyClauseFacts(
  clause: string,
  inheritedPolicyContext = false,
): readonly BodyPolicyClauseFacts[] {
  const domains = BODY_POLICY_DOMAIN_ORDER.filter((domain) =>
    DOMAIN_EVIDENCE_PATTERNS[domain].test(clause),
  );
  return domains.flatMap((domain) =>
    classifyDomainFacts(clause, domain, inheritedPolicyContext),
  );
}

/**
 * @internal Build body-policy facts only after bounded statement groups have
 * established explicit and inherited workflow subjects.
 */
export function bodyPolicyStatementGroupFacts(
  text: string,
  clauseRanges: readonly EvidenceRange[],
): readonly BodyPolicyClauseFacts[] {
  return deduplicateBodyPolicyFacts(
    classifyStatementGroups(text, clauseRanges, {
      subject: undefined,
      policyContext: undefined,
    }),
  );
}

function classifyStatementGroups(
  text: string,
  clauseRanges: readonly EvidenceRange[],
  initialState: StatementAnalysisState,
  analyzePairedComponents = true,
): readonly BodyPolicyClauseFacts[] {
  const classified: BodyPolicyClauseFacts[] = [];
  for (const group of bodyPolicyStatementGroups(
    text,
    clauseRanges,
    initialState,
  )) {
    for (const predicate of group.predicates) {
      if (predicate.enclosure !== "unenclosed") continue;
      const predicateText = text.slice(
        predicate.range.start,
        predicate.range.end,
      );
      const relativeComponent = analyzePairedComponents
        ? pairedRelativePredicateComponent(text, predicate.range)
        : undefined;
      if (
        relativeComponent?.relationship === "subject-relative" &&
        relativeComponent.predicateRange !== undefined &&
        predicate.explicitSubject !== undefined
      ) {
        classified.push(
          ...classifyStatementGroups(
            text,
            clauseRangesWithin(relativeComponent.predicateRange, clauseRanges),
            {
              subject: predicate.explicitSubject,
              policyContext: predicate.policyContext,
            },
            false,
          ),
        );
      }
      if (
        relativeComponent !== undefined &&
        relativeComponent.relationship !== "unsupported" &&
        relativeComponent.mainPredicateRange !== undefined &&
        predicate.explicitSubject !== undefined
      ) {
        classified.push(
          ...classifyStatementGroups(
            text,
            clauseRangesWithin(
              relativeComponent.mainPredicateRange,
              clauseRanges,
            ),
            {
              subject: predicate.explicitSubject,
              policyContext: predicate.policyContext,
            },
            false,
          ),
        );
      }
      const explicitSubject =
        predicate.explicitSubject === undefined
          ? undefined
          : {
              start:
                predicate.explicitSubject.range.start - predicate.range.start,
              end: predicate.explicitSubject.range.end - predicate.range.start,
            };
      const inheritedSubject = predicate.inheritedSubject;
      const projectedFacts =
        inheritedSubject === undefined
          ? []
          : BODY_POLICY_DOMAIN_ORDER.flatMap((domain) => {
              const projected = projectedStatementFact(
                text,
                predicate,
                inheritedSubject,
                domain,
                predicate.policyContext,
              );
              return projected === undefined ? [] : [projected];
            });
      const projectedDomains = new Set(
        projectedFacts.flatMap(({ domain }) =>
          domain === undefined ? [] : [domain],
        ),
      );
      const directFacts = bodyPolicyClauseFacts(
        predicateText,
        predicate.policyContext !== undefined,
      ).map((fact) => {
        const scopeProof = directFactWorkflowScopeProof(
          predicateText,
          predicate,
          fact,
          explicitSubject,
        );
        const scopedFact = applyWorkflowScopeProof(fact, scopeProof);
        const localEvidenceStart =
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
          evidenceStart:
            scopeProof === "policy-context" &&
            predicate.policyContext !== undefined
              ? predicate.policyContext.evidenceStart
              : predicate.range.start + localEvidenceStart,
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
  return classified;
}

function clauseRangesWithin(
  range: EvidenceRange,
  clauseRanges: readonly EvidenceRange[],
): readonly EvidenceRange[] {
  const intersections = clauseRanges
    .filter(({ start, end }) => start < range.end && end > range.start)
    .map(({ start, end }) => ({
      start: Math.max(start, range.start),
      end: Math.min(end, range.end),
    }))
    .filter(({ start, end }) => start < end);
  return intersections.length > 0 ? intersections : [range];
}

function classifyDomainFacts(
  clause: string,
  domain: BodyPolicyDomain,
  inheritedPolicyContext: boolean,
): readonly BodyPolicyClauseFacts[] {
  const domainEvidence = recognizeEvidenceRange(
    clause,
    DOMAIN_EVIDENCE_PATTERNS[domain],
  ) ?? {
    start: 0,
    end: 0,
  };
  const pairedRelative = leadingBoundedPairedRelativeRange(clause);
  const candidateStaysWithinPredicate = (candidate: DomainCandidate): boolean =>
    pairedRelative === undefined ||
    candidate.predicateStart <= pairedRelative.start ||
    candidate.predicateStart >= pairedRelative.end ||
    candidate.end <= pairedRelative.end;
  const requirements = candidateEvidence(
    clause,
    NO_REQUIREMENT_PATTERNS[domain],
    "not-required",
  ).filter(candidateStaysWithinPredicate);
  const affirmativeRequirements = candidateEvidence(
    clause,
    AFFIRMATIVE_REQUIREMENT_PATTERNS[domain],
    "affirmative-requirement",
  )
    .filter(candidateStaysWithinPredicate)
    .filter(
      (candidate) =>
        !requirements.some((requirement) =>
          evidenceOverlaps(candidate, requirement),
        ),
    );
  const supportedProhibitions = candidateEvidence(
    clause,
    PROHIBITED_PATTERNS[domain],
    "supported-prohibition",
  ).filter(candidateStaysWithinPredicate);
  const genericProhibitions = candidateEvidence(
    clause,
    [GENERIC_PROHIBITION_PATTERNS[domain]],
    "generic-prohibition",
  ).filter(candidateStaysWithinPredicate);
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
    const modalNegation = classifyCandidateModalNegation(clause, candidate);
    const supportedPolicyContext =
      inheritedPolicyContext ||
      candidateHasSupportedPolicyContext(clause, candidate);
    const policyContextSupportsGenericModal =
      candidate.kind === "generic-prohibition" &&
      modalNegation !== undefined &&
      modalNegation.form !== "availability-state" &&
      supportedPolicyContext;
    const supportedProhibition =
      candidate.kind === "supported-prohibition" ||
      projectedSupportedEnd !== undefined ||
      policyContextSupportsGenericModal;
    const modalSupportsProhibition =
      modalNegation === undefined ||
      modalNegationSupportsProhibition(modalNegation, supportedPolicyContext);
    const baseModality =
      candidate.kind === "not-required"
        ? "not-required"
        : candidate.kind === "affirmative-requirement"
          ? "unknown"
          : modalSupportsProhibition
            ? "prohibited"
            : "unknown";
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
  kind: PatternProvenance,
): readonly DomainCandidate[] {
  return recognizeCandidateRanges(text, patterns, kind).map(
    ({ start, end }) => {
      const directWorkflowSubject =
        kind === "supported-prohibition"
          ? leadingWorkflowSubject(text, start, end)
          : undefined;
      return {
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
      };
    },
  );
}

function classifyCandidateModalNegation(
  text: string,
  candidate: DomainCandidate,
): ModalNegationSemantics | undefined {
  const syntax = recognizeModalNegation(
    text.slice(candidate.predicateStart, candidate.end),
  );
  if (syntax === undefined) return undefined;
  let classification: ModalNegationClassification;
  switch (syntax.word) {
    case "must":
    case "shall":
      classification = "deontic-prohibition";
      break;
    case "will":
      classification = "policy-commitment";
      break;
    case "should":
    case "may":
      classification = "recommendation";
      break;
    case "might":
      classification = "epistemic";
      break;
    case "can":
    case "could":
      classification = "capability";
      break;
    case "would":
      classification = "hypothetical";
      break;
  }
  return { classification, form: syntax.form };
}

function modalNegationSupportsProhibition(
  semantics: ModalNegationSemantics,
  supportedPolicyContext: boolean,
): boolean {
  if (semantics.form === "availability-state") return false;
  return (
    semantics.classification === "deontic-prohibition" ||
    semantics.classification === "policy-commitment" ||
    (supportedPolicyContext && semantics.classification === "recommendation")
  );
}

function candidateHasSupportedPolicyContext(
  text: string,
  candidate: DomainCandidate,
): boolean {
  const prefixEnd = candidate.directWorkflowSubject?.start ?? candidate.start;
  return prefixClassificationProvidesPolicyContext(
    standalonePolicyPrefixClassification(text.slice(0, prefixEnd)),
  );
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
  kind: PatternProvenance,
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
    const evidence = recognizeEvidenceRange(projection, pattern);
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

function candidateKindOrder(kind: PatternProvenance): number {
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

function supportedCandidatesForFact(
  predicate: string,
  fact: BodyPolicyClauseFacts,
  includePolicyModal: boolean,
): readonly DomainCandidate[] {
  const domain = fact.domain;
  if (domain === undefined) return [];
  const supported = candidateEvidence(
    predicate,
    PROHIBITED_PATTERNS[domain],
    "supported-prohibition",
  );
  const policyModals = includePolicyModal
    ? candidateEvidence(
        predicate,
        [GENERIC_PROHIBITION_PATTERNS[domain]],
        "generic-prohibition",
      ).filter((candidate) => {
        const modal = classifyCandidateModalNegation(predicate, candidate);
        return modal !== undefined && modal.form !== "availability-state";
      })
    : [];
  return [...supported, ...policyModals].filter(
    (candidate) =>
      candidate.predicateStart >= fact.evidenceStart &&
      candidate.end <= fact.evidenceEnd,
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
  segment: PredicateSegment,
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

  const candidates = supportedCandidatesForFact(
    predicate,
    fact,
    segment.policyContext !== undefined,
  );
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
    return outerPrefixSupportsEmbeddedWorkflowSubject(
      standalonePolicyPrefixClassification(
        predicate.slice(0, explicitSubject.start),
      ),
    )
      ? "prefixed-workflow-subject"
      : "explicit-workflow-subject";
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
    segment.policyContext !== undefined &&
    standaloneCandidates.length > 0
  ) {
    return "policy-context";
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
  return directlySupportedProhibitionStartsText(
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
  return pairedRelativeSubjectRelationship(modifier) !== "unsupported";
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
  predicate: PredicateSegment,
  workflowSubject: WorkflowSubjectMatch,
  domain: BodyPolicyDomain,
  policyContext: PolicyContextMatch | undefined,
): BodyPolicyClauseFacts | undefined {
  const subject = source.slice(
    workflowSubject.range.start,
    workflowSubject.range.end,
  );
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
    if (
      candidate.directWorkflowSubject !== undefined &&
      candidate.start === 0 &&
      candidate.end > prefix.length
    ) {
      return true;
    }
    const predicatePrefix = projection.slice(
      prefix.length,
      candidate.predicateStart,
    );
    return (
      candidate.predicateStart >= prefix.length &&
      (candidate.directWorkflowSubject !== undefined ||
        candidate.start >= prefix.length) &&
      directSubjectBridgeSupportsProhibition(
        classifyDirectSubjectBridge(predicatePrefix, domain),
      )
    );
  });
  if (supportedCandidate === undefined) return undefined;
  const fact = bodyPolicyClauseFacts(
    projection,
    policyContext !== undefined,
  ).find(
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
    evidenceStart: Math.min(
      workflowSubject.evidenceStart,
      policyContext?.evidenceStart ?? workflowSubject.evidenceStart,
    ),
    evidenceEnd:
      predicate.range.start +
      Math.max(0, inheritedFact.evidenceEnd - prefix.length),
  };
}

function leadingWorkflowSubject(
  text: string,
  start: number,
  end: number,
): EvidenceRange | undefined {
  return supportedWorkflowSubjectInRange(text, { start, end })?.range;
}
