# Renma Internal Architecture

This document describes the 0.20.x maintainability architecture, including the
additive `guide` command, its shipped interactive authoring protocol, and
Declared Composition and Declared Impact analysis.
It is contributor guidance, not a new versioned JSON schema. Renma 0.18.2
remains the compatibility baseline for existing commands: public fields,
classifications, diagnostics, severities, exit behavior, and migration direction
must not change as a side effect.

The high-level product boundary remains in [Architecture](../architecture.md).
Stable classification and decision fields are documented in the
[Diagnostics Reference](diagnostics.md), and the versioned BOM contract is in
[Repository Context BOM](repository-context-bom.md).

## Dependency Flow

```text
repository files + config
        |
        v
discovery + parsing + repository resolution
        |
        v
RepositorySnapshot (facts and snapshot-scoped indexes)
        |
        +--> scan + graph --> Readiness --> BOM
        |
        v
target evidence --> governance evidence --> command decision --> renderer
```

Dependencies should continue to point from low-level parsing and resolution to
evidence, then to decisions, renderers, and command orchestration. A lower-level
module must not import a command renderer. Commands coordinate these layers;
they should not independently reinterpret repository layout.

The dependency direction is checked in CI. Type-only imports are treated as
architectural dependencies, so lower layers must not import command or renderer
modules even when the import is erased at runtime.

Every production TypeScript file belongs to exactly one enforced layer. A
module may depend on its own layer or a layer above it in this table (toward
lower-level responsibilities), never on a row below it:

| Order | Layer | Responsibility |
| ---: | --- | --- |
| 1 | `foundation` | Shared primitives, stable contracts, configuration, and small dependency-free utilities |
| 2 | `parsing` | Source parsing, syntax recovery, and lexical projection |
| 3 | `repository` | Discovery, metadata normalization, catalog construction, and snapshot projections |
| 4 | `analysis` | Deterministic rules, graph/report intermediate representations, and diagnostics |
| 5 | `evidence` | Reusable target and inspection evidence construction |
| 6 | `decisions` | Authoritative decisions and typed authoring guidance |
| 7 | `renderers` | Human-facing and serialization presentation |
| 8 | `commands` | Command orchestration |
| 9 | `cli` | Global parsing, dispatch, and process entry |

Directory-owned modules inherit their directory layer. Historical top-level
modules are classified in one explicit architecture-test registry, so adding a
new unclassified `src/**/*.ts` file fails CI. Runtime imports, type-only
imports, and re-exports all count as dependencies; lateral imports within one
layer are valid.

Compatibility exceptions name one exact source, target, and reason. The
current list contains the legacy composed-output imports from `src/types.ts`
and snapshot construction's established classification-index path; the type
exceptions are removed by the cohesive type split. The public deep-import type
re-exports from `src/commands/inspect.ts` and
`src/commands/suggest-metadata.ts` are also listed and checked exactly rather
than allowing command modules to re-export arbitrary lower-layer contracts.

## Typed Catalog Diagnostic Identity

Metadata and catalog producers assign stable `DIAGNOSTIC_IDS` identities when
they create diagnostics. `catalogDiagnosticFindings` selects its Finding
definition only from that identity; human-readable messages remain evidence and
presentation text and must never control classification. Structured values that
a downstream rule needs belong in `details`, not in message parsing.

New internal identities attached to legacy catalog diagnostics are
non-enumerable. This lets scan classify them before serialization while
preserving the 0.18.2 JSON projection. Diagnostics that intentionally remain
catalog-only carry a typed internal disposition, and unknown diagnostics use the
generic fail-closed catalog Finding definition.

## Security Destination Analysis

Security destination analysis is a deterministic, non-executing pipeline:

```text
Markdown/source eligibility
  -> logical shell projection
  -> shell command segmentation
  -> curl transfer segmentation
  -> lexical destination candidates
  -> operational association IR
  -> destination normalization/matching
  -> existing policy diagnostics
```

`src/security-diagnostics.ts` owns Markdown eligibility, effective policy,
guard association, evidence projection, and conversion into the existing public
finding model. The internal `src/security-destination/` modules own the pure
destination stages. `analyzeDestinations` projects one input, classifies its
candidates once, masks candidate text once, and records network and upload
associations in one intermediate representation. Policy checks derive their
network and upload views from that result instead of reclassifying raw text.

Lexical classification and operational intent are separate. An explicit
transport can carry network or upload intent even when its host cannot be
normalized; the IR records that as `not-evaluated` without exposing a new CLI
field or diagnostic. Source, command, and curl-transfer spans map back to the
original input so multiline evidence continues to use the existing finding
ranges and snippets.

Shell support is intentionally bounded to the behavior established in 0.22.4:
simple curl commands, single and double quotes, active escapes and
backslash-newlines, common command separators, redirection exceptions, and curl
`--next`. Renma does not execute or fully parse shell. Heredocs, command or
process substitution, subshell evaluation, functions, aliases, variable
expansion, and complete POSIX or Bash parsing remain outside this analysis.
Future support for broader shell syntax, additional URL schemes, IPv6 zone
identifiers, complexity diagnostics, or user-visible not-evaluated results must
be handled as behavior-changing follow-up work.

## RepositorySnapshot Is the Repository Evidence Source

`collectRepositorySnapshot` in `src/repository-evidence.ts` performs one
repository collection and creates the shared in-memory source of repository
facts. The snapshot contains:

- resolved root, configuration, configuration path, and scan count;
- discovered artifacts and parsed documents;
- the normalized catalog, Context Lens summary, and diagnostic partitions;
- repository-relative paths and their captured filesystem states;
- structural classification evidence indexed by repository-relative path;
- a parent-Skill index used for exact parent resolution;
- effective security-policy evidence with its provenance.

The indexes belong to the snapshot. Consumers should reuse them instead of
reparsing files or rebuilding command-specific lookup tables. A new projection
should normally accept `RepositorySnapshot`, or the narrowest existing
projection of it, rather than perform another discovery pass.

`RepositorySnapshot` does not freeze the working tree. It records what one
collection read, after which downstream projections operate on that collected
state. In particular, Readiness builds its graph and scan from one snapshot,
and BOM builds its graph, scan, Readiness evidence, policy inventory, and
diagnostics from one snapshot. This prevents one command result from combining
independently recollected repository states.

`collectRepositoryEvidence` is a narrower compatibility projection for
consumers such as catalog and graph. It deliberately omits parsed documents,
sets, maps, and indexes that are implementation details.

## Declared Composition Is Pure Catalog Analysis

`src/declared-composition.ts` accepts the existing normalized `Catalog` and a
root stable ID or source path. It does not scan files, read the filesystem,
render CLI output, fetch external sources, or build a second repository model.
Graph command orchestration collects repository evidence once and passes that
catalog to the resolver.

The public one-off wrapper prepares a `DeclaredCompositionIndex` and resolves
one root. Scan prepares that forward-only index once and reuses its asset-ID,
normalized-path, sorted-asset, and dependency-by-source lookups for every root.
Per-root member and governance projections are built from reached IDs, so
disconnected assets are not rescanned for each closure.

Scan resolves roots incrementally and immediately aggregates only compact SCC
classification and Skill conflict findings. It retains at most one complete
root report instead of materializing every root's asset lists, provenance
closure, governance findings, resolution issues, and mismatches at once.

Traversal state is `(asset ID, membership)` where membership is required or
optional. Both states may be processed once for the same ID so required and
optional provenance remains complete; final member classification gives
required membership precedence. Expansion is limited to the retained metadata
declaration forms for Context, Lens, and `applies_to` composition.

The resolver stores declaration predecessor edges, not all possible paths.
Line evidence and declaration indexes distinguish repeated declarations.
Strongly connected components operate on those finite edges, and conflict
analysis normalizes unordered ID pairs. Scan aggregation preserves each root's
required or optional SCC classification and promotes the diagnostic to
required when any root requires that SCC. Scan rules and the composition graph
view call the same resolver; renderers do not re-resolve composition or infer a
cycle path from sorted SCC members.

The graph report adds a composition section only for `--view composition`.
Existing graph views keep their meanings. JSON preserves all predecessor edge
data, while Markdown and Mermaid are bounded review projections over the same
report.

## Declared Impact Uses An Impact-Specific Index

`src/declared-impact.ts` is pure catalog analysis over `DeclaredImpactIndex`,
which extends the unchanged forward `DeclaredCompositionIndex` with
`incomingByTargetId`. `prepareDeclaredImpactIndex` first prepares the shared
forward lookups, then builds incoming buckets once from resolved explicit
composition declarations. Each entry retains source and target assets, raw
dependency, normalized relationship, declaration form and index, source path,
line evidence, and any source- or target-kind mismatch. Unresolved declarations
are absent because Renma has no evidence assigning them to a focused target.

Incoming bucket accumulation is linear, followed by deterministic per-bucket
sorting. Their exposed map and arrays are read-only. This avoids the previous
quadratic bucket-copying behavior for high-fan-in shared Contexts. Forward
composition and scan never prepare these buckets.

Impact traversal starts the focus in required state and follows incoming valid
declarations. State is `(asset ID, membership)`, so cycles terminate and each
declaration transition is retained at most once for each resulting membership.
An optional declaration turns that route optional upstream; an already optional
route stays optional through required declarations and Lens `applies_to`.
Required final classification dominates optional classification without
discarding optional edge provenance.

The resolver stores original-direction declaration edges, not reverse arrows or
complete paths. Work and storage are proportional to the reverse reachable
subgraph and its declarations. Invalid incoming declarations are returned for
review but do not expand traversal. Required and optional Skill subsets are
materialized in the report so callers need not reconstruct them by filtering
all dependents.

The graph command collects repository evidence once, then prepares the index
required by the selected view: forward-only for composition and impact-specific
for impact. `--view impact` adds an `impact` report only, and its node and edge
lists are the focus plus valid dependents and retained valid declarations. JSON
is complete; Markdown and Mermaid are review projections and do not infer
runtime use, breakage, path ranking, or semantic importance.

## Structural And Repository-Backed Resolution

Resolution stages answer different questions and must remain separate.

### Repository boundary

`repositoryClassificationPath` determines whether a target can be expressed
relative to one safe repository root. Evidence is considered in this order:

1. an explicit repository root;
2. the nearest valid `.git`, `renma.config.json`, or `.renma.json` marker;
3. an unambiguous strong structural boundary such as `skills`, `.agents`,
   `contexts`, `context`, `lenses`, or `tools`, plus recognized root files such
   as `AGENTS.md`;
4. an unresolved or ambiguous result.

Current-working-directory containment is not proof of a repository boundary.
Renma may be invoked from a parent workspace, and a target may be absolute or
belong to a neighboring repository. Traversal outside an explicit root is
rejected instead of being normalized into that root.

The names `profiles`, `references`, `examples`, `scripts`, and `assets` are
negative guard evidence only. They can make a later structural interpretation
ambiguous, but they never establish a repository root by themselves. Once an
outer strong boundary has a recognized interpretation, nested boundary-like
names do not replace it.

### Structural classification

`classifyAssetPath` consumes only a normalized repository-relative path and,
where relevant, parsed metadata type. It produces path interpretation such as
`kind`, `scope`, `matchedRule`, `reasonCode`, `recognizedRoot`, competing rules,
ignored nested segments, and a possible parent-Skill path.

For Skill-local support, structural placement yields
`parentResolution: "structural-candidate"`. This means only that the path has a
canonical Skill-local shape. It does not prove that the candidate file exists,
is unique, owns the support file, or supplies policy.

### Repository-backed enrichment

`buildSkillParentIndex` records all discovered Skill entrypoint candidates by
logical Skill directory. `resolveSkillSupportParent` then returns `resolved`
only when exactly one candidate exists; zero candidates are `missing`, and
multiple candidates are `ambiguous`. `withResolvedSkillParent` attaches that
result without changing the original structural kind or scope.

Snapshot construction creates this parent index before catalog construction and
passes the same instance into `buildCatalog`. Catalog ownership, target parent
resolution, and governance enrichment therefore share one snapshot-scoped
source rather than reconstructing equivalent indexes independently. The public
`buildCatalog(documents, repositoryPaths)` call remains compatible and creates
an index for standalone callers.

Ownership, policy, catalog membership, and relationships also require
repository evidence. None of them may be manufactured from path shape alone.

## Shared Target Evidence

`inspect` and `suggest-metadata` share the target-evidence pipeline in
`src/evidence/target.ts`:

- `collectTargetDocumentEvidence` reads one target, resolves its repository
  boundary, parses it, and builds structural classification evidence.
- `collectTargetRepositoryEvidence` collects the resolved repository snapshot
  and enriches the target with catalog membership, parent resolution, policy,
  and governance evidence.

The two stages remain separate because a readable file does not guarantee a
resolvable repository. When repository collection is unavailable, the target
retains structural evidence but does not fall back to guessed catalog identity,
parentage, ownership, or policy.

Unavailable evidence preserves the exact boundary result:
`repository-boundary-unresolved` and `repository-boundary-ambiguous` remain
distinct, while a failure after a root resolves is `snapshot-unavailable`.

## Classification, Governance, And Decisions

These evidence layers are related, but none is a substitute for another.

| Layer | Answers | Does not prove |
| --- | --- | --- |
| Classification | What repository path rule matched, what kind and scope result, and whether a structural or resolved parent is known | Ownership, policy, authority, or human intent |
| Governance | Whether ownership and policy are declared, inherited, or missing, including provenance | That a proposed edit is applicable |
| Decision | Whether a command result is deterministic, requires confirmation, is blocked, or recommends no change | A different path classification or permission to discard evidence |

Ownership is explicit governance evidence. A declared local owner remains
declared. A Skill-local file may inherit an effective owner only from exactly
one resolved parent Skill that declares an owner. Missing or ambiguous parents
remain unowned. Renma never derives ownership from directory names, prose, Git
authors, or modification history.

Policy provenance is tracked separately from ownership provenance. A local
policy must not be relabeled as inherited, and an absent effective policy stays
missing. Likewise, Renma does not infer that local support should be promoted,
that an independent asset should be created, or that a maintainer intended an
owner or lifecycle value. Those are human repository-design decisions.

## Decisions, Renderers, And Commands

Decision construction belongs in `src/decisions/`. A decision object carries
the authoritative `decisionStatus`, stable reason code, summary, and any
remaining human question. Candidate construction must honor that status before
anything is presented as an applicable edit.

Metadata suggestion uses pure builders in
`src/decisions/metadata-suggestion.ts` for Skill migrations, Skill-local parent
and governance states, unsupported targets, owner conflicts, and independent
metadata candidates. The command retains filesystem collision checks,
candidate assembly, next-action construction, and orchestration.

Renderers in `src/renderers/` turn an already-decided result into human text.
They may improve wording and layout, but they must not rediscover a parent,
infer governance, change applicability, or create candidate data. JSON output
serializes the command result directly; it is not reconstructed from rendered
text.

Command modules should stay orchestration-oriented:

```text
collect context -> build evidence -> decide -> render or serialize
```

`guide` is intentionally outside the repository-evidence pipeline because it
must work without a repository. `src/guidance/skill-authoring.ts` owns one typed
rule object, `src/renderers/guide.ts` projects that object as prompt or JSON, and
`src/commands/guide.ts` only selects the projection and writes stdout. Scaffold
may reuse small exported authoring invariants, but must not duplicate the full
guide. The guidance source may import canonical metadata definitions; metadata
and renderers must not import command modules.

The 0.19.1 follow-up adds one `interaction` object to that same guidance source.
It owns only normative opening, phase, truth-source, epistemic, unknown-scope,
progression, disposition, question, gate, validation, persistence, and handoff
rules. In 0.19.2, `illustrationRules` and the ordered top-level `illustrations`
array are structurally separate. The previous interaction example fields and
special top-level API object have no aliases because this additive projection
has no independently versioned schema.

Illustrations share one `SkillAuthoringIllustration` type and demonstrate
authoring tensions rather than Skill categories. They may be ignored or used
partially; no selector, similarity matcher, request classifier, or closest-example
instruction exists. The prompt renders all protocol and illustration-usage rules
before the non-normative collection. JSON serializes the same source directly.
Future illustrations can be added without modifying the normative interaction
contract.

In 0.20.0, `externalTraversalRules` is another top-level normative collection,
rendered after metadata rules and before illustration usage. It is conditional
on recursive discovery inside external sources. It defines what an authored
Skill and its consuming runtime must specify; it neither authorizes nor causes
Renma to fetch, normalize, identify, or crawl external sources. It adds no
illustration selector, traversal state metadata, hidden prompt package, or live
visited registry.

Prompt and JSON are intentionally different projections of that source. The
prompt renders each illustration's title, demonstrated tensions, notice,
request, and compact clarification. JSON also retains optional structure,
responsibility, source-reference, additional-review, verification, and
not-created-by-default fields. Renderer tests verify this focused projection;
they do not require every JSON string to appear in the prompt.

`interaction` is normative for truth qualification, question behavior, gate
entry and re-entry, finding classification, persistence, and semantic handoff.
The legacy `workflow` projection is only a short top-level summary, while
placement, artifact, metadata, and conciseness sections retain rules they
uniquely own. Renderers add headings and list formatting; they do not recreate
protocol decisions.

Epistemic and progression classifications are independent. Confirmed, Proposed,
and Unresolved describe support for a decision; Blocking, Reversible default,
and Deferred describe whether the consuming LLM may proceed. The interaction
contract requires the LLM to retain the complete blocker set while asking at
most three closely related questions per turn, then pass the gate only when no
Blocking decision remains. These are prompt instructions and JSON guidance, not
stored Renma workflow state.

Unknown scope and disposition remain separate from both axes. An authoring
decision defines repository structure or Skill behavior and may block the gate;
a runtime task unknown belongs to material the finished Skill processes and can
be reported as an evidence-backed finding. Ask now, Queue as blocker, Proceed
with reversible default, Defer, and Report as finding are temporary actions over
those items, not additional progression classes.

A runtime task unknown may block a later execution stage, but that task-instance
fact never enters the authoring creation-gate blocker set. The finished Skill
follows its authored ask, report, defer, or stop policy. Only uncertainty about
that handling policy or the asset boundary returns to authoring clarification.

Truth-source evidence remains outside Renma's runtime state. A consuming LLM
may use explicit user statements, clearly applicable supplied artifacts,
applicable and effective repository evidence, or successfully consulted
authoritative source content. Renma structural rules constrain placement but do
not establish domain truth. Authoring-time source access comes from the current
request, tools, and environment; future Skill policy is not retroactive
authorization.

Likewise, deterministic detection does not imply deterministic repair. The
protocol permits automatic correction only when evidence and Diagnostics v2
constraints uniquely determine a patch. Repeated-context evidence remains a
consolidation input requiring repository investigation and human review.

The interaction model is an instruction contract for the consuming LLM, not a
Renma state machine:

```text
renma guide skill -> deterministic protocol on stdout
consuming LLM     -> investigates evidence, proposes, asks, and edits
user              -> supplies domain and governance truth
Renma commands    -> provide deterministic rules and repository evidence
human             -> approves meaningful decisions
```

This remains an elaboration of `LLM proposes. Renma verifies. Human approves.`
If source review, semantic refinement, usage, or validation suggests a boundary
change, the consuming LLM records it as Proposed or Unresolved and re-enters the
creation gate. Renma stores no gate or conversation state.

No interaction state crosses the command boundary. `guide` does not accept task
text, ask questions, retain history, interpret answers, create files, call an
LLM, or repair assets. Confirmed / Proposed / Unresolved summaries remain
ephemeral conversation state and must not become new Renma metadata.
Progression summaries, queued blockers, reversible defaults, and Deferred items
are likewise ephemeral. So are unknown scopes, raw-gap themes, stage-dependent
dispositions, and runtime findings during authoring. They create no command
state, metadata field, or automatic Skill split.

A `no-change-recommended` decision is a successful result. It means Renma
completed the analysis and found no supported change. The command must not
manufacture metadata, a migration, or verification work merely to return an
edit-shaped response.

## Public JSON And Internal Working Types

Public machine-readable output is protected at the serialized command boundary.
Fields such as classification evidence, governance provenance,
`decisionStatus`, command invocation `command` and `args`, and established
diagnostic fields must remain compatible with 0.18.2.

Internal working types have a different role. `RepositorySnapshot`, parsed
documents, `ReadonlyMap` indexes, `ReadonlySet` repository paths, and
intermediate target-resolution unions exist to keep implementation states
explicit. They are not public JSON merely because they are TypeScript types.
They may be narrowed or reorganized when behavior-focused tests prove that the
serialized contract is unchanged.

Inspect renderer DTOs live in `src/evidence/inspect.ts`, so renderers do not
depend on command modules. `src/commands/inspect.ts` re-exports the established
types to preserve existing TypeScript deep imports.

Human-readable reasons and prompts may evolve unless a test intentionally
protects exact wording. Stable branching must use typed fields such as
`matchedRule`, `reasonCode`, `parentResolution`, ownership provenance, and
`decisionStatus`, not prose parsing.

## Intentional 0.18.2 Compatibility Seams

Two parallel-looking paths remain intentional in 0.19.x.

### Scan keeps structural parent evidence

The snapshot classification index used to annotate scan findings and
diagnostics is structural. A Skill-local scan detail may therefore retain
`parentResolution: "structural-candidate"`. Target-oriented commands such as
`inspect` and `suggest-metadata` enrich the same structural classification with
snapshot-backed `resolved`, `missing`, or `ambiguous` parent evidence.

Do not silently make scan annotations repository-enriched merely to make the
implementations look uniform. The distinction preserves the 0.18.2 public
diagnostic shape; changing it requires an explicit contract decision and
characterization tests.

### Blocked migrations retain partial diagnostic maps

A blocked Agent Skills migration may retain partial
`candidateAgentSkillsFields` and `candidateRenmaMetadata` maps. These fields are
diagnostic evidence retained for 0.18.2 JSON compatibility, not an applicable
patch.

`decisionStatus` is authoritative. A frontmatter migration is applicable only
when the decision is not blocked and `canonicalFrontmatter` is present.
Blocked results must not expose canonical frontmatter or renderer patch
instructions, and consumers must never treat the partial candidate maps as an
override of the gate.

## Fail-Closed Boundaries

The following constraints are safety and compatibility invariants:

- An unresolved or ambiguous repository boundary produces no guessed root,
  catalog identity, inherited governance, or executable repository action.
- Guard directory names are never positive repository-root evidence.
- Repository discovery does not follow symbolic links, and a symbolic-link
  marker does not establish a boundary.
- Structural Skill-local placement never establishes inheritance by itself.
- A missing or ambiguous parent supplies neither inherited ownership nor
  inherited policy.
- Explicit local governance is preserved as local governance.
- A blocked decision suppresses applicable candidate metadata and canonical
  frontmatter; renderers cannot reopen the decision.
- A no-change decision produces no synthetic work.

When one of these states looks inconvenient, preserve it and improve the
evidence presented to the maintainer. Do not replace uncertainty with a guess.

## Runtime Boundary

Renma analyzes declared repository state. It does not execute Skills, select a
Skill for a live task, assemble prompts, invoke Skill tools, observe model runs,
or collect runtime telemetry. Static instructions and policies are evidence
about repository content; they are not proof of runtime behavior.

Future runtime signals may be imported as a separate, explicitly versioned
evidence artifact linked to a repository snapshot or BOM. Signal production,
collection, storage, and Skill execution remain outside this architecture.

## Contributor Checklist

For an internal change:

1. Add or confirm a behavior-focused test for the 0.18.2 result.
2. Reuse the snapshot and shared resolution paths before adding another
   collector or index.
3. Keep structural facts, repository-backed governance, decisions, and
   rendering in their respective layers.
4. Verify stable JSON fields and fail-closed states, not only human text.
5. For Readiness or BOM changes, prove all derived sections use one snapshot.
6. Run targeted tests, type checking, linting, the full test suite, build, and
   package verification before release.
