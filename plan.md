# Renma Roadmap

## Current Product Definition

Renma is a Git-native context repository and deterministic governance CLI for
agent-consumable Skills, Context Lenses, Context Assets, references, policies,
ownership, lifecycle, dependencies, and evidence.

```text
Skill = agent-facing entrypoint, routing contract, and workflow guide
Context Lens = purpose-oriented interpretation over Context Assets
Context Asset = independently owned source-of-truth knowledge
```

Use platform-native Skill authoring guidance for general Skill design, then use
Renma for repository-specific governance and validation. Renma keeps repository
assets discoverable, compatible, owned, linked, validated, reviewable, and
measurable in Git and CI.

Renma's deterministic core follows:

```text
LLM proposes. Renma verifies. Human approves.
```

No-LLM workflows remain first-class.

## Stable Product Boundaries

Renma owns:

- repository discovery and parsing;
- a normalized asset and relationship model;
- Agent Skills compatibility checks;
- catalog, ownership, graph, Trust Graph, Readiness, and BOM projections;
- deterministic workflow, metadata, lifecycle, relationship, maintenance, and
  security diagnostics;
- semantic diff and CI review evidence; and
- deterministic scaffold and non-editing suggestion output.

Renma does not own:

- general Skill authoring logic supplied by platforms;
- live Skill or Context selection;
- prompt assembly or Context injection;
- Skill, agent, or tool execution;
- runtime telemetry collection;
- hosted dashboards or provider gateways;
- automatic semantic rewriting; or
- automatic policy weakening or suppression creation.

Repository Context BOM v2 remains a declared repository manifest, not a record
of what an LLM consumed. Trust Graph remains deterministic review evidence, not
a subjective trust score or runtime enforcement system.

## Completed Baseline Through 0.16.0

The shipped baseline includes:

- deterministic repository scanning, catalog, ownership, graph, focused graph,
  Readiness, semantic diff, and CI reports;
- first-class Context Assets and Context Lenses with graph-backed validation;
- repeated-context and workflow diagnostics;
- security diagnostics, reusable policy profiles, posture summaries, and
  effective policy inventory;
- Trust Graph v2 evidence and Repository Context BOM v2;
- `inspect`, `scaffold`, `suggest-metadata`, and
  `suggest-semantic-split` authoring support;
- LLM-actionable diagnostics v2 and review bundles; and
- the canonical Agent Skills-compatible Skill format introduced in 0.16.0,
  with flat string-valued `metadata.renma.*` governance and security fields and
  a conservative one-way migration path.

Historical release detail belongs in [CHANGELOG.md](CHANGELOG.md). Authoritative
technical contracts remain in [architecture.md](architecture.md),
[design.md](design.md), and the focused documents under [docs/](docs/README.md).

## 0.17.0: Usability And Documentation Consolidation

Renma 0.17.0 improves the usability and consistency of the authoring and
governance workflows established in 0.16.0. It clarifies documentation, CLI
guidance, and the handoff between platform-native Skill authoring and Renma's
repository-specific validation.

The release focuses on:

- making the new-Skill authoring → scaffold → scan → refine loop discoverable;
- making the existing-Skill review → suggest-metadata → scan → refine loop
  discoverable;
- keeping generic CLI guidance platform-neutral;
- preserving conservative blocked migration and non-editing behavior;
- consolidating README, user-manual, authoring, compatibility, architecture,
  design, and roadmap responsibilities; and
- retaining detailed BOM, security, migration, diagnostic, and repository-model
  contracts in focused documents.

This release does not add a major command, new schema, discovery model, runtime
capability, packaging system, or telemetry import.

## 0.18.0: Graph-Based Skill Discovery

The next proposed capability is a static Skill discovery projection for large
single repositories. The target is 0.18.0, not 0.17.0.

The proposal may add exact Skill-to-Skill route evidence, a static
`skill-index` report, conservative entrypoint inference, deterministic
discovery diagnostics, and later Readiness/diff integrations. It must preserve
the source `SKILL.md` files, the non-runtime boundary, deterministic outputs,
and backward compatibility.

The design is proposed rather than implemented. See
[plan-discovery.md](plan-discovery.md) for prototype knowledge, open decisions,
phases, and non-goals.

## Later Candidates

Later work may consider:

- importing separately produced consumed-context evidence after a stable,
  versioned contract exists;
- additive BOM or Trust Graph projections for stable discovery evidence;
- optional semantic review helpers that consume explicit deterministic bundles;
- multi-repository or distribution workflows after the single-repository model
  is stable; and
- review visualizations derived from versioned report contracts.

These candidates require explicit product decisions. They are not commitments
and must not blur repository governance with runtime execution or telemetry
ownership.

## Explicitly Out Of Scope

The current roadmap excludes:

- accepting task text and automatically selecting or ranking a Skill;
- fuzzy, embedding, or LLM-based runtime routing;
- runtime Context selection, loading, injection, or prompt assembly;
- Skill or agent execution and tool orchestration;
- automatic Skill body rewriting;
- platform-native authoring logic inside Renma;
- arbitrary Skill roots without a separately reviewed compatibility decision;
- package publication, Context materialization, or repository distribution;
- runtime telemetry collection or hidden consumed-context import;
- BOM v2 without a demonstrated breaking-contract need;
- automatic policy relaxation or suppression generation; and
- new metadata semantics without an implemented deterministic consumer.

The roadmap should stay current-facing. Completed behavior belongs in the
baseline and changelog; detailed semantics belong in their canonical technical
documents; proposed discovery remains isolated in the 0.18.0 plan.
