---
name: spec-review
description: Review a specification through the boundary-value context lens and produce ambiguity, missing-boundary, and risk findings before implementation. Use when the specification contains numeric, date, quantity, or limit behavior. Do not use for exploratory notes unrelated to limits, test execution, or failure diagnosis.
metadata:
  renma.id: skill.testing.spec-review
  renma.title: Spec Review
  renma.owner: qa-platform
  renma.status: experimental
  renma.tags: '["testing","spec-review"]'
  renma.requires-context: '["context.testing.boundary-value-analysis"]'
  renma.requires-lens: '["lens.testing.spec-review.boundary-values"]'
---

# Spec Review

## Use This Skill When

Use this skill when reviewing a specification whose behavior depends on numeric, date, quantity, or limit boundaries and the boundary-value lens should guide interpretation.

## Do Not Use This Skill When

- The request is an exploratory note unrelated to limits or boundaries.
- The request is to execute tests or diagnose an observed failure.

Use a more appropriate review or execution workflow instead of stretching this lens beyond its declared scope.

## Required Inputs

- The specification under review.
- The boundary-value context and lens declared in metadata.
- Source evidence for the relevant limits, ranges, defaults, and invalid values.

## Instructions

1. Read the required boundary-value context.
2. Apply the declared context lens to identify ambiguity and missing boundaries.
3. Record unresolved limits and risk notes without inventing values.
4. Produce findings suitable for human review and downstream test design.

## Context References

- Required context: `context.testing.boundary-value-analysis`.
- Required lens: `lens.testing.spec-review.boundary-values`.

## Hard Constraints

- Do not invent limits, defaults, or acceptance criteria.
- Do not use the lens as a runtime prompt selector or context injection rule.
- Do not execute tests or diagnose observed failures from this review skill.
- When a boundary is absent, record it as missing evidence.

## Validation

- Confirm each finding identifies the source boundary or the absence of one.
- Confirm outputs include ambiguity, missing-boundary, or risk evidence as appropriate.
- Confirm no ungrounded value was introduced.
