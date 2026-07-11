# Agent Skills Compatibility and Migration

This document defines Renma's target `SKILL.md` format for the breaking 0.16.0
transition. [Agent Skills](https://agentskills.io/specification) owns the
portable Skill format. Renma extends it with deterministic governance evidence,
without defining a competing Skill format.

This rollout follows one operating principle:

```text
LLM proposes. Renma verifies. Human approves.
```

## Responsibility Boundary

Keep these surfaces separate:

```text
Agent Skills name, description, body, and references
  -> portable and primarily LLM-facing

metadata.renma.*
  -> structured governance evidence for Renma

Renma
  -> deterministic validation and migration assistance

Human
  -> approves semantic changes
```

The Markdown body remains the primary instruction surface after a Skill has
been activated. Generic Agent Skills clients may not send arbitrary metadata
to a model. Renma metadata therefore does not guarantee model compliance and
must not replace behavior-critical instructions.

## Canonical 0.16.0 Frontmatter

Agent Skills owns the standard top-level fields:

- `name`
- `description`
- `license`
- `compatibility`
- `metadata`
- `allowed-tools`

Renma owns flat metadata keys beginning with `renma.`. Agent Skills metadata
values are strings, including values that encode lists or booleans:

```yaml
---
name: spec-review
description: Review specifications before implementation. Use for ambiguity and boundary analysis.
metadata:
  renma.id: skill.testing.spec-review
  renma.owner: qa-platform
  renma.status: stable
  renma.tags: '["testing","spec-review"]'
---
```

Do not use unprefixed shared keys such as `metadata.owner`. Do not use a nested
`metadata.renma` mapping. Unknown `renma.*` keys and other vendors' string
metadata remain valid metadata and are preserved during migration without
interpretation.

## Entrypoint Paths

Canonical Agent Skills entrypoints use the exact filename:

```text
skills/**/SKILL.md
.agents/skills/**/SKILL.md
```

Renma continues discovering historical `skill.md` and `*.skill.md` spellings
under those roots so `scan` can report validation and migration diagnostics.
Discovery does not make those spellings Agent Skills-compatible.

## Validation During Scan

Agent Skills validation is part of the existing scan workflow:

```bash
renma scan .
renma scan . --format json
```

The JSON report includes a dedicated `agentSkills` summary and per-Skill
results. Text output includes a concise valid/invalid summary, structural issues,
authoring warnings, and a `suggest-metadata` migration command when historical
Renma fields are present.

The locally versioned validation profile uses the maintained `yaml` package in
YAML 1.2 mode. It validates:

- the exact `SKILL.md` filename;
- frontmatter presence and closure;
- YAML syntax and mapping shape;
- duplicate top-level and `metadata` keys;
- the allowed Agent Skills top-level fields;
- required, non-empty string `name` and `description` values;
- NFKC-normalized name length, Unicode letters/digits, lowercase and hyphen
  rules, and normalized immediate-parent match;
- description and compatibility length limits;
- optional field types;
- `metadata` as a string-to-string mapping.

The validation profile is local. Renma does not fetch a schema or validation
rules at runtime.

This first stage does not add a separate validation command and does not change
the existing `scan` or `--fail-on` exit contract. Agent Skills results are
visible in scan output but are not inserted into the existing finding threshold
path.

## Format Classification

Each inspected Skill receives one migration-oriented classification:

```text
agent-skills
  Agent Skills identity with no historical top-level Renma fields

renma-legacy
  historical top-level Renma fields without Agent Skills identity

hybrid
  Agent Skills identity plus historical top-level Renma fields

unknown
  neither Agent Skills identity nor a recognized migration source
```

Classification supports validation and migration guidance only in this stage.
It does not create canonical-versus-legacy fallback for catalog, ownership,
graph, readiness, BOM, trust, lifecycle, context dependency, or security
processing.

## Selection Boundaries and Execution Constraints

A selection boundary determines whether a Skill should be chosen. If the body
says `Do not use this skill for test execution`, that exclusion belongs in
`description` because name and description are the discovery surface.

An execution constraint applies after activation. Instructions such as `Do not
modify production files` or `Never upload secrets` belong in the body under a
prominent heading such as `Hard Constraints`, `Prohibited Actions`, or `Safety
Constraints`. A generic execution constraint must not be copied automatically
into `description` or `metadata.renma.when-not-to-use`.

Renma may report conservative authoring warnings for a missing usage boundary,
an omitted selection exclusion, a buried or scattered execution constraint, or
a prohibition without a supported alternative or stop behavior. Nested
subsections under a prominent constraint heading remain prominent. These
warnings do not make a structurally valid Agent Skill invalid.

## One-Way Migration

Historical top-level Renma Skill fields are migration input only:

```text
historical Renma Skill
  -> Agent Skills identity
  -> metadata.renma.*
```

Use the existing non-editing command:

```bash
renma scan .
renma suggest-metadata skills/example/SKILL.md --format prompt
# review and apply the proposed conversion
renma scan .
```

For Skill targets, `suggest-metadata` can preserve valid standard Agent Skills
fields, use a valid immediate parent directory as `name`, preserve an existing
valid description, conservatively extract description evidence from the body,
move recognized historical fields to `metadata.renma.*`, and render canonical
frontmatter for human review. It never edits the file and never proposes a
reverse conversion for a canonical Agent Skill.

## Unsafe Migration Blocking

Renma does not render canonical frontmatter when migration would be ambiguous
or lossy. Blocking cases include:

- invalid or unclosed YAML frontmatter;
- a non-mapping frontmatter document;
- duplicate top-level or metadata keys;
- non-string metadata values;
- an invalid Skill directory name or conflicting identity;
- conflicting canonical and historical values;
- an unknown top-level field;
- missing evidence for a usable description;
- duplicate semantic list values or unsupported historical value shapes.

Renma reports structured blocked evidence with the field and reason. It never
selects the last duplicate value, silently deletes an unknown field, or assigns
an unknown top-level field to a vendor namespace.

Within a valid `metadata` mapping, Renma distinguishes:

```text
known renma.* key
  interpret for migration comparison and preserve

unknown renma.* key
  preserve without interpretation

other vendor metadata
  preserve without interpretation

unknown top-level field
  block migration
```

## Staged 0.16.0 Rollout

Stage 1, established here:

- Agent Skills validation in `scan`;
- one-way migration suggestions in `suggest-metadata`;
- this normative compatibility and migration document.

Stage 1 validates and proposes migration but does not migrate repository-owned
operational Skills yet. Dedicated fixtures cover canonical, legacy, hybrid, and
blocked migration behavior until operational metadata consumers are updated in
a later stage.

Later 0.16.0 stages will make `metadata.renma.*` operational across catalog,
ownership, graph, readiness, BOM, trust, lifecycle, context dependency, and
security processing. Until those focused stages land, this validation and
migration code must not act as a fallback metadata reader for normal Renma
operations.

This stage does not add Skill discovery, runtime selection, prompt assembly,
context injection, execution, or telemetry.
