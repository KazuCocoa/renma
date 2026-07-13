---
id: lens.testing.test-design.boundary-values
type: context_lens
owner: qa-platform
status: experimental
version: 1
scope: context
tags:
  - testing
  - test-design
purpose: test_design
applies_to:
  - context.testing.boundary-value-analysis
focus:
  - inclusive limits
  - empty and zero values
  - overflow behavior
  - retry limits
expected_outputs:
  - test cases
  - edge-case checklist
  - coverage notes
allowed_data:
  - repo-local-files
network_allowed: false
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: false
---
# Test Design Lens for Boundary Values

Interpret the applied boundary-value Context for test design that provides
reviewable evidence of behavior at and around material limits.

## Interpretation Criteria

- Map each declared limit to cases below, at, and above the boundary when those
  states are valid for the system.
- Distinguish inclusive from exclusive behavior and cover empty input, zero
  values, overflow, maximum retries, and expected failure modes when applicable.
- Trace each proposed case to a stated requirement and identify any expected
  result that the specification leaves unresolved.
- Prefer deterministic cases whose setup, assertion, and failure evidence can
  distinguish product behavior from a test defect.

## Evidence And Output

Produce test cases, an edge-case checklist, and coverage notes with requirement
citations. Keep unresolved expected results explicit. Do not select runtime
Context, assemble a prompt, define the Skill workflow, or duplicate the base
Context.
