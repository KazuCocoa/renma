# Skill Discovery Graph

Renma 0.22.x provides a static, declaration-driven Skill-to-Skill graph. It
does not interpret task text, select, rank, load, invoke, or execute a Skill.
Repository authors keep routing conditions in source `SKILL.md` files; Renma
exposes deterministic publication, adoption, continuation, and structural
evidence.

The progression is intentionally layered:

```text
0.22.0
  explicit continuation routes, exact resolution, diagnostics,
  structural roots, and graph projection

0.22.1
  explicit published entrypoints and explicit repository-wide
  Discovery adoption

later
  reachability, coverage, and skill-index
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

Every state explicitly reports coverage as `not-evaluated` with reason
`reachability-and-coverage-are-deferred`. Renma 0.22.1 does not calculate
reachable, not-reached, or unreachable Skills and emits no coverage diagnostic.

## Graph view

All Discovery formats use the same index prepared in the shared repository
snapshot:

```bash
renma graph . --view discovery --format json
renma graph . --view discovery --format markdown
renma graph . --view discovery --format mermaid
renma graph . --view discovery --focus skill.review-request --format json
```

JSON adds `adoption`, `coverage`, and `publishedEntrypointIds` to the dedicated
`discovery` object. Each visible Skill includes ownership provenance,
structural-root and standalone facts, marker evidence, publication request and
acceptance, rejection reasons, and linked diagnostics. Repository diagnostics
remain at top-level `diagnostics`; Skill Discovery diagnostics remain under
`discovery.diagnostics`. Exit-code evaluation considers errors in both
collections, while current Discovery diagnostics are warnings.

Markdown presents Summary, Adoption, Published entrypoints, Structural roots,
Declared routes, Discovery diagnostics, and then Repository diagnostics when
present. Published entries include description, source, effective owner and
provenance, lifecycle, structural-root and standalone facts, and direct route
resolution/usability. When none exists, Markdown says so and presents roots
only as candidate graph facts.

Mermaid retains solid usable route edges and dotted unusable declaration edges.
Published entrypoints and structural roots receive separate deterministic
classes, including both facts when one Skill has both roles. Styling does not
change edge meaning or imply invocation.

Exact `--focus` retains the selected Skill's direct incoming and outgoing
declarations without transitive traversal. A focused projection preserves the
repository-wide adoption object, filters `publishedEntrypointIds` to visible
published Skills, and never recomputes adoption from that subset.

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

## Compatibility and deferred work

Continuation and publication data remain separate from
`catalog.dependencies`. Existing full, summary, workflow, layered,
composition, and impact graph outputs remain route/publication-free. Catalog,
Readiness, diff, CI report, Trust Graph, BOM, ownership, init, scaffold, guide,
and suggestion contracts are unchanged. A repository without Discovery
metadata or adoption remains valid and reports `not-adopted` without a warning.

Reachability, descriptive or authoritative coverage, unreachable-Skill
diagnostics, `notReachedDiscoveryEligibleSkillIds`, route-cycle diagnostics,
`skill-index`, and a `renma discovery` command remain deferred.
