---
id: lens.testing.spec-review.boundary-values
type: context_lens
owner: qa-platform
status: experimental
version: 1
scope: context
tags:
  - testing
  - spec-review
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
focus: ambiguity, missing boundary, source of truth, confirmation questions
expected_outputs: unresolved questions, risk notes, spec clarification suggestions
allowed_data:
  - repo-local-files
network_allowed: false
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: false
---
# Spec Review Lens for Boundary Values

Use this lens when reading boundary value analysis context during spec review.

Emphasize whether the spec defines exact lower and upper bounds, inclusive or exclusive behavior, empty or zero cases, overflow handling, retry limits, and ownership of the source of truth.

The lens should help produce review questions and risk notes. It should not duplicate the base boundary value analysis context or become a prompt template.
