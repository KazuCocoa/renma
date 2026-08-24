# Renma Internal Architecture

This document describes the contributor architecture behind Renma's shared
immutable repository projections, authoring guidance, Declared Composition and
Declared Impact analysis, and Skill Discovery projections. It is implementation
guidance, not a public JSON schema. Public fields, classifications, diagnostics,
severities, exit behavior, and migration direction must not change as an
incidental effect of an internal refactor.

The high-level product boundary remains in
[Architecture](architecture.md).
Stable classification and decision fields are documented in the
[Diagnostics Reference](../diagnostics.md), and the versioned BOM contract is in
[Repository Context BOM](../repository-context-bom.md).

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

The dependency direction has no exceptions. Commands consume result types and
renderers from their lower-layer owners without re-exporting those internal
contracts from command modules.

## Repository-Required Metadata Policy

`src/metadata-definitions.ts` is the single vocabulary authority. A catalog
definition becomes eligible for `metadata.required` only through an explicit
stable `policyKey`, a scalar/list value kind, and both Skill and non-Skill
serialization mappings. Configuration validation and ordering consume the
derived required-metadata definition list; they do not infer spellings from
serializer output.

`src/metadata-policy.ts` runs during catalog construction with request-local
configuration. It evaluates declared source evidence before ownership
inheritance and emits at most one
`META-POLICY-REQUIRED-FIELD-MISSING` diagnostic per applicable asset/field.
Canonical Skill requirements use field-local `metadata.renma.*` evidence:
their envelope, mapping, exact required key, encoding, normalized value, and
field semantics must be valid and unambiguous. Independent Agent Skills errors
remain separately diagnosed but do not invalidate a correct required field.
Operational Skill metadata retains its existing whole-Skill validity gate, so
this policy-only check cannot populate catalog, ownership, or security state.
Non-Skills use the registered top-level key. Binary, non-Markdown, config,
unknown, and non-catalog runtime surfaces never receive a requirement.

`src/metadata-policy-diff.ts` compares archived required-field sets in registry
order and retains endpoint configuration provenance. The separate
`src/metadata-policy-ci-policy.ts` evaluator counts additions and removals
independently, matches removals and CI-mode weakening with stable IDs, and uses
the stricter archived endpoint mode. `diff` and `ci-report` only add the new
policy projection when there is transition evidence, preserving unconfigured
public output. Finding details are retained in semantic diff only for this
policy diagnostic, and its active and suppressed semantic identities include
the registry-ordered required field plus expected serialization key. Separate
fields on one asset therefore remain distinct while unrelated finding identity
is unchanged; vanished findings remain attributable to their exact field,
asset, serialization key, and source configuration.

## Typed Catalog Diagnostic Identity

Metadata and catalog producers assign stable `DIAGNOSTIC_IDS` identities when
they create diagnostics. `src/catalog-findings.ts` owns the ordered definition
registry and diagnostic-to-Finding conversion; `scanner.ts` consumes that
conversion only for scan orchestration.
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

`src/public-types.ts` is the intentionally narrow facade behind the semantic
`renma/types` export. Internal code and tests import the cohesive owner under
`src/types/` directly; there is no parallel internal type barrel:

- artifact, parsed metadata, normalized configuration, decision, governance,
  and the producerless core scan model remain low-level internal contracts;
- classification, governance, decision, diagnostic, and configuration
  contracts each have one dependency-bounded owner;
- `ScanResult` lives in `src/types/scan-result.ts`, the only composed type module
  permitted to import Agent Skills, Context Lens, Executable Surface Inventory,
  Security Policy Inventory, and Trust Graph result types. The public
  `ScanJsonDocument` explicitly lists the top-level `renma.scan.v2` wire fields,
  and `toScanJsonDocument()` projects only those fields with literal
  `format: "json"`. Internal `ScanResult` additions therefore do not become
  public JSON additions implicitly. `ScanResult.diagnostics` is the canonical
  normalized collection used by that serializer. Producer-level discovery and
  parsing diagnostics remain internal as `rawDiagnostics` for strict policy,
  Readiness/BOM/diff inputs, and text rendering. Their normalization and review
  bundle projection are owned by `src/scan-diagnostics.ts`.

The low-level type modules are in the `foundation` layer and cannot import
feature reports, renderers, or commands. The composed scan-result module is in
the `analysis` layer and must not become a dependency of parsing, repository,
or other foundation modules. Focused semantic type exports exist only for
classification, diagnostics, and the scan JSON wire document. They preserve
cohesive consumer imports without turning low-level parser or runtime models
into 1.x commitments.

`scripts/verify-public-api.mjs` uses the TypeScript compiler API to normalize
the complete Renma-owned declaration graph reachable from every supported
package entrypoint. The checked-in snapshot maps each exported name to its root
declaration, follows referenced declarations with cycle detection, and freezes
signatures, interface properties, optionality, readonly modifiers, aliases,
literal unions, tuples, and the exact entrypoint set. TypeScript default-library
declarations, Node declarations, dependency declarations, and any other
declaration outside Renma's built `dist/` tree are treated as external and are
not recursively expanded. Internal modules remain outside the package exports
map, while any internal declaration that contributes to an effective public
shape is intentionally included in the snapshot.

Classification rule and reason-code wire values are intentionally open. Public
`AssetClassificationRule` and `AssetClassificationReasonCode` accept
unfamiliar strings so consumers can retain them and fail closed. Renma's
implementation uses the separate closed `KnownAssetClassification*` helpers,
so adding wire tolerance does not weaken internal classifier exhaustiveness.
The closed `KnownAssetClassificationEvidence` and
`KnownAssetCompetingRuleEvidence` shapes live in an implementation-only module;
supported package entrypoints expose only the open evidence contracts.

## Typed Finding Repair Authority

Finding producers author `RepairConstraint[]` and `VerificationStep[]`
semantics explicitly. `projectFindingRepairGuidance()` is the one compatibility
boundary that generates legacy `constraints` and `verificationSteps` arrays
from the typed objects' `text` fields. The canonical typed values remain
available internally for Diagnostics v2 even though legacy-only Finding
producers are rejected.

`createScanDiagnostics()` never classifies a constraint from English verbs and
never discovers commands from sentence prefixes. It consumes only the typed
guidance, adds the established code-specific typed guardrails, and applies
typed defaults only when a producer supplied no verification steps. Prose may
therefore improve without changing machine semantics.

`src/commands/public-json-schema-versions.ts` inventories stable and
experimental public top-level JSON identifiers by referencing their existing
owners. Its documentation synchronization test keeps the inventory aligned
with `docs/machine-readable-json.md` without changing command dependency
direction or promoting nested and experimental contracts.

## Security Command and Destination Analysis

Security command analysis is a deterministic, non-executing pipeline:

```text
already-discovered Artifact.content
  -> raw hidden-Unicode findings
  -> Markdown/source eligibility
  -> one relevant logical command or line-local instruction
  -> exact structural guard evidence
  -> bounded shell/JavaScript recognition
  +-> ecosystem-specific dependency command and selector classification
  +-> sensitive source and sink classification
  \-> existing destination analysis and normalization
  -> supported structured projection or conservative fallback
  -> existing policy diagnostics
```

`src/unicode-primitives.ts` owns the dependency-free Unicode vocabulary shared
by security consumers: reviewed code-point ranges and boundary values, closed
range membership, and `U+...` formatting. It has no findings, policy metadata,
artifact types, or authority decisions. `src/hidden-unicode.ts` owns the
isolated, context-sensitive raw-source check. It accepts one already-classified
`Artifact`, returns no findings for binary content, and inspects text without
Markdown parsing, visibility projection, normalization, or command analysis.
Its high-signal rules remain narrower than the shared vocabulary so legitimate
multilingual, emoji, and formatting use does not become an unconditional
finding. `analyzeSecurityDiagnostics()` appends those raw findings before
entering the eligible semantic pipeline and derives
`renma.security-analysis-coverage.v1` from the same prepared analysis objects.
The established `securityDiagnosticFindings()` API remains a findings-only
projection of that pass. Discovery scope, artifact classification,
suppression, Diagnostics v2, review bundles, ordering, and reporting remain
owned by their existing layers.

`src/static-support.ts` derives both the bounded non-Markdown eligibility map
and the repository-evidence expectation graph. Both projections reuse
`staticSupportReferences()` and the same minimum-depth reachability algorithm,
require exactly one owning Skill, and traverse a support edge only when its
source is a ParsedDocument. The expectation graph may therefore name an
unparsed target proven by a parsed source, but it never guesses references
behind that target. `src/inspection-coverage.ts` joins those expectations to
canonical repository path states and emits exact blocking evidence with source
provenance. Parsed-to-blocked support transitions consequently use the existing
inspection-coverage diff and strict-scan paths.

For Markdown sources, `staticSupportReferences()` consumes positioned resolved
targets from the primary `MarkdownSyntax` parse. The same evidence supplies
inline and reference-style target identity, while parser-recognized unresolved
uses and definition ranges are masked from the remaining basename and explicit
path grammar. Definition nodes therefore never create support edges on their
own. Non-Markdown plain text retains the bounded explicit-path and basename
grammar; it does not gain a local Markdown parser.

The security eligibility projection selects only discovered UTF-8 `.txt`
support outside `scripts/`. Security orchestration consumes that map without
reparsing references. Eligible plain-text support is prepared with body line
1, no local metadata, no policy authority, and the existing
false-positive-aware structural instruction projection. The same prepared
object drives findings and `semanticInstructions: "analyzed"`; unreachable
`.txt`, structured text, source code, executables, and binary support never
receive a prepared semantic analysis through this path. An expected target
that was not parsed remains inspection evidence only and never gains a
synthetic `renma.security-analysis-coverage.v1` artifact row.

`src/frontmatter-envelope.ts` owns the shared YAML marker, one-leading-BOM
operation, and the intentionally distinct opener and closer predicates. Agent
Skills retain their established surrounding-whitespace and column-zero closer
rules; non-Skill Renma frontmatter retains its exact marker rules after one
optional absolute leading encoding BOM. Parser consumers select one of those
contracts instead of spelling delimiters independently. Security integrity
checks may compare an invalid opener projection with the same contract only to
produce fail-closed evidence; projected delimiters, contents, and values never
gain parser or policy authority.

`src/yaml-frontmatter.ts` owns YAML-comment extraction eligibility as well as
the extracted comment surfaces. `parseAgentSkillFrontmatter()` retains Agent
Skills envelope semantics, while eligible non-Skill Markdown—including
`unknown` Markdown with an exact recognized envelope—supplies the existing
Renma delimiter contract to the same parser-owned extraction without gaining
new metadata or policy authority from comment eligibility. Its
`commentsAnalyzable` evidence is true only after
both semantic YAML parsing and CST token extraction complete without errors.
Security coverage consumes that exact extraction state directly, so zero
comments can mean `analyzed` only when the extractor actually ran
successfully.

`src/security-identifier-integrity.ts` composes the broader reviewed removal
vocabulary from those shared primitives and owns its authority semantics.
Policy resolution compares parser-owned keys and artifact-selected opener
syntax only against exact trusted spellings after that bounded projection. A
matching corrupted opener or canonical `metadata` container produces invalid
declaration evidence for every potentially hidden security field, but the
projected delimiter, container, contents, and values never gain authority or
normalization-based recovery.

`src/security-diagnostics.ts` owns semantic-surface eligibility, effective
policy, guard application, fallback selection, evidence projection, ordering,
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

The private `src/security-body-policy/` classifier consumes prepared clause
ranges through an explicitly layered, bounded pipeline:

```text
lexical recognition
  -> bounded source components and enclosure ranges
  -> statement-group segmentation
  -> statement-state transitions
  -> predicate semantic classification
  -> domain-local facts
  -> evidence projection and deduplication
  -> public contradiction findings
```

`model.ts` owns the internal vocabulary shared by those layers: physical source
and evidence ranges, enclosure provenance, statement boundaries, workflow
subjects, policy context, predicate-start classification, subject
relationships, domains, modalities, scopes, completeness, and pattern
provenance. These contracts remain private implementation details rather than a
public schema or configuration surface.

`lexical-recognition.ts` owns the bounded regular expressions and produces
lexical candidates, evidence ranges, and modal-negation syntax. A lexical match
does not imply a fact or finding. `policy-context.ts` separately recognizes the
bounded directive and policy-label prefixes that may establish policy context;
that context never creates a grammatical workflow subject.
`clause-facts.ts` assigns modal meaning, proves workflow scope, classifies
local-step or specific source/target scope, checks supported completeness, and
decides final fact eligibility. Modal-negation syntax therefore stays separate
from deontic, commitment, recommendation, capability, epistemic, hypothetical,
permission, and availability semantics.

`statement-components.ts` owns physical source components, straight and curly
quote enclosures, ordinary and contrastive separator classes, predicate
segmentation, paired relative components, and statement groups. Enclosed
predicates cannot inherit or establish workflow proof. Opaque quoted spans
preserve outer state for an unquoted continuation after the closing delimiter,
while unquoted sentence endings, Markdown hard breaks and structural
boundaries remain hard boundaries. Ordinary Markdown soft wraps continue to be
prepared as logical prose before this layer; physical projection is preserved
for final evidence.

`statement-state.ts` is the single owner of subject and policy-context
retention. Its deterministic transition takes the previous state plus the
classified segment boundary, enclosure, predicate start, explicit subject, and
explicit policy context. It reports the resulting state, the subject and
context available to the segment, and explicit retention or clearing reasons.
Explicit subjects replace inherited subjects. Supported subjectless predicates
may inherit across the existing ordinary or contrastive connectors. Explicit
policy context can apply without a subject. Changed subjects, conditional or
subordinate starts, unsupported syntax, and hard boundaries clear the
applicable state. Opaque quoted components receive no inherited proof and do
not mutate the outer state.

Paired relatives are normal bounded sub-analyses. A subject-relative component
inherits the outer workflow subject and policy context and reuses the same
statement-group analyzer inside the comma range. An object-relative component
has an explicit changed subject and receives no inherited workflow proof.
Unsupported relatives do not inherit. For supported subject- or object-relative
forms, the main predicate after the closing comma resumes the outer subject and
policy context. Candidate recognition and evidence ends are clipped to the
relative or main component so no candidate crosses that boundary.

Direct and inherited facts share the same domain-local semantic classifier.
Inherited subject projection synthesizes only the bounded subject-plus-predicate
input required by the existing grammar, then projects the classified evidence
back to physical source offsets. Candidate-local evidence belongs to the
semantic classifier; subject and policy-prefix evidence origins belong to
statement state; relative evidence belongs to its bounded sub-analysis; and
physical line/snippet projection remains owned by
`src/security-diagnostics.ts`. `fact-projection.ts` alone owns exact fact
identity, deduplication, and deterministic source/domain ordering. Evidence
ranges remain ordered, non-negative, reproducible, and within their source.

Only a complete `prohibited` fact with proven `workflow` scope can contradict
an enabled permissive policy in the same network, upload, or secrets domain.
Unknown modality, not-required language, local safeguards, local-step scope,
specific sources or targets, unsupported remainders, changed subjects,
conditional syntax, quoted examples, and unsupported grammar continue to fail
open. The refactor does not add vocabulary, grammar, domains, diagnostics, or a
general natural-language parser.

Compatibility remains projection-first. The immutable test fixture freezes 241
exact bodies and public finding projections from Renma 0.24.4 commit
`9e72e1adddd588ea72cba1c3e06ed1d07de330d9`. Exact intentional differences
remain named in the allowlist, every entry must still differ from its legacy
projection, and orphaned entries fail the suite. Current-only matrices preserve
predicate starts, proof classes, prefixes, separators, enclosures, relative
relationships, modal forms, layouts, evidence, domain order, and
deduplication. Focused deterministic fast-check properties use a fixed seed for
range safety, no-throw handling, determinism, deduplication idempotence,
ordering, enclosure safety, relative-component containment, and ordinary
soft-wrap equivalence after physical evidence projection.

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

The low-level `src/dependency-selectors.ts` module owns pure npm registry and
bounded PEP 440/508-inspired selector classification, a raw-evidence-preserving
Python specifier normalization layer, and normalized floating-allowance keys.
The internal `src/security-command/` analysis modules separately own bounded
npm-family and pip-style command recognition, pre-subcommand pip general
options, post-subcommand option arity, and
indirect-file projection, fail-closed variable guards, allowance governance,
tokenization, sensitive-source classification, sink classification, shared
disclosure-action extraction and clause polarity, no-disclosure guard matching,
and the cohesive immutable command result. Selector classification is computed
before governance, so an allowed floating selector is never reclassified as
pinned. One result is cached for each relevant line-local instruction. Each
logical shell command receives one result that reuses its existing
`DestinationAnalysis`; physical continuation members do not independently
reanalyze that command.

`src/security-command/shell-command.ts` owns the shared shell-wrapper
resolution state. Execution is a three-way disposition—`proven`,
`not-executed`, or `unknown`—so an explicitly inert lookup/help mode is not
conflated with an unrecognized option that may still execute. Direct command
risk uses conservative fallback for `unknown`.

Renma analyzes directly expressed shell operations. It does not reconstruct
command text written to a file and later executed as a generated script.
Indirect execution through generated files requires human review or a
dedicated shell-analysis tool.

Deeper indirect shell analysis, if pursued, is separate future work using a
mature shell parser/AST or dedicated analysis engine, preferably through an
optional or experimental analyzer, plugin, package, or external-tool adapter.
That investigation must define supported dialects and versions—including POSIX
shell versus Bash, dash, zsh, fish, and other implementations—source-range
fidelity back to the original Markdown, parser maintenance and licensing,
heredocs, compound commands, functions, substitutions, and redirections,
resource and recursion limits, false-positive and false-negative behavior, and
separate diagnostic confidence and compatibility contracts.

`SEC-UNPINNED-DEPENDENCY-INSTALL` also retains its older bounded line-level
fallback for Homebrew formula installs and Docker image pull/run commands.
Structured npm/PyPI analysis suppresses that fallback only when the structured
result is authoritative; unsupported or unrecognized forms remain
conservative. Floating allowances are asset-local npm/PyPI governance.
Security Policy Inventory exposes their local declaration evidence, while
effective policy, profile/repository resolution, provenance, fingerprints,
owning-Skill inheritance, and existing inventory counts intentionally omit
them.

The internal `src/security-destination/` modules continue to own the pure
destination stages. `analyzeDestinations` projects one input, classifies its
candidates once, masks candidate text once, and records network and upload
associations in one intermediate representation. Policy checks and command
sink classification derive their network and upload views from that result
instead of reclassifying raw text.

When the primary Markdown parse resolves a link or reference target,
`MarkdownSecurityView` maps that positioned target into the governing line or
paragraph clause. Destination classification uses the parsed target identity
while action association masks the original Markdown use span, so evidence
remains the original source rather than synthetic Markdown. The parser-visible
label text is classified separately by the established destination grammar: a
distinct destination-shaped label is additive evidence, while an identical
normalized label/target pair is deduplicated before association. Definition
lines are non-operational and unresolved references supply no target.

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

Effective rule configuration is snapshot-scoped. `loadConfig` normalizes the
repository's optional snake-case Skill, Context, Reference, Profile, and Example
`quality.*_token_warning` / `quality.*_token_high` fields into complete
camel-case token policies, including independent default/configuration
provenance for every value. The shape rule consumes that snapshot value without
mutating `DEFAULT_QUALITY_PROFILE` or consulting process-global state. These
values do not enter `scan-boundary` identity because they change finding
evaluation, not the repository paths or bytes Renma can inspect. A valid
support-asset metadata override composes as an effective warning floor, while
the effective High threshold remains at least that floor. Override declaration
validity uses a stable compatibility baseline independent from current warning
defaults, so raising a default cannot invalidate an established decision.

An explicit projection store derives and memoizes these facts from that stable
input:

- catalog, catalog diagnostics, and the parent-Skill index;
- Agent Skills validation and the dependent Skill Discovery index;
- structural classification evidence;
- effective security-policy evidence;
- executable-surface evidence composed from artifacts, helper commands, support
  reachability, repository path states, and prepared security policies;
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
policy inventory, executable-surface inventory, and diagnostics from the same
snapshot and core. Scan
constructs the inventory summary from the already prepared
`snapshot.securityPolicies` rows, so policy selection, parsing, profile
resolution, inheritance, and provenance preparation occur once for that
snapshot path. Semantic diff performs exactly one snapshot collection per ref,
derives graph and the Discovery-free Readiness subset from it, and builds
topology changes directly from the memoized Skill Discovery indexes. It does
not invoke another command, reconstruct Discovery, or recollect repository
facts.

## Executable Surface Inventory

`src/executable-surface-inventory.ts` owns the composed
`renma.executable-surface-inventory.v1` result. It never reads or executes
source. It joins only one collected snapshot's artifacts, parsed Markdown,
immutable repository path states, parent-Skill index, and prepared
`SecurityPolicyAssetEvidence` rows. Dependency candidates are collected once
from the snapshot's already-read artifacts before repository path states are
prepared, then reused by scan, BOM, diff, and CI projections without rereading
source or rerunning an analyzer.

`src/executable-dependency-analyzer.ts` owns the private, fixed built-in
analyzer registry and the language-neutral candidate contract.
`src/executable-dependency-js-ts.ts`,
`src/executable-dependency-python.ts`,
`src/executable-dependency-shell.ts`,
`src/executable-dependency-powershell.ts`, and
`src/executable-dependency-batch.ts` are bounded lexical collectors.
`src/executable-dependency-resolution.ts` owns the single Renma repository
resolver. The analyzers interpret supplied text only; repository discovery,
exclusions, depth, size, symlink safety, path states, surface identity,
ordering, and graph construction remain Renma responsibilities.

The registry order is `js-ts`, `python`, `shell`, `powershell`, then `batch`.
It dynamically loads nothing, executes no subprocess, has no configuration or
package export, and is not a public plugin system. The boundary permits a
future external provider without coupling language syntax to inventory
construction, but provider discovery, installation, permissions, and version
negotiation are deliberately absent.

Dependency sources are only text surfaces already eligible for the inventory:
Skill-local scripts, repository-root tools, and non-canonical discovered or
statically invoked scripts. A parsed import target that is not one of those
surfaces resolves as `not-inventory`; it never creates a surface.

The JS/TS collector supports `.js`, `.mjs`, `.ts`, `.mts`, and `.cts` sources,
but not `.cjs`, `.jsx`, or `.tsx` sources. It recognizes string-literal ESM
imports and export-from declarations with explicit relative `.js`, `.mjs`,
`.cjs`, `.ts`, `.mts`, `.cts`, `.py`, `.sh`, or `.bash` targets. It skips
comments, unrelated strings, template literals, dynamic imports, CommonJS
`require`, `import.meta`, packages, absolute paths, query/fragment specifiers,
extensionless paths, declaration-level TypeScript type-only syntax, named
import or re-export clauses whose every specifier uses the inline
`type Binding` or `type Binding as Alias` form, and `import = require`. Mixed
type/runtime clauses, default imports, namespace imports, and bindings
literally named `type` remain runtime dependency evidence. Resolution is exact;
compiler substitution, indexes, aliases, package exports, and import maps are
not simulated.

The Python collector supports only `.py` sources and explicit relative
`from ... import ...` statements. A relative module yields its exact `.py` and
`/__init__.py` candidates; `from . import helper, parser` yields one candidate
set per imported module. Absolute imports, dynamic import helpers,
environment/package resolution, `PYTHONPATH`, and implicit `__init__.py` edges
are excluded. Multiple parsed candidates are `ambiguous`; one parsed candidate
is selected; repository escape is `unsafe`.

The shell collector supports only `.sh` and `.bash` sources. It recognizes a
static relative `.sh` or `.bash` command at the start of a physical line,
optionally launched immediately by `bash` or `sh`, or loaded immediately by
`source` or dot-source. Single- and double-quoted literals and repository-safe
`../` paths are accepted. Variables, substitutions, wrappers, options, aliases,
PATH resolution, absolute or external targets, general control flow, and other
shell semantics are excluded. A small lexical state machine suppresses lines
inside recognized heredoc bodies, multiline quoted literal regions, and
backslash-continued physical lines. Unsupported or dynamic heredoc delimiters
fail closed for the remainder of that source. Obvious `$(( ... ))` and
`(( ... ))` arithmetic regions have separate bounded state, preventing `<<` or
`>>` shifts from being interpreted as heredoc syntax or from hiding a later
supported dependency. Bash `<<<` here-string operators are consumed atomically
as non-heredoc tokens so their overlapping suffix cannot enter heredoc state;
the operand remains non-topological data. Repository escape remains `unsafe`
evidence and never becomes topology.

The PowerShell collector supports only `.ps1` sources and targets. At the
beginning of an eligible physical line it recognizes direct explicit relative
execution, the `&` call operator, dot-sourcing, and exact `pwsh` / `powershell`
`-File` forms, including their `.exe` spellings. Its only variable-like path
form is the `$PSScriptRoot` anchor, matched case-insensitively, followed by a
static suffix. Launcher names, `-File`, and `.ps1` extensions are also matched
case-insensitively. A bounded
lexical state suppresses line and nested block comments, here-strings,
multiline quoted data, and backtick-continued data lines. An encountered
PowerShell `data` statement makes the remainder opaque rather than introducing
brace semantics. Variables,
subexpressions, interpolation, wildcards, aliases, discovery commands,
`.psm1`, and `Import-Module` remain unsupported.

The batch collector supports only `.bat` and `.cmd` sources and targets. It
recognizes direct explicit relative execution, immediate `call`, exact
`cmd /c` or `cmd.exe /c`, and the sole `%~dp0` anchor followed by a static
suffix. CMD grammar tokens, the anchor modifier spelling, and `.bat` / `.cmd`
extensions are matched case-insensitively.
It suppresses `REM`, `::`, and caret-continued data lines. Arbitrary percent or
delayed expansion, labels, bare command names, generated command text, and
general CMD parsing remain unsupported. Both Windows collectors normalize
backslashes before the shared resolver, which preserves exact repository path
case and all existing boundary and symlink protections.

`src/helper-command-evidence.ts` owns the bounded helper grammar shared by
repository path candidate collection, existing path diagnostics, and the
inventory. The established `node`, `bash`, `sh`, `python`, and `python3`
behavior is unchanged. Explicit `pwsh -File`, `powershell -File`, `cmd /c`, and
`.exe` equivalents add Windows entrypoints without becoming generic option
parsers. PowerShell targets must end in `.ps1`; CMD targets must end in `.bat`
or `.cmd`. Windows launcher names, bounded switches, and these extensions are
matched case-insensitively. Captured path spelling remains exact; only
backslashes are normalized before the unchanged repository-root and
Skill-relative path rules.
The collector recognizes complete helper commands on fenced-code lines and one
additional mdast-bounded form: a single-line `inlineCode` node directly owned
by a paragraph whose preceding visible text, after whitespace normalization,
is exactly `Run` or `Run:`. Paragraphs may be top-level or nested in ordered or
unordered list items. A blockquote ancestor excludes the occurrence, as do
heading, link, emphasis, strong, and other non-paragraph direct parents.

Inline collection consumes `MarkdownSyntax` already attached by
`parseDocument()`. It traverses the retained node records once, converts mdast
positions through the shared body offset, and validates the cue structure
before deriving its text. Cue children may be text, emphasis or strong
containers composed only of allowed cue children, Markdown line breaks, or
HTML comments ignored consistently with shared Markdown text semantics. Links,
images, inline code, non-comment HTML, reference-like nodes, and every other
unsupported node reject the candidate, including when nested inside an allowed
container. Link labels and image alt text therefore cannot establish the
imperative cue. Collection does not scan raw lines for backticks, reparse normal
snapshot documents, or add inline-code projections to `ParsedDocument`.

Fenced and inline collectors both pass their complete command snippet through
one evidence constructor. Launcher matching, `helperScriptPath()`, owning-Skill
directory derivation, and `resolveHelperScriptPath()` therefore cannot diverge.
The module retains source lines and exact path states without becoming a
general shell or natural-language parser. Ordinary inline code is not
invocation evidence. Quoted examples are excluded because a blockquote may be
copied or external text; lowercase, other verbs, multilingual cues, secondary
code spans after a first span, chained commands, and alternatives are
intentional false negatives. Existing diagnostics use the same recognition
and resolution evidence but keep their established IDs, severity, remediation,
and behavior.

`src/static-support.ts` owns both exact support references and the minimum-depth
reachability projection. `SUPPORT-UNREACHABLE-SCRIPT` and deep-reference
diagnostics consume that projection, as does the inventory. No second
reachability graph is built.

Surface identity is the normalized repository path. Each row carries a
fingerprint over content identity, scope, interpreter hints, reachability,
reference and invocation counts, the surface's own policy evidence, and its
invocation-governance aggregate, plus incoming/outgoing resolved dependency
counts and static invocation reachability. Repository tools do not inherit
policy from their callers: surface policy remains evidence attached to or
inherited by the surface itself.

Every recognized syntactic declaration remains a dependency row with a stable
occurrence ordinal, including textually identical declarations on one source
line. An analyzer-private source offset preserves occurrence identity through
candidate preparation and resolution, then is discarded before public
inventory output. Only `resolved` and `noncanonical` rows contribute graph
topology, and one canonical edge is constructed for each unique source path
and normalized target regardless of analyzer, relation, line, raw specifier,
or occurrence.
Incoming/outgoing counts, adjacency, breadth-first reachability, and semantic
diff graph signatures all consume that same edge set. Breadth-first traversal
starts at directly invoked surfaces, assigns them depth `0`, assigns reachable
targets their deterministic minimum dependency depth, and terminates across
cycles. `direct` wins over `transitive`; an import from an unreached source
does not seed reachability. Existing `staticallyInvoked`, `invocationCount`,
`invokedSurfaces`, and `uninvokedSurfaces` retain their direct-only meanings.
Dependency reachability is repository visibility, not proof of runtime
execution or a claim that an uninvoked surface is unused.

Each recognized invocation separately correlates its exact source path and,
when structurally resolved, its owning Skill entrypoint with already prepared
`SecurityPolicyAssetEvidence` rows. These `source-artifact` and `owning-skill`
relationships remain distinct. The inventory does not reparse policy, merge
rows, apply precedence, or create a combined invocation policy. Multiple
effective-policy fingerprints are visibility about distinct contexts, not a
conflict or verdict. Invocation policy never propagates through dependency
edges.

Raw invocation rows retain source lines, while diff identity uses source path,
launcher, normalized or raw target, and occurrence ordinal so unrelated
preceding-line edits and fenced-to-inline presentation changes are not semantic
add/remove events. Invocation occurrences are deterministically ordered by
source path, line, launcher, target, and snippet. Source columns and syntax
origin are not public inventory fields. The invocation
governance fingerprint covers only owning-Skill resolution and normalized
policy relationships. It excludes line numbers, snippets, unrelated invocation
resolution, absolute paths, and time-dependent values.

The inventory is visibility evidence, not general language analysis, SAST, or
a safety verdict. The canonical diff remains observation-only; `ci-report` may
separately apply repository-configured policy to a bounded set of its
high-signal transitions. Findings,
diagnostics, Readiness, the Security Policy Inventory, and Trust Graph
intentionally do not consume dependency or invocation-governance relationships
in this slice. Executable dependency edges never become normal BOM Context
Asset dependencies or Trust Graph edges.

Default scan text derives a private review projection from the complete
inventory. Healthy state renders one compact summary; only established
resolution, scope, reachability, missing-evidence, or multiple-fingerprint
review conditions select bounded relevant rows. This projection never changes
scan JSON or BOM rendering. Diff separately records newly introduced
multi-fingerprint invocations, while CI renders their total delta and a bounded
neutral detail list without adding them to path-problem evidence.

Asset delta construction reads the canonical `contentHash` already present on
graph/catalog evidence. Hash comparison is symmetric and independent of node
discovery order. `contentChanged` is separate from governance
`changedFields`, and `summary.contentChangedAssets` is a neutral count; neither
field participates in CI status selection. Legacy formatter inputs without
content identity remain accepted and do not fabricate a content transition.
Per-asset `contentChanged` is omitted unless both endpoint hashes are present,
and the aggregate count is omitted unless every shared asset is comparable.

CI calls `executeDiff()` once. It exposes the diff's Discovery projection at
top level, evaluates the two snapshot policy modes as
`skillDiscoveryPolicy`, evaluates both snapshot `security.ci_policy` modes as
`securityPolicy`, evaluates both `scan_boundary.ci_policy` modes as
`scanBoundaryPolicy`, evaluates both `executable_surface.ci_policy` modes as
`executableSurfacePolicy`, evaluates both `quality.ci_policy` modes as
`qualityPolicy`, and retains a compatibility-shaped nested diff. The quality
diff compares all ten numeric warning/High thresholds. The evaluator separately
classifies the archived CI-mode transition and gates both threshold increases
and mode weakening using the stricter endpoint mode. Its additive
`modeTransition` and `numericThresholdChanges` evidence prevents a mode-only
relaxation from becoming a silent first stage; mode tightening remains visible
and non-blocking. Endpoint
snapshots remain revision-local for semantic configuration. For CI only, target
paths are collected once more through the independent union of both endpoint
coverage predicates; the target's semantic configuration is still used for
parsing, projections, and rules. This is an enforcement projection, not a
second semantic comparison. In particular, each direct diff endpoint evaluates
Skill and governed content-asset token-budget findings with its own archived
`quality` thresholds; the CI enforcement-view target uses the target revision's
quality thresholds while only its inspection boundary is widened.

`determineCiReportStatus()` still receives only the compatible diff. The pure
`skill-discovery-ci-policy` module selects the stricter `off < warn` mode,
constructs compact stable-ID matches from the existing diff, and does not read
files, import commands, render Markdown, or mutate input. A separate pure
status helper composes `fail > warn > pass`; Discovery policy can only request
`WARN`, and `WARN` keeps exit `0`. Review-note construction appends one policy
note after preserving existing reasons. Cycles never create a match.

The pure `security-policy-ci-policy` module selects the stricter
`off < warn < fail` mode and consumes only canonical matched-asset boolean
transitions produced by `security-policy-diff`. Permission `false` and approval
`true` are the restrictive effective states. Matches retain asset identity,
exact states, property, and provenance; aggregate inventory deltas never drive
the gate. Security policy can request `WARN` or `FAIL`, and default `FAIL`
produces the command's normal exit code `1` without changing single-revision
scan or Readiness semantics.

`scan-boundary` owns canonical endpoint/effective coverage evidence and the
intersection of enforcement-equivalent active suppressions. The effective CI
collector runs each endpoint predicate against target paths and unions the
artifacts, so no glob-subset heuristic is authoritative. Canonical glob and
exclusion identity preserves exact runtime declarations; only deterministic
sorting and exact-value deduplication occur. Suppression scope identity follows
its separate normalized matcher, and a scope active on both endpoints receives
the stricter expiration as its trusted CI lifetime. `scan-boundary-diff` retains
independent weakening and tightening facts. The pure
`scan-boundary-ci-policy` module selects the stricter `off < warn < fail` mode,
matches exact weakening rows under `scan_boundary_ci.*`, and composes its
outcome with existing CI status. Suppression application returns disjoint
active and suppressed-finding arrays; Diagnostics v2 and Trust Graph continue
to consume only active findings.

The pure `executable-surface-ci-policy` module selects the stricter
`off < warn < fail` archived mode and consumes only the canonical
`ExecutableSurfaceDiff` already built for the enforcement-view target. It does
not scan, parse rendered output, infer aggregate deltas, or add policy state to
the semantic diff. Stable discriminated matches cover added surfaces, new
problematic invocations or dependencies, missing/lost/ambiguous invocation
policy evidence, lost Skill-local or static invocation reachability, and newly
static transitive surfaces. Directional filtering excludes ambiguity and
reachability improvements. Match ordering is stable, and overlapping reasons
remain separate rows. The evaluator outcome composes as a peer with semantic,
Discovery, security, and scan-boundary outcomes; the caller-selected
`--fail-on-status` threshold remains a separate exit decision.

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

TypeScript source and tests are checked by the TypeScript compiler. ESLint is
limited to the JavaScript configuration and tooling files so the project can
use the native TypeScript 7 compiler without retaining the TypeScript 6 compiler
API required by `typescript-eslint`.

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
2. the nearest valid `.git`, `renma.config.jsonc`, or `renma.config.json`
   marker;
3. an unambiguous strong structural boundary such as `skills`, `.agents`,
   `contexts`, `lenses`, or `tools`, plus recognized root files such
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

`src/skill-authoring-handoff.ts` is a repository-layer exchange-contract
parser and validator. It owns the versioned v1 types, local JSON read and parse
boundary, bounded shape checks, caller-declared gate check, safe target
normalization, canonical Skill identity, and asset-graph consistency. The guide
may reuse its low-level version and types; scaffold orchestrates it before any
write. The module does not inspect repository contents, call a model, fetch a
source, or claim that caller-declared authoring facts are true.

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
`src/commands/suggest-metadata.ts` re-export their result types for colocated
command consumers. `src/public-types.ts` is the intentional public semantic
type facade. `src/context-language.ts` owns parsing-stage context language
diagnostics. `src/security-command/index.ts` and
`src/security-destination/index.ts` are cohesive internal subsystem entrypoints;
`src/security-diagnostics.ts` consumes them without re-exporting their members.

The package publishes the compiled `dist` tree for the executable, but its
explicit `exports` allowlist exposes only `renma/types`, the focused
`renma/types/*` modules, and `renma/discovery` (plus `package.json`). Commands,
renderers, guide builders, and migration helpers remain CLI implementation
details: their workflows and result DTOs are not stable v1 library contracts.
Every `renma/dist/...` package specifier and every removed semantic command,
renderer, guidance, or migration specifier is rejected with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. `dist/index.js` remains reachable exclusively
through the `bin.renma` CLI contract, while package-internal relative imports
continue to resolve normally. Clean-consumer verification imports every
allowed semantic runtime and declaration path, verifies representative removed
paths reject, and exercises the installed CLI.

Human-readable reasons and prompts may evolve unless a test intentionally
protects exact wording. Stable branching must use typed fields such as
`matchedRule`, `reasonCode`, `parentResolution`, ownership provenance, and
`decisionStatus`, not prose parsing.

The normal typecheck intentionally follows the current development toolchain.
`tsconfig.node-min.json` is a separate production-source gate backed by the
aliased Node 22.17 declarations. It protects the declared runtime floor from
newer Node-only API usage without weakening current editor and test typings;
actual execution on the exact floor remains a separate CI job.

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
