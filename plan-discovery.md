# Renma Skill Discovery Design

## Status

Status: active design proposal

Implementation status: not implemented

Baseline: Renma 0.21.0

Scope: optional static Skill Discovery for a large single repository

This document separates three levels of decision:

- **Accepted design direction** covers the product boundary, layered graph
  model, source ownership, focused-entrypoint responsibility, deterministic
  evidence, and gradual adoption.
- **Recommended MVP decisions** cover the proposed metadata names, explicit
  publication, exact resolution, report shape, command, diagnostics, and
  implementation sequence. They become public contracts only after contract
  review and implementation.
- **Deferred extensions and open questions** are not part of the MVP and must
  not enlarge the first implementation PR.

PR #86 records the original design exploration. PR #89 is useful prototype
evidence for deriving a static report from the shared repository snapshot,
preserving line provenance, and rendering stdout-only projections. Its older
metadata names, aliases, inferred entrypoints, authoritative Markdown-link
routes, report shape, and implementation are not compatibility requirements or
an implementation base.

## Problem

Renma can already discover and govern repository assets, but a flat catalog is
not a sufficient first hop when a repository contains many layered Skills. A
reader should not need to inspect every `SKILL.md` to learn which broad workflow
owns the next decision.

Large repositories commonly have useful layers such as:

```text
broad workflow
  -> product or platform workflow
    -> concrete workflow
      -> Context Lenses
        -> Context Assets
```

The order is repository-specific and may vary within one repository:

```text
category -> product -> workflow
product -> category -> workflow
category -> team -> workflow
product -> workflow
entrypoint -> entrypoint -> concrete workflow
```

Skill Discovery should expose and validate this topology without imposing a
directory hierarchy or interpreting a live task.

## Product Boundary

Skill Discovery belongs in Renma core because its inputs and outputs are static
repository governance evidence:

- canonical Skill metadata;
- exact asset identity and repository-relative paths;
- lifecycle and ownership;
- declared graph edges and their source evidence;
- deterministic reachability and graph diagnostics; and
- reviewable JSON and Markdown projections.

Renma does not:

- accept task text or decide which Skill applies now;
- rank, select, load, or execute a Skill;
- assemble prompts or inject Context;
- infer route intent from prose;
- observe which Skill or Context a runtime actually used; or
- claim that a statically valid route is semantically correct for a particular
  request.

The governing boundary remains:

```text
LLM proposes. Renma verifies. Human approves.
```

## Operating Model

```text
Repository authors keep workflow and continuation policy in source SKILL.md
  -> compact canonical metadata declares authoritative continuations
  -> Renma parses the repository once into a shared RepositorySnapshot
  -> Skill Discovery resolves and validates a derived continuation graph
  -> renma skill-index emits deterministic JSON or compact Markdown
  -> agents and humans open the source Skills and apply their conditions
  -> humans review repository changes
```

The generated index owns compact first-hop visibility. It does not copy the
complete workflow, decision logic, constraints, or Context from source Skills.

## Design Principles

### Preserve layered Skills as a graph

Every node remains a normal Skill. Discovery adds a typed directed
relationship between Skills and derives root-like views from that graph. It
does not introduce category, team, product, router, or entrypoint asset kinds.

Tree views may be useful projections, but the source model permits shared
children, multiple entrypoints, cross-cutting continuations, and different
ordering in different areas.

### Preserve source ownership

The source `SKILL.md` owns:

- its focused workflow responsibility;
- positive and negative selection boundaries;
- inputs and evidence it examines;
- decision, stop, ask, report, or handoff behavior;
- conditions for continuing with another Skill; and
- completion and verification criteria.

Metadata is a compact deterministic index of a route. It does not replace the
body's policy. The generated report points back to source paths instead of
reproducing instructions.

### Keep entrypoints focused

An entrypoint is a role of a normal Skill, not a routing-only placeholder. It
must perform a meaningful bounded responsibility before a continuation can
apply. A broad Skill may classify input, identify a product or platform, check
prerequisites, decide whether a specialized workflow applies, report that no
safe continuation is available, or ask for missing evidence.

Routing may be part of that responsibility. A directory listing alone is not a
sufficient Skill responsibility.

### Keep product knowledge durable

Product identity and durable product knowledge should remain more stable than
current ownership. Product-related Context Assets and Context Lenses may be
shared by Skills owned by different teams. An owner change is not a product
identity change.

The MVP does not introduce a Product asset or required product directory.
Existing exact tags such as `product:<id>` and stable Context or Lens IDs remain
available for a later projection.

### Prefer exact, compact, additive contracts

Discovery uses canonical Agent Skills metadata under `metadata.renma.*` only.
It uses exact IDs and repository-relative paths, preserves evidence, fails
closed on ambiguity, and adds metadata only when the MVP consumes it.

No-LLM and CI workflows remain first-class. Given the same repository,
configuration, Renma version, and evaluation date where applicable, the report
must be deterministic.

## Proposed Domain Model

The MVP uses the following terms.

### Skill node

A discovered catalog asset with kind `skill`. A Skill remains visible even
when it is invalid, inactive, disconnected, or outside an adopted Discovery
graph. Only a specification-valid canonical Agent Skill contributes
operational `metadata.renma.*` values, matching the current parser's fail-closed
contract.

For Discovery, an **active Skill** is a Skill whose lifecycle is not
`deprecated` or `archived`. Existing lifecycle and invalid-metadata diagnostics
remain authoritative.

### Declared continuation

A directed source-Skill-to-target-Skill relationship created by one exact
canonical metadata item. A declared continuation says that the source Skill
identifies the target as a possible next workflow after the source fulfills its
own bounded responsibility.

It does not express runtime selection, priority, exclusivity, loading,
execution, or actual use.

### Published entrypoint

An active, specification-valid Skill with a valid explicit publication marker.
It is intentionally included in the first-hop index. Publication is not
inferred from graph position.

### Structural root

An active Skill with no incoming usable declared continuation from another
active Skill. Structural roots are graph facts and adoption candidates, not
published entrypoints.

### Standalone Skill

An active Skill with no incoming or outgoing usable declared continuation. A
standalone Skill may be intentionally published, intentionally independent, or
not yet adopted into Discovery.

### Unrouted Skill

An active Skill that is not published and has no incoming usable declared
continuation. Standalone Skills are a subset of unrouted Skills. Unrouted is a
reporting classification, not automatically a defect.

### Reachable and unreachable Skill

After explicit Discovery adoption, an active Skill is reachable when a
cycle-safe traversal of usable declared continuations reaches it from at least
one published entrypoint. An active Skill not reached that way is unreachable.

Before adoption, reachability is **not evaluated**. Renma must not label every
active Skill unreachable merely because a repository has not adopted the
contract.

These classifications intentionally overlap. A report should expose each
property directly instead of forcing every Skill into one artificial category.

## Entrypoint Semantics

An entrypoint can be broad or concrete, but it remains a focused workflow. A
useful entrypoint owns at least one bounded decision or result, for example:

- determine which product or platform is affected from exact repository
  evidence;
- classify an input into supported workflow families;
- check prerequisites before a specialized workflow can begin;
- decide that none of its declared continuations safely applies;
- ask a human for a material missing decision; or
- complete a preliminary review and hand the evidence to a narrower Skill.

Every published entrypoint therefore needs:

- a clear capability and positive selection boundary in the canonical Agent
  Skills `description`;
- a clear negative selection boundary, with the body retaining detailed
  conditions where needed;
- named inputs or evidence to examine;
- deterministic decision rules or an explicit human-resolution point;
- stop, ask, report, or continuation behavior; and
- its own completion condition.

For new canonical Skills, `description` remains the portable discovery source
of truth. The existing `renma.when-to-use` and `renma.when-not-to-use` values
remain migration-preserved governance metadata and are not reintroduced as the
primary entrypoint contract.

A published entrypoint may have no outgoing continuation when it is itself the
complete first-hop workflow. Conversely, a structural root with many outgoing
continuations is not published unless a repository author explicitly says so.

## Skill Route Semantics

### Recommended metadata name

The MVP should add:

```text
metadata.renma.continues-with
```

The alternatives are less precise for this boundary:

- `routes-to` can sound like Renma or a runtime performs selection;
- `hands-off-to` can sound like an executing agent automatically transfers
  control; and
- `delegates-to` can imply that the source executes or supervises the target.

`continues-with` describes a source-authored workflow relationship without
claiming that Renma selected, loaded, or executed the target.

The value is a canonical Agent Skills JSON-array string containing exact Skill
IDs or repository-relative Skill paths:

```yaml
---
name: test-case-generation
description: Classify test-case design work by product. Use when the product workflow is not yet selected. Do not use for test execution or failure debugging.
metadata:
  renma.id: skill.testing.test-case-generation
  renma.owner: qa-platform
  renma.status: stable
  renma.continues-with: '["skill.product.checkout.test-case-generation","skills/products/search/test-case-generation/SKILL.md"]'
  renma.published-entrypoint: "true"
---
```

The source body must explain when each continuation applies and what to do when
none applies. The metadata list records possible authoritative edges; list
order does not define priority.

### Recommended publication marker

The MVP should also add:

```text
metadata.renma.published-entrypoint
```

The only publishing value is the exact canonical string `"true"`. Omission
means not published. Other values, including a redundant `"false"`, are
invalid so the marker remains one-state, compact, and unambiguous.

Explicit publication is necessary because a structural root may instead be a
standalone Skill, an unfinished adoption candidate, or the root of a
disconnected internal subgraph. Automatically publishing all no-incoming
Skills would turn a graph fact into unsupported repository policy.

No alias field is proposed. Exact stable ID and path already serve deterministic
lookup and focus. Titles, tags, and free-form phrases do not become alternate
runtime match keys.

## Evidence and Resolution

### Authoritative route evidence

In the MVP, only a valid `metadata.renma.continues-with` item creates an
authoritative continuation. Each item retains:

- source Skill ID and source path;
- metadata key and zero-based declaration index;
- raw target spelling;
- exact line range and snippet available from the canonical metadata parser;
  and
- resolution status and resolved target identity when successful.

The route graph is derived from the existing shared `RepositorySnapshot`, its
catalog assets, parsed documents, and evidence. Discovery must not add a second
scanner or catalog.

### Exact target resolution

Resolution follows these steps:

1. Read the field only from operational canonical Skill metadata.
2. Require a JSON-array string of non-empty strings; do not split commas or
   coerce another type.
3. For an ID reference, require one exact catalog Skill ID match.
4. For a path reference, normalize path separators to `/`, remove one leading
   `./` for current compatibility, and require one exact repository-relative
   catalog path. Reject absolute paths and paths that escape the repository.
5. If the spelling matches an ID and a path belonging to different assets, or
   duplicate catalog identity makes the target ambiguous, fail closed.
6. If the resolved target is not a Skill, retain the evidence and report a
   wrong-kind diagnostic.
7. Retain routes to `deprecated` or `archived` Skills for review, but do not use
   them for active reachability.

A usable route is resolved, unambiguous, Skill-to-Skill, and connects active
Skills. Traversal deduplicates by stable Skill ID and terminates through cycles.

### Observed Skill references

Arbitrary local Markdown links are **not** authoritative routes in the MVP. A
link may mean continue, see also, compare with, use as an example, consult for
background, or follow migration guidance. Exact path resolution proves the
target, not the author's intent.

Observed Skill links may later be exposed as a separate, non-authoritative
`observedReferences` projection or route-candidate review aid. They must remain
distinguishable from declared continuations and must not establish published
entrypoints, reachability, or blocking diagnostics. Renma must not infer route
intent from surrounding prose with regular expressions, fuzzy matching, or an
LLM.

## Proposed MVP

The recommended MVP includes:

- the two canonical metadata fields above;
- exact ID and repository-relative path target resolution;
- source-path and line-level declaration evidence;
- lifecycle-aware route resolution;
- explicit published entrypoints;
- structural-root, standalone, and unrouted classifications;
- adoption-aware reachability from published entrypoints;
- a versioned canonical JSON report;
- compact Markdown that points to source Skills;
- a stdout-only `renma skill-index` command;
- exact `--focus` by Skill ID or path; and
- narrow deterministic diagnostics for exact contract violations.

The MVP excludes:

- aliases, titles, tags, or free-form phrases as focus keys;
- observed Markdown references;
- fuzzy matching, embeddings, or LLM inference;
- task input, ranking, or runtime selection;
- a Product asset or product projection;
- Mermaid output;
- Readiness, semantic diff, CI, Trust Graph, and BOM integration;
- scaffold, `guide`, or `suggest-metadata` changes;
- new repository configuration; and
- automatic repository edits.

## Report and CLI Contract

### Command name

The recommended public command remains:

```bash
renma skill-index [path] [--format json|markdown] [--focus <skill-id-or-path>]
```

`skill-index` describes a static repository artifact and does not imply runtime
selection. A generic `discovery` command would be easy to confuse with Renma's
existing repository file-discovery implementation.

The command writes only to stdout. Markdown is the default human- and
agent-readable projection. `--json` may remain the normal shortcut for
`--format json`. The command does not create `.renma/`, rewrite metadata, or
update a checked-in index.

Exact focus follows existing graph conventions: Skill ID or source path only.
No match and an ambiguous match are usage errors. An unfocused JSON report is
the canonical complete contract; a focused report is an explicitly labeled
deterministic projection using the same schema.

Recommended exit behavior follows current report commands:

- `0`: the report was produced, including advisory warnings;
- `1`: the report contains an error-severity repository diagnostic; and
- `2`: invalid CLI use, configuration failure, or report-construction failure.

The initial Discovery diagnostics are warnings, so CI gating is not introduced
indirectly through this command.

### Canonical JSON report

The recommended schema identifier is:

```text
renma.skill-index.v1
```

The report should contain these stable sections:

```text
schemaVersion
root
configPath?
scannedFileCount
focus?
adoption
summary
skills
routes
publishedEntrypointIds
structuralRootIds
standaloneSkillIds
unroutedSkillIds
unreachableSkillIds
diagnostics
```

`adoption.state` is one of:

- `not-adopted`: no Discovery metadata is present;
- `incomplete`: Discovery metadata is present, but no valid active published
  entrypoint exists; or
- `adopted`: at least one valid active Skill has
  `renma.published-entrypoint: "true"`.

This is deliberately independent of `renma init`. Initialization records Renma
repository adoption; it does not silently adopt the Skill Discovery contract.
No config field is added merely because a config file now exists.

Each Skill entry should include stable ID, Agent Skills name and description
when valid, source path, effective owner with provenance, lifecycle, tags,
publication state, structural-root state, standalone state, and reachability.
Reachability is `null` or an equivalent explicit not-evaluated state before
adoption.

Each route entry should include source ID, declared target, resolution state,
resolved target ID/path/kind/status when available, usability, and declaration
evidence. Resolution state distinguishes at least `resolved`, `unresolved`,
`ambiguous`, and `wrong-kind`.

Summary counts include total and active Skills, declared and usable routes,
published entrypoints, structural roots, standalone and unrouted Skills, and
reachable active Skills when evaluated. Arrays and diagnostics use stable
deterministic ordering.

### Compact Markdown

Default Markdown should show:

- the static-only boundary and adoption state;
- each published entrypoint's ID, description, path, lifecycle, owner, and
  direct declared continuations;
- compact structural-root, standalone, and unrouted summaries;
- unreachable Skills only after adoption; and
- exact diagnostics with source links or paths.

It should instruct the reader to open source `SKILL.md` files and apply their
conditions. It must not reproduce complete workflow instructions or present the
index as a prompt package.

When there is no valid published entrypoint, Markdown should say that Discovery
is not adopted or incomplete and show structural roots as candidates. It must
not silently publish every candidate.

## Diagnostics

The initial diagnostics are exact, evidence-backed warnings. “Adoption
required” below means the diagnostic is emitted only when `adoption.state` is
`adopted`.

| Diagnostic | Applies when | Adoption required | Exact evidence and actionability |
| --- | --- | --- | --- |
| `DISCOVERY-INVALID-CONTINUATION-DECLARATION` | `renma.continues-with` is not a valid JSON-array string of non-empty strings. | No | The canonical metadata field, parser error, and line range identify the value to correct or remove. It can only arise from the explicit route field, never an ordinary link. |
| `DISCOVERY-UNRESOLVED-DECLARED-ROUTE` | A valid declaration item has no exact ID or repository-relative path match, or resolution is ambiguous. | No | The declaration item, index, raw target, source path, and candidate details identify the exact contract to repair. Ordinary references are not considered. |
| `DISCOVERY-ROUTE-TARGET-NOT-SKILL` | A declaration resolves exactly to a non-Skill asset. | No | The declaration and resolved asset kind/path show that a Context, Lens, or support relationship should use its existing typed field instead. |
| `DISCOVERY-INACTIVE-ROUTE-TARGET` | An active Skill declares a continuation to a deprecated or archived Skill. | No | The route declaration plus target lifecycle and path support replacement or explicit removal. The edge remains visible but unusable for active reachability. |
| `DISCOVERY-DUPLICATE-DECLARED-ROUTE` | One source declares the same normalized unresolved target more than once, or multiple items resolve to the same target Skill. | No | All declaration indices and line evidence show the redundant items. Markdown links cannot create this diagnostic. |
| `DISCOVERY-INVALID-PUBLISHED-ENTRYPOINT` | The publication key is present with a value other than `"true"`, is declared ambiguously, belongs to an invalid Skill, or attempts to publish a deprecated or archived Skill. | No | The publication field and relevant Agent Skills or lifecycle evidence show why the Skill cannot be published. |
| `DISCOVERY-ENTRYPOINT-WITHOUT-USABLE-BOUNDARIES` | A valid published entrypoint has a deterministically established missing capability, positive usage boundary, or negative routing boundary under current Agent Skills and Skill-quality checks. | No | The publication marker and originating `AS-SKILL-*`, `RN-SKILL-*`, or `QUAL-*` evidence identify the boundary to improve. This is a publication-quality check, not link interpretation, and passing it is not proof of semantic completeness. |
| `DISCOVERY-ROUTE-CYCLE` | The usable active continuation graph contains a self-loop or multi-Skill strongly connected component. | No | The exact declared edges and source evidence identify the cycle. It is a warning for human review; traversal remains cycle-safe and Renma does not assume every cycle is semantically invalid. |
| `DISCOVERY-UNREACHABLE-ACTIVE-SKILL` | After adoption, an active Skill is not reachable from any published entrypoint through usable declared continuations. | Yes | Published-entrypoint evidence and the authoritative route graph establish the gap. Ordinary Markdown references cannot make a Skill reachable or unreachable. |

Existing duplicate-ID, invalid Agent Skills, lifecycle, ownership, and usage
guidance diagnostics remain visible and should be reused as related evidence
rather than reimplemented with different semantics. The MVP adds no confidence,
centrality, popularity, route-quality, or “best Skill” scores.

## Adoption Model

Adoption is incremental and does not require moving files.

### Stage 1: inspect candidates

Run the proposed report with no Discovery metadata. Renma reports
`not-adopted`, structural roots, standalone Skills, and exact current repository
diagnostics. Reachability is not evaluated.

### Stage 2: declare one bounded area

Add `renma.continues-with` only to source Skills that own real continuation
policy. Keep the conditions and no-match behavior in each Skill body. The
report state is `incomplete` until an active entrypoint is published.

### Stage 3: publish intentional first hops

Add `renma.published-entrypoint: "true"` to a small reviewed set of meaningful
entrypoint Skills. This adopts Discovery for the repository and enables
authoritative reachability and unreachable warnings.

### Stage 4: review and expand

Review unrouted and unreachable Skills, disconnected subgraphs, inactive
targets, cycles, and usage boundaries. A Skill may remain intentionally
standalone and published. Expand one bounded workflow area at a time.

No initial CI gate, repository rewrite, or all-at-once metadata migration is
required.

## Compatibility

No Discovery metadata or report contract has shipped, so historical proposal
names are not compatibility requirements. The implementation must not restore
old top-level fields such as:

```yaml
routes_to:
discovery_entrypoint:
discovery_aliases:
```

It also must not accept those names as silent aliases. Canonical Skills use
flat string-valued `metadata.renma.*`; non-Skill assets cannot declare Skill
continuations or publication.

Repositories without Discovery metadata keep their current scan, catalog,
graph, Readiness, diff, CI, Trust Graph, and BOM behavior. Adding the standalone
MVP must not change those report schemas or advertise `skill-index` as current
behavior before the command ships.

PR #89 should not be rebased, cherry-picked, restored, or used as the code
baseline. Implementation starts from the 0.21.0 shared repository snapshot,
canonical metadata parser, diagnostics, and current CLI conventions.

## Deferred Extensions

Only after the MVP contract is stable should Renma consider:

- non-authoritative observed Skill references or route candidates;
- Readiness, semantic diff, CI summary, suppression, and optional gating;
- Mermaid or richer route visualizations;
- product and ownership projections from exact tags, stable IDs, and existing
  Context/Lens relationships;
- Trust Graph or Repository Context BOM additions;
- scaffold, `guide`, metadata suggestion, or review-bundle assistance; and
- repository-wide configuration if metadata-based adoption proves
  insufficient.

LLM-assisted authoring remains an adjacent or dogfooded Skill layer unless a
future decision changes Renma's boundary. Runtime debugging and observability
require runtime-produced evidence and remain external. Multi-repository or
organization-wide discovery requires a separate federation design.

## Implementation Sequence

### PR 1: Contract, domain types, and fixtures

- finalize `renma.continues-with` and `renma.published-entrypoint` through
  public-contract review;
- define TypeScript domain types for declarations, resolution, adoption,
  Skill classifications, reachability, and diagnostics;
- define and schema-test `renma.skill-index.v1`;
- add representative fixtures for category-first, product-first, team-first,
  direct-leaf, standalone, inactive, ambiguous, cyclic, and partially adopted
  repositories; and
- add contract tests for ordering, evidence, and not-evaluated reachability.

This PR adds no operational metadata parsing, public CLI command, existing
report change, or documentation claim that Skill Discovery is implemented.

### PR 2: Canonical parsing, resolution, and internal report

- extend the canonical metadata parser with the two reviewed fields;
- derive declarations from the shared `RepositorySnapshot`;
- resolve exact Skill IDs and repository-relative paths with fail-closed
  ambiguity;
- preserve line evidence and lifecycle state;
- calculate publication, structural roots, standalone and unrouted Skills,
  adoption, cycle-safe reachability, and cycles;
- emit the canonical report through an internal API; and
- add the exact diagnostics defined above.

This PR does not add a public command or change Readiness, diff, CI, graph,
Trust Graph, BOM, scaffold, or suggestion output.

### PR 3: Public `skill-index` command

- register the command in the current CLI and help contract;
- add canonical JSON and compact Markdown formatting;
- add exact focus by Skill ID or path;
- document output, adoption, exit behavior, and interpretation;
- keep all output stdout-only; and
- add CLI, package, and documentation contract tests.

### Later PRs

Choose later work from the deferred list only after actual use validates the
MVP report. Each integration receives its own additive contract review.

## Open Design Questions

These questions are intentionally post-MVP and do not block the three PRs
above:

1. Do observed local Skill references provide enough review value to justify a
   separate non-authoritative projection?
2. If metadata-based adoption proves too easy to remove accidentally, is a
   repository-wide adoption flag justified despite the preference for
   Skill-local policy?
3. Which integration should follow first after report stability: semantic diff,
   Readiness, or CI summary?
4. Can a useful product projection be derived from existing exact tags and
   Context/Lens identity without adding product metadata or a Product asset?
5. Which route visualization remains readable in genuinely large cyclic or
   shared-child graphs?

The PR 1 contract review may refine public spelling before release. It must not
add aliases, observed-route authority, free-form focus, or another metadata
field without a concrete deterministic MVP consumer.

## Success Criteria

The design succeeds when a reviewer can determine, from current repository
evidence:

1. which Skills are intentionally published first hops;
2. which exact declarations create authoritative continuations;
3. where every declaration came from and how it resolved;
4. which Skills are structural roots, standalone, unrouted, or unreachable;
5. whether reachability is authoritative or not yet evaluated;
6. how layered routing varies without requiring a fixed hierarchy;
7. why source Skills remain authoritative and focused;
8. why product knowledge survives owner changes; and
9. why the report is repository governance rather than runtime selection.

The first-hop Markdown projection must remain bounded and useful with more than
100 Skills because it publishes only explicit entrypoints and summarizes gaps
instead of promoting every structural root.

## Non-Goals

- live task interpretation or Skill selection;
- ranking, recommendation, fuzzy search, embeddings, or aliases;
- prompt assembly, Context loading or injection, and execution;
- runtime telemetry, consumed-context claims, or semantic correctness claims;
- inferred route intent from Markdown prose or links;
- a required repository hierarchy or central handwritten mega-index;
- a Product asset or ownership-derived product identity;
- automatic route, entrypoint, Skill, config, or generated-file edits;
- quality, confidence, centrality, or popularity scores;
- Readiness, semantic diff, CI, Trust Graph, or BOM changes in the MVP; and
- treating the old experimental PR as the implementation starting point.
