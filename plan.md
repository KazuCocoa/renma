# Renma Roadmap

## Current Product Definition

Renma 0.19.2 is the current shipped baseline:
a Git-native context repository and deterministic governance CLI for
agent-consumable Skills, Context Lenses, Context Assets, local support
resources, policies, ownership, lifecycle, dependencies, and review evidence.

```text
Skill = focused, bounded workflow entrypoint
Context Lens = purpose-oriented interpretation over Context Assets
Context Asset = independently owned source-of-truth knowledge
```

Renma follows the deterministic boundary:

```text
LLM proposes. Renma verifies. Human approves.
```

## Implemented 0.18.x Baseline

The shipped baseline includes:

- focused workflow Skills with explicit usage boundaries rather than thin
  routing-only entrypoints;
- progressive disclosure through static, reviewable references;
- first-class Skill-local `references/`, `profiles/`, `examples/`, `scripts/`,
  and `assets/` resources under `skills/**` and `.agents/skills/**`;
- deterministic ownership, reachability, helper-command, and static support
  relationships, including ambiguity that fails closed;
- repository-bounded discovery that never follows leaf or directory symlinks,
  with actionable evidence for referenced unusable paths;
- canonical Agent Skills compatibility, migration guidance, scaffold, inspect,
  and non-editing suggestion workflows;
- catalog, graph, ownership, Readiness, semantic diff, CI, diagnostics v2, and
  review-bundle projections;
- security diagnostics, reusable profiles, effective-policy inventory, and
  deterministic compositional policy provenance; and
- Repository Context BOM v2 and Trust Graph v2 as the first supported
  long-term contracts and the only emitted BOM/Trust Graph schemas.

Repository Context BOM v2 is a declared repository manifest, not a record of
what an LLM consumed. Trust Graph v2 is deterministic review evidence, not a
subjective score or runtime enforcement system.

Historical release detail belongs in [CHANGELOG.md](CHANGELOG.md). Contract
details live in [architecture.md](architecture.md), [design.md](design.md), and
the focused documents under [docs/](docs/README.md).

## Shipped 0.19.0 Authoring Guidance

The 0.19.0 authoring flow begins with the deterministic, stdout-only
`renma guide skill` contract:

```text
renma guide skill
  -> define the smallest intended asset graph
  -> renma scaffold skill
  -> scaffold or reuse justified Context Assets
  -> complete the focused workflow
  -> renma scan . --fail-on high
  -> inspect catalog and graph evidence
  -> fix and rerun
  -> human review
```

Renma establishes repository asset, metadata, placement, source-of-truth, and
file-responsibility boundaries before generation. Platform-native Skill
guidance may refine semantics only within those boundaries. A source-of-truth
role alone can justify a concise Context Asset; reuse across multiple Skills is
not required. Scripts, Context Lenses, examples, and support files require their
own current responsibility.

`guide` does not call an LLM, accept task text, create or edit files, fetch
URLs, select runtime Context, infer governance or domain facts, or perform
semantic rewriting. Human or LLM authors create the intended assets; existing
scan, catalog, and graph behavior validates and exposes deterministic repository
evidence.

## Shipped 0.19.1 Interactive Authoring Protocol

The shipped 0.19.1 follow-up extends the same structured `renma guide skill` source with
an interactive protocol for the consuming LLM. It does not make Renma itself
interactive and does not add a command or option:

```text
renma guide skill
  -> consuming LLM clarifies the task and investigates applicable evidence
  -> separate authoring decisions from runtime task unknowns
  -> separate confirmed facts, proposals, and unresolved human truth
  -> separately classify blocking, reversible-default, and deferred progression
  -> cluster raw gaps into decision themes and choose dispositions
  -> ask one to three focused questions per batch and retain queued blockers
  -> pass the creation gate when no blocker remains
  -> scaffold and author the smallest justified structure
  -> validate
  -> repair only uniquely supported corrections, investigate, ask, or justify no change
  -> re-enter the creation gate if asset boundaries may change
  -> persist reviewed durable decisions
  -> human review
```

The protocol adds interactive clarification; qualified truth-source separation
across user statements, supplied artifacts, applicable repository evidence,
reviewed external source content, and Renma structural rules; separate
authoring-time and runtime access decisions; creation-gate re-entry; conservative
post-scan repair classification; and reviewed-decision persistence. Temporary
conversation summaries, rejected proposals, and unanswered questions do not
become repository metadata or assets. Platform-native Skill authoring guidance
may refine semantics only after the gate and only within the agreed Renma
structure; discovered boundary changes return to clarification instead of being
applied silently.

The protocol keeps epistemic support separate from authoring progression. The
consuming LLM retains the complete blocker set, asks small question batches,
proceeds with visible safe reversible defaults or Deferred items only after no
Blocking decision remains, and promotes a Deferred item back to Blocking when
later evidence makes it material. Branching across unrelated responsibilities
prompts a Proposed Skill-boundary reconsideration, never an automatic split.

Task-instance unknowns that the finished Skill should detect and report do not
automatically block creation. The protocol keeps unknown scope and disposition
separate from epistemic and progression axes, groups raw gaps into risk-oriented
decision themes, and reassesses Blocking versus Report as finding only across
meaningful workflow stages. Many findings are expected output for review Skills;
only materially independent tasks and contracts signal a possible Skill split.

This elaborates the stable operating boundary: `LLM proposes. Renma verifies.
Human approves.` Deterministic detection does not imply deterministic repair,
and repeated-context consolidation remains a reviewed semantic decision.

Existing CLI arguments, exit codes, deterministic output, non-editing behavior,
and repository contracts remain unchanged.

## Shipped 0.19.2 Domain-Neutral Authoring Refinement

Renma 0.19.2 preserves the complete 0.19.1 truth-seeking authoring protocol and
structurally separates it from an ordered top-level illustration collection.
Illustrations are optional, non-normative demonstrations of authoring tensions,
not Skill categories or templates. The consuming LLM applies the protocol to
the current request and evidence; it may ignore illustrations or combine
individual lessons without selecting a closest example.

The report-first and fictional source-backed Product API patterns retain their
corrected semantics, while every extra asset, source, permission, or Skill split
still requires independent evidence. Future illustrations may be added without
modifying `interaction`. `guide` remains deterministic, stdout-only,
non-editing, non-networked, and non-interactive; it neither calls an LLM nor
performs illustration classification or runtime selection.

## Stable Product Boundaries

Renma owns repository discovery and parsing, normalized static evidence,
validation, deterministic projections, and review-oriented authoring support.
It does not own live Skill or Context selection, prompt assembly, execution,
runtime telemetry, hosted gateways, automatic semantic rewriting, or automatic
policy weakening.

## Deferred Skill-to-Skill Discovery Design

Graph-based Skill-to-Skill route discovery is not a 0.18.0 feature and has no
assigned release. The exploratory design in
[plan-discovery.md](plan-discovery.md) discusses possible `routes_to` metadata,
discovery aliases, generated routing indexes, and a `skill-index` projection.
None is an implemented contract.

Any future proposal must be reconsidered against the focused-workflow model
introduced in 0.18.0. It must remain deterministic and static, avoid runtime
selection, preserve source Skills, and receive an explicit version and contract
decision before implementation.

## Later Candidates

Future product decisions may consider imported external consumed-context
evidence, additive projections over stable evidence, optional semantic-review
helpers, multi-repository workflows, or review visualizations. These are not
commitments and have no assigned version.

## Explicitly Out Of Scope

- accepting task text and automatically selecting or ranking a Skill;
- fuzzy, embedding, or LLM-based runtime routing;
- runtime Context loading, injection, prompt assembly, or execution;
- runtime telemetry collection or hidden consumed-context import;
- automatic Skill-body rewriting or policy relaxation;
- arbitrary Skill roots without a reviewed compatibility decision; and
- advertising deferred `routes_to`, `skill-index`, aliases, or generated
  routing indexes as current behavior.
