# Renma Authoring Guide

This is the canonical guide for authoring and improving Skills and Context
Assets in a Renma repository.

## Responsibility Boundary

Use your platform's standard Skill authoring guidance for general Skill design,
then use Renma for repository-specific governance and validation.

Platform-native authoring guidance owns:

- name and trigger description;
- usage and exclusion boundaries;
- instructions and workflow;
- constraints and safety behavior;
- examples; and
- completion criteria.

Renma complements that guidance with:

- canonical metadata and Agent Skills compatibility;
- dependency and graph validation;
- ownership and lifecycle governance;
- security policy validation;
- workflow clarity diagnostics; and
- repository-wide scan and readiness evidence.

Renma does not replace platform-native authoring guidance, generate domain
intent, or automatically improve a Skill body. Human judgment remains required
for semantics, ownership, policy, dependencies, and source-of-truth claims.

## Focused Workflow Model

A Skill is a focused workflow entrypoint, not a thin router. `SKILL.md` may own
positive and negative selection boundaries, required inputs, preflight checks,
ordered instructions, decisions, short Skill-specific commands, examples,
edge cases, safety constraints, completion criteria, and verification. Renma
does not warn merely because a Skill is procedural or includes an executable
command.

Use Agent Skills progressive disclosure deliberately:

1. Metadata: `name` and `description` let a client decide whether to activate
   the Skill.
2. Instructions: the activated `SKILL.md` carries the focused workflow and
   explicit read or execution conditions.
3. Resources: local files are read or executed only when the workflow calls
   for them.

Choose placement by responsibility, not size alone:

| Content | Place it in | Ownership test |
| --- | --- | --- |
| Selection boundaries, ordered workflow, constraints, completion | `SKILL.md` | Required to perform this focused workflow |
| Skill-specific detail, variants, edge cases | `references/` | Owned and loaded by one Skill |
| Deterministic repeatedly executed implementation | `scripts/` | Code is safer and more repeatable than prose |
| Templates, images, data, output resources | `assets/` | Consumed or copied as material, not instructions |
| Shared knowledge | `contexts/` | Used by multiple Skills or needs independent ownership, lifecycle, or source-of-truth status |
| Purpose-specific interpretation of Context | `lenses/` | A static governance view over Context Assets |
| Provider-specific UI metadata | provider-owned files such as `agents/openai.yaml` | Optional interface metadata, not Renma core schema |

The canonical defaults and their Agent Skills/Renma provenance are in the
[Quality Profile](quality-profile.md).

## New Skill Workflow

Use this sequence for a new Skill:

```text
platform-native Skill authoring guidance
  -> renma scaffold skill
  -> review and complete the generated Skill
  -> renma scan . --fail-on high
  -> fix relevant diagnostics
  -> rerun validation
  -> human review
```

### 1. Design the Skill

Before generating a file, use the standard guidance for your platform to define:

- the recurring task or decision;
- the trigger and nearby cases that should not use the Skill;
- required inputs and evidence;
- the ordered workflow and decision points;
- safety and repository constraints; and
- the output and completion criteria.

Write concrete positive and near-miss negative trigger examples before
scaffolding. Define the expected output and completion criteria early. Match
implementation freedom to fragility: use prose when judgment is central, a
parameterized script when a stable operation needs flexible inputs, and a fixed
script when ordering or exact behavior is safety-critical.

Do not guess missing owners, policies, dependencies, product behavior, domain
rules, or source-of-truth documents. Record gaps for a human to resolve.

### 2. Generate one repository-compatible starting point

Run the Renma generator once:

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md \
  --id skill.testing.spec-review \
  --title "Spec Review" \
  --owner qa-platform \
  --tags testing,spec-review \
  --resources references,scripts,assets
```

The target must be a canonical `SKILL.md` under `skills/**` or
`.agents/skills/**`. File mode refuses to overwrite an existing file and
requires an explicit owner. The output is a deterministic starting point, not
a finished Skill.

`--resources` creates only the requested empty directories and no placeholder
files. In the completed Skill, state when each reference should be read, each
script should be run, and each asset should be used.

Do not run two independent generators against the same target file. Some
platform-native authoring tools create files themselves, so choose one of these
safe approaches:

1. Run `renma scaffold skill`, then ask the platform tool to review and refine
   that existing file.
2. Ask the platform tool to use `renma scaffold skill` as the starting point
   instead of independently generating the same target.

In a Codex workflow, use Renma as the one generator, then ask Codex's
`skill-creator` to semantically review the existing scaffold. Do not ask both
generators to independently create the same target.

`--format prompt` prints the deterministic scaffold and constraints without
writing the file. `--format json` prints the existing structured bundle. These
modes do not reserve or create the target path.

### 3. Review and complete the scaffold

Use platform-native guidance to complete:

- `description`, including positive and negative trigger boundaries;
- required inputs and preflight evidence;
- instructions, decisions, and workflow;
- constraints and security behavior;
- completion criteria and validation; and
- intended Renma metadata and Context relationships.

Preserve the repository's intended behavior. Keep reusable domain, testing,
product, platform, or tool knowledge in independently owned Context Assets when
it should outlive one Skill.

Preserve Agent Skills optional fields, unknown `metadata.renma.*` values, and
other vendors' string metadata. Provider-specific `agents/openai.yaml` is
permitted but is not required by Renma core.

Execute and test every script. Forward-test complex Skills with raw user
prompts, outputs, and execution logs in the external runtime that consumes the
Skill. Do not leak expected answers, diagnoses, or intended fixes to evaluation
agents. Renma remains deterministic; runtime evaluation stays external.

### 4. Validate, fix, and rerun

Start with the release gate:

```bash
renma scan . --fail-on high
```

Review every relevant diagnostic, correct the underlying wording, metadata, or
relationship, and rerun the same scan. Do not weaken security policy or add a
suppression merely to make validation pass.

Use other deterministic views when they answer a specific review question:

```bash
renma inspect skills/testing/spec-review/SKILL.md
renma catalog . --format markdown
renma graph . --focus skill.testing.spec-review --format mermaid
renma ownership . --format markdown
renma readiness . --format markdown
```

The final step is human review of the Skill's intent, workflow, policy,
relationships, and remaining uncertainty.

## Existing Skill Workflow

Use this sequence for an existing Skill:

```text
review with platform-native Skill authoring guidance
  -> renma scan . --fail-on high
  -> inspect relevant diagnostics and repository evidence
  -> use suggest-metadata only for metadata or migration work
  -> prepare and review intended changes
  -> renma scan . --fail-on high
  -> fix relevant diagnostics
  -> rerun validation
  -> human review
```

### 1. Review the whole Skill

Use platform-native authoring guidance to review the trigger description,
instructions, workflow, constraints, examples, and completion criteria. This is
semantic authoring review; `suggest-metadata` does not perform it.

### 2. Scan and inspect repository evidence

```bash
renma scan . --fail-on high
renma inspect skills/testing/spec-review/SKILL.md
```

`scan` is the general deterministic starting point for an existing Skill. Use
`inspect`, `catalog`, `graph`, `ownership`, or `readiness` when one of those
commands answers a specific evidence question. Renma reports structural and
governance evidence; it does not perform the whole-Skill semantic review.

### 3. Generate a metadata or migration suggestion when needed

```bash
renma suggest-metadata skills/testing/spec-review/SKILL.md
```

Optionally provide an owner only when a human has explicitly confirmed it:

```bash
renma suggest-metadata skills/testing/spec-review/SKILL.md \
  --owner qa-platform \
  --format json
```

`suggest-metadata` reads one target and prints a deterministic prompt or JSON
payload to stdout. It does not edit, rename, or move the file. Its supported
responsibilities are:

- compact canonical metadata suggestions;
- explicit owner retrofit and one-way migration of recognized pre-0.16
  governance and security metadata;
- pre-0.16 to canonical Agent Skills migration candidates;
- conflict and unsafe-evidence detection; and
- validation of the rendered candidate.

It does not rewrite the body, infer ownership, choose between conflicting
semantic values, infer missing security policy, or propose reverse migration
for a canonical Skill. An owner candidate requires explicit human-provided
evidence. Security policy remains intentionally authored and deterministically
validated.

Do not route an already canonical Skill through `suggest-metadata` as ceremony.
Use it only for a metadata retrofit, explicit owner retrofit, recognized
pre-0.16 one-way migration, or blocked migration review.

### 4. Review before applying

Treat the output as a candidate. Compare it with the source and apply only the
intended metadata, path migration, or migration changes. Preserve the Markdown
body and unknown vendor metadata unless a separately reviewed semantic change
requires otherwise.

If migration is blocked:

1. Review the reported conflicts or invalid evidence.
2. Confirm the Skill's intent using platform-native authoring guidance.
3. Do not apply a candidate while Renma cannot generate it safely.
4. Correct the source evidence.
5. Rerun `renma suggest-metadata <SKILL.md>`.
6. After intended corrections, run `renma scan . --fail-on high` and repeat the
   fix-and-rerun loop.

Renma never chooses a semantic winner automatically. The detailed one-way
migration and blocking contract is in
[Agent Skills Compatibility and Migration](agent-skills-compatibility.md).

## Canonical Skill Metadata

Agent Skills owns the standard Skill identity and body. Renma fields are flat,
string-valued `metadata.renma.*` entries. JSON-array strings encode lists:

```yaml
---
name: spec-review
description: Review specifications for ambiguity and missing boundaries. Use when requirements need evidence-backed review before implementation.
metadata:
  renma.id: skill.testing.spec-review
  renma.title: Spec Review
  renma.owner: qa-platform
  renma.status: stable
  renma.tags: '["testing","spec-review"]'
  renma.requires-context: '["context.testing.boundary-value-analysis"]'
  renma.optional-context: '[]'
---
```

Do not use a nested `metadata.renma` mapping, native YAML booleans for canonical
security fields, or comma-separated canonical lists. See the compatibility and
security guides for the complete contracts.

## Context Asset And Context Lens Authoring

Create a Context Asset when knowledge should be reusable and independently
owned:

```bash
renma scaffold context contexts/testing/boundary-value-analysis.md \
  --owner qa-platform
```

A Context Asset should contain durable, source-backed domain knowledge,
testing heuristics, tool constraints, platform facts, or reviewed policy. Keep
task-specific prompt instructions and runtime selection rules out of shared
Context.

Create a Context Lens when one purpose needs a focused interpretation of one or
more Context Assets:

```bash
renma scaffold context_lens \
  lenses/testing/spec-review-boundary-values.md \
  --owner qa-platform
```

The repository can represent both:

```text
Skill -> Context Lens -> Context Asset
Skill -> Context Asset
```

These metadata relationships are static governance evidence. Renma does not
select, load, or inject Context at runtime.

Context and Context Lens scaffolds keep their top-level Renma metadata syntax;
the Agent Skills `metadata.renma.*` serialization boundary applies to Skills.

For current guidance on deriving several thin, bounded Skills from a broad
existing Skill—including focused `inspect`, graph, Context reuse, and Appium
examples—see [Advanced Skill Authoring](advanced-skill-authoring.md). That guide
keeps current thin-Skill authoring separate from proposed 0.18.0 Skill-to-Skill
discovery.

## Optional Codex Example

Codex `skill-creator` is one example of platform-native authoring guidance; it
is not a Renma dependency and is not named in generic CLI output.

After creating the Renma scaffold, a safe request is:

```text
Use skill-creator to review and refine the existing
skills/testing/spec-review/SKILL.md scaffold. Preserve its intended Renma
metadata and repository behavior. Do not independently generate a second target
file. Do not invent owners, policy, dependencies, domain rules, or
source-of-truth claims. After the reviewed edits, run
`renma scan . --fail-on high`, fix relevant diagnostics, and rerun the scan.
```

Alternatively, ask `skill-creator` to use `renma scaffold skill` as its
starting point. In both cases, only one generator creates the target file.

## Review Checklist

Before human approval, confirm that:

- the description says when the Skill should and should not be selected;
- instructions, constraints, and completion criteria are explicit;
- owners, policies, dependencies, and domain claims are evidence-backed;
- reusable knowledge has an appropriate Context boundary;
- generated or suggested changes were reviewed rather than applied blindly;
- blocked migration evidence was resolved instead of bypassed;
- `renma scan . --fail-on high` was rerun after fixes; and
- no policy weakening or new suppression was used merely to pass validation.

The operating principle remains:

```text
LLM proposes. Renma verifies. Human approves.
```
