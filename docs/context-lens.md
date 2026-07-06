# Context Lens Assets

`context_lens` is an experimental Renma asset type for purpose-oriented interpretation over reusable context assets.

It keeps the existing Renma boundary intact:

```text
Renma catalogs and validates repository assets.
Agents and tools decide what to do at runtime.
```

Renma does not select lenses for a task, rank lenses, assemble prompts, inject context, or run an LLM to judge lens quality.

## Model

```text
references -> contexts -> context_lenses -> skills
```

The design principle is:

```text
Knowledge should be reusable.
Interpretation should be purpose-oriented.
Execution should be skill-specific.
```

Use this split when the same base context should be read differently for different purposes.

For example, a payment retry context can support:

- a spec review lens that focuses on ambiguity and source-of-truth gaps
- a test design lens that focuses on boundary values and expected results
- a failure analysis lens that focuses on observed symptoms and logs

The base context remains reusable. The lens explains how that context should be interpreted for a purpose.

## Lens metadata

Prefer compact, flat metadata. Detailed interpretation guidance belongs in the Markdown body, not in frontmatter.

```yaml
---
id: lens.testing.spec-review.boundary-values
type: context_lens
title: Spec Review Lens for Boundary Values
owner: qa-platform
status: experimental
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
expected_outputs:
  - unresolved questions
  - risk notes
---
```

Supported experimental lens fields:

- `type: context_lens`: identifies a lens for files under `context/` or `contexts/`.
- `purpose`: short purpose label such as `spec_review`, `test_design`, or `failure_analysis`.
- `applies_to`: context asset IDs this lens interprets.
- `focus`: compact review focus terms.
- `expected_outputs`: compact output expectations.

`context_lens` is the only supported `type` value today. Other `type` strings may parse as raw metadata, but Renma does not assign them catalog meaning.

## Skill metadata

A skill can declare static lens relationships:

```yaml
---
id: skill.testing.spec-review
owner: qa-platform
status: experimental
requires_context:
  - context.testing.boundary-value-analysis
requires_lens:
  - lens.testing.spec-review.boundary-values
---
```

`requires_lens` and `optional_lens` are graph metadata. They do not make Renma select runtime context or inject the lens into an agent.

## Good lens boundaries

A lens should answer:

- What purpose is this context being read for?
- Which context assets does it apply to?
- What questions, risks, checks, or evidence should be emphasized?
- What output shape should the agent or human reviewer produce?

A lens should not become:

- a copy of the base context
- a long prompt template
- a runtime routing rule
- a QA-specific rule hardcoded into Renma core
- a replacement for the skill entrypoint

## Implementation status

Initial support is intentionally small:

- `context_lens` assets are cataloged.
- `lenses/**/*.md` is scanned by default.
- `type: context_lens` can classify a context asset as a lens.
- `applies_to`, `requires_lens`, and `optional_lens` create graph edges.
- missing lens `purpose` or `applies_to` metadata is reported for active canonical lenses.
- missing referenced lens or context IDs are reported through deterministic dependency diagnostics.

Future work may improve `inspect`, `scaffold`, authoring workflows, readiness summaries, and optional profile-specific rules without changing the runtime boundary.
