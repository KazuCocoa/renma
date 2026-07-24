# Renma Roadmap

## Current Product

Renma 0.23.1 is a Git-native Context Repository governance CLI for
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

## Stable Skill Discovery Core

The current single-repository static Skill Discovery core is stable for
repositories with many layered `SKILL.md` files.

The shipped 0.22.0 slice makes explicit Skill-to-Skill continuation contracts,
exact route resolution, route eligibility/usability, warning diagnostics, and
structural roots reviewable without introducing a runtime Skill selector.
Existing Skills remain the source of workflow and routing policy; the graph is
only a compact, deterministic projection.

The 0.22.1 slice added explicit Skill-local published entrypoints and explicit
repository-wide Discovery adoption. It does not infer either from graph
position, route metadata, directories, ownership, or the existence of Skills.

The 0.22.2 slice adds cycle-safe reachability from effective published
entrypoints. Partial repositories with an effective first hop receive
descriptive evidence; adopted repositories receive authoritative coverage and
one warning per not-reached eligible Skill. Traversal uses only existing usable
representative resolved Skill routes and never infers routes from prose or
Markdown links.

The 0.22.3 slice adds the canonical `renma.skill-index.v1` report and
stdout-only `renma skill-index` command. It wraps the prepared Discovery index
from the shared repository snapshot, defaults to compact Markdown, supports
complete JSON and exact optional focus, and keeps repository diagnostics
separate from Discovery diagnostics. It does not interpret a task, choose or
execute a Skill, infer routes, load Context, or create a generated index.

The 0.22.4 stabilization slice adds deterministic strongly connected component
review over the existing usable continuation graph. It emits one
`DISCOVERY-ROUTE-CYCLE` warning per maximal cyclic component, including
self-loops, with exact internal route and Skill evidence. Cycles remain
traversal-safe static evidence and may be intentional; Renma does not claim
runtime recursion or choose a route to remove.

The 0.23.0 slice projects the existing prepared Discovery index into
`renma readiness`. It adds compact repository-wide counts plus publication,
route-validity, coverage, unrouted-Skill, and cycle-review checks. Authoritative
adoption makes coverage gaps review warnings; partial and not-adopted coverage
remain descriptive. The checks add visibility without a new score weight or a
second penalty for existing diagnostics.

The 0.23.1 slice adds an observation-only `DiffReport.discovery` projection to
direct `renma diff`. It compares exact adoption, coverage, effective
publication, reachable/not-reached and unrouted Skill identities, canonical
route groups, and maximal cyclic components from the prepared indexes for two
refs. Route identity uses normalized source path plus normalized declared
target, so declaration order and source lines are not semantic identity.
Renma assigns no improvement/regression classification, CI status, warning,
gate, or exit-code effect to these facts.

[The Skill Discovery design](plan-discovery.md) defines the full direction and
the independently bounded 0.22.0 through 0.22.4 core slices, 0.23.0 Readiness
integration, and 0.23.1 semantic diff integration.

## Expected Implementation Sequence

1. Ship the 0.22.0 foundation with only
   `metadata.renma.continues-with`, exact ID/path resolution, prepared snapshot
   route evidence, warnings, structural roots, and
   `graph --view discovery` JSON/Markdown/Mermaid with optional exact focus.
2. Ship the 0.22.1 publication/adoption contract with only the exact
   `metadata.renma.published-entrypoint: "true"` marker, strict
   `skill_discovery.adopted` policy, adoption states, publication diagnostics,
   and Discovery graph projection. Do not infer publication or adoption.
3. Ship the 0.22.2 reachability/coverage slice through the existing Discovery
   graph: cycle-safe traversal, descriptive versus authoritative coverage,
   unrouted classification, and adopted-mode unreachable warnings. Do not add
   a command.
4. Ship the 0.22.3 versioned `skill-index` report/command from the same prepared
   snapshot and Discovery index, with JSON, compact Markdown, exact focus,
   diagnostic separation, and no downstream-report integration.
5. Ship the 0.22.4 stabilization slice with deterministic usable-route cycle
   diagnostics, exact component evidence, linked routes and Skills, focus-aware
   diagnostic projection, and no report schema, reachability, or downstream
   integration changes.
6. Ship the 0.23.0 Readiness projection from the same prepared index with a
   compact additive summary and five non-double-counting checks. Preserve
   descriptive partial coverage, warning-only cycle review, and every existing
   Discovery semantic and diagnostic contract.
7. Ship the 0.23.1 observation-only direct semantic diff from one immutable
   `RepositorySnapshot` per ref. Compare prepared Discovery identities and
   route/cycle state without changing Readiness, diagnostics, CI, or exits.
8. Evaluate 0.23.2 CI report integration independently. Any optional CI policy
   or gating remains a later separately reviewed decision, as do Trust Graph,
   BOM, observed-reference, ownership, authoring, richer visualization, and
   federation integrations.

The current roadmap sequence is:

```text
0.23.0 — Discovery Readiness integration
0.23.1 — Discovery semantic diff integration
0.23.2 — Discovery CI report integration
later   — optional CI policy or gating
```

The 0.23.2 and later lines identify review order, not committed product
behavior.

## Later Candidates

Possible later Renma core work includes:

- Discovery projection in CI reports after an independent 0.23.2 contract
  review;
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
