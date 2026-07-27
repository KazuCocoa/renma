import assert from "node:assert/strict";
import test from "node:test";

import type {
  ClassifiedSegment,
  PolicyContextMatch,
  StatementAnalysisState,
  WorkflowSubjectMatch,
} from "../src/security-body-policy/model.js";
import { transitionStatementState } from "../src/security-body-policy/statement-state.js";

const SUBJECT: WorkflowSubjectMatch = {
  range: { start: 0, end: 13 },
  evidenceStart: 0,
};
const POLICY: PolicyContextMatch = {
  range: { start: 0, end: 7 },
  evidenceStart: 0,
};
const EMPTY_STATE: StatementAnalysisState = {
  subject: undefined,
  policyContext: undefined,
};

test("statement transitions establish and inherit workflow subjects", () => {
  const explicit = transitionStatementState(
    EMPTY_STATE,
    segment({
      explicitSubject: SUBJECT,
      startClassification: "explicit-workflow-subject",
    }),
  );
  assert.equal(explicit.state.subject, SUBJECT);
  assert.equal(explicit.subjectReason, "explicit");

  const inherited = transitionStatementState(
    explicit.state,
    segment({
      boundary: "inherited",
      startClassification: "supported-subjectless",
      initialComponent: false,
    }),
  );
  assert.equal(inherited.inheritedSubject, SUBJECT);
  assert.equal(inherited.state.subject, SUBJECT);
  assert.equal(inherited.subjectReason, "inherited");
});

test("policy context transitions independently from grammatical subject", () => {
  const explicitPolicy = transitionStatementState(
    EMPTY_STATE,
    segment({
      explicitPolicyContext: POLICY,
      startClassification: "supported-subjectless",
    }),
  );
  assert.equal(explicitPolicy.state.subject, undefined);
  assert.equal(explicitPolicy.state.policyContext, POLICY);
  assert.equal(explicitPolicy.subjectReason, "policy-context-without-subject");

  const inheritedPolicy = transitionStatementState(
    explicitPolicy.state,
    segment({
      boundary: "inherited",
      startClassification: "supported-subjectless",
      initialComponent: false,
    }),
  );
  assert.equal(inheritedPolicy.state.subject, undefined);
  assert.equal(inheritedPolicy.policyContext, POLICY);
  assert.equal(inheritedPolicy.policyContextReason, "inherited");
});

test("changed, subordinate, opaque, and hard boundaries have explicit state outcomes", () => {
  const previous = { subject: SUBJECT, policyContext: POLICY };
  for (const startClassification of [
    "explicit-changed-subject",
    "conditional-or-subordinate",
    "unsupported",
  ] as const) {
    const changed = transitionStatementState(
      previous,
      segment({
        boundary: "inherited",
        startClassification,
        initialComponent: false,
      }),
    );
    assert.deepEqual(changed.state, EMPTY_STATE);
    assert.equal(changed.subjectReason, "changed-or-unsupported");
    assert.equal(changed.policyContextReason, "changed-or-unsupported");
  }

  const opaque = transitionStatementState(
    previous,
    segment({
      boundary: "opaque",
      enclosure: "straight-double-quoted",
      initialComponent: false,
    }),
  );
  assert.deepEqual(opaque.state, previous);
  assert.equal(opaque.inheritedSubject, undefined);
  assert.equal(opaque.policyContext, undefined);
  assert.equal(opaque.subjectReason, "opaque");

  const hard = transitionStatementState(
    previous,
    segment({
      boundary: "hard",
      explicitSubject: SUBJECT,
      startClassification: "explicit-workflow-subject",
      initialComponent: false,
    }),
  );
  assert.equal(hard.state.subject, SUBJECT);
  assert.equal(hard.state.policyContext, undefined);
  assert.equal(hard.subjectReason, "explicit");

  const hardClear = transitionStatementState(
    previous,
    segment({
      boundary: "hard",
      initialComponent: false,
    }),
  );
  assert.deepEqual(hardClear.state, EMPTY_STATE);
  assert.equal(hardClear.subjectReason, "hard-boundary");
  assert.equal(hardClear.policyContextReason, "hard-boundary");
});

function segment(overrides: Partial<ClassifiedSegment>): ClassifiedSegment {
  return {
    boundary: "start",
    enclosure: "unenclosed",
    startClassification: "unsupported",
    explicitSubject: undefined,
    explicitPolicyContext: undefined,
    initialComponent: true,
    ...overrides,
  };
}
