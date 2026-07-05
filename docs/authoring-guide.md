# Renma Authoring Guide

Use this guide when creating or refining Renma skills and context assets. For CLI command syntax, see the [User Manual](user-manual.md). For security-sensitive skills or context assets, read the [Security Policy Guide](security-policy.md). For finding details, use the [Diagnostics Reference](diagnostics.md). For shared-context wording guidance, see [Context Language Diagnostics](context-language-diagnostics.md).

Renma is a tool-assisted authoring and verification layer. It emits deterministic repository evidence that humans and external LLM tools can use, but Renma does not call an LLM, choose runtime context, assemble prompts, inject context into agents, execute agent workflows, or own runtime telemetry.

A practical authoring loop is:

```text
scaffold
-> edit skill/context
-> inspect
-> scan
-> catalog
-> focused graph
-> readiness
-> give Renma output to an external LLM if useful
-> human reviews patch
-> rerun Renma
```

Principle:

```text
LLM proposes. Renma verifies. Human approves.
```

## Recommended Metadata

Assets can use simple YAML-style metadata at the top of Markdown files. For shared context assets, start with a small, deterministic block like this:

```yaml
---
id: context.testing.boundary-value-analysis
title: Boundary Value Analysis
owner: qa-platform
status: stable
version: 1.0.0
tags:
  - testing
  - qa
when_to_use:
  - Designing tests around numeric, date, quantity, or limit boundaries
when_not_to_use:
  - Exploratory testing notes that do not depend on boundaries
requires_context:
  - context.testing.negative-testing
optional_context:
  - context.testing.regression-risk
---
```

Use these fields consistently:

- `id`: stable catalog asset ID. It should be deterministic and should not change when the file moves unless the asset's identity changes.
- `title`: human-readable title.
- `owner`: real owning team or maintainer. Avoid placeholder ownership in shared assets.
- `status`: lifecycle only: `experimental`, `stable`, `deprecated`, or `archived`.
- `version`: optional asset metadata. It is not the npm package version.
- `tags`: searchable labels that help navigation, ownership review, and reporting.
- `when_to_use` and `when_not_to_use`: scope guidance for humans and agents.
- `requires_context` and `optional_context`: static graph relationships to other assets. They do not make renma select runtime context.
- `conflicts`: assets that should not be used together without review.
- `superseded_by`: replacement or migration relationships for deprecated or archived content.

The supported list-style metadata fields are `tags`, `when_to_use`, `when_not_to_use`, `requires_context`, `optional_context`, `conflicts`, and `superseded_by`.

Keep `when_to_use` and `when_not_to_use` compact. They are routing boundaries for catalog and graph review, not full procedures. Put detailed explanation, examples, caveats, and rationale in the Markdown body or referenced context assets.

For shared context bodies, avoid leaving English vague wording such as `usually`, `often`, `quickly`, or `as needed` without a concrete condition, threshold, required evidence, or explicit uncertainty-handling rule. Avoid relative currentness wording such as `recently`, `latest`, `currently`, or `as of now` unless the same line includes a stable date or version.

## Skill vs Context Metadata

Skills are agent-facing entrypoints and routing contracts. They explain when a capability applies, what safety or preflight checks matter, and which owned context assets are relevant.

Context assets are independently owned source-of-truth knowledge units. They should carry stronger ownership, lifecycle, usage-boundary, and dependency metadata because they are intended to outlive a single skill.

Keep skills thin. A skill should reference context assets instead of embedding all reusable knowledge directly in `SKILL.md`.

Example skill metadata:

```yaml
---
id: skill.testing.spec-review
title: Spec Review
owner: qa-platform
status: stable
tags:
  - testing
  - spec-review
requires_context:
  - context.testing.boundary-value-analysis
  - context.testing.negative-testing
optional_context:
  - context.domain.payment.idempotency
---
```

## First Skill Walkthrough

Use `scaffold` when you want a safe starter file for a new skill. This command creates a minimal skill entrypoint:

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md \
  --id skill.testing.spec-review \
  --title "Spec Review" \
  --owner qa-platform \
  --tags testing,spec-review
```

If you want to hand the scaffold and authoring constraints to an external or local LLM before creating the file, emit a prompt instead:

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md \
  --id skill.testing.spec-review \
  --title "Spec Review" \
  --owner qa-platform \
  --tags testing,spec-review \
  --format prompt > spec-review-authoring-prompt.md
```

Review the prompt, add any repository-specific evidence or constraints, then give it to your LLM tool. The LLM should propose a repository patch; Renma still verifies the result after you apply and review it.

The generated file is intentionally small. Treat it as a starting point for review, not as a complete skill. Fill in these sections before depending on it:

- Purpose: the recurring task, decision, or workflow the skill guides.
- Required Inputs: the evidence, files, issue links, specs, diffs, or user answers needed before work begins.
- Instructions: the routing steps, preflight checks, decision points, and expected handoff.
- Context References: the durable context assets listed in `requires_context` and `optional_context`.
- Constraints: safety, ownership, policy, and product-boundary rules the agent must preserve.
- Validation: the checks that prove the result is ready to review.

A beginner-friendly authoring loop is:

```bash
renma inspect skills/testing/spec-review/SKILL.md
renma scan .
renma catalog . --format json
renma graph . --focus skill.testing.spec-review --format mermaid
renma readiness . --format markdown
```

Renma does not call an LLM, choose runtime task context, assemble live prompts, inject context into agents, execute agent workflows, or own runtime telemetry. It emits deterministic repository evidence. You can give that evidence to your own local or external LLM tool:

1. Give the scaffolded skill or scaffold prompt to the LLM.
2. Give relevant `renma inspect`, `scan`, `catalog`, `graph`, or `readiness` output.
3. Ask the LLM to propose a patch.
4. Review the patch as a human owner.
5. Run Renma again.
6. Repeat until the skill is thin, owned, linked, and ready.

Copyable prompt:

```text
I am authoring a Renma skill.

Use the scaffolded skill and Renma diagnostics below.
Propose a minimal patch that:
- keeps the skill as a thin routing contract
- moves reusable knowledge into context assets
- preserves supported metadata fields
- adds required/optional context references where appropriate
- fixes Renma findings without weakening safety policy
- does not invent owners, policies, dependencies, or domain facts

Renma output:
<paste scan/catalog/graph/readiness output here>
```

For finding details, use the finding ID in the output and check [Diagnostics Reference](diagnostics.md).

### When To Create Context Assets

Skills should not absorb all reusable knowledge. Keep the skill as the agent-facing routing contract, and move durable knowledge into owned context assets.

A skill should contain:

- when to use the capability
- when not to use it
- required inputs
- routing and preflight guidance
- which context assets to reference
- expected output and validation

A context asset should contain:

- reusable domain knowledge
- testing heuristics
- setup constraints
- tool limitations
- team-specific policy or risk
- platform-specific facts
- source-backed guidance that can outlive one skill

Example layout:

```text
Skill:
  skills/testing/spec-review/SKILL.md

Shared context:
  contexts/testing/boundary-value-analysis.md
  contexts/testing/negative-testing.md
  contexts/domain/payment/idempotency.md
```

The skill can declare static repository relationships:

```yaml
requires_context:
  - context.testing.boundary-value-analysis
  - context.testing.negative-testing
optional_context:
  - context.domain.payment.idempotency
```

Renma records and verifies these relationships in the repository catalog and graph. It does not select runtime context for a task.

## Deriving A New Router From An Existing Skill

A repository may already contain a broad skill category such as setup, test code generation, spec review, regression planning, or release preparation. Over time, teams may need separate routers for the same category:

```text
setup
├── setup-repository
├── setup-environment
└── setup-ci
```
