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
focus:
  - ambiguity
  - missing boundary
  - source of truth
  - confirmation questions
expected_outputs:
  - unresolved questions
  - risk notes
  - spec clarification suggestions
allowed_data:
  - repo-local-files
network_allowed: false
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: false
---
# Spec Review Lens for Boundary Values

Interpret the applied boundary-value Context from the perspective of an
experienced QA reviewer responsible for finding specification risk before
implementation.

## Interpretation Criteria

- Determine whether each material limit has an exact value and an identified
  source of truth.
- Check whether lower and upper bounds are inclusive or exclusive and whether
  empty, zero, overflow, and retry-limit behavior is specified.
- Identify conflicting requirements, undefined ownership, and assumptions that
  could lead implementations or tests to disagree.
- Distinguish documented facts from inferred behavior and unresolved decisions.

## Evidence And Output

Cite the specification section or repository source behind every conclusion.
Produce prioritized unresolved questions, risk notes, and clarification
suggestions. Do not duplicate the base Context, define the Skill workflow, or
turn this Lens into a prompt template.
