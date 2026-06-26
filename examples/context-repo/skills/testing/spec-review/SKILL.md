---
id: skill.testing.spec-review
title: Spec Review
version: 0.1.0
owner: qa-platform
status: experimental
tags:
  - testing
  - spec-review
requires_context:
  - context.testing.boundary-value-analysis
  - context.testing.negative-testing
optional_context:
  - context.domain.payment.idempotency
---

# Spec Review

## Purpose

Use this skill to review a product or test specification before implementation starts. It turns requirements into concrete review notes that a tester, engineer, or product owner can act on.

## Required Inputs

- The feature or change summary.
- Acceptance criteria or examples.
- Known constraints, integrations, and user states.

## Instructions

1. Identify the main behavior the spec promises.
2. Check boundary values, empty states, invalid inputs, and retry paths.
3. Compare each risk against the context assets listed in this skill.
4. Group findings by severity and owner.
5. Recommend the smallest follow-up that would make the spec testable.

## Validation

The review is complete when every acceptance criterion has at least one positive path, one negative path, and any relevant boundary case.

## Context References

- `context.testing.boundary-value-analysis`
- `context.testing.negative-testing`
- `context.domain.payment.idempotency`
