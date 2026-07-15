# Renma Internal Architecture

This document describes the 0.19.x maintainability architecture, including the
additive `guide` command and its unreleased interactive authoring protocol.
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
It owns the opening rule, progressive phases, truth-source and decision classes,
question rules, creation gate, post-validation actions, persistence rules,
platform-native Skill authoring guidance handoff, and minimal and Product A
clarification examples. The prompt renderer places this protocol immediately
after the central principle; JSON serializes the same object directly. This is
an additive projection, not a separately versioned schema.

`interaction` is normative for truth qualification, question behavior, gate
entry and re-entry, finding classification, persistence, and semantic handoff.
The legacy `workflow` projection is only a short top-level summary, while
placement, artifact, metadata, and conciseness sections retain rules they
uniquely own. Renderers add headings and list formatting; they do not recreate
protocol decisions.

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
