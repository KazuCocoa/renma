---
name: spec-review
description: Review an incomplete product or test specification through focused clarification. Use when requirements need evidence-backed review notes; do not use for implementation or final approval.
metadata:
  renma.id: skill.testing.spec-review
  renma.title: Spec Review
  renma.version: "0.1.0"
  renma.owner: qa-platform
  renma.status: experimental
  renma.tags: '["testing","spec-review"]'
  renma.requires-context: '["contexts/testing/negative-testing.md"]'
  renma.optional-context: '["context.domain.payment.idempotency"]'
  renma.requires-lens: '["lens.testing.spec-review.boundary-values"]'
---

# Spec Review

## Routing

Use for incomplete specification clarification and evidence-backed review. The
agent follows this Skill; Renma validates it and its declared relationships.

## Required Inputs

- The incomplete request, available criteria, examples, and references.
- Known constraints, integrations, user states, and owners.

## Repository Context

This Skill is statically navigable inside this repository checkout. The
consuming agent must open these relative links; Renma validates the matching
asset IDs and relationships but does not load or inject their contents:

- [Spec Review Boundary Values Lens](../../../lenses/testing/spec-review-boundary-values.md)
- [Negative Testing](../../../contexts/testing/negative-testing.md)
- [Example asset index](../../../README.md#repository-assets), which locates the
  optional Payment Idempotency Context Asset for retryable payment writes

Copying this `SKILL.md` without its linked assets is not a complete workflow.

## Hard Constraints

- Do not invent requirements, sources, or ownership. Ask a focused question;
  when an answer is unavailable, record the gap and decision owner for human
  review.

## Clarification Workflow

1. Inspect the request and available references.
2. Separate facts from missing information, ambiguity, and conflicts.
3. Ask about the most consequential gap. Record each answer and its source.
4. Repeat until intended behavior, acceptance criteria, boundaries, error or
   retry behavior, and remaining decision owners are clear enough for review.
   Keep unavailable answers as unresolved questions.
5. Open the linked Lens and Context Assets. Apply the Lens to boundary-value
   analysis, use Negative Testing directly, and use Payment Idempotency only
   for retryable payment writes.
6. Record facts and sources, clarifications, assumptions, open questions,
   applied Context and rationale, and findings with evidence and impact.
7. Present the record to a human, who accepts, rejects, or corrects it.

## Validation

The review is ready for human judgment when each acceptance criterion has a
positive path, a negative or unsupported-state path where relevant, and each
material boundary or retry case. Unresolved issues remain explicit.
