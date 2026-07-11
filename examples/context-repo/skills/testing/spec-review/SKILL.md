---
name: spec-review
description: Review a product or technical specification for ambiguity, missing boundaries, negative cases, and domain-specific risks before implementation. Use when turning a specification into review findings or test-design inputs. Do not use for executing tests, diagnosing an observed failure, or inventing product behavior that is absent from the source material.
metadata:
  renma.id: skill.testing.spec-review
  renma.title: Spec Review
  renma.owner: qa-platform
  renma.status: stable
  renma.tags: '["testing","spec-review"]'
  renma.when-to-use: '["Reviewing a product or technical specification before implementation","Identifying ambiguity, missing boundaries, negative cases, and domain-specific risks"]'
  renma.when-not-to-use: '["Executing tests or debugging an observed failure","Inferring product behavior that is not present in the source material"]'
  renma.requires-context: '["context.testing.boundary-value-analysis","context.testing.negative-testing"]'
  renma.optional-context: '["context.domain.payment.idempotency"]'
---

# Spec Review

## Use This Skill When

Use this skill to review a product or technical specification before implementation and produce explicit findings, unresolved questions, and test-design inputs.

## Do Not Use This Skill When

- The request is to execute tests or diagnose an already observed failure.
- Product behavior is missing from the source material and would have to be invented.

In those cases, stop and request the missing evidence or use the workflow that owns test execution or failure diagnosis.

## Required Inputs

- The specification or requirement under review.
- Relevant product context and source-of-truth references.
- Any known platform, policy, or compatibility constraints.

## Instructions

1. Identify the specification's stated behavior and acceptance boundaries.
2. Apply the required testing contexts for boundary and negative-case analysis.
3. Load optional domain context only when the specification touches that domain.
4. Record ambiguities and missing evidence instead of resolving them by assumption.
5. Produce review findings, unresolved questions, and candidate test-design inputs.

## Context References

- Required: `context.testing.boundary-value-analysis`.
- Required: `context.testing.negative-testing`.
- Optional: `context.domain.payment.idempotency` when payment behavior is in scope.

## Hard Constraints

- Do not invent product behavior, acceptance criteria, or domain policy.
- Do not convert unresolved ambiguity into an asserted requirement.
- Do not execute tests or diagnose runtime failures from this review-only skill.
- When evidence is missing, stop at a clearly labeled unresolved question.

## Validation

- Confirm every finding is traceable to source text or a declared context asset.
- Confirm negative and boundary cases are represented where applicable.
- Confirm assumptions are labeled and unresolved questions remain explicit.
