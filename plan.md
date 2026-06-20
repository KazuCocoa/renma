# Renma Plan

Renma is a Git-native governance and quality layer for LLM-ready context assets and skills.

Renma prepares shared repositories so Codex, Claude, Cursor, and future agents can consume team-owned expertise correctly. Renma does not choose task context, assemble prompts, inject context, or execute agent workflows. Agents and agent runtimes decide how to use the repository assets at task time.

Conceptually:

```text
Skill = LLM-facing entrypoint / routing contract / usage guide
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

Renma remains deterministic by default, CLI-first, Git-native, minimal-dependency, and independent of LLMs for core analysis. Optional LLM assistance may support suggestions, semantic duplicate labeling, or review summaries, but deterministic evidence remains the authority.

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
- Produce agent readiness reports that describe repository health.
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
- agent readiness report

Prefer "LLM-facing entrypoint", "routing contract", "skill guidance", or "usage contract" over broad coordination language.

Renma is telemetry-aware, but not telemetry-responsible. External signal producers may import usage evidence later, but Renma should not become a runtime observability system.

## Core Concepts

### Skill

A skill is an LLM-facing entrypoint. It defines when a capability should be used, when it should not be used, required preflight questions, workflow guidance, safety gates, verification expectations, and which context assets it declares or references.

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

### Agent Readiness Report

An agent readiness report summarizes repository health for agent consumption. It should not say which context to use for a live task. It should say whether the repository has enough ownership, structure, references, metadata, and validation for agents to consume assets responsibly.

## Metadata Direction

Start with a small stable metadata subset and expand only when a command uses the field.

```yaml
id: testing.boundary-value-analysis
version: 1.0.0
owner: qa-platform
status: stable
tags: testing, qa
when_to_use: Designing tests around numeric, date, quantity, or limit boundaries
when_not_to_use: Exploratory testing notes that do not depend on boundaries
requires_context: testing.negative-testing
optional_context: domain.payment.duplicate-charge
conflicts: archived.testing.boundary-v0
```

The current parser supports simple one-line values and comma-separated lists. Richer YAML block-list frontmatter can be added later.

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
- Stale or expired context when freshness fields are introduced

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

- First-class `context` assets under `contexts/**/*.md` and `context/**/*.md`
- Context discovery distinct from skill-local `references/`, `profiles/`, and `examples/`
- Deterministic scan and catalog metadata consistency
- Invalid lifecycle status detection
- Missing shared context `id` and `owner` diagnostics
- Semantic context path advisory for process-state folders
- Duplicate asset ID detection
- Unknown declared reference detection
- Deprecated or archived declared reference validation
- Orphaned shared context asset detection
- Superseded local support asset reference advisories
- Ownership coverage reporting
- Context graph snapshot reporting
- LLM-actionable finding fields for safe external repair loops

### Near-Term Implementation

- Agent readiness report
- Repeated context and duplicate knowledge discovery
- Semantic diff for context changes
- Optional LLM-assisted repository evaluation bundles

### Later / External Evidence

- Optional external signal import as repository evidence
- Runtime telemetry ownership, dashboards, provider gateways, and prompt wrappers remain out of scope

### Historical Roadmap Detail

### 1. Scanner And Metadata Stabilization

Current Renma lives here. Continue strengthening deterministic scanning, config loading, path normalization, Markdown parsing, and metadata parsing.

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
```

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

### 8. Agent Readiness Reports

Agent readiness reports should summarize whether the repository is healthy enough for agents to consume.

Report areas:

- Missing owners
- Missing usage guidance
- Broken references
- Deprecated or archived reachable context
- Orphaned shared context
- Oversized assets
- Duplicate knowledge
- Safety risks
- Affected skills and assets

### 9. Optional External Signal Import

External signal producers may later provide evidence such as:

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
