# Renma Roadmap

## Current Product

Renma 0.21.0 is a Git-native Context Repository governance CLI for
agent-consumable knowledge. It applies the review boundary:

```text
LLM proposes. Renma verifies. Human approves.
```

The shipped product provides:

- focused, bounded Skills using the canonical Agent Skills format;
- Context Lenses and independently owned Context Assets;
- deterministic, repository-bounded discovery and normalized repository
  evidence;
- catalog, graph, ownership, Readiness, semantic diff, CI report, and review
  bundle projections;
- Declared Composition and Declared Impact analysis;
- Trust Graph v2 and Repository Context BOM v2;
- deterministic authoring guidance, inspection, and metadata or semantic-split
  suggestions;
- `renma scaffold` for explicitly requested starter assets; and
- `renma init` for recording repository adoption with a minimal configuration
  file, independently from asset scaffolding.

Historical release detail belongs in [CHANGELOG.md](CHANGELOG.md). Current
contracts live in [architecture.md](architecture.md), [design.md](design.md),
and the focused documents under [docs/](docs/README.md).

## Current Product Boundaries

Renma owns deterministic repository discovery, parsing, validation,
projections, diagnostics, and review evidence. It does not own live task
interpretation, runtime Skill or Context selection, prompt assembly, Context
injection, workflow execution, or runtime telemetry collection.

Repository Context BOM v2 describes declared repository evidence, not what a
runtime consumed. Trust Graph v2 connects static governance evidence without
assigning subjective trust or routing scores.

## Immediate Priority: Skill Discovery

The next active design and implementation area is static Skill Discovery for
repositories with many layered `SKILL.md` files.

The goal is to make explicit Skill-to-Skill continuation contracts,
intentional first-hop entrypoints, eligibility, descriptive reachability, and
separately declared repository-wide coverage reviewable without introducing a
runtime Skill selector. Existing Skills remain the source of workflow and
routing policy; a generated index is only a compact, deterministic projection.

[The Skill Discovery design](plan-discovery.md) defines the recommended MVP and
its open questions. No release number is assigned until the public metadata,
report, diagnostic, and CLI contracts have been reviewed.

## Expected Implementation Sequence

1. Finalize the two-field metadata contract, single-field repository coverage
   policy, domain types, versioned JSON report, representative fixtures, and
   contract tests without adding a public command.
2. Parse and resolve exact declared Skill continuations, preserve invalid-Skill
   evidence, compute fail-closed eligibility, entrypoints, and descriptive or
   authoritative reachability, and emit exact diagnostics through an internal
   report API.
3. Add a stdout-only `renma skill-index` command with canonical JSON, compact
   Markdown, and exact focus by Skill ID or repository-relative path.

Each step should remain independently reviewable. Readiness, semantic diff,
CI, Trust Graph, BOM, authoring, and visualization integrations follow only
after the standalone report contract is stable.

## Later Candidates

Possible later Renma core work includes:

- Discovery summaries in Readiness, semantic diff, and CI reports;
- optional CI policy for exact, repository-adopted Discovery violations;
- product and ownership projections based on stable IDs, exact tags, and
  existing Context or Lens relationships;
- observed Skill-reference analysis kept separate from authoritative declared
  routes;
- Trust Graph or BOM additions after their contract impact is reviewed; and
- richer focused visualizations over stable report data.

These are candidates, not commitments, and have no assigned release.

## Adjacent or External Capabilities

- LLM-assisted authoring support should remain a dogfooded Skill layer,
  companion package, or other adjacent workflow unless a future product
  decision changes the boundary. Renma core continues to verify the resulting
  repository assets deterministically.
- Runtime debugging and observability require evidence produced by runtimes,
  such as selected Skill revisions and actually loaded Context. Renma may later
  validate or correlate an external evidence contract, but it cannot
  independently collect that evidence.
- Multi-repository and organization-wide workflows require separate federation,
  identity, transport, and policy decisions.
- Optional semantic review helpers may prepare bounded evidence or suggestions;
  they must not become required for deterministic validation.

## Explicit Non-Goals

- accepting free-form task text and selecting or ranking a Skill;
- fuzzy, embedding, or LLM-based runtime routing;
- prompt construction, Context bundling or injection, and agent execution;
- runtime telemetry collection or claims about actual runtime consumption;
- automatic Skill, metadata, route, or generated-index edits;
- a required category, product, team, or workflow directory hierarchy;
- subjective routing confidence, centrality, quality, or “best Skill” scores;
  and
- treating an owner change as a product identity change.
