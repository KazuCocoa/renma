---
id: context.testing.negative-testing
title: Negative Testing
version: 0.1.0
owner: qa-platform
status: stable
tags:
  - testing
when_to_use:
  - Designing validation, unsupported-state, or error-handling test cases
when_not_to_use:
  - Designing accepted boundary-value cases for valid limits
allowed_data:
  - repo-local-files
  - disclosed-user-provided-data
network_allowed: false
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
---

# Negative Testing

Negative testing verifies that invalid inputs and unsupported states fail clearly. It should confirm the user sees a useful error, the system avoids partial work, and any retry or recovery path is explicit.

Useful negative cases include missing required fields, malformed values, expired sessions, duplicate submissions, permission failures, and upstream service errors.
