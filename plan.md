# Renma Plan

Renma is a Git-native governance and quality layer for agent-consumable context assets and skills.

Renma prepares shared repositories so Codex, Claude, Cursor, and future agents can consume team-owned expertise correctly. Renma does not choose task context, assemble prompts, inject context, or execute agent workflows. Agents and agent runtimes decide how to use the repository assets at task time.

Conceptually:

```text
Skill = agent-facing entrypoint / routing contract / usage guide
Context = independently owned source-of-truth knowledge asset
```

Renma keeps those assets healthy: discoverable, owned, validated, reusable, deduplicated, and reviewable in Git.

## Product Direction

Large AI-agent repositories develop the same maintenance problems as large software systems:

- Knowledge is copied across skills.
- Context drifts out of date.
- Ownership is unclear.
- References break silently.
- Deprecated guidance remains reachable.
- Important expertise is buried inside one skill instead of shared.
- Repeated knowledge makes review and updates expensive.

Renma should help teams answer:

- What skills and context assets exist?
- Who owns each asset?
- Which skills declare, reference, or depend on each context asset?
- Which references are missing, deprecated, conflicting, or unreachable?
- Which context assets appear orphaned?
- Where is knowledge repeated across skills, agents, references, examples, or shared contexts?
- What changed between two Git revisions?
- Is the repository ready for agents to consume?

Renma remains deterministic by default, CLI-first, Git-native, minimal-dependency, and independent of LLMs for core analysis. Optional external-LLM assistance may support suggestions, semantic duplicate labeling, or review summaries, but deterministic evidence remains the authority: LLM proposes. Renma verifies. Human approves.

The 0.7.0 security direction stabilizes deterministic diagnostics for agent-facing context assets. Renma should catch risky instructions inside discovered skills, contexts, agent files, references, profiles, examples, and tool guidance without becoming a broad package, CI, Docker, GitHub Actions, or supply-chain scanner.

## Repository Model

Renma should support shared repositories shaped like this:

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

`contexts/` is the preferred shared context root. `context/` remains supported as an alias because existing repositories may already use it.

Skills may reference context assets, but context assets remain independently owned and reusable. A QA team can own testing heuristics. A payment team can own payment risk context. A mobile team can own offline behavior context. Tooling teams can own Appium guidance. Product teams can own local contracts and known risks.

## What Renma Owns

Renma owns repository quality, structure, and governance.

Renma should:

- Scan bounded repository paths.
- Parse Markdown, metadata, headings, links, and frontmatter.
- Catalog skills, agents, shared context assets, skill-local references, profiles, examples, and config.
- Validate required metadata for published assets.
- Validate declared references and dependencies.
- Detect missing, invalid, deprecated, archived, conflicting, unreachable, and orphaned context.
- Build a dependency graph snapshot with source evidence.
- Report affected skills and assets when context changes.
- Detect repeated or duplicate knowledge with deterministic evidence.
- Produce catalog snapshots and repository manifest artifacts for Git review and CI.
- Produce deterministic readiness reports that describe repository health.
- Emit structured, LLM-actionable diagnostics that humans and agents can use to repair the repository safely.
- Suggest improvements without requiring an LLM.
- Advise when large skill-local support files have generic source-of-truth structure that a human or calling LLM should inspect for possible promotion into owned shared context assets under `contexts/`.
- Advise when final shared context assets live under process-state folders such as `promoted`, `generated`, or `drafts` instead of semantic paths organized by meaning, ownership, team, domain, tool, policy, or platform.

Renma should not:

- Select a skill for a user task.
- Decide which context an agent should use for a task.
- Assemble prompts or task-specific context bundles.
- Inject context into an agent.
- Execute tools on behalf of an agent.
- Own provider gateways, hosted dashboards, or package synchronization.
- Replace human ownership review.

## LLM-Actionable Diagnostics

Renma should detect repository problems and emit structured diagnostics that are
useful as repair prompts for humans and LLM coding agents. Findings should
explain what is wrong, why it matters, where the evidence is, what a safe repair
should do, what constraints must be preserved, and how to verify the fix.

Core loop:

```text
renma scan / validate
  -> structured diagnostics
  -> Codex / Claude reads diagnostics
  -> agent proposes repository patch
  -> human reviews
  -> renma validates again
```

Central repair workflow: a single `SKILL.md` contains reusable domain
knowledge, tool guidance, and QA heuristics. Renma reports that the skill is too
monolithic and mixes usage guidance with reusable context. Codex or Claude moves
the reusable knowledge into first-class context assets under `contexts/`, keeps
the skill concise, adds metadata, updates declared context references, and then
Renma validates the healthier separation.

Future output modes may include human-readable diagnostics, machine-readable
JSON diagnostics, and LLM-friendly repair instructions. Core validation should
remain deterministic and should not call an LLM.

## Terminology

Use repository-governance terminology:

- declared context
- referenced context
- reachable context
- missing context
- invalid reference
- deprecated context
- archived context
- orphaned context
- conflicting context
- repository manifest
- catalog snapshot
- context graph snapshot
- asset provenance manifest
- optional external-LLM integration reports

Prefer "agent-facing entrypoint", "routing contract", "skill guidance", or "usage contract" over broad coordination language.

Renma is telemetry-aware, but not telemetry-responsible. External signal producers may import usage evidence later, but Renma should not become a runtime observability system.

## Core Concepts

### Skill

A skill is an agent-facing entrypoint. It defines when a capability should be used, when it should not be used, required preflight questions, workflow guidance, safety gates, verification expectations, and which context assets it declares or references.

A good skill stays concise. It routes agents toward the right owned context assets instead of embedding every piece of expert knowledge.

### Context Asset

A context asset is an independently owned source-of-truth knowledge unit prepared for agents to consume. It should be reusable across skills, teams, tools, and agents.

Good context boundaries are based on:

- Concept
- Owner
- Update frequency
- Task relevance
- Conflict surface
- Expected consumers

Examples:

- `contexts/testing/boundary-value-analysis.md`
- `contexts/domain/payment/idempotency.md`
- `contexts/domain/mobile/offline-behavior.md`
- `contexts/tools/appium/limitations.md`
- `contexts/teams/checkout/known-risk-patterns.md`

### Dependency

A dependency is a typed relationship between assets. Initial relationship kinds:

- `requires`
- `optional`
- `conflicts`
- `extends`
- `references`

`references` is static repository evidence for graph analysis and validation, not task context choice.

Every dependency should preserve source evidence: path, line range, declaration form, and reason where available.

### Catalog Snapshot

A catalog snapshot answers what exists in the repository and how assets relate.

It should include:

- Asset ID
- Kind
- Source path
- Content hash
- Owner
- Status
- Tags
- Declared dependencies
- Dependents
- Diagnostics

### Context Graph Snapshot

A context graph snapshot is the dependency graph of skills, context assets, agents, examples, profiles, references, and config. It powers validation, catalog output, affected-asset reporting, semantic diff, and future visualizations.

### Readiness Report

Agent readiness v1 summarizes repository health for agent consumption. It does not say which context to use for a live task. It reports whether the repository has enough ownership, structure, references, metadata, workflow guidance, diagnostics, and layout health for agents to consume assets responsibly.

## Metadata Direction

Start with a small stable metadata subset and expand only when a command uses the field.

```yaml
---
id: context.testing.boundary-value-analysis-v2
title: Boundary Value Analysis
owner: qa-platform
status: stable
version: 1.0.0
last_reviewed_at: 2026-06-28
review_cycle: P180D
expires_at: 2026-12-31
tags:
  - testing
  - qa
when_to_use:
  - Designing tests around numeric, date, quantity, or limit boundaries
when_not_to_use:
  - Exploratory testing notes that do not depend on boundaries
requires_context:
  - testing.negative-testing
optional_context:
  - context.domain.payment.duplicate-charge
conflicts:
  - context.testing.boundary-value-analysis-v1
superseded_by:
  - context.testing.boundary-value-analysis-v3
---
```

The current parser supports YAML-style block lists for selected deterministic metadata fields. Supported block-list fields are `tags`, `when_to_use`, `when_not_to_use`, `requires_context`, `optional_context`, `conflicts`, and `superseded_by`; arbitrary nested maps are not metadata. Freshness metadata is scalar and explicit: `last_reviewed_at` and `expires_at` use ISO dates, and `review_cycle` currently supports day-based ISO 8601 durations such as `P90D` and `P180D`.

Supported status values:

- `experimental`
- `stable`
- `deprecated`
- `archived`

Keep lifecycle status separate from replacement or delegation relationships.
Values such as `active` and `delegated` are not lifecycle statuses. If a local
support file has been replaced by a shared context asset, prefer
`status: deprecated` plus a separate future-compatible relationship such as
`superseded_by: contexts/tools/example/setup.md`.

Context promotion lifecycle governance should also cover the migration after
promotion. When reusable knowledge has moved from `skills/*/references/` into
`contexts/`, Renma can warn if the parent skill still routes readers through a
deprecated or superseded local support file instead of the canonical shared
context asset.

The same lifecycle governance should apply to non-skill assets that keep direct
references to superseded support files. Those references should usually move to
the canonical shared context, unless the superseded file is deliberately kept as
a compatibility or migration shim.

Validation should cover:

- Duplicate IDs
- Invalid status values
- Missing owner on published assets
- Missing ID on shared context assets
- Unknown dependencies
- Dependencies on deprecated or archived context
- Conflicts declared but not visible in the graph
- Stale or expired context from explicit freshness metadata

## QA And Testing Focus

The first strong use case is QA/testing.

The goal is not merely "AI generates test cases." The deeper goal is that QA expertise becomes reusable context assets:

- Testing heuristics become organizational source of truth.
- Domain-specific risks become visible and reusable.
- New engineers and agents can use senior QA knowledge.
- Teams can maintain their own quality knowledge for other teams and agents.

A future `test-case-generation` skill should be able to reference context assets about:

- Boundary value analysis
- Negative testing
- Regression risk
- Payment idempotency
- Duplicate charge prevention
- Refund edge cases
- Mobile offline behavior
- Appium usage
- Internal test strategy
- Known team-specific risks

Renma keeps those assets clean, owned, validated, deduplicated, and easy for agents to consume.

## Roadmap

### Completed Baseline

Renma's shipped baseline is now grouped around:

- Repository discovery for `contexts/**/*.md`, `context/**/*.md`, and skill-adjacent `references/`, `profiles/`, and `examples/`.
- Deterministic scan and catalog diagnostics for metadata IDs, owners, tags, freshness, paths, references, dependencies, manifest shape, layout policy, duplicate context, repeated context, and security policy issues.
- CLI-first views for `scan`, `catalog`, `ownership`, `graph`, focused graph views, `trust-graph`, `readiness`, `bom`, `repeated-context`, `diff`, `ci-report`, `inspect`, `scaffold`, and `suggest-semantic-split`.
- LLM-actionable output without an LLM runtime dependency: Markdown and JSON diagnostics provide stable IDs, severity, evidence, and repair guidance.
- Security diagnostics v1 for agent-facing network, upload, and secret-material policy; approved network destinations; approved upload domains; command-risk patterns; profile inheritance and cycles; and policy contradictions.
- Historical `0.1.0` manifests remain supported as legacy input. Current planning should describe the merged implementation, not a separate `0.2.0` security command.

### Near-Term Implementation

- Deterministic network/upload/secret-material policy refinement and diagnostics coverage for agent-facing repository artifacts.
- Security posture summaries for readiness, CI reports, and Trust Graph, derived from existing scan, catalog, graph, and policy evidence.
- Optional external-LLM repository evaluation bundles remain external and advisory, not scan/catalog/graph/readiness/diff/CI truth.

### Security posture, Trust Graph, and Repository Context BOM

Renma should extend security diagnostics into repository-level security posture reporting before adding heavier provenance features.

Near-term work should keep improving deterministic security diagnostics for agent-facing artifacts. The next layer should summarize effective policy, profile resolution, approved destinations, human approval requirements, forbidden inputs, and high-risk findings in readiness and CI reports.

Trust Graph v1 is an interpretation of existing catalog, graph, scan, and security evidence, not a new runtime system. Nodes expose deterministic trust and risk evidence such as owner presence, lifecycle status, declared dependencies, security profile resolution, effective policy fingerprints, and diagnostics without introducing a subjective score.

Repository Context BOM v1 is a repository-level manifest of declared assets, hashes, owners, lifecycle states, dependencies, security posture, diagnostics, and readiness evidence. It does not claim actual LLM runtime usage.

Actual consumed-context evidence may be imported later from external agents, editor integrations, prompt wrappers, or CI tools and validated against the repository model. Renma should remain telemetry-aware but not telemetry-responsible.

Follow-up policy hygiene ideas belong after Trust Graph v1, not in the first implementation patch:

- Consider a generic diagnostic for non-canonical security policy field spellings if repositories commonly use camelCase policy names in frontmatter and the warning can be made deterministic without branch-specific cleanup rules.
- Consider surfacing profile inheritance details more richly in Trust Graph only when configuration evidence can point back to stable config paths and ranges.

### Later / External Evidence

- Optional external signal import as repository evidence
- Runtime telemetry ownership, dashboards, provider gateways, and prompt wrappers remain out of scope

### Historical Roadmap Detail

### 1. Scanner And Metadata Stabilization

Current Renma lives here. Continue strengthening deterministic scanning, config loading, path normalization, Markdown parsing, and metadata parsing, while treating diagnostics v1 as merged across scan/catalog/readiness/diff/CI/inspect/suggest-semantic-split instead of as a separate history or design track.

Immediate priorities:

- Scan shared `contexts/**/*.md` and `context/**/*.md` by default.
- Preserve stable POSIX-style repo-relative paths.
- Treat shared context assets as first-class catalog entries.
- Validate basic metadata without requiring heavy schemas.
- Keep JSON and text output deterministic for CI.

### 2. First-Class Context Assets

Move the product model from skill-local references toward independently owned shared context assets.

Add rules for:

- Missing context IDs
- Missing owners
- Deprecated or archived context still referenced
- Oversized shared context assets
- Context assets without clear usage guidance
- Shared assets that duplicate large skill-local sections
- SKILL.md files that may contain reusable setup, troubleshooting, platform, testing, risk, or domain-rule guidance worth extracting

### 3. Catalog Generation

Make `renma catalog` the primary discovery artifact.

Commands:

```bash
renma catalog --format json
renma catalog --format markdown
```

Generated artifacts may include:

```text
catalog.json
CATALOG.md
```

Catalogs should be useful in code review, CI, and local repository navigation.

### 4. Dependency And Reference Graph

Build a normalized graph model from declared metadata and Markdown references.

The graph should answer:

- Which assets does this skill declare?
- Which context assets depend on this context?
- Which references are missing?
- Which assets are orphaned?
- Which assets are affected by this change?
- Which conflicts exist?

Current command:

```bash
renma graph --format json
renma graph --format markdown
renma graph --format mermaid
renma graph --focus skill.testing.spec-review --format mermaid
renma readiness --format json
renma readiness --format markdown
```

Focused graph views are inspection tools; they do not choose, inject, or load runtime context for an agent.

Implemented in 0.11.1: graph readability for context lenses.

Problem:

When skills use `context_lens` assets, the current graph is technically correct
but visually noisy because skills, lenses, contexts, and support assets share the
same graph plane. The intended review path should be easy to see:

```text
skill -> lens -> context
```

Real repositories may also keep direct `requires_context` edges while adopting
lenses, so focused graph output can mix these relationship shapes:

```text
skill -> context
skill -> lens -> context
context -> optional_context
```

Implemented behavior:

Renma includes a visualization-only graph view that makes the lens-mediated path
readable without changing catalog semantics or adding runtime behavior.

```bash
renma graph . --view layered
renma graph . --view lens
```

Behavior:

- Group or rank nodes by asset kind: skills, context lenses, contexts, and then
  references / examples / profiles / tools.
- Render `requires_lens` and `optional_lens` edges from skills to lenses.
- Render `applies_to` edges from lenses to contexts.
- Keep direct `requires_context` and `optional_context` edges visible, but
  visually separate from lens-mediated paths so they do not obscure the lens
  layer.
- Preserve existing graph output unless the new view is requested.

Non-goals:

- Do not change catalog semantics.
- Do not add runtime lens selection.
- Do not rank, retrieve, inject, or assemble context.
- Do not make graph views a prompt assembly or agent execution feature.

Acceptance criteria:

- A focused graph for an Appium setup lens clearly shows
  `skill -> lens -> context`.
- Context and lens nodes are visually distinguishable.
- Direct skill-to-context edges remain visible but do not obscure the lens layer.
- Existing graph output remains backward compatible unless `--view layered`,
  `--view lens`, or an equivalent explicit view is requested.

### 5. Graph-Backed Validation

Use the graph to validate repository health.

Rules should identify:

- Missing dependencies
- Invalid references
- Deprecated dependencies
- Archived dependencies
- Orphaned context assets
- Conflicting context declarations
- Cycles that make ownership or review unclear
- Skills that declare too many unrelated contexts

### 6. Repeated Context And Duplicate Knowledge Discovery

Repeated context discovery helps teams extract reusable knowledge into shared assets.

Start with deterministic evidence:

- Exact normalized section hashes
- Near-duplicate token shingles
- Repeated headings
- Repeated command blocks
- Repeated links, path terms, product names, tools, and tags
- Repeated workflow skeletons across skills, references, examples, agents, and contexts

Output should be human-reviewable `ContextPatternCandidate` records with paths, line ranges, signal kinds, confidence, and possible shared asset boundaries.

Optional LLM assistance may label clusters or propose refactors. Deterministic evidence remains the source of truth.

### 7. Semantic Diff For Context Changes

Git shows textual changes. Renma should explain repository-governance changes that matter for agent readiness.

Diff categories:

- Ownership changes
- Status or lifecycle changes
- Required context changes
- Optional context changes
- Conflict changes
- Dependency graph changes
- Repeated-context candidate changes
- Risk and safety changes

Possible command:

```bash
renma diff --from main --to HEAD
```

Semantic diff should compare Renma's deterministic repository model across Git revisions, not use an LLM to interpret arbitrary prose.

It should explain changes in catalog, ownership, lifecycle status, declared dependencies, graph resolution, readiness score/level, check statuses, and findings. The goal is to show whether a change improves or regresses repository governance and agent readiness.

Semantic diff must not choose task context, assemble prompts, judge runtime agent behavior, call an LLM, or automatically repair files.

### 8. Repository Health Reports

Current v1 command:

```bash
renma readiness [path] [--format json|markdown]
```

Readiness v1 is a deterministic static repository-health report. It answers whether skill workflow entrypoints, graph references, ownership metadata, diagnostics, and layout checks are healthy enough for responsible agent consumption.

The Markdown report is compact enough to paste into a PR description: level, score, workflow readiness, graph resolution, ownership coverage, diagnostics, and layout status. The JSON report keeps the same fields available for CI and tooling.

In v1, readiness does not choose runtime context, assemble prompt packages, call an LLM, auto-repair files, compare cross-document semantic consistency, score repairability, or plan per-skill patches.

Future work may add optional LLM-assisted integration reports, CI examples, sample readiness reports, or semantic-diff review bundles, but those are separate from deterministic readiness output.

Security posture should be the next readiness layer after diagnostics stabilization. It should summarize effective security policy, profile resolution, allowed data, forbidden inputs, approved network and upload destinations, human approval requirements, and high-risk findings without selecting runtime context or enforcing agent behavior.

### 9. Optional External Signal Import

External signal producers may later provide consumed-context evidence such as:

- Which context assets agents actually loaded
- Which references were ignored
- Which context assets caused confusion
- Which files changed before failures
- Which teams or skills frequently touch an asset

Potential producers:

- Codex plugin
- Claude extension
- Prompt wrapper
- CI integration
- External agent signal import

Renma may import those signals as repository evidence. Renma should not become the runtime, telemetry backend, provider gateway, or prompt wrapper.

Imported consumed-context evidence should be validated against the catalog, graph, readiness, and security posture model. It should not redefine the near-term Repository Context BOM, which remains a declared repository manifest rather than an actual runtime usage report.

## Out Of Scope

Out of scope for this project direction:

- Task-specific skill choice
- Task-specific context choice
- Prompt assembly
- Context injection
- Agent execution
- Provider invocation
- Hosted dashboards
- Organization-wide synchronization
- Package installation/update transports
- Runtime telemetry ownership

Out-of-scope commands:

Renma should avoid command shapes that imply task execution, agent prompt construction, package synchronization, or agent workflow behavior.

## Operating Principle

Renma should stay boring in the best sense: deterministic, reviewable, local, and useful in Git.

```text
LLM proposes. Renma verifies. Human approves.
```

No-LLM workflows must remain first-class.

## Security diagnostics safety

Renma does not execute skills, install dependencies, or call an LLM to judge content. Its safety model is deterministic, Git-native, and artifact-facing: make agent instructions reviewable before they are reused in prompts, CI jobs, or local automation.

The merged security diagnostics are narrower than a generic command block-list. They understand LLM-facing policy metadata and instruction text for:

- `network_allowed` and approved network destinations, including `approved_network_destinations` and `security.approvedDomains`.
- `external_upload_allowed` and approved upload domains, including `approved_upload_domains` and `security.approvedUploadDomains`.
- Secret-material and credential handling, including commands that pass credentials in arguments.
- Security profile inheritance, missing profiles, cycles, contradictions, and artifact-local policy overrides.
- Risky command/context patterns such as predictable temp paths, broad chmod or sudo usage, ignored recovery paths, and upload/network instructions that violate declared policy.

Core security contract:

```text
LLM proposes. Renma verifies. Human approves.
```

Agent-facing allowed network access, upload, and secret-material rules live in checked-in metadata/config. Diagnostics are deterministic and LLM-actionable: they report stable rule IDs, severity, evidence, and remediation text for humans, agents, CI, and PR review. Renma should continue to explain why something is risky; it should not auto-repair security issues or become a runtime sandbox.

Near-term / future:

- Stabilize security diagnostics for agent-facing context assets and keep broad package, Docker, GitHub Actions, and supply-chain scanner behavior outside Renma's core scope.
- Add security posture summaries to readiness and CI reports using the existing policy, profile, destination, approval, and finding evidence.
- Keep output useful for CI/PR review by improving JSON and Markdown diagnostics rather than adding a standalone `security-diagnostics-v6` command.
- Add focused tests before broadening heuristics, especially for upload/network allow-lists, security profile inheritance, command-risk findings, and false-positive suppression.
- Keep LLM assistance optional and outside the trusted decision path; Renma remains deterministic, non-runtime, and non-LLM.
