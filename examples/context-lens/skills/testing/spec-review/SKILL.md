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

The skill stays thin. It declares the reusable base context and the purpose-oriented lens, while the detailed knowledge remains in context assets and lens assets.

## Required Inputs

- The specification or product change to review.
- Any linked source-of-truth documents or implementation references.

## Instructions

1. Read the declared context assets.
2. Apply the declared context lens to focus the review.
3. Produce unresolved questions, risk notes, and clarification suggestions.

## When Not To Use

Use an implementation workflow for code changes, a decision owner for final
approval, or an editorial workflow for copy-only review.

## Validation

- The output distinguishes known facts from open questions.
- The output cites the source-of-truth gaps it found.
- The skill does not copy reusable testing guidance into this file.

## Completion Criteria

Complete when the output separates facts from unresolved questions, cites each
source-of-truth gap, records the applied Lens, and is ready for human review.
