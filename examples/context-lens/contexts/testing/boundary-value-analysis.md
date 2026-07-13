---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
tags:
  - testing
  - qa
when_to_use:
  - Designing or reviewing behavior around numeric, date, quantity, retry, or limit boundaries
when_not_to_use:
  - Reviewing copy, styling, or exploratory observations that do not depend on explicit boundaries
allowed_data:
  - repo-local-files
network_allowed: false
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: false
---
# Boundary Value Analysis

Boundary value analysis is reusable testing knowledge. It should stay as a base
Context Asset because it can support spec review, test design, regression
planning, onboarding, and other Skills.

When several workflows need reusable purpose-specific interpretation, keep that
interpretation in Context Lenses instead of copying this knowledge into each
Skill. A Skill may reference this Context directly when no Lens adds value.
