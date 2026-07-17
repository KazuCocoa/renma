# Declared Impact

Renma 0.20.1 adds a deterministic reverse projection over Declared
Composition:

```text
Focused asset
  -> which cataloged assets and Skills explicitly depend on it?
```

> Renma reports declared impact. It does not predict actual breakage.

Declared Impact is change-review evidence over repository declarations. It is
not runtime telemetry, semantic dependency inference, test selection, or a
claim that any dependent must change.

## Command

```bash
renma graph . \
  --view impact \
  --focus context.shared-api \
  --format json
```

`--format markdown` and `--format mermaid` are also supported. `--focus` is
required and accepts the same stable asset IDs, repository-relative source
paths, and absolute source paths as the other graph views. An unknown focus is
a usage error. A resolved asset with no incoming composition declarations is a
successful empty report.

## Relationship Boundary

Impact traverses incoming forms of exactly these explicit relationships:

- `requires_context`;
- `optional_context`;
- `requires_lens`;
- `optional_lens`; and
- Context Lens `applies_to`.

It does not traverse `references`, `conflicts`, `covered_by`, `superseded_by`,
ownership, lifecycle, policy, static support, `extends`, prose references, or
inferred Skill-to-Skill relationships. Unresolved declarations are not guessed
to target the focus.

## Required And Optional Membership

Membership is relative to the focused asset:

```text
all-required dependent-to-focus route
  => required declared impact

route containing any optional declaration
  => optional declared impact
```

The focus begins in required traversal state and is reported separately. Once
a reverse route crosses an optional declaration, upstream dependents on that
route remain optional. Lens `applies_to` preserves the current route state. If
the same stable asset ID has both required and optional routes, the asset is
classified once as required while provenance retains both route classes.

Required impact means the focus belongs to the dependent asset's required
explicit composition closure. Optional impact means the focus is reached only
through routes containing an optional declaration. Neither classification
means the asset is broken, was loaded, must be tested, or must be changed.

## Report Contract

Impact JSON is the complete machine-readable projection. The additive `impact`
section contains:

- `focus`;
- `requiredDependents` and `optionalDependents`;
- `requiredSkills` and `optionalSkills`;
- `provenanceEdges`; and
- `invalidIncomingDeclarations`.

The focus and dependent assets include stable ID, kind, repository-relative
source path, lifecycle status when declared, and direct status. A dependent is
direct only when one valid composition declaration targets the focus itself.
An asset with both direct and transitive routes remains `direct: true`.

Each provenance edge preserves the repository declaration direction:

```text
dependent source -> declared target -> ... -> focus
```

It retains relationship, raw declared target, declaration index, source path,
line evidence, direct status, and `dependentMembership`. Thus this repository
shape:

```text
Skill A requires_lens Lens B
Lens B applies_to Context X
```

is reported as `Skill A -> Lens B -> Context X`, even though resolution walks
the index backward from Context X.

Invalid resolved incoming declarations remain reviewable but do not establish
or expand impact. For example, a Context using `applies_to`, or a
`requires_context` declaration targeting a Lens, is excluded from valid
dependents. Existing scan diagnostics remain the governance finding source;
the impact report does not create new scan findings.

## Determinism And Cycles

The prepared `DeclaredCompositionIndex` builds incoming resolved declarations
once. Reverse traversal processes `(stable asset ID, membership)` states, so
cycles terminate and each stable ID appears once in the final classification.
Distinct declarations and declaration indexes retain distinct evidence.

Provenance storage is proportional to reachable declarations, not the number
of possible complete dependent-to-focus paths. JSON retains the complete edge
set; human renderers use those edges without eagerly enumerating every path.
Cycle-forming edges are preserved as real repository declarations and no path
is fabricated from sorted cycle members.

## Output Formats

Markdown emphasizes affected Skills, other dependents, declaration evidence,
invalid incoming declarations, and the product boundary. Mermaid points in the
original declaration direction toward the focus, uses solid edges for required
declared impact and dotted edges for optional declared impact, highlights the
focus, and explicitly labels any displayed invalid edge.

All formats are read-only, deterministic repository projections. Renma performs
no network access, LLM call, runtime selection, prompt assembly, telemetry
collection, Git-diff inference, automatic test selection, or repository rewrite
while resolving impact.

## Graph View Comparison

| Form | Meaning |
| --- | --- |
| `graph --view full` | Repository-wide catalog graph. |
| `graph --view full --focus <asset>` | Direct incoming and outgoing neighborhood. |
| `graph --view composition --focus <asset>` | Transitive outgoing Declared Composition: what the focus explicitly includes. |
| `graph --view impact --focus <asset>` | Transitive incoming Declared Composition: what explicitly depends on the focus. |

Use impact to prepare a review scope after a Context or Lens changes. Review
the retained declarations and the actual change before deciding whether any
dependent is semantically affected.
