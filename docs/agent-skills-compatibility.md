# Agent Skills Compatibility and Migration

Renma treats [Agent Skills](https://agentskills.io/specification) as the canonical
format for agent-facing `SKILL.md` files. Renma does not define a competing skill
format. It validates the portable Agent Skills surface and stores repository
governance extensions inside the standard `metadata` mapping.

This design keeps two responsibilities separate:

```text
Agent Skills
  defines the portable skill entrypoint and discovery metadata

Renma
  validates, extends, reviews, and operates a repository of those skills
```

## Canonical Skill Frontmatter

New Renma skills use Agent Skills top-level fields. Renma-specific values are
string metadata entries with a `renma.*` namespace:

```yaml
---
name: spec-review
description: Review a specification for ambiguity and missing test boundaries. Use before implementation. Do not use for executing tests or diagnosing an observed failure.
compatibility: Requires access to the specification and related repository files.
metadata:
  renma.id: skill.testing.spec-review
  renma.title: Spec Review
  renma.owner: qa-platform
  renma.status: stable
  renma.tags: '["testing","spec-review"]'
  renma.requires-context: '["context.testing.boundary-value-analysis"]'
---
```

The top-level fields accepted by the Agent Skills specification are:

- `name`
- `description`
- `license`
- `compatibility`
- `metadata`
- `allowed-tools`

Renma list metadata is encoded as a JSON array string because Agent Skills
requires values under `metadata` to be strings.

## Identity

`name` and `renma.id` have different jobs:

```text
name
  Agent Skills identity; must match the parent directory

renma.id
  Stable repository-governance identity used by catalogs and relationships
```

A file move may require changing `name`. A reviewed asset whose meaning remains
the same can retain its `renma.id`.

Renma takes an Agent Skills `name` from the immediate parent directory after
NFKC normalization and validates it with the same rules as `validate-skills`.
It does not ASCII-slugify or silently rename that identity. A directory such as
`MySkill`, `-demo`, or `demo--review` must be renamed before scaffolding or
migration can continue. Valid Unicode letters and numbers remain supported;
Renma ID normalization is a separate repository-governance concern.

## Validation

Run strict specification validation with:

```bash
renma validate-skills .
renma validate-skills . --format json
```

The command exits `1` when at least one discovered skill violates the Agent
Skills specification. Renma authoring warnings, such as an omitted explicit
selection boundary or a buried execution constraint, do not fail validation by
themselves.

`renma scan .` also includes an `agentSkills` summary in JSON and text output so
repository quality, security, and specification evidence can be reviewed
together.

Agent Skills specification validity comes from the maintained `yaml` package
using YAML 1.2 parsing, strict errors, source positions, and explicit duplicate
key detection. A real parser is required because regex scalar parsing cannot
reliably validate quoting, escapes, comments, sequences, or literal and folded
multiline values. Renma does not fetch schemas or validation logic at runtime;
the validation profile remains locally implemented and versioned.

Validation covers deterministic requirements including:

- the canonical `SKILL.md` filename;
- YAML frontmatter presence, closure, syntax, and mapping shape;
- allowed top-level fields;
- required `name` and `description` fields;
- name length, casing, characters, hyphen rules, and directory match;
- description and compatibility length limits;
- `metadata` as a string-to-string mapping;
- duplicate top-level fields and duplicate `metadata` child keys.

Invalid YAML is a gating specification failure. The lightweight repository
Markdown parser remains in use for headings, links, code fences, legacy context
assets, and line evidence; it is not the source of Agent Skills validity.

Renma additionally emits authoring warnings for boundaries that are important to
agent behavior but are not structural specification errors.

The validator is static evidence. It does not guarantee that every runtime model
will obey every instruction.

## One-Way Legacy Migration

Renma continues to read historical top-level metadata so existing repositories
can be inspected and migrated:

```yaml
---
id: skill.testing.spec-review
owner: qa-platform
status: stable
requires_context:
  - context.testing.boundary-value-analysis
---
```

This is a migration source, not a format Renma should newly generate. The
supported direction is deliberately one-way:

```text
legacy top-level Renma skill metadata
  -> Agent Skills top-level identity
  -> metadata.renma.* repository extensions
```

Renma does not suggest converting a valid Agent Skill back to the legacy form.
Context assets and context lenses are not Agent Skills and may continue using
their existing Renma frontmatter.

Use the existing migration assistant:

```bash
renma suggest-metadata skills/testing/spec-review/SKILL.md --format prompt
renma suggest-metadata skills/testing/spec-review/SKILL.md --format json
renma suggest-metadata skills/testing/spec-review/SKILL.md \
  --owner qa-platform --format json
```

For a skill, the result now includes:

- source format: `agent-skills`, `renma-legacy`, `hybrid`, or `unknown`;
- Agent Skills specification findings;
- migration direction;
- candidate `name` and `description` evidence;
- candidate `renma.*` extension metadata;
- canonical frontmatter when it can be produced without inventing facts;
- blocked fields that require a human decision;
- authoring recommendations for usage boundaries and constraints.

The command still does not edit files. An external coding agent may propose the
small patch, Renma verifies it, and a human approves it.

## Metadata Precedence During Migration

Renma reads both forms during the transition:

```yaml
owner: legacy-owner
metadata:
  renma.owner: canonical-owner
```

The canonical `metadata.renma.*` value takes precedence. If the two forms differ,
Renma reports `RENMA-METADATA-CONFLICTING-SOURCES`; it does not silently decide
which semantic value should survive. Resolve the conflict through human review,
then remove the legacy duplicate.

For deterministic security evaluation, a canonical value replaces its legacy
counterpart regardless of field order. Canonical lists replace rather than
union with legacy lists, so stale legacy permissions or destinations cannot
widen the effective policy. The conflict diagnostic remains visible, and
`suggest-metadata` blocks canonical frontmatter generation while preserving
both sources until a human chooses the retained semantic value.

## Separating Selection Boundaries From Execution Constraints

A `do not ...` statement is not automatically a skill-selection exclusion.
Renma uses narrow, deterministic wording as evidence and does not claim to
understand the semantics of arbitrary prose. It reviews three separate layers:

### 1. Discovery boundary

Agent Skills clients commonly discover skills from `name` and `description`
before loading the full body. A selection-critical exclusion belongs in
`description`. A description should say what the skill does and when to use it;
it needs a negative clause only when an exclusion genuinely affects selection:

```yaml
description: Review specifications before implementation. Use for ambiguity and boundary analysis. Do not use for test execution or observed-failure diagnosis.
```

### 2. Governance boundary

Renma can keep compact positive and negative selection scope for catalog,
review, and relationship evidence:

```yaml
metadata:
  renma.when-to-use: '["Reviewing a specification before implementation"]'
  renma.when-not-to-use: '["Executing tests","Diagnosing an observed failure"]'
```

`metadata.renma.when-not-to-use` is a governance representation of selection
scope. It does not replace the Agent Skills description, does not hold generic
execution prohibitions, and does not make Renma a runtime selector.

### 3. Activated-workflow boundary

After activation, important execution constraints remain in the skill body and
should be easy to find under a heading such as `Hard Constraints`, `Prohibited
Actions`, or `Safety Constraints`:

```markdown
## Hard Constraints

- When source evidence is missing, do not infer product behavior. Stop and list the missing evidence.
- Do not silently resolve an ambiguous requirement. Record it as an unresolved question for human review.
```

Strong constraints state:

```text
condition
  -> prohibited action
  -> required alternative or stop behavior
  -> verification
```

Renma warns when an explicit selection exclusion is absent from `description`,
when an execution constraint is outside a prominent constraint section, when
constraints are scattered across sections, or when a prohibition has no nearby
deterministic stop or alternative instruction. Prominence is evaluated for the
section containing each constraint; an empty `Hard Constraints` heading does
not make a prohibition buried under `Procedure` prominent. It does not require every skill
to have a negative description clause, copy execution constraints into
`description` or `metadata.renma.when-not-to-use`, or invent missing behavior.

These warnings improve visibility and reviewability; they cannot guarantee
model compliance. Important constraints should be made testable where possible.
Prefer a condition, the prohibited action, and the required alternative or stop
behavior. If the existing skill does not support an alternative, request human
clarification instead of generating one.

The deterministic authoring diagnostics are:

- `RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY` for an explicit body-level skill exclusion missing from discovery metadata;
- `RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT` for execution prohibitions without a recognized constraint heading;
- `RN-SKILL-EXECUTION-CONSTRAINT-SCATTERED` for multiple prohibitions in multiple sections without a central constraint section;
- `RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE` when no nearby supported alternative or stop instruction is visible.

They are Renma authoring warnings, not Agent Skills specification errors.

## New Skill Creation

`renma scaffold skill` now produces Agent Skills-compatible frontmatter and a
body with explicit usage and constraint sections:

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md \
  --owner qa-platform \
  --tags testing,spec-review
```

The generated description and body are intentionally marked as a draft. Replace
all placeholders with repository-grounded guidance before depending on the
skill. The scaffold includes:

- `Use this skill when`;
- `Do not use this skill when`;
- required inputs;
- instructions;
- context references;
- hard constraints;
- validation.

Scaffolding refuses to create a Skill when its immediate parent directory is
not already a valid Agent Skills name. It does not create a lowercased or
ASCII-only substitute.

## Repository Boundary

The initial operating model remains one repository containing its skills,
contexts, lenses, policies, and review evidence. Renma does not require that all
future deployments stay in one repository, but 0.16.0 does not add federation,
package synchronization, or organization-wide distribution.

## Product Boundary

Renma validates repository evidence. It does not:

- select or rank a skill for live task text;
- assemble or inject a prompt;
- load runtime context;
- execute an agent;
- guarantee model compliance;
- infer owners, policies, dependencies, or domain facts;
- automatically apply a legacy migration.

The operating rule remains:

```text
LLM proposes. Renma verifies. Human approves.
```
