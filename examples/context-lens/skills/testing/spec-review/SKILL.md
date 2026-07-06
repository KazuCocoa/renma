---
id: skill.testing.spec-review
owner: qa-platform
status: experimental
tags:
  - testing
  - spec-review
requires_context:
  - context.testing.boundary-value-analysis
requires_lens:
  - lens.testing.spec-review.boundary-values
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
