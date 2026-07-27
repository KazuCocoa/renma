import type {
  ClassifiedSegment,
  StatementAnalysisState,
  StatementTransition,
} from "./model.js";

/**
 * @internal Apply the complete subject and policy-context retention policy for
 * one bounded predicate segment.
 */
export function transitionStatementState(
  previous: StatementAnalysisState,
  segment: ClassifiedSegment,
): StatementTransition {
  const hardBoundary = segment.boundary === "hard";
  const effectivePrevious = hardBoundary
    ? { subject: undefined, policyContext: undefined }
    : previous;

  if (segment.enclosure !== "unenclosed") {
    return {
      state: effectivePrevious,
      inheritedSubject: undefined,
      policyContext: undefined,
      subjectReason: hardBoundary ? "hard-boundary" : "opaque",
      policyContextReason: hardBoundary ? "hard-boundary" : "opaque",
    };
  }

  const mayInherit =
    !hardBoundary &&
    (segment.boundary === "inherited" || segment.initialComponent);
  const supportedStart =
    segment.startClassification === "supported-subjectless" ||
    segment.startClassification === "explicit-workflow-subject";
  const explicitPolicyContextApplies =
    segment.explicitPolicyContext !== undefined && supportedStart;
  const inheritedPolicyContext =
    !explicitPolicyContextApplies &&
    mayInherit &&
    effectivePrevious.policyContext !== undefined &&
    supportedStart
      ? effectivePrevious.policyContext
      : undefined;
  const policyContext = explicitPolicyContextApplies
    ? segment.explicitPolicyContext
    : inheritedPolicyContext;
  const inheritedSubject =
    segment.explicitSubject === undefined &&
    segment.explicitPolicyContext === undefined &&
    mayInherit &&
    effectivePrevious.subject !== undefined &&
    segment.startClassification === "supported-subjectless"
      ? effectivePrevious.subject
      : undefined;
  const subject = segment.explicitSubject ?? inheritedSubject;

  return {
    state: {
      subject,
      policyContext,
    },
    inheritedSubject,
    policyContext,
    subjectReason:
      segment.explicitSubject !== undefined
        ? "explicit"
        : inheritedSubject !== undefined
          ? "inherited"
          : hardBoundary
            ? "hard-boundary"
            : segment.explicitPolicyContext !== undefined
              ? "policy-context-without-subject"
              : "changed-or-unsupported",
    policyContextReason: explicitPolicyContextApplies
      ? "explicit"
      : inheritedPolicyContext !== undefined
        ? "inherited"
        : hardBoundary
          ? "hard-boundary"
          : "changed-or-unsupported",
  };
}
