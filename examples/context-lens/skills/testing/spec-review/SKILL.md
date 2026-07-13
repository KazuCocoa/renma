---
name: spec-review
description: Review a specification through declared Context Assets and Context Lenses. Use when implementation or test-design boundaries need focused analysis; do not use for implementation, final approval, or unrelated editorial review.
metadata:
  renma.id: skill.testing.spec-review
  renma.owner: qa-platform
  renma.status: experimental
  renma.tags: '["testing","spec-review"]'
  renma.requires-context: '["context.testing.boundary-value-analysis"]'
  renma.requires-lens: '["lens.testing.spec-review.boundary-values"]'
  renma.optional-lens: '["lens.testing.test-design.boundary-values"]'
  renma.allowed-data: '["repo-local-files"]'
  renma.network-allowed: "false"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
  renma.requires-human-approval: "false"
---
# Spec Review

Use this skill to review a specification before implementation or test design.

This Skill owns the focused review workflow. The declared Context Asset owns
reusable boundary-value knowledge, and the declared Lenses own purpose-specific
interpretation of that knowledge.

## Selection Boundaries

Use this workflow when a specification needs evidence-backed analysis of
implementation or test-design boundaries. Do not use it to implement the
change, approve product decisions, or perform unrelated editorial review.

## Required Inputs

- The specification or product change to review.
- Any linked source-of-truth documents or implementation references.

## Instructions

1. Confirm that the supplied specification and its sources are available. If a
   required source is missing, record the gap rather than inventing behavior.
2. Read the declared boundary-value Context Asset and the required spec-review
   Lens. Apply the optional test-design Lens only when test coverage is also in
   scope for the requested review.
3. Extract stated behavior, limits, assumptions, and sources from the supplied
   specification. Keep facts separate from inferences and unresolved questions.
4. Apply the required Lens's interpretation criteria to the reusable Context.
   Cite the reusable guidance where relevant instead of reproducing it in this
   Skill or output.
5. Prioritize findings by implementation or release risk. Cite the relevant
   specification section or repository evidence for every finding.
6. Produce the expected output below and leave decisions with the accountable
   human owner.

## Expected Output

- A short scope and evidence summary.
- Prioritized unresolved questions and risk notes.
- Clarification suggestions tied to cited source gaps.
- The Context and Lens IDs applied, including why the optional Lens was or was
  not used.

## When Not To Use

Use an implementation workflow for code changes, a decision owner for final
approval, or an editorial workflow for copy-only review.

## Validation

- The output distinguishes known facts from open questions.
- The output cites the source-of-truth gaps it found.
- Each finding has an impact or risk and an evidence-backed rationale.
- Use of the optional Lens matches the requested review scope.
- The skill does not copy reusable testing guidance into this file.

## Completion Criteria

Complete when the output separates facts from unresolved questions, cites each
source-of-truth gap, records the applied Lens, and is ready for human review.
