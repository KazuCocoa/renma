# Skill Discovery Graph

Renma 0.22.0's first operational Skill Discovery slice is a static,
declaration-driven Skill-to-Skill graph. It does not interpret task text,
select, rank, load, invoke, or execute a Skill. Repository authors keep routing
conditions in each source `SKILL.md`; Renma exposes and validates only the
explicit continuation evidence.

## Canonical declaration

Only a canonical, directory-based Agent Skill named exactly `SKILL.md` can
declare continuations:

```yaml
---
name: review-request
description: Classify a review request by workflow. Use when a request needs a reviewed next step; do not use for implementation or runtime Skill selection.
metadata:
  renma.id: skill.review-request
  renma.owner: developer-experience
  renma.status: stable
  renma.continues-with: '["skill.review-api","skills/review-ui/SKILL.md"]'
---
```

`metadata.renma.continues-with` must be a YAML string containing a JSON array.
Every array member must be a string and must remain non-empty after trimming.
An empty array string (`'[]'`) is valid and declares no routes. Native YAML
arrays, objects, scalar JSON values, numbers, booleans, null, malformed JSON,
comma-separated text, and empty members are invalid. Renma does not accept
`routes_to`, `routes-to`, `hands-off-to`, `delegates-to`, or other aliases.

For example, this unresolved declaration is syntactically valid but has no
exact catalog target:

```yaml
metadata:
  renma.continues-with: '["skill.review-missing"]'
```

Renma reports the declaration and its exact line evidence. It does not create
or suggest a placeholder Skill merely to make the route resolve.

## Exact resolution

Each declaration item is trimmed, path separators are normalized to `/`, and
at most one leading `./` is removed. Absolute paths and paths that escape the
repository are rejected. Renma then attempts:

1. one exact effective asset-ID match; and
2. one exact repository-relative source-path match.

There is no suffix, basename, title, tag, alias, fuzzy, case-insensitive, body
text, or Markdown-link matching. If ID and path identify different assets, or
an effective ID belongs to multiple assets, resolution is `ambiguous`. One
exact path can still resolve a duplicate-ID Skill, but the route remains
unusable because that target has no unique graph identity. A non-Skill target
is `wrong-kind`, not missing.

Resolution and usability are separate. A usable route requires a valid,
lifecycle-active canonical Agent Skill at both ends and a repository-unique
effective asset ID for both Skills. Stable unusability reasons include:

- `invalid-source` and `invalid-target`;
- `inactive-source` and `inactive-target`;
- `duplicate-source-id` and `duplicate-target-id`;
- `wrong-kind`, `ambiguous-target`, and `unresolved-target`; and
- `duplicate-declaration` for a redundant non-representative item.

Existing `AS-SKILL-*` diagnostics remain authoritative for Agent Skills
validity, and `META-DUPLICATE-ASSET-ID` remains authoritative for catalog
identity. Discovery links that evidence instead of creating competing validity
or identity diagnostics.

When one source declares the same normalized unresolved spelling more than
once, or multiple items resolve to the same target Skill, Renma retains every
declaration index and evidence location. One deterministic representative may
form the usable edge. Declaration order never means priority.

## Structural roots

A structural root is a route-eligible Skill with no incoming usable Skill
route. A route-eligible Skill with no incoming or outgoing usable route is also
reported as standalone. These are graph facts, not published entrypoints,
coverage claims, or evidence that repository-wide Discovery has been adopted.

## Graph view

The shared repository snapshot prepares the route index once. All Discovery
formats use that same index:

```bash
renma graph . --view discovery --format json
renma graph . --view discovery --format markdown
renma graph . --view discovery --format mermaid
renma graph . --view discovery --focus skill.review-request --format json
renma graph . --view discovery --focus skills/review-request/SKILL.md --format markdown
```

JSON adds a dedicated `discovery` section containing deterministic summary
counts, visible Skills, every route declaration, structural-root and standalone
IDs, declaration evidence, linked diagnostics, and optional exact focus
evidence. Skill route diagnostics live only in `discovery.diagnostics`;
pre-existing repository diagnostics remain in the top-level graph
`diagnostics` collection. Unresolved declarations are never represented as
resolved edges. The graph command exits with code `1` when either collection
contains an error, while the initial Discovery diagnostics remain warnings.

Markdown states the static-only boundary, reports counts, lists structural
roots, shows routes in deterministic source/declaration order, preserves exact
evidence locations, and separates Discovery diagnostics from repository
diagnostics. Readers must open the source `SKILL.md` and apply its routing
conditions; the report is not an executable prompt.

Mermaid renders usable resolved Skill routes as solid edges. Every unresolved,
ambiguous, wrong-kind, inactive, duplicate, or otherwise unusable declaration
uses a dotted edge to a labeled synthetic review node. Structural roots receive
a restrained visual distinction. Evidence and diagnostics are comments, and
Discovery and repository diagnostics use separately labeled comment groups.
Output remains deterministic for empty graphs, duplicate IDs, unresolved
targets, shared targets, and cycles.

Exact `--focus` is optional for this view. It accepts one exact Skill ID or
repository-relative source path and retains the selected Skill's direct
incoming and outgoing declared routes. An ambiguous or missing focus is a usage
error; focus never performs fuzzy matching or transitive traversal.

## Diagnostics

The first slice emits warning-severity diagnostics only:

- `DISCOVERY-INVALID-CONTINUATION-DECLARATION`;
- `DISCOVERY-UNRESOLVED-DECLARED-ROUTE`;
- `DISCOVERY-ROUTE-TARGET-NOT-SKILL`;
- `DISCOVERY-INACTIVE-ROUTE-TARGET`; and
- `DISCOVERY-DUPLICATE-DECLARED-ROUTE`.

They are included in snapshot aggregate diagnostics and normal `scan` output,
including diagnostics v2 repair constraints and verification steps. The repair
policy preserves the intended relationship, permits exact ID/path correction
or removal of stale evidence, forbids placeholder Skills, and requires human
review when the target intent is ambiguous. This release adds no Discovery CI
gate or error-severity policy.

## Compatibility and deferred work

The route index is separate from `catalog.dependencies`; existing full,
summary, workflow, layered, composition, and impact graph contracts do not gain
Skill continuation edges. `renma init`, scaffold, Readiness, diff, CI report,
Trust Graph, BOM, ownership, authoring guidance, and suggestions are unchanged.
Ordinary Markdown links and noncanonical `skill.md` or `*.skill.md` files do
not create operational routes.

Later slices may review explicit published entrypoints, repository-wide
Discovery adoption, descriptive or authoritative reachability, coverage,
`skill-index`, Readiness/diff/CI integration, and richer visualization. None of
those contracts is inferred or implemented by the 0.22.0 route foundation.
