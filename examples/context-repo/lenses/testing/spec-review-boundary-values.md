---
id: lens.testing.spec-review.boundary-values
type: context_lens
title: Spec Review Boundary Values Lens
version: 1
owner: qa-platform
status: stable
tags:
  - testing
  - spec-review
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
focus:
  - missing limits
  - inclusive and exclusive boundaries
  - empty and zero values
  - overflow and retry limits
expected_outputs:
  - focused clarification questions
  - boundary-related review findings
  - unresolved source-of-truth gaps
---

# Spec Review Boundary Values Lens

Interpret [Boundary Value Analysis](../../contexts/testing/boundary-value-analysis.md)
for specification review. Identify missing limits, whether endpoints are
inclusive or exclusive, behavior for empty and zero values, overflow behavior,
and retry limits.

Ask focused questions when the specification does not define those decisions.
Record unresolved source-of-truth gaps instead of inventing a boundary. This
Lens guides the consuming agent's interpretation; Renma validates its metadata
and relationship to the Context Asset but does not apply the Lens at runtime.
