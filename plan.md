# Renma Roadmap

## Current Product

Renma 0.22.x is a Git-native Context Repository governance CLI for
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

## Immediate Priority: Skill Discovery Publication And Adoption

The active design and implementation area is static Skill Discovery for
repositories with many layered `SKILL.md` files.

The shipped 0.22.0 slice makes explicit Skill-to-Skill continuation contracts,
exact route resolution, route eligibility/usability, warning diagnostics, and
structural roots reviewable without introducing a runtime Skill selector.
Existing Skills remain the source of workflow and routing policy; the graph is
only a compact, deterministic projection.

The 0.22.1 slice adds explicit Skill-local published entrypoints and explicit
repository-wide Discovery adoption. It does not infer either from graph
position, route metadata, directories, ownership, or the existence of Skills.
Reachability and coverage remain explicitly not evaluated.

[The Skill Discovery design](plan-discovery.md) defines the full direction and
the independently bounded 0.22.0 and 0.22.1 release slices.

## Expected Implementation Sequence

1. Ship the 0.22.0 foundation with only
   `metadata.renma.continues-with`, exact ID/path resolution, prepared snapshot
   route evidence, warnings, structural roots, and
   `graph --view discovery` JSON/Markdown/Mermaid with optional exact focus.
2. Ship the 0.22.1 publication/adoption contract with only the exact
   `metadata.renma.published-entrypoint: "true"` marker, strict
   `skill_discovery.adopted` policy, adoption states, publication diagnostics,
   and Discovery graph projection. Do not infer publication or adoption.
3. Review reachability, coverage, and a separate `skill-index` report/command
   only after route evidence has operational use.
4. Consider Readiness, semantic diff, CI, Trust Graph, BOM, authoring, and
   richer visualization integrations independently after those contracts are
   stable.

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
