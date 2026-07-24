# Renma Skill Discovery Design

## Status

Status: stable single-repository static Discovery core

Implementation status: 0.22.0 implements explicit `renma.continues-with`, exact
resolution, route diagnostics, structural roots, and
`graph --view discovery`; 0.22.1 implements explicit
`renma.published-entrypoint`, strict `skill_discovery.adopted`, publication
diagnostics, and adoption projection; 0.22.2 implements cycle-safe reachability,
descriptive and authoritative coverage, unrouted projection, and adopted-mode
unreachable warnings; 0.22.3 implements the versioned
`renma.skill-index.v1` report and stdout-only `skill-index` command with compact
Markdown and exact optional focus; 0.22.4 implements deterministic route-cycle
review diagnostics over the authoritative usable continuation graph and closes
the static core stabilization sequence; 0.23.0 implements an additive
repository-wide Readiness projection over that unchanged prepared index; and
0.23.1 implements an observation-only direct semantic diff over two prepared
indexes without changing CI policy.

Baseline: Renma 0.21.0

Scope: incrementally delivered static Skill Discovery for a large single
repository

This document separates three levels of decision:

- **Accepted design direction** covers the product boundary, layered graph
  model, source ownership, focused-entrypoint responsibility, deterministic
  evidence, and gradual adoption.
- **Complete-design decisions** cover fail-closed Discovery eligibility, the
  incrementally delivered metadata names, explicit publication, separate repository-wide
  adoption, exact resolution, report shape, command, diagnostics, and
  implementation sequence. Each becomes a public contract only in the release
  slice that implements it.
- **Deferred extensions and open questions** are not part of the MVP and must
  not enlarge the first implementation PR.

PR #86 records the original design exploration. PR #89 is useful prototype
evidence for deriving a static report from the shared repository snapshot,
preserving line provenance, and rendering stdout-only projections. Its older
metadata names, aliases, inferred entrypoints, authoritative Markdown-link
routes, report shape, and implementation are not compatibility requirements or
an implementation base.

## Release slicing

Skill Discovery was deliberately delivered as additive slices rather than one
atomic `skill-index` MVP. The 0.22.0 foundation includes only:

- canonical `metadata.renma.continues-with` declarations;
- exact ID and repository-relative path resolution;
- separate resolution and route-usability evidence;
- warnings for invalid, unresolved, ambiguous, wrong-kind, inactive, and
  duplicate declarations;
- structural-root and standalone graph facts; and
- JSON, Markdown, and Mermaid through `graph --view discovery`, with optional
  exact direct-neighborhood focus.

The 0.22.1 slice adds published entrypoints and `skill_discovery.adopted` as a
separate contract. The 0.22.2 slice adds reachability and coverage semantics to
the existing graph projection. The 0.22.3 slice adds the separate versioned
Skill Index report and command without changing the graph or integrating
Readiness, diff, CI report, Trust Graph, BOM, ownership, scaffold, init, guide,
suggestion, or richer visualization contracts. The 0.22.4 slice adds
deterministic cycle review warnings without changing route, reachability,
coverage, report-shape, rendering, or downstream-integration contracts.
The 0.23.0 slice adds compact Discovery counts and five focused checks to
Readiness without changing Discovery core semantics, `renma.skill-index.v1`,
the Discovery graph, diagnostic payloads, or scoring weights. The 0.23.1 slice
adds exact Discovery topology changes to direct semantic diff without
classifying them as improvements or regressions. CI report, Trust Graph, BOM,
ownership, runtime integration, and optional gating remain deferred.

The remainder of this document retains the complete design direction so later
slices can be evaluated consistently. Publication and adoption describe 0.22.1
behavior; reachability, evaluated coverage, and global adopted-mode
unreachable diagnostics describe 0.22.2 behavior; the versioned report and
command describe 0.22.3 behavior.
Route-cycle review and static-core stabilization describe 0.22.4 behavior.
The compact Readiness projection describes 0.23.0 behavior.
The direct semantic diff projection describes 0.23.1 behavior.

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
  -> graph --view discovery emits the first deterministic route projection
  -> skill-index emits the versioned publication/reachability-oriented index
  -> readiness summarizes repository-level Discovery health from that index
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

### Visible Skill

Every discovered catalog asset with kind `skill` is a visible Skill. Invalid,
inactive, duplicate-ID, disconnected, and not-yet-adopted Skills remain visible
in the JSON report with their source identity and existing diagnostics.
Visibility does not make a Skill usable for Discovery.

### Lifecycle-active Skill

A lifecycle-active Skill is not `deprecated` or `archived`. This classification
is useful descriptive inventory, but lifecycle alone is insufficient for
publication, traversal, or authoritative coverage.

### Discovery-eligible Skill

A Skill is Discovery-eligible only when all of the following are true:

```text
a specification-valid canonical Agent Skill
AND not deprecated
AND not archived
AND its effective asset ID is unique across the repository catalog
```

Effective ID uniqueness is repository-wide across all catalog assets, not only
Skills, because Renma asset IDs are global catalog identities. A valid active
Skill whose effective ID collides with another Skill, Context, Lens, or other
catalog asset is not Discovery-eligible.

Only a Discovery-eligible Skill may create a usable continuation, participate
in Discovery traversal, or be a published entrypoint. Existing Agent Skills
validation diagnostics remain authoritative. An invalid Skill is not silently
reclassified as missing, non-Skill, deprecated, or archived.

A Skill with a duplicate effective ID likewise remains visible with its source
path, metadata and declaration evidence, and existing
`META-DUPLICATE-ASSET-ID` diagnostics, but has `discoveryEligible: false`. It is
not reclassified as unresolved, missing, wrong-kind, invalid Agent Skill,
deprecated, or archived. It cannot be published, create or receive a usable
continuation, or participate in structural-root, standalone, unrouted,
reachability, cycle, or authoritative coverage calculations.

Only a specification-valid canonical Agent Skill contributes operational
`metadata.renma.*` values, matching the current parser's fail-closed contract.
Discovery may retain a rejected field and exact target resolution as review
evidence, but that evidence does not become an operational route.

### Declared continuation

A directed source-Skill-to-target relationship named by one exact canonical
metadata item. A declared continuation says that the source Skill identifies
the target as a possible next workflow after the source fulfills its own
bounded responsibility.

The report retains a declaration's source, target spelling, resolution, and
evidence even when the source or resolved target is not Discovery-eligible. It
becomes an authoritative usable edge only when the declaration is valid and
both source and target are Discovery-eligible Skills.

It does not express runtime selection, priority, exclusivity, loading,
execution, or actual use.

### Published entrypoint

A Discovery-eligible Skill with a valid explicit publication marker. It is
intentionally included in the first-hop index. Publication is Skill-local and
is not inferred from graph position.

Publishing an entrypoint does not declare that every Discovery-eligible Skill
in the repository must be reachable from it. Repository-wide coverage is a
separate explicit configuration decision.

### Repository-wide Discovery adoption

Repository-wide adoption is a repository policy that every Discovery-eligible
Skill belongs to the published continuation graph: it is reachable from a
published entrypoint or is itself intentionally published as an independent
first hop. It is distinct from publishing any individual Skill and is declared
only by the proposed repository configuration field below.

### Structural root

A Discovery-eligible Skill with no incoming usable declared continuation from
another Discovery-eligible Skill. Structural roots are graph facts and adoption
candidates, not published entrypoints.

### Standalone Skill

A Discovery-eligible Skill with no incoming or outgoing usable declared
continuation. A standalone Skill may be intentionally published, intentionally
independent, or not yet adopted into Discovery.

### Unrouted Skill

A Discovery-eligible Skill that is not published and has no incoming usable
declared continuation. Standalone Skills are a subset of unrouted Skills.
Unrouted is a reporting classification, not automatically a defect.

### Reachable and unreachable Skill

A Discovery-eligible Skill is reachable when a cycle-safe traversal of usable
declared continuations reaches it from at least one published entrypoint.
Specification-invalid Skills are visible but never satisfy reachability.

In `partial` mode, reachability may be calculated as descriptive projection
data for the published subgraphs. A not-reached Skill is not thereby a global
coverage defect. Only explicit repository-wide adoption makes reachability an
authoritative coverage contract and permits global unreachable diagnostics.

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
Neither publication nor structural position enables repository-wide coverage
diagnostics without the separate adoption configuration.

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

### Canonical publication marker

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

### Canonical repository-wide adoption field

Repository-wide coverage intent is genuinely repository-wide policy, so 0.22.1
adds one minimal configuration field:

```json
{
  "skill_discovery": {
    "adopted": true
  }
}
```

`skill_discovery.adopted: true` means that every Discovery-eligible Skill is
expected to be reachable from a published entrypoint or intentionally
published as an independent first hop. Omission or `false` means the repository
has not declared complete Discovery coverage. In 0.22.1 this records policy
intent without evaluating reachability or coverage. In 0.22.2 it enables
authoritative coverage after an effective published entrypoint exists. No
additional Discovery config key is supported.

This field is independent of Skill-local publication. Adding
`renma.published-entrypoint: "true"` includes one Skill in the first-hop index;
it does not enable repository-wide unreachable diagnostics. `renma init` must
not emit the field or silently adopt Discovery.

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

1. Inspect canonical frontmatter together with the current Agent Skills
   validation result. Only a Discovery-eligible source contributes an
   operational declaration; a rejected source field may remain visible as
   non-operational review evidence.
2. Require a JSON-array string of non-empty strings; do not split commas or
   coerce another type.
3. For an ID reference, require one exact catalog asset ID match.
4. For a path reference, normalize path separators to `/`, remove one leading
   `./` for current compatibility, and require one exact repository-relative
   catalog path. Reject absolute paths and paths that escape the repository.
5. If the spelling matches an ID and a path belonging to different assets, fail
   closed. An ID reference shared by multiple catalog assets is ambiguous, but
   an exact path reference still resolves to its one path target.
6. If the resolved target is not a Skill, retain the evidence and report a
   wrong-kind diagnostic.
7. If the target is a specification-invalid Skill, retain its Skill identity,
   path, validation diagnostics, and route evidence. Do not treat it as
   missing, wrong-kind, or usable.
8. Retain routes to valid `deprecated` or `archived` Skills for review, but do
   not use them for Discovery traversal.
9. If an exact path resolves to a Skill whose effective ID is not unique,
   retain the resolved target path, ID, metadata evidence, declaration
   evidence, and linked `META-DUPLICATE-ASSET-ID` diagnostics. The resolution
   remains `resolved`, but the route is unusable because the target lacks
   authoritative graph identity.

A usable route is resolved, unambiguous, Skill-to-Skill, declared by a
Discovery-eligible source, and targets a Discovery-eligible Skill. Route data
separates target resolution from usability and exposes deterministic unusable
reasons such as `invalid-source`, `invalid-target`, `inactive-source`,
`inactive-target`, `duplicate-source-id`, `duplicate-target-id`, `wrong-kind`,
or `ambiguous-target`. A duplicate-ID Skill cannot create or receive a usable
continuation. Traversal deduplicates by stable Skill ID only after excluding
identity-ineligible Skills, and terminates through cycles.

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

## Complete Discovery MVP (delivered across independent slices)

The complete delivered design includes:

- the two canonical metadata fields above;
- the minimal `skill_discovery.adopted` repository-wide coverage field above;
- exact ID and repository-relative path target resolution;
- source-path and line-level declaration evidence;
- fail-closed Discovery eligibility using current Agent Skills validation and
  lifecycle evidence plus repository-wide effective asset ID uniqueness;
- explicit published entrypoints;
- structural-root, standalone, and unrouted classifications;
- descriptive reachability during partial adoption and authoritative coverage
  only after repository-wide adoption;
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
- Mermaid output in `skill-index` (the 0.22.0 graph projection
  already provides deterministic Mermaid);
- Readiness, semantic diff, CI, Trust Graph, and BOM integration;
- scaffold, `guide`, or `suggest-metadata` changes;
- any repository configuration beyond the single coverage field; changes to
  `renma init`; and
- automatic repository edits.

## Versioned full report and CLI contract

### Command name

The publication/reachability-oriented command is:

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

Exit behavior follows current report commands:

- `0`: the report was produced, including advisory warnings;
- `1`: the report contains an error-severity repository diagnostic; and
- `2`: invalid CLI use, configuration failure, or report-construction failure.

The initial Discovery diagnostics are warnings, so CI gating is not introduced
indirectly through this command.

### Canonical JSON report

The canonical schema identifier is:

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
coverage
summary
skills
routes
publishedEntrypointIds
structuralRootIds
standaloneSkillIds
unroutedSkillIds
notReachedDiscoveryEligibleSkillIds
reachableDiscoveryEligibleSkillIds
diagnostics
```

`adoption.state` is one of:

- `not-adopted`: no Discovery metadata is present and repository-wide coverage
  is not declared;
- `partial`: continuations or published entrypoints exist, but
  `skill_discovery.adopted` is not `true`;
- `incomplete`: repository-wide coverage is declared, but no valid
  Discovery-eligible published entrypoint exists; or
- `adopted`: repository-wide coverage is declared and at least one
  Discovery-eligible Skill has `renma.published-entrypoint: "true"`.

This is deliberately independent of `renma init`. Initialization records Renma
repository adoption; it does not silently adopt the Skill Discovery contract.
The current `renma init` output remains unchanged.

The `adoption` object should expose whether Discovery metadata is present,
whether repository-wide coverage is declared, the config path and field
evidence when declared, and why the current state was selected. The separate
`coverage.mode` is `not-evaluated`, `descriptive`, or `authoritative`:

- partial mode with a Discovery-eligible published entrypoint may calculate
  descriptive reachability without emitting global unreachable diagnostics;
- incomplete mode cannot evaluate coverage because it has no usable first hop;
  and
- adopted mode evaluates authoritative repository-wide coverage.

Each Skill entry should include stable ID, Agent Skills name and description
when valid, source path, effective owner with provenance, lifecycle, tags,
Agent Skills validity, lifecycle-active state, `effectiveIdUnique`, Discovery
eligibility, publication state, structural-root state, standalone state, and
reachability. `effectiveIdUnique` states whether the effective ID occurs exactly
once across all repository catalog assets. Reachability is `reachable`,
`not-reached`, or `not-evaluated`; invalid and duplicate-ID Skills remain visible
with `discoveryEligible: false` and their existing diagnostics.

Each route entry should include source ID and path, declared target, resolution
state, resolved target ID/path/kind/status when available, target-ID uniqueness,
usability, usability reasons, linked diagnostics, and declaration evidence.
Resolution state distinguishes at least `resolved`, `unresolved`, `ambiguous`,
and `wrong-kind`. Usability is separate and includes stable reasons for invalid,
inactive, or duplicate-ID sources and targets. A path-resolved duplicate-ID
Skill therefore remains a resolved Skill target while the route is unusable.

Summary counts distinguish total discovered Skills, lifecycle-active Skills,
Discovery-eligible Skills, invalid Skills, duplicate-effective-ID Skills,
declared and usable routes, published entrypoints, structural roots, standalone
and unrouted Skills, and reachable Discovery-eligible Skills when evaluated.
All ID-based arrays contain only Discovery-eligible Skills with unique catalog
identity. Arrays and diagnostics use stable deterministic ordering.
`notReachedDiscoveryEligibleSkillIds` is descriptive in partial mode and is
authoritative coverage evidence only in adopted mode.

### Compact Markdown

Default Markdown should show:

- the static-only boundary and adoption state;
- each published entrypoint's ID, description, path, lifecycle, owner, and
  direct declared continuations;
- counts plus a deterministically capped structural-root, standalone, and
  unrouted sample using the current presentation cap;
- global unreachable Skills only in adopted mode; and
- exact diagnostics with source links or paths.

It should instruct the reader to open source `SKILL.md` files and apply their
conditions. It must not reproduce complete workflow instructions or present the
index as a prompt package.

During partial adoption, default Markdown should show published entrypoints and
their direct continuation evidence without enumerating every unrelated
not-reached Skill. When there is no valid published entrypoint, Markdown should
say that Discovery is not adopted, partial, or incomplete as applicable and
show only a bounded structural-root candidate summary. It must not silently
publish every candidate.

## Diagnostics

The initial diagnostics are exact, evidence-backed warnings. “Adoption
required” below means the diagnostic is emitted only when `adoption.state` is
`adopted`.

| Diagnostic | Applies when | Adoption required | Exact evidence and actionability |
| --- | --- | --- | --- |
| `DISCOVERY-INVALID-CONTINUATION-DECLARATION` | `renma.continues-with` is not a valid JSON-array string of non-empty strings. | No | The canonical metadata field, parser error, and line range identify the value to correct or remove. It can only arise from the explicit route field, never an ordinary link. |
| `DISCOVERY-UNRESOLVED-DECLARED-ROUTE` | A valid declaration item has no exact ID or repository-relative path match, or resolution is ambiguous. | No | The declaration item, index, raw target, source path, and candidate details identify the exact contract to repair. Ordinary references are not considered. |
| `DISCOVERY-ROUTE-TARGET-NOT-SKILL` | A declaration resolves exactly to a non-Skill asset. | No | The declaration and resolved asset kind/path show that a Context, Lens, or support relationship should use its existing typed field instead. |
| `DISCOVERY-INACTIVE-ROUTE-TARGET` | A Discovery-eligible Skill declares a continuation to a specification-valid deprecated or archived Skill. | No | The route declaration plus target lifecycle and path support replacement or explicit removal. The edge remains visible but unusable for Discovery traversal. |
| `DISCOVERY-DUPLICATE-DECLARED-ROUTE` | One source declares the same normalized unresolved target more than once, or multiple items resolve to the same target Skill. | No | All declaration indices and line evidence show the redundant items. Markdown links cannot create this diagnostic. |
| `DISCOVERY-INVALID-PUBLISHED-ENTRYPOINT` | The publication key is present with a value other than `"true"`, is declared ambiguously, or attempts to publish a specification-valid deprecated or archived Skill. | No | The publication field and lifecycle evidence show why the Skill cannot be published. A specification-invalid or duplicate-ID Skill instead remains ineligible under its existing Agent Skills or catalog-identity diagnostics. |
| `DISCOVERY-ENTRYPOINT-WITHOUT-USABLE-BOUNDARIES` | A Discovery-eligible published entrypoint has a deterministically established missing capability, positive usage boundary, or negative routing boundary under current Agent Skills and Skill-quality checks. | No | The publication marker and originating `RN-SKILL-*` or `QUAL-*` evidence identify the boundary to improve. This is a publication-quality check, not link interpretation, and passing it is not proof of semantic completeness. |
| `DISCOVERY-UNREACHABLE-ELIGIBLE-SKILL` | In adopted mode, a Discovery-eligible Skill is not reachable from any published entrypoint through usable declared continuations. | Yes | The repository-wide adoption declaration, published-entrypoint evidence, and authoritative route graph establish the gap. Ordinary Markdown references cannot make a Skill reachable or unreachable. |
| `DISCOVERY-ROUTE-CYCLE` | Usable representative resolved Skill routes form a self-loop or a multi-Skill strongly connected component. | No | Sorted member Skill paths and every internal route retain exact declaration evidence. One warning covers each maximal component. Review whether the loop is intentional and bounded or accidental; do not infer runtime recursion or remove an arbitrary edge. |

Existing duplicate-ID, invalid Agent Skills, lifecycle, ownership, and usage
guidance diagnostics remain visible and should be reused as related evidence
rather than reimplemented with different semantics. In particular:

- resolving a declaration to an invalid Skill adds `invalid-target` usability
  evidence and links to the existing `AS-SKILL-*` diagnostics; it does not add
  a second invalid-Skill diagnostic or pretend the target is missing, inactive,
  or wrong-kind; and
- a duplicate effective ID links the existing `META-DUPLICATE-ASSET-ID`
  evidence from the visible Skill, rejected publication, and affected route.
  Discovery adds `duplicate-source-id` or `duplicate-target-id` usability
  evidence, not a competing duplicate-ID diagnostic. Exact path resolution
  remains distinct from identity usability.

The MVP adds no confidence, centrality, popularity, route-quality, or “best
Skill” scores.

## Adoption Model

Adoption is incremental and does not require moving files.

### Stage 1: inspect candidates

Run `renma skill-index .` with no Discovery metadata. Renma reports
`not-adopted`, structural roots, standalone Skills, and exact current repository
diagnostics. Reachability is not evaluated.

### Stage 2: declare and publish one bounded area

Add `renma.continues-with` only to source Skills that own real continuation
policy, and publish a reviewed first hop when that area is useful. Keep the
conditions and no-match behavior in each Skill body. The report state is
`partial`: publication and direct route evidence are descriptive. When an
effective published entrypoint exists, 0.22.2 also calculates descriptive
reachability without making a repository-wide completeness claim. Default
Markdown remains bounded to the published area and compact candidate summaries.

### Stage 3: review and expand descriptive coverage

Review declared routes, invalid or inactive targets, and usage boundaries. Add
intentional entrypoints or continuations one bounded workflow area at a time.
Reachability and not-reached Skill arrays are descriptive evidence only; they
do not create global coverage defects during partial adoption.

### Stage 4: declare repository-wide coverage

Set `skill_discovery.adopted: true` only when the repository intends complete
coverage. The state is `incomplete` until at least one Discovery-eligible Skill
is published, then `adopted`. The 0.22.2 slice evaluates authoritative coverage
and emits one warning per not-reached eligible Skill only in the `adopted`
state.

No initial CI gate, repository rewrite, or all-at-once metadata migration is
required.

## Compatibility

The 0.22.0 route foundation recognizes only
`metadata.renma.continues-with`; historical proposal names are not
compatibility requirements. The implementation must not restore old top-level
fields such as:

```yaml
routes_to:
discovery_entrypoint:
discovery_aliases:
```

It also must not accept those names as silent aliases. Canonical Skills use
flat string-valued `metadata.renma.*`; non-Skill assets cannot declare Skill
continuations or publication.

Repositories without Discovery metadata keep their current scan, catalog,
graph, CI, Trust Graph, and BOM behavior. Readiness adds a stable neutral
inventory `summary.skillDiscovery`; direct diff adds a stable no-change
Discovery section when both refs retain the same topology. A `not-adopted`
repository may still report route-eligible and unrouted Skill counts, but
publication is not required, structural roots are not promoted, and coverage
remains explicitly unevaluated without warnings. The dedicated Discovery graph
view does not add continuation edges to existing graph views; `skill-index` is
an independent report. `renma init` continues to omit repository-wide
Discovery adoption; authors may set the strict `skill_discovery.adopted` config
field explicitly.

PR #89 should not be rebased, cherry-picked, restored, or used as the code
baseline. Implementation starts from the 0.21.0 shared repository snapshot,
canonical metadata parser, diagnostics, and current CLI conventions.

## Deferred Extensions

After static-core stabilization, operational trials may inform:

- non-authoritative observed Skill references or route candidates;
- CI summary, suppression, and optional gating;
- richer route visualizations beyond the initial deterministic Mermaid view;
- product and ownership projections from exact tags, stable IDs, and existing
  Context/Lens relationships;
- Trust Graph or Repository Context BOM additions;
- scaffold, `guide`, metadata suggestion, or review-bundle assistance; and
- additional Discovery configuration beyond the single reviewed adoption
  field, if concrete usage demonstrates a need.

LLM-assisted authoring remains an adjacent or dogfooded Skill layer unless a
future decision changes Renma's boundary. Runtime debugging and observability
require runtime-produced evidence and remain external. Multi-repository or
organization-wide discovery requires a separate federation design.

## Incremental implementation sequence

### 0.22.0: route foundation and graph projection

- parse only canonical `renma.continues-with` declarations;
- build one exact, fail-closed route index from the shared snapshot and catalog;
- preserve declaration, Agent Skills, lifecycle, kind, and identity evidence;
- calculate route eligibility/usability, structural roots, and standalone
  Skills without reachability or coverage semantics;
- emit the five initial warning diagnostics through scan and diagnostics v2;
  and
- add the dedicated discovery graph JSON, Markdown, Mermaid, exact optional
  focus, CLI help, tests, and documentation.

### 0.22.1: publication and adoption

- parse only the exact string `renma.published-entrypoint: "true"` marker;
- apply existing Discovery eligibility to effective publication and retain
  stable rejection evidence;
- parse strict boolean `skill_discovery.adopted` repository policy;
- expose `not-adopted`, `partial`, `incomplete`, and `adopted` states while
  keeping coverage explicitly `not-evaluated`;
- emit publication warnings through scan and diagnostics v2; and
- extend the existing discovery graph JSON, Markdown, Mermaid, and focus
  projection without adding a new command.

### 0.22.2: reachability and coverage semantics

- traverse only usable representative resolved Skill-to-Skill routes from
  effective published entrypoints, with cycle safety and deterministic
  multi-source provenance;
- expose per-Skill reachability, repository-wide reachable/not-reached IDs,
  exact unrouted facts, and repository-scoped coverage counts;
- calculate descriptive evidence for partial adoption with an effective first
  hop and authoritative completeness only for adopted repositories;
- emit one warning per authoritative not-reached eligible Skill through scan,
  diagnostics v2, and review bundles; and
- extend the existing JSON, Markdown, Mermaid, and exact-focus projections
  without integrating downstream reports or adding a command.

### 0.22.3: versioned Skill Index report and command

- build `renma.skill-index.v1` from one shared repository snapshot and prepared
  Discovery index without a second scan or model;
- expose the existing complete Skill, route, adoption, coverage, publication,
  reachability, structural, standalone, unrouted, and ID-array structures;
- keep repository and Discovery diagnostics in separate collections and apply
  report exit codes across both;
- default to compact, deterministically capped Markdown and support canonical
  JSON plus exact direct-neighborhood focus; and
- add no Mermaid format, runtime selection, route inference, repository writes,
  metadata, configuration, or downstream-report integration.

### 0.22.4: route-cycle diagnostics and static-core stabilization

- run deterministic, stack-safe iterative strongly connected component
  detection over only usable representative resolved Skill-to-Skill routes
  after route usability is prepared and before any focus projection, grouping
  internal component routes in one pass for `O(V + E)` work apart from sorting;
- emit one `DISCOVERY-ROUTE-CYCLE` warning per maximal cyclic component,
  including explicit self-loops, every sorted member Skill, every sorted
  internal route, and canonical first-route primary evidence;
- link the warning to every internal route and member Skill, and retain it under
  exact focus whenever any internal cycle route is visible;
- propagate the warning through scan, diagnostics v2, review bundles, the
  existing Discovery graph diagnostics, and Skill Index Discovery diagnostics;
  and
- preserve reachability, coverage, `renma.skill-index.v1`, graph rendering,
  exit codes, metadata, configuration, downstream exclusions, and package
  version.

After this slice, the current single-repository static Discovery core is
stable. Operational trials may inform later integrations, but those decisions
do not reopen the current route, publication, reachability, focus, or report
contracts automatically.

### 0.23.0: Skill Discovery Readiness integration

- derive one compact `summary.skillDiscovery` from the memoized prepared
  Discovery index already owned by the shared `RepositorySnapshot`;
- expose adoption, publication, eligibility, reachability, unrouted, usable,
  unusable, unresolved, and maximal cycle-component counts without embedding
  the route graph or duplicating diagnostics;
- add `discovery.publication`, `discovery.route_validity`,
  `discovery.coverage`, `discovery.unrouted_skills`, and
  `discovery.cycle_review` checks with compact evidence that references
  existing structured facts and diagnostic codes;
- treat adopted coverage as authoritative, partial coverage with an effective
  entrypoint as descriptive, and not-adopted or no-entrypoint coverage as
  explicitly unevaluated; keep `not-adopted` publication and coverage neutral
  and cycle presence review-only;
- add no Discovery scoring weight and do not copy Discovery diagnostics into
  the Readiness diagnostic collection, avoiding a second penalty; and
- preserve the Discovery graph, `renma.skill-index.v1`, route and eligibility
  semantics, exact diagnostic wording/evidence/repair contracts, and deferred
  semantic diff, CI, Trust Graph, BOM, ownership, runtime, and telemetry work.

Only direct Readiness requests its Discovery projection in this slice.
The 0.23.1 direct diff continues to request this internal Readiness subset
without Discovery checks, then compares `snapshot.skillDiscovery` separately.
BOM continues to build its existing subset without preparing or serializing
Discovery. Defensive output filters remain compatibility guards; no second
collection or parse is introduced.

### 0.23.1: Skill Discovery semantic diff integration

- collect exactly one immutable `RepositorySnapshot` for each archived Git ref,
  derive graph and the pre-0.23.0 Readiness subset from it, and access its
  memoized `skillDiscovery` projection once;
- add `DiffReport.discovery` with exact adoption and coverage transitions,
  compact count deltas, effective published entrypoint identities,
  reachable/not-reached and unrouted identity changes, canonical route-group
  changes, and maximal cycle-component changes;
- identify Skills by repository-relative path plus ID, routes by normalized
  source Skill path plus normalized declared target, and cycles by sorted
  member IDs;
- group duplicate declarations under `declarationCount`, ignore declaration
  order, array position, source lines, and discovery order, and report
  resolution or usability changes under one stable route identity rather than
  as removal plus addition;
- keep direct Markdown bounded and complete JSON deterministic without copying
  the Skill Index, diagnostics, raw snippets, declaration indices, temp paths,
  timestamps, or mutable internals; and
- omit the new section through an explicit CI-compatible diff projection.
  Discovery facts do not affect CI JSON, Markdown, status, notes, exit behavior,
  Readiness scoring, or any diagnostic contract in 0.23.1.

### 0.23.2 and later integrations

The planned review order is:

```text
0.23.0 — Discovery Readiness integration
0.23.1 — Discovery semantic diff integration
0.23.2 — Discovery CI report integration
later   — optional CI policy or gating
```

0.23.2 CI report integration is not committed product behavior. Optional
gating, Trust Graph, BOM, ownership, observed-reference, authoring, richer
visualization, and federation additions also require independent additive
contract review.

## Open Design Questions

These questions are intentionally later work and do not block the stable
0.23.1 Discovery, Readiness, and direct semantic diff contracts:

1. Do observed local Skill references provide enough review value to justify a
   separate non-authoritative projection?
2. Should 0.23.2 expose neutral Discovery diff facts in CI, and if so which
   compact projection avoids implying policy?
3. Can a useful product projection be derived from existing exact tags and
   Context/Lens identity without adding product metadata or a Product asset?
4. Which route visualization remains readable in genuinely large cyclic or
   shared-child graphs?

Later contract review must not add aliases, observed-route authority,
free-form focus, another metadata field, or another repository config field
without a concrete deterministic consumer.

## Success Criteria

The design succeeds when a reviewer can determine, from current repository
evidence:

1. which discovered Skills are visible, lifecycle-active, specification-valid,
   repository-unique in effective asset identity, and Discovery-eligible;
2. why an invalid or duplicate-ID Skill retains source and declaration evidence
   but cannot publish, create or receive a usable route, participate in
   authoritative graph calculations, or satisfy reachability;
3. which Skills are intentionally published first hops;
4. whether the repository has separately declared complete Discovery coverage;
5. which exact declarations create authoritative continuations;
6. where every declaration came from and how it resolved;
7. which eligible Skills are structural roots, standalone, unrouted, or not
   reached, and whether that result is descriptive or authoritative;
8. which exact usable continuations form each maximal cyclic component and why
   that static evidence does not prove runtime recursion;
9. how layered routing varies without requiring a fixed hierarchy;
10. why source Skills remain authoritative and focused;
11. why product knowledge survives owner changes; and
12. why the report is repository governance rather than runtime selection.

The first-hop Markdown projection must remain bounded and useful with more than
100 Skills because it publishes only explicit entrypoints and uses capped
summaries instead of promoting every structural root or enumerating all
not-reached Skills during partial adoption.

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
- CI, Trust Graph, BOM, ownership, observed-reference, richer visualization,
  authoring-assistance, federation integration, or optional gating in 0.23.1;
  and
- treating the old experimental PR as the implementation starting point.
