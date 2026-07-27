# Renma Internal Architecture

This document describes the contributor architecture behind Renma's shared
immutable repository projections, authoring guidance, Declared Composition and
Declared Impact analysis, and Skill Discovery projections. It is implementation
guidance, not a public JSON schema. Public fields, classifications, diagnostics,
severities, exit behavior, and migration direction must not change as an
incidental effect of an internal refactor.

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
        +--> prepared Skill Discovery --> discovery graph + skill-index
        |                              \-> Readiness summary/checks
        +--> scan + graph -------------> Readiness --> BOM subset
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
current list contains the established `src/types.ts` facade re-export of the
composed scan result and snapshot construction's classification-index path.
The public deep-import type re-exports from `src/commands/inspect.ts` and
`src/commands/suggest-metadata.ts` are also listed and checked exactly rather
than allowing command modules to re-export arbitrary lower-layer contracts.

## Typed Catalog Diagnostic Identity

Metadata and catalog producers assign stable `DIAGNOSTIC_IDS` identities when
they create diagnostics. `src/catalog-findings.ts` owns the ordered definition
registry and diagnostic-to-Finding conversion; `scanner.ts` re-exports the
established conversion symbols while retaining scan orchestration.
`catalogDiagnosticFindings` selects its Finding definition only from typed
identity; human-readable messages remain evidence and presentation text and
must never control classification. The diagnostic-code list is derived from the
definition registry rather than maintained separately. Structured values that a
downstream rule needs belong in `details`, not in message parsing.

New internal identities attached to legacy catalog diagnostics are
non-enumerable. This lets scan classify them before serialization while
preserving the established JSON projection. Diagnostics that intentionally
remain catalog-only carry a typed internal disposition, and unknown diagnostics
use the generic fail-closed catalog Finding definition.

## Cohesive Type Ownership

`src/types.ts` is a compatibility facade for the established
`renma/dist/types.js` deep import. Internal modules do not use that facade; they
import the cohesive owner under `src/types/`:

- artifact and parsed metadata contracts remain low-level;
- classification, governance, decision, diagnostic, and configuration
  contracts each have one dependency-bounded owner;
- `ScanResult` lives in `src/types/scan-result.ts`, the only composed type module
  permitted to import Agent Skills, Context Lens, Security Policy Inventory, and
  Trust Graph result types.

The low-level type modules are in the `foundation` layer and cannot import
feature reports, renderers, or commands. The composed scan-result module is in
the `analysis` layer and must not become a dependency of parsing, repository,
or other foundation modules. Compatibility re-exports preserve established
TypeScript deep imports without making the facade an internal dependency hub.

## Security Command and Destination Analysis

Security command analysis is a deterministic, non-executing pipeline:

```text
Markdown/source eligibility
  -> one relevant logical command or line-local instruction
  -> exact structural guard evidence
  -> bounded shell/JavaScript recognition
  +-> npm-style dependency pinning
  +-> sensitive source and sink classification
  \-> existing destination analysis and normalization
  -> supported structured projection or conservative fallback
  -> existing policy diagnostics
```

`src/security-diagnostics.ts` owns Markdown eligibility, effective policy,
guard application, fallback selection, evidence projection, ordering,
deduplication, and conversion into the existing public Finding model. Its
private orchestration has explicit document preparation, policy-prelude,
physical-line, semantic-unit, policy-contradiction, and final projection
stages:

```text
artifact eligibility
  -> prepared policy, Markdown view, visible lines, and logical commands
  -> policy prelude
  -> physical-line detections
  -> semantic-unit detections
  -> policy contradictions
  -> deduplication and Finding projection
```

Document preparation resolves the parsed and effective policies once, creates
one `MarkdownSecurityView`, prepares one destination and security analysis for
each logical command, and indexes a normalized prose projection for every line
in each operational paragraph semantic unit. That private paragraph projection
retains each source line's normalized start and end offsets. It also prepares
the ordered paragraph list, disclosure-clause ranges, structural eligibility,
and each physical line's intersecting clause range once. Genuine soft wraps use
a space, while mdast `break` nodes preserve explicit Markdown hard breaks as
newlines and therefore as clause boundaries. The shared security-command
classifier evaluates action polarity only in clauses intersecting the current
line range, so an action before a soft-wrapped secret term remains negated
without allowing unrelated earlier clauses to guard later actions.

Paragraph-clause destination analysis is cached privately by the exact prepared
paragraph object plus its `clauseStart:clauseEnd` offsets. Repeated physical-line
checks over the same clause reuse that result; normalized text alone is never a
cache identity. Guard evidence and Finding evidence remain line-specific. The
projection never crosses paragraph, list-item, blockquote, heading,
thematic-break, hidden comment, or code boundaries, and it does not replace
physical-line or logical-command evidence or analysis input.

The private `src/security-body-policy/` classifier consumes those already
prepared clause ranges through one bounded statement-group layer:

```text
prepared paragraph or eligible fallback line
  -> statement groups with source ranges and separator classes
  -> predicate segments with explicit or inherited workflow subjects
  -> domain-local modality, scope, completeness, and pattern support
  -> private clause facts
  -> public contradiction evidence
```

Statement grouping recognizes only the existing workflow subject vocabulary and
a small coordination grammar. It carries the nearest explicit subject through
ordinary coordination, `but`, `yet`, `however`, `; however,`, bare semicolons,
and `then`. Consecutive predicate starts are classified as an explicit workflow
subject, a supported subjectless predicate, an explicit changed subject, a
conditional or subordinate prefix, or unsupported syntax. Supported
subjectless starts include copular and auxiliary or modal predicates plus a
curated ordinary-verb vocabulary; this keeps subject state through three or
more predicates without treating arbitrary words as verbs. The bounded `also`,
`still`, and `therefore` modifiers remain supported. Bare semicolons and `then`
deliberately use the strict 0.24.4 compatibility behavior. Sentence endings,
Markdown hard breaks, structural boundaries, explicit changed subjects,
conditional or subordinate prefixes, and unsupported syntax reset inheritance.
A subject is established from the grammatical statement segment before domain
facts exist, so a domain-free, local, specific, or cross-domain first predicate
cannot discard it.

Existing domain patterns may also produce a direct workflow-prefix
prohibition. Its subject-to-predicate bridge is classified as one bounded
sequence: optional colon or dash punctuation, short adverbial or modal
modifiers, and an optional relative or parenthetical modifier. Explicit changed
subjects, conditional or subordinate instructions, quoted or descriptive text,
and unsupported bridges are rejected. Local-step, specific source/target,
exception, and allowance language inside a bridge is preserved as a
qualification instead of being erased. In particular, `during deterministic
validation` and other bounded validation phases are local rather than
workflow-wide.

Every direct prohibited fact with apparent workflow scope is also evaluated
against one private statement-level proof class: standalone default, explicit
workflow subject, inherited workflow subject, explicit workflow qualifier, or
no workflow proof. Only the first four preserve workflow scope. A supported
domain pattern inside a changed-subject, conditional, descriptive, or
unsupported segment therefore cannot escape through the clause-facts default.

For each supported network, external-upload, or secret candidate in a predicate
segment, the classifier retains its local source range, explicit or inherited
subject range, proof-derived scope, domain, modality, supported-clause
completeness, and whether the existing domain grammar directly supported it.
One statement group may therefore produce multiple facts for the same domain
while every predicate keeps local scope, safeguard, source/target, remainder,
and evidence decisions. Base and third-person forms of the curated policy
verbs continue a proven subject; strong noun phrases followed by modal or
prohibition heads clear it before noun/verb homographs can inherit workflow
scope.
Only a complete `prohibited` fact with `workflow` scope can contradict an
enabled permissive policy for the same domain. `unknown`, `not-required`,
`local-safeguard`, local-step, specific-source, specific-target, and
unsupported-remainder states fail open by producing no contradiction. Facts
are computed once per statement group through the same analyzer for prepared
paragraphs and eligible fallback lines such as headings. Finding construction
maps normalized offsets back to bounded physical source lines without crossing
Markdown structure.

Clause-fact composition remains separate from lexical sharing.
`src/security-prose-vocabulary.ts` may supply exact terms used identically by
multiple detectors, but the body-policy module owns the semantic relationship
between domain, modality, scope, and completeness. It is not a public schema,
configuration surface, or general natural-language parser.

Compatibility tests freeze 116 exact bodies and public finding projections from
Renma 0.24.4 commit `9e72e1adddd588ea72cba1c3e06ed1d07de330d9`.
The test consumes those bodies directly; legacy code is not installed or run in
CI. Thirty-two frozen cases cover every requested pair across first predicate
kind and later scope, earlier and later domain, connector and layout, connector
and implicit or changed subject, and predicate count and middle-predicate
category. A deterministic current-only matrix additionally covers predicate
start classification, direct provenance, all scope-proof classes, composed and
qualified bridges, base and third-person middle verbs, changed subjects,
one-line and soft-wrap prose, heading fallback, domain order, and
deduplication. Compatibility means equality with the frozen corpus except for
named, exact-current-output allowlist entries covering intentional precision,
statement-group recovery, and bounded-evidence changes.

The physical-line stage keeps one lazy analysis accessor for a line outside a
logical command. It intentionally runs line-local checks on physical
continuation members while limiting destination, sensitive data, and upload
checks over the complete command to the logical-command start. Only
human-approval and command-risk guard history is mutable across physical lines;
the current line is evaluated before either history is updated, and blockquoted
prose cannot update them.
`MarkdownSecurityView.associatedGuardEvidence()` supplies exact source ranges
for the same instruction, same list item, preceding paragraph, and active
safety section without crossing unrelated headings, thematic breaks, sibling
items, code blocks, or quoted examples.

The internal `src/security-command/` analysis modules own bounded tokenization,
npm-style dependency pinning, sensitive-source classification, sink
classification, shared disclosure-action extraction and clause polarity,
no-disclosure guard matching, and the cohesive immutable command result. One
result is cached for each relevant line-local instruction. Each logical shell
command receives one result that reuses its existing `DestinationAnalysis`;
physical continuation members do not independently reanalyze that command.

The internal `src/security-destination/` modules continue to own the pure
destination stages. `analyzeDestinations` projects one input, classifies its
candidates once, masks candidate text once, and records network and upload
associations in one intermediate representation. Policy checks and command
sink classification derive their network and upload views from that result
instead of reclassifying raw text.

`src/security-prose-vocabulary.ts` owns only exact lexical sources shared by
multiple prose-oriented detectors. Each owning detector still controls regex
structure, distance bounds, flags, captures, operational association, and
evidence. Similar terms stay local when their semantics differ: command guards
retain their disclosure-action union and polarity subsets, the sensitive-data
classifier retains path and bounded data-flow grammar, and destination
association retains its structural target rules. Shared regexes are compiled
once at module initialization; no detector compiles patterns in a scan loop.

Authors should state whole-workflow prohibitions explicitly. Renma
intentionally does not infer a body-policy contradiction from ambiguous or
unsupported prose.

Lexical classification and operational intent are separate. An explicit
transport can carry network or upload intent even when its host cannot be
normalized; the IR records that as `not-evaluated` without exposing a new CLI
field or diagnostic. Source, command, and curl-transfer spans map back to the
original input so multiline evidence continues to use the existing finding
ranges and snippets.

Shell support remains intentionally bounded: simple quoting, exact npm, pnpm,
and yarn install forms, the `${NAME:?message}` fail-closed expansion, selected
sensitive-file readers, local output redirection, disclosure pipelines, and the
established curl destination behavior. JavaScript recognition distinguishes
`process.env` access from literal sensitive-file reads without an AST or
general data-flow claim. Unknown, ambiguous, or unsupported syntax selects the
conservative legacy rule path and cannot earn a local-only suppression.

Npm-style option projection distinguishes attached values from separated
values before and after the subcommand. Before the subcommand it recognizes
only pnpm `--filter`/`-F` and Yarn `--cwd`, including repeated filters; unknown,
missing, or ambiguous manager options select fallback. Reliable package
classifications remain available even when the cohesive result requires
fallback. Any unclassified non-option candidate also selects fallback.
Associated version guards are accepted only as exact executable fail-closed
statements earlier in the same bounded instruction; textual mentions and
ambiguous control flow are not execution evidence. Sink classification treats
standard descriptor devices as disclosure, `/dev/tcp` and `/dev/udp` as
network, and other unproven special devices as unknown. Disclosure negation is
attached to its bounded action clause rather than the whole input.

Renma does not execute or fully parse shell or JavaScript. Heredocs, command or
process substitution, subshell evaluation, functions, aliases, general
JavaScript/TypeScript data flow, and complete POSIX or Bash parsing remain
outside this analysis. Cross-command and cross-file taint, additional language
support, public source-to-sink evidence, configurable security suppressions,
subjective confidence scores, runtime enforcement, prompt construction, and
Context injection remain deferred.

The command IR, source and sink classifications, guard identity, support state,
and trace evidence are internal implementation details. Filesystem reachability
of their emitted modules does not make them public report fields. Scan,
Readiness, BOM, diff, CI, and other CLI JSON retain the established Finding
contracts and diagnostic IDs.

## RepositorySnapshot Is the Repository Evidence Source

`collectRepositorySnapshotCore` in `src/repository-evidence.ts` performs one
discovery pass and parses each discovered artifact once. Collection copies the
complete evidence graph into runtime-immutable values: the effective
configuration and its nested collections, every Artifact and ParsedDocument,
their nested arrays and metadata evidence, discovered paths, and discovery
diagnostics. Sets and Maps use protected read-only views because freezing a
native Set or Map object does not disable its mutator methods. Their mutable
backing collections are never exposed. No derived projection may rediscover
files or reread repository content.

An explicit projection store derives and memoizes these facts from that stable
input:

- catalog, catalog diagnostics, and the parent-Skill index;
- Agent Skills validation and the dependent Skill Discovery index;
- structural classification evidence;
- effective security-policy evidence;
- Context Lens summary and diagnostics.

Repository path existence states are captured before
`collectRepositorySnapshot` returns, using the catalog derived from the same
core. They remain eager because later filesystem mutation must not change a
partially prepared snapshot. Pure projections may remain lazy; repeated access
returns the same prepared object. Each prepared projection is itself copied
into a runtime-immutable graph before it becomes caller-visible, so mutating a
prepared catalog or validation result cannot affect a dependent projection.
The compatibility properties `core`, `config`, `artifacts`, and `documents`
reference the same immutable collected facts rather than mutable inputs.

Consumers explicitly prepare only what they need. Scan names its required
projections and includes Skill Discovery only when that diagnostic slice is
requested. `collectRepositoryEvidence`, the compatibility path used by
catalog, prepares only catalog and Context Lens and therefore does not validate
Agent Skills, build Skill Discovery, classify assets, collect security-policy
evidence, or capture command-only repository path states.

Direct Readiness builds graph and scan evidence plus its compact Skill
Discovery summary and checks from one `RepositorySnapshot`. Accessing
`skillDiscovery` prepares its catalog and Agent Skills dependencies at most
once and reuses the immutable index used by the Discovery graph and Skill
Index. An internal Discovery-free projection remains available to compatible
consumers; it omits that access without triggering another collection or parse.

BOM builds graph, scan, its intentionally Discovery-free Readiness subset,
policy inventory, and diagnostics from the same snapshot and core. Scan
constructs the inventory summary from the already prepared
`snapshot.securityPolicies` rows, so policy selection, parsing, profile
resolution, inheritance, and provenance preparation occur once for that
snapshot path. Semantic diff performs exactly one snapshot collection per ref,
derives graph and the Discovery-free Readiness subset from it, and builds
topology changes directly from the memoized Skill Discovery indexes. It does
not invoke another command, reconstruct Discovery, or recollect repository
facts.

CI calls `executeDiff()` once. It exposes the diff's Discovery projection at
top level, evaluates the two snapshot policy modes as
`skillDiscoveryPolicy`, and retains a compatibility-shaped nested diff. It
does not recollect, reload configuration, reconstruct Discovery, or run a
second comparison.

`determineCiReportStatus()` still receives only the compatible diff. The pure
`skill-discovery-ci-policy` module selects the stricter `off < warn` mode,
constructs compact stable-ID matches from the existing diff, and does not read
files, import commands, render Markdown, or mutate input. A separate pure
status helper composes `fail > warn > pass`; Discovery policy can only request
`WARN`, and `WARN` keeps exit `0`. Review-note construction appends one policy
note after preserving existing reasons. Cycles never create a match.

CI Markdown uses the shared presentation cap, while JSON retains the complete
diff and policy evaluation once each. Formatters accept reports that lack the
optional Discovery or policy projections and do not invent missing facts.
Likewise, the exported `buildDiffReport()` helper accepts minimal compatible
snapshots without prepared Discovery and supplies a stable neutral
compatibility object rather than inferring topology from unrelated fields.

Catalog and Agent Skills preparation occurs only where a consumer requires
those projections. A working-tree mutation after collection cannot influence a
later lazy projection, and caller attempts to mutate snapshot arrays, nested
objects, configuration, or path collections cannot change the projection
input. A new collection is required to observe different facts.

The Discovery diff projection is pure. Skill keys use normalized
repository-relative path plus ID; route-group keys use normalized source Skill
path plus normalized declared target; cycle keys use sorted maximal component
member IDs. Declaration indices, YAML order, source lines, traversal order,
resolved targets, diagnostics, and mutable index objects are not identities.
Duplicate declarations change one group's count, while operational resolution
or usability changes under the same key remain one changed route.

## CLI Commands Have One Registered Contract

`COMMAND_REGISTRY` in `src/cli.ts` is the command-level source of truth. Every
`CommandName` has exactly one registry entry that binds its positional bounds,
accepted option names, authoritative `CommandHelp` object, default output
format, command-specific parser/executor, and any expected filesystem-error
adapter. The registry is checked with `satisfies Record<CommandName,
CommandSpec>`, so adding help for a command without executor wiring is a type
error. Help rendering and option rejection use the same registered help
contract rather than independently maintained command lists.

The global `node:util` parser remains intentionally shared to preserve unknown
option behavior and short flags. Its option table is itself checked against
every `CliOptionName`; registration still controls which parsed options an
individual command accepts. An option therefore cannot leak into a command
merely because the global parser recognizes it.

Command-specific validation remains close to the executor whose defaults and
semantics it protects. Shared configuration-path projection and ordinary
expected-error rendering are centralized, while inspect and semantic-split
read errors remain explicit registry adapters. The dispatcher performs no
command-name branch chain: it validates and invokes the selected spec. It also
preserves synchronous command return timing for stdout-only commands and awaits
asynchronous executors before applying their expected-error adapters.

## Targeted Maintainability Guardrails

Catalog Markdown prepares dependency indexes once before rendering. Outbound
dependencies are bucketed by source asset ID, inbound dependencies are bucketed
by the ID of the resolved target, and target identity/path lookups retain the
first-match semantics of `resolveDependencyTarget`. Bucket order follows the
existing catalog dependency order, so rendering is byte-compatible while each
asset performs only two map lookups. Operation-count tests cover the index and
render passes without wall-clock assertions.

BOM prepares dependency, dependent, and exact-path diagnostic buckets after
the complete arrays reach their established stable order. Asset projection uses
map lookups into those buckets, so it does not repeatedly scan the complete
dependency or diagnostic arrays. Bucket accumulation preserves resolved and
unresolved semantics, duplicates, and array order.

ESLint uses both `tsconfig.json` and `tsconfig.test.json` for typed source and
test linting. `no-floating-promises`, `no-misused-promises`, and
`switch-exhaustiveness-check` are enforced. Calls registering tests with
`node:test` are narrowly marked as known-safe floating calls because the test
runner owns their returned promises. `no-unnecessary-condition` was evaluated
but is intentionally deferred: assertion-based narrowing in tests and
fail-closed defensive recovery in parsers and security analysis produce broad
false-positive noise, and adopting it now would require a large unrelated
rewrite. It should be reconsidered only with a scoped assertion/recovery policy,
not blanket inline suppressions.

Filesystem-backed tests can use `test/repository-fixture.ts` to create and
clean up isolated repositories, write config and arbitrary files, create
canonical Skills, Context Assets, and Context Lenses with governance and
dependency metadata, and initialize Git when ref-based behavior is under test.
Path normalization rejects absolute paths and traversal. Specialized parser
fixtures should remain explicit when direct source text is the clearer test
contract; fixture migration is intentionally incremental.

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

The `interaction` object owns normative opening, phase, truth-source,
epistemic, unknown-scope, progression, disposition, question, gate,
validation, persistence, and handoff rules. `illustrationRules` and the
ordered top-level `illustrations` array remain structurally separate. They have
no compatibility aliases because authoring guidance is an unversioned internal
projection rather than an independently versioned schema.

Illustrations share one `SkillAuthoringIllustration` type and demonstrate
authoring tensions rather than Skill categories. They may be ignored or used
partially; no selector, similarity matcher, request classifier, or closest-example
instruction exists. The prompt renders all protocol and illustration-usage
rules before the non-normative collection. JSON serializes the same source
directly. Illustration membership does not modify the normative interaction
contract.

`externalTraversalRules` is a top-level normative collection rendered after
metadata rules and before illustration usage. It applies only to recursive
discovery inside external sources. It defines what an authored Skill and its
consuming runtime must specify; it neither authorizes nor causes Renma to
fetch, normalize, identify, or crawl external sources. It adds no illustration
selector, traversal state metadata, hidden prompt package, or live visited
registry.

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
request, tools, and environment; finished-Skill policy is not retroactive
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
diagnostic fields must remain compatible with the established serialized
contract.

`formatJsonDocument` in `src/report.ts` owns only the common serialization form:
native `JSON.stringify` with two-space indentation followed by exactly one
newline. It does not sort or rewrite keys; deterministic field order remains the
responsibility of report construction. Formatters with preprocessing, custom
ordering, replacers, compact output, or different newline behavior remain
separate.

Internal working types have a different role. `RepositorySnapshot`, parsed
documents, `ReadonlyMap` indexes, `ReadonlySet` repository paths, and
intermediate target-resolution unions exist to keep implementation states
explicit. They are not public JSON merely because they are TypeScript types.
They may be narrowed or reorganized when behavior-focused tests prove that the
serialized contract is unchanged.

Inspect renderer DTOs live in `src/evidence/inspect.ts`, so renderers do not
depend on command modules. `src/commands/inspect.ts` and
`src/commands/suggest-metadata.ts` re-export established result types as
compatibility facades. `src/types.ts`,
`src/context-language-diagnostics.ts`, and the destination-analysis exports
from `src/security-diagnostics.ts` serve the same bounded purpose.

The package publishes `dist` without an exports map, but filesystem
reachability is not a promise that every emitted module is a stable deep
import. Only entrypoints explicitly documented or verified by package
compatibility tests are supported. Internal modules such as
`security-command/*` remain implementation details even when the package
layout makes them physically importable.

Human-readable reasons and prompts may evolve unless a test intentionally
protects exact wording. Stable branching must use typed fields such as
`matchedRule`, `reasonCode`, `parentResolution`, ownership provenance, and
`decisionStatus`, not prose parsing.

## Intentional Compatibility Seams

Two parallel-looking paths remain intentional.

### Scan keeps structural parent evidence

The snapshot classification index used to annotate scan findings and
diagnostics is structural. A Skill-local scan detail may therefore retain
`parentResolution: "structural-candidate"`. Target-oriented commands such as
`inspect` and `suggest-metadata` enrich the same structural classification with
snapshot-backed `resolved`, `missing`, or `ambiguous` parent evidence.

Do not silently make scan annotations repository-enriched merely to make the
implementations look uniform. The distinction preserves the established public
diagnostic shape; changing it requires an explicit contract decision and
characterization tests.

### Blocked migrations retain partial diagnostic maps

A blocked Agent Skills migration may retain partial
`candidateAgentSkillsFields` and `candidateRenmaMetadata` maps. These fields are
diagnostic evidence retained for compatibility with the established JSON
projection, not an applicable patch.

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

Runtime-produced evidence has no implicit place in repository analysis. Any
separately defined evidence contract must keep signal production, collection,
storage, and Skill execution outside this architecture.

## Contributor Checklist

For an internal change:

1. Add or confirm a behavior-focused test for the established
   compatibility-sensitive result.
2. Reuse the snapshot and shared resolution paths before adding another
   collector or index.
3. Keep structural facts, repository-backed governance, decisions, and
   rendering in their respective layers.
4. Verify stable JSON fields and fail-closed states, not only human text.
5. For Readiness or BOM changes, prove all derived sections use one snapshot
   and each required memoized projection is prepared at most once.
6. Run targeted tests, type checking, linting, the full test suite, build, and
   package verification before release.
