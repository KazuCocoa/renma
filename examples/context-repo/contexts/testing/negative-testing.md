---
id: context.testing.negative-testing
title: Negative Testing
version: 0.1.0
owner: qa-platform
status: stable
tags:
  - testing
---

# Negative Testing

Negative testing verifies that invalid inputs and unsupported states fail clearly. It should confirm the user sees a useful error, the system avoids partial work, and any retry or recovery path is explicit.

Useful negative cases include missing required fields, malformed values, expired sessions, duplicate submissions, permission failures, and upstream service errors.
