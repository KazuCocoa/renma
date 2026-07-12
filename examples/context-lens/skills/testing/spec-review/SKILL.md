---
name: spec-review
description: Review a specification through declared context and lenses. Use when implementation or test-design boundaries need focused analysis.
metadata:
  renma.id: skill.testing.spec-review
  renma.owner: qa-platform
  renma.status: experimental
  renma.tags: '["testing","spec-review"]'
  renma.requires-context: '["context.testing.boundary-value-analysis"]'
  renma.requires-lens: '["lens.testing.spec-review.boundary-values"]'
  renma.optional-lens: '["lens.testing.test-design.boundary-values"]'
---
# Spec Review

Use this skill to review a specification before implementation or test design.

The skill stays thin. It declares the reusable base context and the purpose-oriented lens, while the detailed knowledge remains in context assets and lens assets.

## Required Inputs

- The specification or product change to review.
- Any linked source-of-truth documents or implementation references.

## Instructions

1. Read the declared context assets.
2. Apply the declared context lens to focus the review.
3. Produce unresolved questions, risk notes, and clarification suggestions.

## Validation

- The output distinguishes known facts from open questions.
- The output cites the source-of-truth gaps it found.
- The skill does not copy reusable testing guidance into this file.
