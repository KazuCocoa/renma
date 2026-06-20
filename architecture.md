# Renma Architecture Direction

Renma is a Git-native governance and quality layer for LLM-ready context assets and skills. It keeps shared repositories healthy so agents can consume team-owned expertise correctly.

Renma sits at the repository governance layer, not the runtime layer.

```text
Shared repository
  skills/
  contexts/
  metadata/
  graph/
  catalog/

Renma
  scan
  validate
  catalog
  graph
  report
  suggest improvements

Agents and runtimes
  Codex
  Claude
  Cursor
  future agents

External signal producers
  Codex plugin
  Claude extension
  prompt wrapper
  CI and external signal integrations
```

Renma does not choose task context, assemble prompts, inject context, or execute agent workflows. Agents and runtimes decide how to use repository assets for a task.

## Goals

- Keep skills and context assets discoverable, owned, and reviewable.
- Treat shared context as a first-class repository asset outside individual skill directories.
- Validate references, metadata, lifecycle, and dependency graph health.
- Detect orphaned, deprecated, conflicting, missing, and repeated context.
- Provide deterministic catalog and graph snapshots for Git review and CI.
- Produce repository-level agent readiness reports.
- Allow optional LLM assistance for suggestions and semantic review without making LLMs required for core analysis.

## Non-Goals

- Task-specific context choice
- Prompt assembly
- Agent execution
- Provider gateways
- Hosted dashboards
- Package synchronization
- Organization-wide distribution transport
- Runtime telemetry ownership

Renma is telemetry-aware, but not telemetry-responsible. It may import external signals later as evidence for repository review.

## Source Layout

Preferred repository layout:

```text
skills/
  testing/
    test-case-generation.skill.md
    spec-review.skill.md
    regression-planning.skill.md
contexts/
  testing/
    boundary-value-analysis.md
    negative-testing.md
    regression-risk.md
  domain/
    payment/
      idempotency.md
      duplicate-charge.md
      refund-risk.md
    mobile/
      offline-behavior.md
      background-resume.md
  tools/
    appium/
      usage-guideline.md
      limitations.md
  teams/
    checkout/
      payment-api-contracts.md
      known-risk-patterns.md
metadata/
graph/
catalog/
```

`contexts/` is preferred. `context/` is also scanned for compatibility.

Skill-local `profiles/`, `references/`, and `examples/` remain supported, but shared context assets should become the durable source of truth when knowledge is reused across skills, teams, tools, or agents.

## Core Concepts

### Skill

A skill is an LLM-facing entrypoint and routing contract. It tells an agent when and how to use a capability, what preflight questions matter, which safety and verification steps apply, and which context assets are relevant.

A skill should not be the only source of truth for reusable expert knowledge.

### Context Asset

A context asset is an independently owned knowledge unit. It may be maintained by QA, domain teams, tooling teams, product teams, or platform teams.

Good context assets have:

- Stable ID
- Clear owner
- Lifecycle status
- Usage guidance
- Scope boundaries
- References or dependencies where needed

### Asset

An asset is any repository object Renma can catalog, validate, reference, or include in graph checks.

Initial asset kinds:

- `skill`
- `context`
- `profile`
- `reference`
- `example`
- `agent`
- `config`

Shared Markdown under `contexts/` or `context/` uses the dedicated `context` kind. Skill-local supporting material remains `reference`.

### Dependency

A dependency is a typed edge between assets.

Initial edge kinds:

- `requires`
- `optional`
- `conflicts`
- `extends`
- `routes_to`

Edges should carry source evidence: source path, line range, declaration form, and reason where available.

## Architecture

```text
Markdown, frontmatter, config, docs snapshots
  |
  v
Importers and parsers
  |
  v
Normalized asset model
  |
  v
Catalog snapshot + context graph snapshot
  |
  v
Validation, repeated-context discovery, semantic diff
  |
  v
Reports, repository manifests, agent readiness output
```

The normalized model is the contract between files and higher-level features. Users work with Markdown and small metadata blocks. Renma uses the model internally to keep output deterministic and testable.

## Metadata

Renma should validate a small stable subset first:

```yaml
id: domain.payment.idempotency
version: 1.0.0
owner: payments
status: stable
tags: payment, qa
when_to_use: Testing payment retry or duplicate-submit behavior
when_not_to_use: Non-payment checkout UI copy review
requires_context: testing.negative-testing
optional_context: testing.regression-risk
conflicts: archived.payment.retry-v0
```

The current parser supports simple one-line values and comma-separated lists. Richer YAML block-list frontmatter is a future parser improvement.

Status values:

- `experimental`
- `stable`
- `deprecated`
- `archived`

Fields should be added only when a command or rule uses them.

## Catalog Snapshot

`renma catalog` should provide deterministic inventory.

Catalog entries should include:

- ID
- Kind
- Source path
- Content hash
- Owner
- Status
- Tags
- Declared dependencies
- Dependents
- Diagnostics

Catalog output should be stable across filesystems and Node versions.

## Context Graph Snapshot

The graph should represent assets and typed dependencies. It should power:

- Missing reference checks
- Deprecated or archived dependency checks
- Orphaned context detection
- Conflict visibility
- Affected asset reporting
- Catalog enrichment
- Semantic diff
- Future visualization

Possible command:

```bash
renma graph --format json
```

The graph is not a runtime selection engine. It is repository evidence.

## Validation

Validation should combine local file checks and graph-backed checks.

Rule areas:

- Missing or weak skill description
- Missing negative routing
- Missing usage guidance
- Missing preflight guidance
- Missing verification guidance
- Oversized skills or context assets
- Missing shared context owner or ID
- Invalid status values
- Unknown dependencies
- Deprecated or archived referenced context
- Orphaned context assets
- Conflicting context declarations
- Repeated or duplicate knowledge
- Secret-like literal values
- Private key material
- Destructive commands without confirmation or recovery context
- Risky remote defaults
- Broad environment copying into subprocesses
- Hardcoded user-local paths

Static checks are evidence. Passing a scan does not prove an agent workflow is safe.

## Repeated Context Discovery

Repeated context discovery is a bridge from "what exists" to "what should become shared context."

Deterministic signals:

- Normalized section hashes
- Token shingles
- Repeated headings
- Repeated command blocks
- Repeated links
- Repeated tool, domain, path, or product terms
- Similar workflow skeletons

Output should be a human-reviewable set of candidates with source paths, line ranges, signal kinds, confidence, and suggested context boundaries.

Optional LLM support may label clusters or draft refactors, but deterministic evidence remains authoritative.

## Semantic Diff

Semantic diff should explain repository-health changes that normal Git diffs make hard to see.

Categories:

- Ownership changes
- Lifecycle status changes
- Dependency changes
- Conflict changes
- Missing reference changes
- Orphaned context changes
- Repeated-context candidate changes
- Safety and risk changes

Possible command:

```bash
renma diff --from main --to HEAD
```

## Agent Readiness Report

An agent readiness report should describe whether a repository is healthy enough for agents to consume.

It should include:

- Broken references
- Missing owners
- Missing usage boundaries
- Deprecated or archived reachable context
- Orphaned context
- Oversized assets
- Repeated knowledge
- Risk findings
- Affected skills and context assets

It should not choose task context for an agent run.

## External Signals

External tools may later emit signals into Renma:

- Context assets loaded by agents
- Context assets ignored by agents
- Repeated confusion around an asset
- Runtime failures mapped back to source paths
- CI findings attached to owners

Renma may import these as repository evidence. Ownership of telemetry collection, storage, runtime tracing, and dashboards remains outside Renma.

## Roadmap Layers

1. Scanner and metadata stabilization
2. First-class context assets
3. Catalog generation
4. Dependency and reference graph
5. Graph-backed validation
6. Repeated context and duplicate knowledge discovery
7. Semantic diff for context changes
8. Agent readiness reports
9. Optional external signal import

This sequence prioritizes shared context assets and repository health before external signal import.

## Implementation Notes

Current CLI commands:

```bash
renma scan [path]
renma catalog [path]
renma inspect <file>
renma suggest-semantic-split <file>
```

`renma inspect` inspects repository files and context assets by outline or line range. It does not choose task context or assemble prompts.

Near-term implementation work:

- Add dedicated `context` asset kind.
- Keep shared `contexts/**/*.md` and `context/**/*.md` in default discovery.
- Expand catalog entries with owner, status, dependency, and dependent summaries.
- Add graph output once the model is stable.
- Add graph-backed validation rules.
- Broaden repeated context discovery across shared contexts, skills, agents, references, profiles, and examples.

## Principle

```text
LLM proposes. Renma verifies. Human approves.
```

No-LLM workflows stay first-class. Renma's core value is deterministic repository evidence.
