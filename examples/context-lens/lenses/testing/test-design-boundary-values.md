---
id: lens.testing.test-design.boundary-values
type: context_lens
owner: qa-platform
status: experimental
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
---
# Test Design Lens for Boundary Values

Use this lens when turning boundary value analysis context into concrete test coverage.

Emphasize lower and upper bounds, inclusive and exclusive behavior, empty input, zero values, overflow, maximum retries, and expected failure modes.

The lens should help produce test cases and coverage notes. It should not select runtime context, assemble a prompt, or duplicate the base boundary value analysis context.
