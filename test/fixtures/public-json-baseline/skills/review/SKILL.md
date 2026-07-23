---
name: review
description: Review repository evidence and report deterministic results. Use when repository validation is requested; do not use for runtime selection or command execution.
metadata:
  renma.id: skill.review
  renma.status: stable
  renma.owner: qa-platform
  renma.requires-context: '["context.valid","context.invalid-status","context.missing-boundary","context.placeholder","context.inactive","context.missing-owner","context.unknown"]'
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
  renma.requires-human-approval: "true"
  renma.published-entrypoint: "true"
---
# Review

Review repository evidence and report completion.

## Required Inputs

- The repository evidence and requested validation scope.

## Preflight

Confirm the repository root and preserve all source content.

## Workflow

Review declared metadata, diagnostics, and dependency evidence.

## Examples

Use the Skill for deterministic repository validation, not runtime selection.

## Verification

Confirm every reported result is supported by repository evidence.

## Completion Criteria

Return the findings and verification status without modifying the repository.
