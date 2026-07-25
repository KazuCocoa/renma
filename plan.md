# Renma Roadmap

## Current Checkpoint

Renma 0.24.1 is a focused maintenance checkpoint after the 0.24.0
structure-aware security-analysis release.

The checkpoint aligns implementation, tests, CLI help, examples, code comments,
and repository documentation. It does not add a product feature or intentionally
change public behavior.

The current product remains a single-repository, deterministic Context
Repository governance CLI:

```text
LLM proposes. Renma verifies. Human approves.
```

Current contracts live in [architecture.md](architecture.md),
[design.md](design.md), and the [documentation index](docs/README.md).
Historical release detail belongs only in [CHANGELOG.md](CHANGELOG.md).

## Stabilization Priorities

The current stabilization phase prioritizes:

- keeping documentation aligned with executable command, schema, diagnostic,
  path, metadata, ordering, and compatibility contracts;
- preserving one immutable repository-evidence snapshot per analyzed repository
  state;
- keeping static Skill Discovery, security analysis, composition, impact,
  Readiness, diff, CI, Trust Graph, and BOM boundaries explicit;
- removing obsolete chronology and duplicated contract lists from evergreen
  documentation;
- protecting documented deep imports and compatibility re-exports;
- improving maintainability without adding dependencies or broadening runtime
  responsibility.

## Open Core Candidates

These candidates have no assigned release and require independent evidence and
contract review:

- hard-fail Skill Discovery CI gating after operational experience with the
  existing opt-in warn-only policy;
- broader source-to-sink analysis for additional languages or syntax, including
  any separately versioned public evidence contract;
- observed Skill-reference evidence kept separate from authoritative declared
  continuation routes;
- product or ownership projections derived only from stable IDs, exact tags,
  and existing Context or Lens relationships;
- richer focused visualization over existing stable report data;
- additive Trust Graph or BOM evidence whose compatibility impact is explicit.

None is a commitment. A candidate becomes product work only after its user
problem, deterministic inputs, output contract, compatibility effect, and
non-goals are reviewed.

## Adjacent or External Capabilities

Some useful capabilities should remain outside Renma core unless a future
product decision changes the boundary:

- LLM-assisted authoring orchestration can live in a Skill, companion workflow,
  or calling agent while Renma verifies the resulting repository assets.
- Runtime debugging and observability require evidence produced by runtimes.
  Renma may eventually validate a separate evidence artifact, but it cannot
  independently claim what a runtime selected or consumed.
- Multi-repository and organization-wide use requires separate identity,
  federation, transport, and policy decisions.
- Hosted dashboards, provider gateways, package distribution transport, and
  workflow execution are ecosystem responsibilities.

## Explicit Non-Commitments

Renma is not committed to:

- accepting free-form task text and selecting or ranking a Skill;
- fuzzy, embedding, or LLM-based runtime routing;
- prompt construction, Context bundling or injection, or agent execution;
- runtime telemetry collection or claims about actual runtime consumption;
- automatic Skill, metadata, route, policy, or generated-index edits;
- a required category, product, team, or workflow directory hierarchy;
- subjective trust, confidence, centrality, popularity, or “best Skill” scores;
- treating owner changes as product identity changes;
- making optional LLM assistance required for deterministic validation.

## Decision Rule

Prefer the smallest additive contract that answers a demonstrated repository
governance question. Keep deferred ideas visibly separate from shipped behavior,
and move completed implementation history to the changelog instead of extending
this roadmap.
