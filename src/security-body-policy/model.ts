/** @internal Physical offsets into the prepared Markdown source. */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/** @internal Physical offsets owned by a fact or projected finding. */
export type EvidenceRange = SourceRange;

export const BODY_POLICY_DOMAIN_ORDER = Object.freeze([
  "network",
  "upload",
  "secrets",
] as const);

export type BodyPolicyDomain = (typeof BODY_POLICY_DOMAIN_ORDER)[number];

export type BodyPolicyModality =
  "prohibited" | "not-required" | "local-safeguard" | "unknown";

export type BodyPolicyScope =
  "workflow" | "local-step" | "specific-target" | "specific-source" | "unknown";

type BodyPolicyCompleteness = "complete" | "unsupported-remainder";

export interface BodyPolicyClauseFacts {
  readonly domain: BodyPolicyDomain | undefined;
  readonly modality: BodyPolicyModality;
  readonly scope: BodyPolicyScope;
  readonly completeness: BodyPolicyCompleteness;
  readonly evidenceStart: number;
  readonly evidenceEnd: number;
}

export interface WorkflowSubjectMatch {
  readonly range: SourceRange;
  readonly evidenceStart: number;
}

export interface PolicyContextMatch {
  readonly range: SourceRange;
  readonly evidenceStart: number;
}

export type EnclosureProvenance =
  | "unenclosed"
  | "straight-double-quoted"
  | "straight-single-quoted"
  | "curly-double-quoted"
  | "curly-single-quoted"
  | "escaped-visible-quoted";

export interface EnclosureRange extends SourceRange {
  readonly provenance: Exclude<EnclosureProvenance, "unenclosed">;
}

type StatementBoundary = "start" | "inherited" | "opaque" | "hard";

export type PredicateStartClassification =
  | "explicit-workflow-subject"
  | "supported-subjectless"
  | "explicit-changed-subject"
  | "conditional-or-subordinate"
  | "unsupported";

export interface ScopeClassification {
  readonly scope: BodyPolicyScope;
  readonly supportedEnd: number;
}

export type PatternProvenance =
  | "not-required"
  | "affirmative-requirement"
  | "supported-prohibition"
  | "generic-prohibition";

export interface LexicalCandidate extends SourceRange {
  readonly provenance: PatternProvenance;
}

export interface DomainCandidate extends SourceRange {
  readonly kind: PatternProvenance;
  readonly predicateStart: number;
  readonly directWorkflowSubject: SourceRange | undefined;
}

export type ModalNegationClassification =
  | "deontic-prohibition"
  | "policy-commitment"
  | "recommendation"
  | "epistemic"
  | "capability"
  | "hypothetical";

export type ModalNegationWord =
  | "must"
  | "shall"
  | "will"
  | "should"
  | "would"
  | "may"
  | "might"
  | "can"
  | "could";

export type ModalNegationForm =
  | "never"
  | "active-action"
  | "passive-action"
  | "permission-state"
  | "availability-state";

export interface ModalNegationSemantics {
  readonly classification: ModalNegationClassification;
  readonly form: ModalNegationForm;
}

export interface ModalNegationSyntax {
  readonly word: ModalNegationWord;
  readonly form: ModalNegationForm;
}

export type DirectSubjectBridgeClassification =
  | "immediate"
  | "composed"
  | "explicit-changed-subject"
  | "conditional-or-subordinate"
  | "local-step-scope"
  | "specific-source-or-target"
  | "exception-or-allowance"
  | "quoted-or-descriptive"
  | "unsupported";

export type WorkflowScopeProof =
  | "standalone-default"
  | "explicit-workflow-subject"
  | "prefixed-workflow-subject"
  | "inherited-workflow-subject"
  | "policy-context"
  | "explicit-workflow-qualifier"
  | "no-workflow-proof";

export type StandalonePolicyPrefixClassification =
  | "plain-start"
  | "directive-prefix"
  | "policy-label"
  | "composed-policy-prefix"
  | "descriptive-prefix"
  | "changed-subject-prefix"
  | "unsupported-prefix";

export interface PredicateSegment {
  readonly range: SourceRange;
  readonly separator: SourceRange;
  readonly enclosure: EnclosureProvenance;
  readonly boundary: StatementBoundary;
  readonly startClassification: PredicateStartClassification;
  readonly explicitSubject: WorkflowSubjectMatch | undefined;
  readonly inheritedSubject: WorkflowSubjectMatch | undefined;
  readonly policyContext: PolicyContextMatch | undefined;
  readonly independentStandaloneBoundary: boolean;
}

export interface StatementGroup {
  readonly sourceText: string;
  readonly range: SourceRange;
  readonly explicitSubject: WorkflowSubjectMatch | undefined;
  readonly predicates: readonly PredicateSegment[];
}

export type SubjectRelationship =
  "subject-relative" | "object-relative" | "unsupported";

export interface RelativePredicateComponent {
  readonly relationship: SubjectRelationship;
  readonly predicateRange: SourceRange | undefined;
  readonly mainPredicateRange: SourceRange | undefined;
}

export interface StatementAnalysisState {
  readonly subject: WorkflowSubjectMatch | undefined;
  readonly policyContext: PolicyContextMatch | undefined;
}

export interface ClassifiedSegment {
  readonly boundary: StatementBoundary;
  readonly enclosure: EnclosureProvenance;
  readonly startClassification: PredicateStartClassification;
  readonly explicitSubject: WorkflowSubjectMatch | undefined;
  readonly explicitPolicyContext: PolicyContextMatch | undefined;
  readonly initialComponent: boolean;
}

export interface StatementTransition {
  readonly state: StatementAnalysisState;
  readonly inheritedSubject: WorkflowSubjectMatch | undefined;
  readonly policyContext: PolicyContextMatch | undefined;
  readonly subjectReason:
    | "explicit"
    | "inherited"
    | "opaque"
    | "hard-boundary"
    | "policy-context-without-subject"
    | "changed-or-unsupported";
  readonly policyContextReason:
    | "explicit"
    | "inherited"
    | "opaque"
    | "hard-boundary"
    | "changed-or-unsupported";
}
