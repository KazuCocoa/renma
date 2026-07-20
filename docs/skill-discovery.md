# Skill Discovery Graph and Index

Renma 0.22.x provides a static, declaration-driven Skill-to-Skill graph and a
versioned compact index. It does not interpret task text, select, rank, load,
invoke, or execute a Skill. Repository authors keep routing conditions in
source `SKILL.md` files; Renma exposes deterministic publication, adoption,
continuation, and structural evidence.

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
  remain empty.
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
seed and never recomputes coverage from the subset.

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
bundles. They do not create a CI gate and remain excluded from Readiness,
semantic diff, CI report, Trust Graph, and BOM.

Renma 0.22.2 adds
`DISCOVERY-UNREACHABLE-ELIGIBLE-SKILL` only in authoritative adopted mode, once
per not-reached eligible Skill. It states the exact negative graph fact: no
usable declared continuation path reaches the Skill from any effective
published entrypoint. It does not claim runtime non-use and does not recommend
a fake route or blanket publication. Repair requires human review of whether
the Skill is an independent first hop, belongs beneath a real source-owned
workflow, or falls outside the intended repository-wide policy. This warning
also flows through scan, diagnostics v2, and review bundles while remaining
outside downstream Trust Graph, Readiness, diff, CI, and BOM projections.

## Compatibility and future work

Continuation and publication data remain separate from
`catalog.dependencies`. Existing full, summary, workflow, layered,
composition, and impact graph outputs remain route/publication-free. Catalog,
Readiness, diff, CI report, Trust Graph, BOM, ownership, init, scaffold, guide,
and suggestion contracts are unchanged. A repository without Discovery
metadata or adoption remains valid and reports `not-adopted` without a warning.

Route-cycle diagnostics and a `renma discovery` command remain deferred. Cycles
are ordinary traversal-safe graph evidence. Readiness, semantic diff, CI
report, Trust Graph, BOM, ownership, scaffold, init, guide, and suggestion
contracts remain independent from the Skill Index.
