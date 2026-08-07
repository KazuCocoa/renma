# Skill Discovery Design Rationale

## Status

Status: stable single-repository static Discovery core, fully implemented.

As of Renma 0.28.4, the accepted Discovery design is shipped across the
dedicated graph view, Skill Index, Readiness, semantic diff, and CI report. CI
enforcement remains explicitly opt-in and warn-only. Route cycles are review
evidence, and no Discovery condition can produce a CI failure.

The newer executable-surface inventory and focused executable graph describe
bounded Skill-to-script and script-to-script evidence. They do not create
Skill continuation routes, publication, or Discovery reachability. Likewise,
the isolated SkillSpector evidence-correlation experiment does not make
scanner observations authoritative Discovery declarations.

The authoritative current behavior, schemas, diagnostics, CLI projections,
Readiness integration, semantic diff, and CI review policy are documented in
the [Skill Discovery Graph and Index contract](../skill-discovery.md).
Implementation ownership and snapshot invariants are documented in
[Internal Architecture](internal-architecture.md). Release history belongs in
the [Changelog](../changelog.md).

This document retains only the durable product rationale and open design
questions. It is not a release sequence or a second copy of the current
contract.

## Problem

A flat catalog is not a sufficient first hop in a repository with many layered
Skills. Reviewers need to understand explicit workflow topology without
inspecting every `SKILL.md`, and repositories need that topology to vary without
adopting one required category, product, team, or workflow hierarchy.

Skill Discovery answers that repository-governance problem with an explicit,
static graph. It does not interpret a live task or choose a Skill.

## Accepted Design

### Preserve layered Skills as a graph

Repositories may organize workflow responsibility in different orders. Renma
therefore models exact source-Skill-to-target-Skill continuation relationships
instead of assigning directory levels a universal meaning.

The source Skill owns the decision policy in its body. A continuation edge says
which next Skills are possible; it does not encode priority, automatically
delegate work, or replace the workflow prose.

### Keep publication separate from coverage

Three facts remain independent:

1. a Skill may declare continuation routes;
2. a Skill may explicitly publish itself as an entrypoint;
3. a repository may explicitly adopt authoritative Discovery coverage.

Publishing an entrypoint does not declare that every Discovery-eligible Skill
must be reachable. Repository-wide coverage is a separate explicit
configuration decision. Only adopted mode enables authoritative global
not-reached diagnostics.

### Fail closed on eligibility and identity

A Discovery-eligible Skill is a specification-valid canonical Agent Skill that
is not deprecated or archived and whose effective asset ID is unique across the
repository catalog.

Invalid or ambiguous evidence stays visible without becoming authoritative. If
a target is a specification-invalid Skill, Renma retains its Skill identity,
path, validation diagnostics, and route evidence, but the route cannot become
usable.

### Require explicit route evidence

`renma.continues-with` is the only canonical continuation declaration.
Resolution uses one exact effective Skill ID or normalized
repository-relative source path.

Arbitrary local Markdown links are **not** authoritative routes. Directory
shape, naming similarity, ownership, tags, prose, embeddings, and LLM inference
also do not create routes.

### Keep static evidence separate from runtime routing

Structural roots, published entrypoints, route usability, reachability,
unrouted Skills, not-reached Skills, and cyclic components are static graph
facts. They do not prove that a runtime selected, skipped, recursed through, or
successfully executed a Skill.

### Prefer compact additive projections

Discovery reuses the repository snapshot, catalog, and Agent Skills validation.
Graph, Skill Index, Readiness, diff, and CI derive their focused projections
from the same prepared index instead of rescanning or inventing parallel route
semantics.

The complete JSON contracts retain exact evidence. Markdown and Mermaid are
bounded review projections. Compact presentation must not change identity,
ordering, reachability, or policy decisions.

## Compatibility Boundary

Canonical publication uses the exact string-valued
`renma.published-entrypoint` marker. Repository-wide adoption uses the explicit
`skill_discovery.adopted` configuration field. Neither is inferred.

Historical proposal fields such as `routes_to`, `discovery_entrypoint`, and
`discovery_aliases` are not aliases or compatibility input. Discovery
continuations do not enter `catalog.dependencies`, and the dedicated Discovery
graph does not add continuation edges to ordinary graph views.

Repositories without Discovery declarations retain neutral, descriptive
Discovery projections where the current report contract requires them. Renma
does not manufacture coverage, publication, routes, or policy findings for an
unadopted repository.

## Gradual Adoption

A repository can adopt Discovery incrementally:

1. inspect existing Skills and exact candidate continuations;
2. declare routes in the Skills that own those decisions;
3. publish bounded entrypoints intentionally;
4. review descriptive topology and reachability;
5. enable repository-wide adoption only when complete coverage is genuinely
   intended.

No all-at-once metadata migration, generated mega-index, or repository rewrite
is required.

## Open Questions

The following remain candidates, not commitments. None has an assigned release:

- whether observed local Skill references or external scanner correlations
  provide useful separate, non-authoritative evidence without weakening exact
  declared-route authority;
- whether product views can be derived from existing exact tags and
  Context/Lens identity without adding a Product asset or ownership-derived
  product identity;
- which additional focused visualization, beyond the current bounded
  JSON/Markdown/Mermaid projections and focus neighborhood, remains readable in
  large cyclic or shared-child graphs;
- whether operational experience justifies independently reviewed hard-fail CI
  gating.

Any future contract review must start from a concrete deterministic consumer.
It must not silently add aliases, observed-route authority, fuzzy focus, another
metadata field, or another repository configuration field.

## Non-Goals

- live task interpretation or Skill selection;
- ranking, recommendation, fuzzy search, embeddings, or aliases;
- prompt assembly, Context loading or injection, or execution;
- runtime telemetry or consumed-context claims;
- inferred routes from prose, links, directories, or ownership;
- a required repository hierarchy or central handwritten index;
- automatic route, entrypoint, Skill, config, or generated-file edits;
- subjective routing confidence, quality, centrality, or popularity scores;
- federation or organization-wide transport.
