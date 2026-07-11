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

## Validation

Run strict specification validation with:

```bash
renma validate-skills .
renma validate-skills . --format json
```

The command exits `1` when at least one discovered skill violates the Agent
Skills specification. Renma authoring warnings, such as an omitted negative
usage boundary, do not fail validation by themselves.

`renma scan .` also includes an `agentSkills` summary in JSON and text output so
repository quality, security, and specification evidence can be reviewed
together.

Validation covers deterministic requirements including:

- the canonical `SKILL.md` filename;
- YAML frontmatter presence and closure;
- allowed top-level fields;
- required `name` and `description` fields;
- name length, casing, characters, hyphen rules, and directory match;
- description and compatibility length limits;
- `metadata` as a string-to-string mapping;
- duplicate top-level fields.

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

## Making “Do Not” Boundaries Visible

A prohibition can be correct in prose and still be ineffective if it is absent
from the surface an agent sees at the relevant time. Renma therefore reviews
three layers:

### 1. Discovery boundary

Agent Skills clients commonly discover skills from `name` and `description`
before loading the full body. A selection-critical exclusion belongs in
`description`:

```yaml
description: Review specifications before implementation. Use for ambiguity and boundary analysis. Do not use for test execution or observed-failure diagnosis.
```

### 2. Governance boundary

Renma can keep compact positive and negative boundaries for catalog, review, and
relationship evidence:

```yaml
metadata:
  renma.when-to-use: '["Reviewing a specification before implementation"]'
  renma.when-not-to-use: '["Executing tests","Diagnosing an observed failure"]'
```

This metadata does not replace the Agent Skills description and does not make
Renma a runtime selector.

### 3. Activated-workflow boundary

After activation, important constraints should be easy to find in the body:

```markdown
## Hard Constraints

- Do not infer product behavior when source evidence is missing.
- Stop and list the missing evidence instead.
- Do not silently resolve an ambiguous requirement.
- Record it as an unresolved question for human review.
```

Strong constraints state:

```text
condition
  -> prohibited action
  -> required alternative or stop behavior
  -> verification
```

Renma warns when negative directives are scattered, when a visible body-level
exclusion is absent from `description`, or when no negative usage boundary is
present. These are review prompts, not claims that Renma can prove runtime
compliance.

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
