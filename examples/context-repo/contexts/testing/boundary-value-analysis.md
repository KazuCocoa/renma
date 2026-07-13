---
id: context.testing.boundary-value-analysis
title: Boundary Value Analysis
version: 0.1.0
owner: qa-platform
status: stable
tags:
  - testing
when_to_use:
  - Designing test cases around numeric, date, count, length, or pagination limits
when_not_to_use:
  - Testing invalid inputs that are not tied to explicit boundary values
allowed_data:
  - repo-local-files
  - disclosed-user-provided-data
network_allowed: false
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
---

# Boundary Value Analysis

Boundary value analysis checks the values just below, at, and just above important limits. Use it for limits such as quantity, length, date range, retry count, price, and pagination size.

Prefer examples that name the limit and the expected behavior. A good case says what happens at the minimum, the maximum, and the first invalid value outside each edge.
