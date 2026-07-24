# Skill Discovery Graph and Index

Renma 0.23.2 provides a static, declaration-driven Skill-to-Skill graph, a
versioned compact index, a compact repository-level Readiness projection, and
an observation-only direct semantic diff. It does not interpret task text,
select, rank, load, invoke, or execute a Skill. Repository authors keep routing
conditions in source `SKILL.md` files; Renma exposes deterministic publication,
adoption, continuation, and structural evidence.

The progression is intentionally layered:

```text
0.22.0
  explicit continuation routes, exact resolution, diagnostics,
  structural roots, and graph projection

0.22.1
  explicit published entrypoints and explicit repository-wide
  Discovery adoption

0.22.2
  cycle-safe reachability, descriptive coverage, authoritative coverage,
  and adopted-mode unreachable diagnostics

0.22.3
  versioned renma.skill-index.v1 report and dedicated stdout-only
  skill-index command

0.22.4
  deterministic route-cycle review diagnostics and stabilization of the
  single-repository static Discovery core

0.23.0
  compact Skill Discovery summary and focused checks in Readiness

0.23.2
  observation-only Skill Discovery topology changes in direct semantic diff
```

## Three separate facts

```text
structural root
  = a derived Skill graph fact

published entrypoint
  = an explicit valid Skill-local declaration

repository-wide adoption
  = an explicit repository configuration decision
```

A structural root is not automatically published. A published entrypoint does
not prove complete repository coverage. Neither fact causes Renma to select or
execute a Skill.

## Canonical declarations

Only a specification-valid, directory-based Agent Skill named exactly
`SKILL.md` can contribute operational Discovery metadata:

```yaml
---
name: review-request
description: Classify a review request by workflow. Use when a request needs a reviewed next step; do not use for implementation or runtime Skill selection.
metadata:
  renma.id: skill.review-request
  renma.owner: developer-experience
  renma.status: stable
  renma.published-entrypoint: "true"
  renma.continues-with: '["skill.review-api","skills/review-ui/SKILL.md"]'
---
```

`metadata.renma.published-entrypoint` is a one-state marker. The only valid
value is the exact YAML string `"true"`; omission means not published. YAML
booleans, `"false"`, empty or whitespace-padded strings, alternate casing,
numbers, arrays, objects, null, duplicate declarations, and duplicate
top-level `metadata` mappings fail closed. Renma does not accept
`published_entrypoint`, `discovery_entrypoint`, `entrypoint`,
`renma.entrypoint`, or historical aliases, and does not fall back to legacy
metadata. Rejected markers retain exact field evidence.

`metadata.renma.continues-with` remains the 0.22.0 JSON-array string contract.
Every member must be a non-empty string. An empty array string (`'[]'`) is valid
and declares no routes. Renma resolves one exact effective asset ID or one
exact repository-relative source path after the documented path normalization;
it does not match titles, tags, aliases, basenames, suffixes, prose, or ordinary
Markdown links.

## Publication eligibility

Publication intent and effective publication are separate. A visible Skill
exposes marker state and evidence, whether publication was requested and
accepted, stable rejection reasons, and linked existing diagnostics.

A Skill is an effective published entrypoint only when the marker is the exact
string `"true"` and the Skill is:

- a specification-valid canonical Agent Skill;
- not deprecated or archived; and
- unique in effective asset ID across the repository catalog.

Stable publication rejection reasons are `invalid-marker`,
`ambiguous-marker`, `invalid-skill`, `inactive-skill`, and
`duplicate-skill-id`. Existing `AS-SKILL-*` validity diagnostics and
`META-DUPLICATE-ASSET-ID` evidence remain authoritative; Discovery links them
instead of emitting competing validity or identity diagnostics.

A published Skill may have an incoming route or no outgoing route. A Skill
with no outgoing route can itself be a complete first-hop workflow. Graph
position never determines publication.

## Repository-wide adoption

Repository-wide adoption is declared only in Renma JSON configuration:

```json
{
  "skill_discovery": {
    "adopted": true
  }
}
```

`skill_discovery` must be an object, its only supported key is `adopted`, and
`adopted` must be a JSON boolean. Omission defaults to `false`; explicit
`false` does not declare repository-wide adoption. Unknown keys and alternate
spellings are configuration errors. `renma init` continues to omit this field:
initializing Renma is not the same decision as adopting repository-wide Skill
Discovery.

The prepared Discovery index reports one deterministic adoption state:

- `not-adopted`: no continuation or publication metadata is present and
  repository-wide adoption is not true;
- `partial`: valid, invalid, or rejected continuation/publication metadata is
  present and repository-wide adoption is not true;
- `incomplete`: repository-wide adoption is true but no effective published
  entrypoint exists; or
- `adopted`: repository-wide adoption is true and at least one effective
  published entrypoint exists.

## Reachability and coverage

Published entrypoints define where Discovery starts. Usable `continues-with`
routes define where Discovery can continue. Reachability reports what can be
found through those declarations. Renma still does not decide which Skill
matches a user request.

Traversal starts from every effective published entrypoint at depth `0` and
uses only routes that are usable representatives, resolve successfully, and
target a Skill. Resolution and usability are not reinterpreted during
traversal. Invalid, inactive, duplicate-ID, unresolved, ambiguous, wrong-kind,
and duplicate non-representative declarations therefore cannot create
reachability. Adjacency, entrypoint provenance, and result IDs are sorted;
per-entrypoint breadth-first traversal gives the true minimum route depth and
terminates safely through self-loops and larger cycles.

## Route-cycle review diagnostics

Renma 0.22.4 detects maximal strongly connected components after route
resolution and usability are complete. The input is exactly the existing
authoritative continuation edge boundary:

```text
route.usable === true
route.representative === true
route.resolution === "resolved"
route.resolvedTarget.kind === "skill"
```

Invalid, inactive, duplicate-ID, unresolved, ambiguous, wrong-kind,
normalization-rejected, and duplicate non-representative declarations cannot
participate. Ordinary Markdown references, Context relationships,
reachability, structural-root state, and directory layout never create cycle
edges.

A singleton component emits `DISCOVERY-ROUTE-CYCLE` only when its one Skill has
an explicit self-loop. A component with two or more Skills emits one warning
for the complete maximal component, including every usable representative
internal route. Sorted adjacency, members, routes, and component sequences make
the result independent of document, declaration, Map, and Set insertion order.
The canonical first internal route supplies the warning's primary path and
exact `renma.continues-with` evidence.

A cycle is static continuation evidence. It does not prove that an agent will
recurse or execute the same Skills repeatedly. Renma traversal is cycle-safe. A
cycle may be intentional, but every internal continuation and the workflow's
stop, ask, retry, handoff, and completion conditions should be reviewed. An
intentional bounded cycle may remain after review; Renma does not choose an
edge to remove or change reachability.

Every visible Skill exposes one reachability object:

- `reachable`: an effective entrypoint or an eligible Skill reached through
  usable declarations, with every reaching entrypoint ID and minimum depth;
- `not-reached`: an eligible Skill with no usable path when coverage is being
  evaluated; or
- `not-evaluated`: repository coverage is not evaluated, or the Skill itself
  is not Discovery-eligible.

Coverage always has repository scope and uses one of three modes:

- `not-evaluated`: Discovery is `not-adopted`, `incomplete`, or `partial`
  without an effective published entrypoint. Reachable and not-reached arrays
  remain empty. Readiness reports this as unevaluated rather than presenting
  the empty arrays as `0 reachable` and `0 not-reached`. The check is neutral
  for `not-adopted`; it warns only when Discovery metadata or explicit
  repository-wide adoption makes the missing effective entrypoint actionable.
- `descriptive`: adoption is `partial` and at least one effective published
  entrypoint exists. Reachability is review evidence, not a repository-wide
  completeness claim, and not-reached Skills do not emit coverage warnings.
- `authoritative`: adoption is `adopted`. `complete` is true only when every
  Discovery-eligible Skill is reachable; otherwise it is false and each
  not-reached eligible Skill emits a warning.

The index exposes sorted `reachableDiscoveryEligibleSkillIds`,
`notReachedDiscoveryEligibleSkillIds`, and `unroutedSkillIds`. Unrouted means
exactly an eligible structural root that is not an effective published
entrypoint; it is not a synonym for not-reached. A disconnected child can be
not-reached while still having an incoming usable route and therefore not be
unrouted.

## Graph view

All Discovery formats use the same index prepared in the shared repository
snapshot:

```bash
renma graph . --view discovery --format json
renma graph . --view discovery --format markdown
renma graph . --view discovery --format mermaid
renma graph . --view discovery --focus skill.review-request --format json
```

JSON includes `adoption`, repository-scoped `coverage`, published, reachable,
not-reached, structural-root, standalone, and unrouted ID arrays in the
dedicated `discovery` object. Each visible Skill includes ownership provenance,
structural-root and standalone facts, marker evidence, publication request and
acceptance, rejection reasons, global reachability, unrouted state, and linked
diagnostics. Repository diagnostics remain at top-level `diagnostics`; Skill
Discovery diagnostics remain under `discovery.diagnostics`. Exit-code
evaluation considers errors in both collections, while current Discovery
diagnostics are warnings.

Markdown presents Summary, Adoption, Coverage, Published entrypoints,
authoritative coverage gaps when adopted, Structural roots, Unrouted Skills,
Declared routes, Discovery diagnostics, and then Repository diagnostics when
present. Descriptive mode shows counts without presenting not-reached Skills as
defects. Long structural and coverage lists are bounded; JSON retains the full
arrays.

Mermaid retains solid usable route edges and dotted unusable declaration edges.
Published entrypoints and structural roots receive separate deterministic
classes, including both facts when one Skill has both roles. Styling does not
change edge meaning or imply invocation. Deterministic comments record coverage
mode plus source-entrypoint, reachable, not-reached, and unrouted ID arrays.

Exact `--focus` retains the selected Skill's direct incoming and outgoing
declarations without transitive traversal. A focused projection preserves the
repository-wide adoption and coverage objects and every visible Skill's global
reachability. Published, reachable, not-reached, and unrouted ID arrays plus
summary counts are filtered to visible Skills. Focus never becomes a traversal
seed and never recomputes coverage or cycles from the subset. Repository-wide
cycle diagnostics remain visible whenever any recorded internal cycle route is
part of the focused direct-neighborhood route projection. Focusing an unrelated
Skill excludes the diagnostic; focus does not become transitive.

## Skill Index command

Renma 0.22.3 adds a compact static index over the same prepared Discovery
model:

```bash
renma skill-index .
renma skill-index . --format markdown
renma skill-index . --format json
renma skill-index . --json
renma skill-index . --focus skill.release-prep --format markdown
```

Markdown is the default. JSON uses the canonical schema identifier
`renma.skill-index.v1` and is the complete unfocused automation contract. The
report contains repository metadata, the existing adoption, coverage, summary,
visible Skill, route, publication, reachability, structural-root, standalone,
unrouted, and eligible-ID projections, plus explicitly separate
`diagnostics.repository` and `diagnostics.discovery` collections.

The command collects one `RepositorySnapshot` and wraps its already prepared
Discovery index. It does not scan twice or reimplement parsing, exact target
resolution, eligibility, publication, reachability, coverage, or focus.
Repository diagnostics remain repository-wide. Focused Discovery diagnostics
use the existing exact direct-neighborhood projection.

Focus accepts only an exact stable effective Skill ID or exact
repository-relative Skill source path. It does not match titles, descriptions,
tags, aliases, basenames, suffixes, letter-case variants, fuzzy phrases, or task
text. Focus does not perform transitive traversal and does not make the selected
Skill reachable. In focused reports:

```text
coverage is repository-scoped

summary and visible ID arrays are projection-scoped
```

Markdown shows the static-only boundary, summary, adoption and coverage,
focused Skill when present, effective published entrypoints and their direct
continuations, authoritative coverage gaps, structural candidates, separate
diagnostic sections, and instructions to open the referenced source
`SKILL.md`. Long presentation lists use the established deterministic cap;
JSON retains complete evidence.

The command writes only to stdout. It does not create `.renma/`, write a
generated index, modify configuration or Skill metadata, interpret a request,
select or rank a Skill, load Context, assemble a prompt, infer a route, call an
LLM, or execute a workflow. Exit `0` means the report was produced with no
error-severity diagnostic; warnings still exit `0`. Exit `1` means an error is
present in either diagnostic collection. Invalid CLI use, configuration, focus,
or report construction exits `2`.

## Diagnostics

Renma 0.22.1 adds warning diagnostics:

- `DISCOVERY-INVALID-PUBLISHED-ENTRYPOINT` for an invalid or ambiguous marker,
  or an exact marker on a specification-valid inactive Skill; and
- `DISCOVERY-ENTRYPOINT-WITHOUT-USABLE-BOUNDARIES` when current deterministic
  Agent Skills checks establish that an effective entrypoint lacks a
  capability, positive usage boundary, or negative selection boundary.

The boundary warning reuses linked `RN-SKILL-*` evidence and is not proof of
semantic completeness. Its repair is to improve the bounded first-hop
responsibility, not to remove publication solely to silence the warning.

Both diagnostics flow through normal scan output, diagnostics v2, and review
bundles. They do not create a CI gate. Readiness 0.23.0 may reference their
stable codes and messages as compact check evidence without copying them into
its diagnostic collection. The semantic diff and neutral CI projection compare
prepared topology facts but do not copy these diagnostics; Trust Graph and BOM
remain excluded.

Renma 0.22.2 adds
`DISCOVERY-UNREACHABLE-ELIGIBLE-SKILL` only in authoritative adopted mode, once
per not-reached eligible Skill. It states the exact negative graph fact: no
usable declared continuation path reaches the Skill from any effective
published entrypoint. It does not claim runtime non-use and does not recommend
a fake route or blanket publication. Repair requires human review of whether
the Skill is an independent first hop, belongs beneath a real source-owned
workflow, or falls outside the intended repository-wide policy. This warning
also flows through scan, diagnostics v2, and review bundles. Readiness 0.23.0
uses it as the authority for adopted-mode coverage check evidence without
duplicating the diagnostic or applying another score penalty. Its diagnostic
payload remains outside Trust Graph, semantic diff, CI, and BOM projections.

Renma 0.22.4 adds `DISCOVERY-ROUTE-CYCLE` without requiring repository-wide
adoption. It is emitted whenever the prepared usable continuation graph
contains a cyclic strongly connected component, including a self-loop. In
normal repository states this means `partial`, `incomplete`, or `adopted`: a
truly `not-adopted` repository has no Discovery metadata and therefore cannot
contain a usable declared route cycle. Details contain
sorted `cycleSkillIds`, `cycleSkills`, `selfLoop`, `routeCount`, and complete
`cycleRoutes` evidence. Every member Skill and internal route links the
diagnostic. The warning asks a human to decide whether the component is an
intentional bounded workflow loop or an accidental circular continuation
contract; it does not require every intentional cycle to be removed.

Cycle warnings flow through scan, diagnostics v2, review bundles, Discovery
graph diagnostics, Skill Index Discovery diagnostics, and the compact
Readiness cycle-review check. They remain warnings, do not create a CI gate,
and do not by themselves make Readiness fail. Discovery JSON report schemas,
Markdown sections, and Mermaid edge semantics are unchanged; there is no
top-level cycle section or count in the Discovery graph or Skill Index.

## Readiness projection

Renma 0.23.0 adds routine-review visibility under
`readiness.summary.skillDiscovery`. The summary is derived only from the
memoized prepared Discovery index in the shared `RepositorySnapshot` and
contains the existing adoption state plus compact publication, eligibility,
reachability, unrouted, route-usability, unresolved-route, and maximal
cycle-component counts. It contains no complete Skill array, route list, or
diagnostic payload.

The five Readiness checks use the established lower-case dotted ID style:

- `discovery.publication` reviews explicit effective publication only.
  `not-adopted` repositories pass because publication is not required and
  structural roots are never inferred as published. Partial or incomplete
  adoption without an effective published entrypoint warns, while valid
  effective publication and existing publication diagnostics remain
  authoritative;
- `discovery.route_validity` aggregates existing resolution and usability
  reasons;
- `discovery.coverage` is authoritative only for explicit repository-wide
  adoption, descriptive only for partial adoption with an effective
  entrypoint, and explicitly unevaluated when Discovery is not adopted or no
  effective entrypoint exists;
- `discovery.unrouted_skills` preserves the existing unpublished/no-incoming
  usable continuation definition and does not reject intentional standalone
  Skills automatically; and
- `discovery.cycle_review` counts maximal cyclic components as warning-level
  human review evidence.

The 0.23.0 projection adds no scoring weight. Partial coverage never reduces
the score, cycle presence alone is not a hard failure, and existing Discovery
diagnostics are referenced rather than copied or penalized again. Use
`renma skill-index` for the complete static report and
`renma graph --view discovery` for topology and source evidence.

The direct Readiness command prepares the memoized Discovery projection once.
Semantic diff retains the pre-0.23.0 Readiness subset, then uses the same
snapshot's prepared Discovery index for its dedicated versioned section.
CI calls that complete semantic diff once and projects its existing
`SkillDiscoveryDiff`; it therefore intentionally prepares one Discovery index
per ref without a second collection or comparison. BOM continues to build and
serialize its pre-0.23.0 Readiness subset without preparing Discovery for that
subset.

## Semantic diff projection

Renma 0.23.1 adds an observation-only `discovery` section to direct
`renma diff` JSON and Markdown. It reports exact from/to adoption and coverage
modes, count deltas, effective published entrypoint additions/removals,
newly-reachable and newly-not-reached Skills, newly/resolved unrouted Skills,
route additions/removals/state changes, and added/resolved maximal cyclic
components. Count deltas use `to - from`; identity lists remain present because
equal additions and removals can cancel numerically.

Skill identity is repository-relative path plus visible ID. Route identity is
normalized source Skill path plus normalized declared target. It deliberately
excludes declaration index, YAML array position, source line, discovery order,
resolved target, and object insertion order. Declarations with the same route
identity form one group whose `declarationCount` records duplicate changes.
Reordering declarations therefore produces no diff. A resolution, candidate,
resolved-target, lifecycle, usability, or reason change under the same
identity is one changed route; only identity presence determines route
addition or removal.

Cycle identity is the sorted maximal strongly connected component member-ID
set. Internal edge order does not create a resolved-plus-added cycle pair;
edge changes remain route changes. Reachability uses only the prepared
reachable/not-reached partitions, and empty sets stay empty when coverage is
not evaluated. Structural roots are never inferred as publication.

Each archived ref is collected once into one immutable `RepositorySnapshot`.
Graph, the Discovery-excluded Readiness subset, and `snapshot.skillDiscovery`
therefore share one parse, catalog preparation, Agent Skills validation, and
Discovery preparation per ref. The diff does not call `skill-index`, reconstruct
Discovery independently, or copy its complete report or diagnostics.

These facts have no improvement/regression label and do not change direct diff
exit behavior.

## CI report projection

Renma 0.23.2 exposes the exact existing `SkillDiscoveryDiff` once as required
top-level `CiReport.skillDiscovery`. Its schema remains
`renma.skill-discovery-diff.v1`; CI does not construct a second Discovery
schema or comparison. The nested `CiCompatibleDiffReport` under `diff` omits
`discovery`, preserving the compact earlier contract and avoiding duplicate
JSON.

CI calls complete `diff()` exactly once. Each ref therefore uses one immutable
`RepositorySnapshot`, one discovery pass, one parse per artifact, one catalog
preparation, one Agent Skills validation, and one Skill Discovery preparation.
Graph, the Discovery-excluded Readiness subset, and Discovery facts reuse that
same snapshot.

CI Markdown places a bounded `## Skill Discovery Changes` section after the
semantic-diff summary. It reports schema, neutral policy effect, adoption,
coverage, publication, reachability, unrouted Skills, route changes, and cycle
changes. Detailed lists use the shared top-summary cap and direct readers to
JSON for omitted entries. It does not render the complete graph, diagnostics,
declaration indices, source lines, or repair instructions.

`determineCiReportStatus()` and review notes continue to receive only the
Discovery-free compatible diff. Discovery changes therefore do not affect
Readiness scores, `PASS`/`WARN`/`FAIL`, review notes, or the established
`0`/`1` exit behavior. Pre-0.23.2 serialized CI reports without
`skillDiscovery` retain their prior JSON and Markdown shape when formatted.
Optional policy or gating remains later work.

Programmatic compatibility is preserved separately from the direct command
contract. `buildDiffReport()` accepts older snapshots without prepared
Discovery indexes and returns a stable neutral Discovery section rather than
inferring topology. `formatDiff()` accepts older serialized reports without
`discovery` and retains their previous non-Discovery Markdown shape.

## Compatibility and future work

Continuation and publication data remain separate from
`catalog.dependencies`. Existing full, summary, workflow, layered,
composition, and impact graph outputs remain route/publication-free. Catalog,
Trust Graph, BOM, ownership, init, scaffold, guide, and suggestion contracts
are unchanged. Readiness changes only through the additive 0.23.0 summary and
checks; direct diff changes only through the additive 0.23.1 section; CI
changes only through the additive neutral 0.23.2 projection. A repository
without Discovery metadata or adoption remains valid and warning-free. Its
`not-adopted` Readiness summary is a neutral inventory
summary: route-eligible, unrouted, and route counts remain visible, while
publication is not required and coverage is not evaluated.

The current single-repository static Discovery core is stable after 0.22.4,
with Readiness integration in 0.23.0, direct semantic diff integration in
0.23.1, and neutral CI report integration in 0.23.2. A `renma discovery`
command is not implemented. Optional CI policy or gating, Trust Graph, BOM,
ownership, observed Markdown references,
richer visualization, authoring assistance, scaffold, init, guide, suggestion,
and multi-repository federation remain independent later decisions informed by
operational trials. BOM and Trust Graph output contracts contain no Discovery
additions in 0.23.2.
