# Renma Roadmap

## Current Product Definition

Renma 0.18.0 is the current shipped baseline: a Git-native context repository
and deterministic governance CLI for agent-consumable Skills, Context Lenses,
Context Assets, local support resources, policies, ownership, lifecycle,
dependencies, and review evidence.

```text
Skill = focused, bounded workflow entrypoint
Context Lens = purpose-oriented interpretation over Context Assets
Context Asset = independently owned source-of-truth knowledge
```

Use platform-native guidance for general Skill authoring, then use Renma for
repository-specific governance. Renma follows the deterministic boundary:

```text
LLM proposes. Renma verifies. Human approves.
```

## Implemented 0.18.0 Baseline

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
