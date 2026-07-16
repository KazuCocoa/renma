# Declared Composition

Declared Composition is Renma's deterministic projection of required and
optional relationships explicitly authored in a repository.

> Renma models explicit composition, not general natural-language inheritance.

A Declared Composition report answers which Context Lenses and Context Assets
belong to one resolved root's declared closure, which declarations include
them, and which structural or governance problems need review. It does not
prove which Context an agent loaded, selected, or used at runtime.

## Expansion Contract

Renma expands only these normalized declaration forms:

| Declaration | Target | Membership effect |
| --- | --- | --- |
| `requires_context` | Context Asset | Required unless the route is already optional |
| `optional_context` | Context Asset | Makes this route and its descendants optional |
| `requires_lens` | Context Lens | Required unless the route is already optional |
| `optional_lens` | Context Lens | Makes this route and its descendants optional |
| Lens `applies_to` | Context Asset | Preserves the Lens route's membership |

Renma does not expand `references`, `conflicts`, `covered_by`,
`superseded_by`, ownership, lifecycle, policy inheritance, local support,
static file references, or `extends`. Those relationships can still be
validated or reported.

`extends` keeps its existing meaning: an overlay or profile relationship. It
belongs only to a typed resolver that defines supported fields, merge and
precedence behavior, conflicts, cycles, effective output, and provenance.
Declared Composition does not generalize it into natural-language inheritance.

Declaration order is stable for review but has no semantic precedence. Renma
does not implement first-wins, last-wins, implicit override, status-based
selection, prose merging, or conflict winner selection.

## Required And Optional Membership

- A route containing only required edges produces required membership.
- After a route crosses an optional edge, every descendant on that route stays
  optional, including a Context reached through a required descendant edge.
- A required Lens makes its `applies_to` Context required; an optional Lens
  makes it optional.
- When the same stable asset ID has required and optional routes, the asset is
  listed once as required while both kinds of provenance remain present.
- The root is reported separately and is not duplicated in the required list.
- Optional membership is a repository declaration, not a runtime choice made
  by Renma.

Assets with different stable IDs are never merged because their titles or
contents look similar.

## Finite Resolution And Provenance

The resolver operates over the existing catalog and tracks each stable asset
ID in required and optional traversal states. Each state is processed at most
once. A later required route upgrades final membership without discarding the
optional state or its evidence.

One-off callers use the public resolver wrapper. Repository scans prepare the
asset-ID, normalized-path, and dependency-by-source indexes once, then reuse
them across roots. Member lists and governance checks visit only the root and
reached IDs rather than filtering every catalog asset for every root.

Renma retains predecessor declaration edges rather than eagerly enumerating
every root-to-node path. Each edge records source and target IDs, declared
target, declaration form, membership, source path, line range, and raw snippet.
This preserves multiple parents, duplicate declaration evidence, optional and
required routes, and cycle-forming declarations while keeping storage
proportional to assets and declarations instead of possible paths.

If required and optional traversal states produce the same resulting
membership for one declaration, Renma records that declaration transition once.
The transition identity includes source ID and path, declaration form and
index, declared target, normalized relationship, and resulting membership.
Distinct metadata entries retain distinct declaration indexes and evidence.

## Completeness, Cycles, And Conflicts

`requiredComplete` is false when a required composition declaration is
unresolved, originates from an invalid source kind, or resolves to the wrong
target kind. Equivalent optional failures make `optionalComplete` false
without changing required completeness. Source-kind validation is independent
from target resolution, so an invalid `applies_to` source with an unresolved
target retains both facts.

`cycleFree` is independent. A complete cycle such as Context A requiring
Context B and Context B requiring Context A resolves to a finite closure:

```text
requiredComplete: true
cycleFree: false
```

Focused reports retain their root-relative required and optional cycles. Scan
findings group the same strongly connected component across roots and use the
required diagnostic whenever any root reaches it as required, while preserving
optional roots in structured details. Cycle asset IDs are a sorted member set,
not an inferred path; Markdown lists the actual retained declarations instead.
Cycles define no precedence and do not instruct a runtime to load an asset
repeatedly.

Conflicts are normalized as stable unordered asset-ID pairs. A conflict where
both members are required is stronger than a candidate involving an optional
member. Reports retain the conflict declarations and inclusion provenance.
Renma never selects a winner from order, lifecycle status, dates, popularity,
or model inference.

## Composition View

Use the existing graph command with one focus target:

```bash
renma graph . --view composition --focus skill.testing.spec-review --format json
renma graph . --view composition --focus skill.testing.spec-review --format markdown
renma graph . --view composition --focus skills/testing/spec-review/SKILL.md --format mermaid
```

The focus accepts the existing stable-ID and source-path forms. Omitting
`--focus` is an argument error.

JSON contains the root, required and optional assets, complete provenance
edges, unresolved declarations, source- and target-kind mismatches, cycles,
conflicts, freshness and lifecycle findings, and completeness flags. Markdown
is a compact review report. Mermaid uses labeled solid required edges and
labeled dotted optional edges; it depicts repository composition, not runtime
execution.

## Scan Findings

Composition analysis supplies these stable scan identifiers:

- `META-DEPENDENCY-SOURCE-KIND-MISMATCH`
- `META-DEPENDENCY-TARGET-KIND-MISMATCH`
- `META-DUPLICATE-DECLARED-DEPENDENCY`
- `COMPOSITION-REQUIRED-CYCLE`
- `COMPOSITION-OPTIONAL-CYCLE`
- `COMPOSITION-DECLARED-CONFLICT`
- `COMPOSITION-OPTIONAL-CONFLICT`

Existing `MAINT-ASSET-EXPIRED` and `MAINT-ASSET-REVIEW-OVERDUE` freshness
governance now also applies to Context Lenses. Findings remain deterministic
repository evidence and do not perform runtime selection, loading, prompt
assembly, execution, crawling, or automatic rewriting.
