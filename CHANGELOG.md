# Changelog

All notable changes to Renma are documented in this file.

This project follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

### Changed

- Replaced catalog-to-Finding message parsing with producer-assigned stable
  diagnostic identities and an exhaustive typed conversion registry while
  preserving diagnostic wording and public JSON projections.
- Classified every production TypeScript module into an enforced dependency
  layer, including type-only imports and re-exports, with narrowly documented
  compatibility seams for established deep imports.
- Split the former broad `src/types.ts` hub into cohesive low-level contracts
  and an isolated composed scan-result type while retaining the established
  `dist/types.js` compatibility facade.

## [0.22.5] - 2026-07-21

### Changed

- Internally modularized deterministic security destination analysis into
  logical-shell projection, lexical classification, operational association,
  and normalization/matching layers, with a shared compatibility corpus and
  seeded property tests. No CLI or diagnostic behavior change is intended.

## [0.22.4] - 2026-07-21

### Added

- Added deterministic, stack-safe iterative strongly connected component
  detection over only usable representative resolved Skill-to-Skill
  continuation routes, including one-pass internal-route grouping, explicit
  self-loop handling, and one `DISCOVERY-ROUTE-CYCLE` warning per maximal cyclic
  component. Detection is `O(V + E)` apart from deterministic sorting.
- Added complete sorted cycle member, Skill path, internal route, declaration
  index, and line evidence to each warning, with cycle-specific LLM repair
  constraints, human decision guidance, and graph, Skill Index, and scan
  verification steps.
- Linked each warning to every member Skill and internal route, preserved
  repository-wide cycle evidence under exact direct-neighborhood focus, and
  propagated the warning through scan, diagnostics v2, review bundles,
  Discovery graph diagnostics, and Skill Index diagnostics.

### Changed

- Clarified the bundled release-prep Skill and Context to require
  `Renma v<version>` as the GitHub Release title while retaining `v<version>`
  as the Git tag.
- Limited network allowlist scanning of dotted local identifiers to lines with
  network actions while preserving upload allowlist detection for every
  supported upload action.

### Fixed

- Hardened network and upload destination classification by separating lexical
  candidates from clause-associated operational targets. Local dotted paths,
  filenames, Renma identifiers, and command file arguments remain local;
  candidate text cannot create its own action signal; unsupported explicit URLs
  retain fail-closed permission intent; coordinated destination lists inherit
  one governing action; curl upload options work before or after the URL while
  backslash-continued commands retain exact token identity and source-line
  evidence and remain bounded to the candidate's shell command and `--next`
  transfer; standalone `&` separates
  commands without treating `&>` or `2>&1` redirections as boundaries;
  transport-less IP and strong host candidates require an action; explicit URLs
  support IPv4, bracketed IPv6, internationalized and single-label hosts; and
  network and upload allowlist boundaries remain separate.

### Compatibility

- Preserved reachability, minimum depth, source-entrypoint provenance,
  coverage, route resolution/usability, focus neighborhoods, Discovery graph
  schemas and edge rendering, and the exact `renma.skill-index.v1` top-level
  shape. Cycles remain traversal-safe static review evidence and do not imply
  runtime recursion or require repair.
- Readiness, semantic diff, CI report, Trust Graph, Repository Context BOM,
  ownership, init, scaffold, guide, suggestions, metadata, configuration,
  suppression, CI gating, and package version remain unchanged.

## [0.22.3] - 2026-07-20

### Added

- Added the stdout-only `renma skill-index [path]` command with default compact
  Markdown, canonical `renma.skill-index.v1` JSON, `--json`, and exact optional
  Skill ID or repository-relative `SKILL.md` path focus.
- Added a pure Skill Index report builder over one shared `RepositorySnapshot`
  and its prepared Discovery index. The report preserves existing Skill, route,
  publication, adoption, reachability, coverage, structural-root, standalone,
  unrouted, focus, and diagnostic projection contracts without rescanning.
- Added compact, deterministically capped Markdown for published entrypoints,
  direct continuations, authoritative coverage gaps, structural candidates,
  separate Discovery/repository diagnostics, and source-Skill continuation
  guidance.
- Documented broad and intermediate routers, workflow/orchestration Skills,
  specialized operational Skills, and the rule that workflow policy stays in
  the owning Skill body rather than continuation declaration order.

### Compatibility

- Preserved every `graph --view discovery` JSON, Markdown, and Mermaid contract.
  The Skill Index adds no Mermaid format and does not add route cycles or new
  reachability semantics.
- Readiness, semantic diff, CI report, Trust Graph, Repository Context BOM,
  ownership, init, scaffold, guide, suggestions, configuration, Skill metadata,
  and package version remain unchanged. The command creates no generated index
  or repository files.

## [0.22.2] - 2026-07-19

### Added

- Added cycle-safe, deterministic multi-entrypoint reachability over only
  usable representative resolved Skill-to-Skill continuations, including
  per-Skill state, all reaching entrypoint IDs, and true minimum route depth.
- Added repository-scoped `not-evaluated`, `descriptive`, and `authoritative`
  coverage modes; reachable, not-reached, and exact unrouted eligible-Skill ID
  arrays; and projection-scoped summary counts with repository-scoped coverage
  retained under exact focus.
- Added `DISCOVERY-UNREACHABLE-ELIGIBLE-SKILL` warnings only for authoritative
  adopted-mode coverage gaps, with Skill identity evidence, constrained human
  repair choices, reachability-specific verification, scan/diagnostics-v2
  propagation, and review-bundle support.
- Extended Discovery JSON, Markdown, and Mermaid with coverage, reachability,
  unrouted facts, adopted-mode coverage gaps, and deterministic coverage
  comments while preserving existing route edge meaning.

### Compatibility

- Existing Discovery resolution, usability, publication, adoption,
  structural-root, standalone, focus-neighborhood, warning, and exit-code
  contracts remain unchanged. No route-cycle diagnostic or new command was
  added, and `catalog.dependencies` remains separate.
- Readiness, semantic diff, CI report, Trust Graph, Repository Context BOM,
  ownership, init, scaffold, guide, suggestions, and package version remain
  unchanged. `skill-index` remains a later report/CLI slice.

## [0.22.1] - 2026-07-19

### Added

- Added the exact canonical Agent Skills
  `metadata.renma.published-entrypoint: "true"` marker, publication eligibility
  and rejection evidence, and deterministic effective published-entrypoint
  projection without inferring publication from structural roots or routes.
- Added strict `skill_discovery.adopted` repository configuration and explicit
  `not-adopted`, `partial`, `incomplete`, and `adopted` states. Coverage remains
  explicitly `not-evaluated` because reachability and coverage are deferred.
- Added `DISCOVERY-INVALID-PUBLISHED-ENTRYPOINT` and
  `DISCOVERY-ENTRYPOINT-WITHOUT-USABLE-BOUNDARIES` warning diagnostics through
  scan, diagnostics v2, and review bundles.
- Extended `graph --view discovery` JSON, Markdown, and Mermaid with adoption,
  publication evidence, explicit published entrypoints, and distinct
  entrypoint styling while preserving repository diagnostics separately.

### Compatibility

- Discovery publication remains separate from structural-root facts and
  `catalog.dependencies`. Existing graph views and Readiness, diff, CI report,
  Trust Graph, BOM, ownership, init, scaffold, guide, and suggestion contracts
  remain unchanged; `renma init` does not adopt Skill Discovery.
- Reachability, coverage evaluation, unreachable-Skill diagnostics,
  `skill-index`, and runtime Skill selection remain deferred.

## [0.22.0] - 2026-07-19

### Added

- Added the canonical Agent Skills
  `metadata.renma.continues-with` JSON-array string contract, exact Skill ID or
  repository-relative path resolution, route eligibility and usability
  evidence, deterministic duplicate handling, and structural-root facts.
- Added warning diagnostics for invalid continuation declarations, unresolved
  or ambiguous routes, non-Skill targets, inactive targets, and duplicate
  declarations. Discovery diagnostics flow through repository snapshots,
  normal scan output, and diagnostics v2 repair guidance.
- Added `graph --view discovery` JSON, Markdown, and Mermaid projections with
  optional exact Skill ID/path focus over direct incoming and outgoing declared
  routes.

### Compatibility

- Skill continuations remain separate from `catalog.dependencies`; existing
  graph views and Readiness, diff, CI report, Trust Graph, BOM, ownership,
  init, scaffold, guidance, and suggestion behavior are unchanged.
- Published entrypoints, repository-wide Discovery adoption, reachability,
  coverage, `skill-index`, and downstream report integrations remain deferred.

## [0.21.0] - 2026-07-19

### Added

- Added `renma init [root]` to record explicit repository adoption with a
  minimal `renma.config.json` while preserving existing conventional config
  files and keeping repository initialization separate from asset scaffolding.

### Changed

- Expanded the GitHub Actions example to generate catalog, focused composition,
  and CI report artifacts, enforce scan and report failures, and maintain one CI
  report comment for same-repository pull requests while preserving artifacts
  as the fallback for fork pull requests.

## [0.20.2] - 2026-07-19

### Added

- Added `SEC-SAFEGUARD-BYPASS-INSTRUCTION` for explicit guidance that disables
  checks, weakens policy to pass diagnostics, suppresses warnings, bypasses or
  defers approval, selects a riskier permission fallback, or auto-executes after
  no user response.
- Added `SEC-UNTRUSTED-CONTENT-AS-INSTRUCTION` for instructions that make
  external pages, issue bodies, logs, tool output, attachments, or downloaded
  content executable authority without review.
- Added `SEC-UNBOUNDED-EXTERNAL-SOURCE-TRAVERSAL` for explicit recursive
  external-source walks with no local scope or termination boundary. The
  finding is low/advisory by default and medium/suspicious when combined with a
  local upload or sensitive-disclosure instruction.

### Changed

- Adopted one shared CommonMark AST for general Markdown headings, links,
  images, and code-block structure. Normal repository scans reuse one primary
  parse per eligible Markdown artifact while preserving public JSON shapes and
  original-file line provenance. This reduces false positives from fenced and
  indented code, inline code, HTML comments, and malformed Markdown-like text;
  recognizes Setext and formatted headings plus tilde and longer fences; and
  keeps established inline image destinations in the existing link projection.
- Limited security content analysis to LLM-facing Markdown instructions and
  metadata. Scripts retain discovery, catalog, ownership, inherited-policy,
  Trust Graph, and BOM evidence, but executable contents require independent
  project-selected SAST and dependency scanning. Renma still diagnoses Markdown
  instructions that direct an agent to fetch, trust, execute, or invoke scripts
  unsafely.
- Strengthened Security Diagnostics with one primary CommonMark AST parse per
  eligible Markdown artifact and bounded reparsing only for visible prose
  recovered from raw flow HTML. Positioned paragraph and list-item boundaries
  prevent sibling or nested instructions from being combined, while heading,
  block quote, HTML-comment, inline-code, and code-block ranges drive approval
  proximity, action-span guards, emitted-action deduplication, operational fence
  routing, and deterministic original-line evidence for agent-facing artifacts.
- Refined the existing bulk sharing, overbroad context, redaction, secret
  material, and upload rules to distinguish local reads, prompt/context
  attachment, stdout/log output, and external upload. `process.env.NAME` is no
  longer treated as a `.env` file reference, while actual `.env` paths remain
  detectable.

### Compatibility

- Security diagnostics remain repository-governance checks over already
  discovered agent-facing instructions. This change adds no language-specific
  SAST, dependency or workflow scanning, runtime enforcement, command or
  network execution, LLM call, telemetry, automatic repair, suppression, or
  policy relaxation. Passing a scan is not a safety proof.
- Renma analyzes the security posture of LLM-facing Markdown instructions and
  metadata. It does not perform language-specific analysis of referenced or
  embedded executable scripts; use appropriate SAST and dependency-scanning
  tools for executable code.

## [0.20.1] - 2026-07-16

### Added

- Added pure Declared Impact resolution over the prepared Declared Composition
  index. A focused asset now resolves its reverse transitive closure through
  explicit required/optional Context and Lens declarations plus Lens
  `applies_to`, with stable-ID deduplication, direct/transitive status, and
  required/optional affected Skill summaries.
- Added a `DeclaredImpactIndex` with incoming resolved declarations layered over
  the unchanged forward `DeclaredCompositionIndex`. Incoming entries retain
  source asset, target asset, raw dependency, normalized relationship,
  declaration form and index, source path, line evidence, and kind mismatches.
  Reverse traversal uses `(asset ID, membership)` state and edge provenance
  rather than enumerating every dependent-to-focus path.
- Added `graph --view impact --focus <asset-id-or-path>` with complete JSON,
  change-review-oriented Markdown, and original-declaration-direction Mermaid
  output. Invalid incoming declarations remain visible without establishing a
  valid impact route.
- Added the focused [Declared Impact contract](docs/declared-impact.md), graph
  view comparison, practical change-review guidance, and resolver, graph, CLI,
  renderer, cycle, invalid-declaration, and high-path-count DAG tests.

### Changed

- Added separate composition and impact index preparation so composition and
  scan do not build reverse incoming declarations. Impact construction appends
  to mutable target buckets internally, then exposes deterministically sorted
  read-only collections.
- Updated graph help and documentation to distinguish the repository-wide full
  graph, direct focused neighborhood, forward Declared Composition, and reverse
  Declared Impact.

### Compatibility

- Existing CLI behavior, graph views and documented JSON fields, composition
  reports and diagnostics, Lens freshness, authoring projections, BOM, Trust
  Graph, Readiness, and Security Profile `extends` semantics remain unchanged.
  The exported `DeclaredCompositionIndex` keeps its 0.20.0 field shape; the
  `DeclaredImpactIndex`, `impact` view and report, and impact graph edge
  membership field are separate additions.
- Declared Impact does not claim runtime usage, actual breakage, required file
  changes, optional selection, test requirements, or semantic relevance. Renma
  performs no network access, LLM call, runtime selection, prompt assembly,
  telemetry collection, or repository rewrite for this query.

## [0.20.0] - 2026-07-16

### Added

- Added a pure Declared Composition resolver over the existing catalog. It
  expands explicit required/optional Context and Lens declarations plus Lens
  `applies_to`, propagates optional membership, deduplicates by stable asset ID,
  retains required and optional predecessor-edge provenance, and keeps storage
  proportional to declarations instead of possible paths.
- Added separate required and optional unresolved declarations, independent
  source- and target-kind mismatches, completeness flags, strongly connected
  required and optional cycles, normalized transitive conflicts, lifecycle
  findings, and freshness summaries. A fully resolved cycle remains complete
  while `cycleFree` is false; conflicts never select a winner.
- Added `graph --view composition --focus <asset-id-or-path>` with deterministic
  JSON, compact Markdown, and required-versus-optional Mermaid projections.
  Dependency graph edges now retain additive declaration form, declaration
  index, and line-level source evidence.
- Added scan findings `META-DEPENDENCY-SOURCE-KIND-MISMATCH`,
  `META-DEPENDENCY-TARGET-KIND-MISMATCH`,
  `META-DUPLICATE-DECLARED-DEPENDENCY`, `COMPOSITION-REQUIRED-CYCLE`,
  `COMPOSITION-OPTIONAL-CYCLE`, `COMPOSITION-DECLARED-CONFLICT`, and
  `COMPOSITION-OPTIONAL-CONFLICT`, with actionable diagnostics v2 guidance.
- Added top-level conditional normative `externalTraversalRules` to the Skill
  authoring source. The rules distinguish named source reading from recursive
  traversal and require bounded logical-identity, visited-source, relevance,
  termination, safety-cap, cycle, access-failure, and unresolved-boundary
  behavior in authored Skills when recursion is possible.

### Changed

- Extended the existing freshness rules and diagnostic IDs to Context Lenses.
- Reused one prepared Declared Composition index across scan roots, limited
  per-root governance work to reached assets, consumed complete root reports
  incrementally, deduplicated declaration transitions per resulting
  membership, promoted shared SCC diagnostics to required whenever any root
  requires them while retaining optional roots, and rendered SCC members with
  actual declaration edges instead of a fabricated sorted path.
- Documented that Renma models explicit composition rather than
  natural-language inheritance, declaration order has no precedence, stable IDs
  resolve once while all declaration evidence remains, cycles terminate
  finitely, and `extends` stays limited to typed overlay/profile contracts.
- Rendered external traversal rules after metadata rules and before
  illustration usage, preserving the 0.19.2 separation of normative protocol,
  conditional normative guidance, illustration rules, non-normative
  illustrations, compact prompt, and complete JSON projections.

### Compatibility

- Existing commands, graph views, output fields, lifecycle semantics, Security
  Profile `extends` resolution, Trust Graph v2, Repository Context BOM v2,
  Readiness, deterministic stdout, and read-only/non-network/non-LLM boundaries
  remain intact. New graph fields, the composition view, authoring field, and
  diagnostics are additive.
- Renma still does not select or execute Skills, select or load runtime Context,
  assemble prompts, coordinate Workflows, fetch or crawl external sources,
  call an LLM, infer undeclared composition, resolve conflicts automatically,
  or rewrite repository assets.

## [0.19.2] - 2026-07-15

### Changed

- Structurally separated the normative 0.19.1 authoring protocol from a
  deterministic top-level collection of non-normative, intentionally incomplete
  illustrations. `interaction` now contains protocol rules only; the previous
  example fields and special top-level API object have no compatibility aliases
  in the independently unversioned guide JSON projection.
- Added normative illustration-usage rules: apply the protocol directly to the
  current request and evidence, never choose or copy the closest illustration,
  ignore illustrations when useful, and combine individual decision patterns
  only when their conditions are independently present. Renma adds no
  illustration classifier, selector, similarity matcher, or Skill-type template.
- Consolidated the minimal-clarification, report-first-progression, and
  source-backed-boundary patterns under one illustration type. The fictional
  Product API remains fully contained in one source-backed illustration; its
  API, schema, timeout, retry, and response details are not universal Skill
  requirements.
- Reinforced that Context Assets, Context Lenses, scripts, support files,
  external sources, runtime network access, and Skill splits each require
  independent justification. Future review findings remain runtime task
  unknowns rather than automatic authoring blockers.
- Made top-level verification domain-neutral and conditional, while retaining
  Context, URL, access, fallback, and security checks inside the source-backed
  illustration. The default prompt now renders compact illustration decisions;
  JSON retains detailed optional structures for external consumers.

### Compatibility

- Existing command syntax, formats, exit codes, deterministic stdout-only
  behavior, repository independence, and non-editing/non-network/non-LLM
  boundaries remain unchanged. The additive guide JSON projection still has no
  independently versioned schema, so removed example fields have no
  compatibility-only duplicates inside the normative interaction object.
- The 0.19.1 creation gate, question batching, queued blockers, conservative
  repairs, re-entry, and persistence semantics are unchanged.

## [0.19.1] - 2026-07-15

### Added

- Added an interactive, truth-seeking authoring protocol to the existing
  structured `renma guide skill` source. The default prompt now tells the
  consuming LLM to investigate qualified user, artifact, repository, and
  authoritative-source evidence; distinguish confirmed facts from proposals and
  unresolved human truth; separately classify Blocking, Reversible default, and
  Deferred progression; distinguish authoring decisions from runtime task
  unknowns; separate authoring-time from runtime source access; ask focused
  question batches while retaining queued blockers; pass and re-enter a creation
  gate; classify
  post-validation actions conservatively; and persist only reviewed decisions.
- Added minimal-trigger and fictional Example Product API clarification examples
  plus focused regression coverage for prompt ordering, the additive JSON
  interaction projection, decision classes, question rules, creation gates,
  handoff, boundary-change re-entry, uniquely supported repairs,
  repeated-context constraints, unknown scope and disposition, progression and
  question batching, stage-dependent blockers, persistence, determinism, and
  non-editing behavior.

### Changed

- Clarified the authoring boundary: Renma prints a deterministic protocol while
  the consuming LLM conducts the conversation, the user supplies domain and
  governance truth, and a human approves meaningful decisions.
- Delayed platform-native Skill authoring guidance until after the Renma
  clarification gate and limited it to semantic refinement within the agreed
  scaffold and asset structure. Newly discovered boundary changes return to the
  clarification gate instead of silently changing repository structure.
- Clarified that deterministic findings are not automatically deterministic
  repairs. Repeated-context consolidation and unsupported-field meaning require
  investigation or human review unless evidence uniquely determines a safe
  patch.
- Reduced duplicated prompt workflow and artifact prose so the interaction
  object remains the normative owner of truth, gate, validation, persistence,
  and handoff behavior.
- Clarified that authoring proceeds when no Blocking decision remains, while
  visible safe reversible defaults and Deferred decisions may remain without
  becoming Confirmed. Unrelated branching blockers prompt a proposed boundary
  reconsideration rather than an automatic Skill split.
- Clarified that runtime task unknowns are findings rather than automatic
  authoring blockers, runtime-stage blocking follows the authored handling policy
  without adding task-instance facts to the creation gate, “do not guess” still
  permits independent analysis, related raw gaps should be clustered into
  decision themes, and Example Product API runtime knowledge is rendered once.

### Compatibility

- Existing `guide` commands, options, exit codes, stdout-only behavior, and
  prompt/JSON derivation remain unchanged. The JSON projection adds only the
  `interaction` object and still has no separately versioned schema.
- Renma remains non-interactive and adds no task input, session state, LLM call,
  automatic creation, repair, runtime selection, or decision-state metadata.

## [0.19.0] - 2026-07-14

### Added

- Added deterministic `renma guide skill` prompt and JSON authoring guidance
  derived from one structured rule source. The command includes the installed
  version, requires no repository, writes only to stdout, and performs no
  filesystem, network, or LLM operations.
- Added focused guide regression coverage for formats, determinism, version
  reporting, non-editing behavior, help, argument validation, load-bearing
  authoring invariants, and the compact fictional Example Product API
  Skill-plus-Context example.

### Changed

- Changed new-Skill authoring priority to establish Renma asset, metadata,
  Context, source-of-truth, and file-responsibility boundaries before using
  platform-native guidance to refine Skill semantics.
- Updated Skill scaffold prompts and next steps to direct authors through
  `renma guide skill`, justified Context decisions, scan, catalog and graph
  evidence, reruns, and human review.
- Clarified that source-of-truth status alone can justify a Context Asset,
  structured output alone does not justify a script, and every support file
  needs a distinct current responsibility.

### Compatibility

- Existing commands and JSON contracts remain unchanged. `guide` is additive
  and intentionally has no separately versioned public JSON schema in this
  release.

## [0.18.3] - 2026-07-14

### Added

- Added focused regression coverage for repository markers and guard
  directories, cross-command classification evidence, historical and canonical
  parent-Skill resolution, inherited governance provenance, structured command
  displays, and snapshot reuse.
- Added an internal architecture guide describing repository snapshots,
  resolution and evidence stages, decisions, renderers, fail-closed boundaries,
  and compatibility constraints.

### Changed

- Centralized target document and repository evidence used by `inspect` and
  `suggest-metadata`, including boundary resolution, metadata-refined
  classification, parent-Skill resolution, ownership, and policy provenance.
- Made repository snapshots retain shared classification, parent-Skill, and
  security-policy indexes so downstream commands do not reinterpret the same
  files independently.
- Changed Readiness to derive graph and scan results from one repository
  snapshot instead of discovering and parsing the repository twice.
- Separated metadata-suggestion decision types and typed owner-conflict logic
  from human wording. Human prompt and inspect text rendering now live behind
  focused renderer boundaries while legacy module exports remain available.
- Added design comments for repository guards, outer-boundary precedence,
  ownership non-inference, parent inheritance, application gates, and
  repository-rooted migration collision checks.
- Removed the inspect command/renderer type cycle by placing their shared DTOs
  in a neutral evidence module while preserving command-module type exports.
- Reused one Skill parent index for snapshot catalog ownership, target parent
  resolution, and governance enrichment; ambiguous and unresolved repository
  boundary evidence now also remain distinct internally.
- Moved the remaining pure metadata-suggestion decisions into the decision
  layer without moving filesystem checks, next-action construction, or
  rendering into it.

### Compatibility

- CLI names, arguments, exit codes, JSON property names, enum values, finding
  and diagnostic IDs, severity, scoring, migration direction, package entry
  paths, and previously packaged deep-module entrypoints remain compatible with
  0.18.2. The package adds only the new internal modules and architecture guide.
- Scan diagnostics continue to expose structural parent candidates while
  repository-aware commands may enrich the same classification to `resolved`,
  `missing`, or `ambiguous`. This stage distinction avoids changing existing
  diagnostic JSON.
- Blocked historical Skill migrations continue to retain partial diagnostic
  candidate maps for 0.18.2 JSON compatibility. `decisionStatus: "blocked"`
  remains the authoritative hard stop, and no applicable canonical frontmatter
  or patch instruction is emitted.

## [0.18.2] - 2026-07-13

### Added

- Added one deterministic asset-classification evidence model shared by
  discovery, `inspect`, `suggest-metadata`, and relevant scan diagnostics. JSON
  now separates stable `matchedRule` and `reasonCode` fields from human-readable
  explanations, includes concise competing-rule evidence, and keeps
  classification separate from ownership and policy governance.
- Added explicit suggestion `decisionStatus`, structured decision evidence,
  cross-platform next actions with separate command/argv/display fields, and
  the successful `no-proposal` mode.

### Changed

- `inspect` now reports classification for cataloged assets, files with missing
  metadata, repository tools, and unknown files. When catalog evidence exists,
  it reports declared or inherited ownership and policy separately.
- `suggest-metadata` now uses the shared classifier. Ordinary Skill-local
  support produces no independent retrofit proposal unless an explicit
  supported override is supplied; existing local metadata remains supported.
- Repository classification resolves an explicit caller root first, then the
  nearest safe `.git` or Renma config marker, then an unambiguous structural
  boundary. Being below the current working directory is no longer treated as
  repository-root evidence.
- Skill entrypoint classification and migration now use the resolved
  repository-relative path consistently. Filesystem collision checks rebase
  the repository-relative migration target against that resolved root, so
  invoking Renma from a nested repository's parent behaves like invoking it
  inside the repository.
- Skill-local classification now records a structural parent candidate
  separately from catalog-backed `resolved`, `missing`, or `ambiguous` parent
  evidence. Missing and ambiguous parents block inheritance claims and metadata
  proposals until the layout is reviewed.

### Fixed

- Prevented nested `references/`, `profiles/`, `examples/`, `scripts/`, or
  `assets/` names from overriding the recognized `contexts/**` or legacy
  `context/**` boundary.
- Prevented `references/**`, `tools/**`, and `skills/**/tools/**` from being
  misclassified as independently governed Context Assets or canonical local
  support.
- Repository paths with multiple plausible structural roots now fail closed as
  `repository-boundary-ambiguous`; unresolved and ambiguous suggestions no
  longer manufacture a `scan .` action against the caller's current directory.
- Marker-free structural fallback now treats `profiles`, `references`,
  `examples`, `scripts`, and `assets` only as ambiguity guards. Those directory
  names never establish a repository root without a strong boundary, explicit
  root, or repository marker.
- An explicit owner equal to an existing canonical
  `metadata.renma.owner` now returns `no-proposal` and
  `no-change-recommended` without candidate metadata or frontmatter.

### Compatibility

- The `inspect` JSON outline adds `repositoryBoundary`, `classification`, and
  `governance`. `repositoryBoundary` preserves resolved or unresolved boundary
  evidence, including ambiguity candidates when present.
  `suggest-metadata` JSON adds `classification`, `decisionStatus`, `decision`,
  and `nextActions`, and may return `suggestedMode: "no-proposal"`. Relevant
  diagnostic `details` may add `classification`. The new JSON fields are
  additive, but the command behavior is intentionally refined: targets that
  previously represented a successful no-change result may now use
  `suggestedMode: "no-proposal"`, and Skill-local inheritance is reported only
  after one parent resolves. Consumers should branch on `decisionStatus`, treat
  unknown future `suggestedMode` values conservatively, and execute
  `nextActions[].invocation.command` with `invocation.args` rather than parsing
  `display`. Finding severity, scan thresholds, Readiness scoring, Agent Skills
  migration direction, and supported explicit local metadata remain unchanged.

## [0.18.1] - 2026-07-13

### Added

- Added `token_budget_override`, `token_budget_rationale`, and optional
  `token_budget_reviewed_at` metadata for recording a declared human decision
  that a support asset should remain intentionally long. Invalid, ambiguous,
  incomplete, orphaned, or unnecessary decision metadata emits
  `QUAL-INVALID-TOKEN-BUDGET-OVERRIDE` and never suppresses the default budget.
  Only Markdown-parser-eligible support assets can declare the bundle, and
  override limits must be positive safe integers represented exactly.
- Added the blocking `CONTEXT-LENS-TARGET-NOT-CONTEXT` diagnostic.
  Context Lens `applies_to` targets must now resolve specifically to Context
  Assets; Skills, support assets, and other Context Lenses are rejected.

### Changed

- Changed support-asset token guidance to ask for a split-versus-intentionally-
  long user decision. Semantic splitting remains preferred when it preserves
  coherence and execution order; a valid declared decision provides an
  effective limit for intentionally coherent or ordered long-form assets.
- Clarified Skill, Context Asset, Context Lens, Skill-local support, and
  external runtime responsibilities across canonical documentation, CLI help,
  scaffolds, and examples. Context Lens guidance now requires declared Context,
  rejects persona-only authoring as insufficient, uses canonical Agent Skills
  relationship metadata, and preserves focused workflows without changing
  Renma's deterministic runtime boundary.

## [0.18.0] - 2026-07-12

### Added

- Added the internal `renma-quality` profile family. The emitted profile
  identifier is derived from the Renma package version as
  `renma-quality@<package version>`. Added canonical threshold documentation
  with units, provenance, rationale, false-positive risks, and
  future-configurability status.
- Added one deterministic Unicode-aware `estimated_tokens` implementation for
  Skill, content-asset, reuse-candidate, and repeated-context analysis.
- Added first-class `script` and `asset` artifact kinds under both supported
  Skill roots, including original-byte hashes, sizes, text/binary
  classification, Markdown eligibility, and catalog, graph, Trust Graph, and
  BOM inventory.
- Added direct, one-index-hop, deep-chain, unreachable, and missing-path static
  support reachability for references, scripts, assets, profiles, and examples.
- Added `renma scaffold skill --resources references,scripts,assets`; file mode
  creates only selected empty directories, while prompt and JSON modes report
  the selected resource contract without writing files.
- Added BOM and Trust Graph v2 as the first supported long-term schema
  contracts. Renma 0.18.0 does not provide a v1 compatibility mode; the
  earlier experimental v1 surface was removed before broader adoption.
- Added normalized ownership provenance and static local-resource relationship
  edges across catalog, graph, readiness, BOM, and Trust Graph output.

### Changed

- Replaced the thin-router model with focused workflow entrypoints. Ordered
  procedures, completion criteria, and short command examples are valid in
  `SKILL.md`; progressive disclosure is reviewed by semantic destination.
- Changed Skill body advisories to low above 2,000 and medium above 5,000
  estimated tokens. Changed content advisories to Context 4,000, Reference
  5,000, Profile 2,000, and Example 2,500 estimated tokens.
- Changed metadata advisories to 48 frontmatter lines, 4,096 frontmatter
  characters, and 256 characters per prose-like list item, with practical
  exemptions for IDs, repository paths, and URLs.
- Changed reusable Context eligibility to 60 lines or 800 estimated tokens plus
  four reusable signals. Changed shared-reference eligibility to 80 lines or
  1,200 estimated tokens plus three reusable headings and four reusable
  phrases. Ordinary workflow headings and constraint words do not qualify.
- Changed repeated headings to require three files and token shingles to 40
  estimated tokens in three files. Exact-section, exact-code, and per-category
  caps retain their established defaults.
- Changed Readiness to `workflow.skills_focused`, removed the five-point
  existence penalty for deprecated/archived assets, and reduced subjective
  workflow advisory weights while preserving blocking graph and diagnostic
  failures.
- Deprecated `metadata.renma.when-to-use` and
  `metadata.renma.when-not-to-use` for new Skill authoring. They remain
  recognized for governance and migration preservation; portable
  `description` is the Skill discovery source of truth.

### Fixed

- Stopped overcounting Japanese one character at a time in quality rules and
  undercounting unspaced Japanese as one token in repeated-context analysis.
- Stopped decoding images, PDFs, fonts, and other opaque assets as UTF-8
  Markdown or exposing binary bytes in diagnostic snippets.
- Stopped non-Markdown text scripts and assets from contributing frontmatter,
  headings, links, fences, or repeated-context evidence.
- Fixed nearest-Skill support ownership, nested Skill boundaries, explicit path
  reachability, extensionless and spaced paths, and oversized-file existence
  evidence.
- Prevented script and asset bytes from declaring policy. Skill-local scripts
  and assets inherit the nearest unambiguous Skill policy for inventory and
  provenance reporting, while binary files and ordinary output assets stay
  opaque.
- Rejected files reached through leaf or ancestor symbolic links, including
  Skill-local directory links that point elsewhere inside or outside the
  repository.
- Added explicit local, inherited, effective, and missing-effective policy
  inventory provenance for non-Markdown scripts without interpreting script
  bytes as security policy metadata.
- Added balanced-parenthesis Markdown destination parsing and single-pass
  decoding for encoded filename characters.
- Stopped treating a command, Procedure/Steps/Setup headings, ordered workflow
  wording, or 450/700-word counts as evidence of a bad Skill.
- Stopped recommending Context Assets as the default destination for
  Skill-specific procedures, variants, edge cases, scripts, and output
  resources.
- Stopped repeated links to the same specification or source from producing
  maintenance findings by default.

### Removed

- Removed default emission of `QUAL-SHORT-DESCRIPTION`,
  `LAYOUT-SKILL-NOT-THIN`, `LAYOUT-SKILL-EXECUTABLE-COMMAND`, and
  `MAINT-REPEATED-LINK`.
- Removed the Readiness `layout.skills_thin` contract and the unconditional
  lifecycle-status penalty.

### Compatibility

- No public quality-threshold configuration was added to
  `renma.config.json`. The versioned internal profile is shaped for possible
  later overrides after usage evidence.
- `ArtifactKind`, catalog entries, graph nodes, Trust Graph asset properties,
  and Repository Context BOM assets add `script`/`asset` and binary-safety
  evidence. Consumers that exhaustively match kinds or exact-normalize these
  schemas must update for 0.18.0.
- Scaffold file, prompt, and JSON contracts add selected resource directories;
  existing invocations without `--resources` create no extra directories.
- Agent Skills specification errors remain separate from Renma advisories:
  `description` is required, a string, and 1-1,024 characters; 150 characters
  is not an Agent Skills minimum.

### Migration

- `LAYOUT-SKILL-NOT-THIN` -> `QUAL-SKILL-MIXED-RESPONSIBILITY` when reusable
  knowledge evidence exists, otherwise no finding.
- `LAYOUT-SKILL-EXECUTABLE-COMMAND` -> no layout finding; security,
  unresolved-helper, path-escape, and large-inline-implementation checks remain.
- `QUAL-SHORT-DESCRIPTION` -> Agent Skills description validity plus
  `RN-SKILL-DESCRIPTION-MISSING-CAPABILITY`,
  `RN-SKILL-DESCRIPTION-MISSING-USAGE-BOUNDARY`, and
  `RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY` where applicable.
- `MAINT-REPEATED-LINK` -> no maintenance finding by default.
- Readiness `layout.skills_thin` -> `workflow.skills_focused`.
- Rebaseline exact catalog, graph, Trust Graph, BOM, Readiness, scaffold JSON,
  and package-content fixtures against the 0.18.0 schemas before release.

## [0.17.0] - 2026-07-11

### Added

- Added platform-neutral, Skill-specific next steps to scaffold file and prompt output, including the authoring-review, scan, fix, rerun, and human-review loop.
- Added Skill-specific `suggest-metadata` prompt guidance that separates whole-Skill authoring review from metadata or one-way migration suggestions and keeps blocked migrations conservative.
- Added a documentation index with reading paths for workflows, format contracts, governance references, product design, architecture, and roadmap material.
- Added the interactive-placeholder onboarding example and package-content verification for version-matched README documentation and examples.

### Changed

- Clarified that platform-native guidance owns general Skill design while Renma complements it with repository-specific governance and validation.
- Consolidated the README around product identity, boundaries, primary workflows, quick start, command orientation, a canonical example, and documentation navigation.
- Made the authoring guide the canonical new-Skill and existing-Skill workflow, including safe generator boundaries and an optional Codex `skill-creator` example.
- Reworked the user manual and compatibility guide around actual CLI behavior, review responsibilities, scan/fix/rerun validation, and blocked migration recovery.
- Rewrote the roadmap around the shipped 0.16.0 baseline, the 0.17.0 usability release, and proposed 0.18.0 graph-based Skill discovery; removed stale release sequencing from architecture and design.
- Made canonical nested Skills under both `skills/**` and `.agents/skills/**` participate consistently in Readiness, thin-Skill, graph, support, and parent-Skill checks.
- Allowed valid Skill-local Agent Skills support directories without path-only disallowed-layout findings; reusable Context and shared-helper promotion remains evidence-based and human-reviewed.
- Normalized expected CLI target and option errors, enforced command-specific options and positional arity, and rejected partial positive-integer values.
- Retained `layout.tool_namespace` and `layout.workflow_aliases` as validated compatibility-only input; they no longer force path-only migration of valid Skill-local support.

### Fixed

- Corrected Readiness false-positive `ready` results for nested Skills with missing workflow guidance.
- Updated the Context Lens example to current 0.17.0 quality with conservative local policy, complete workflow guidance, and clean scan/readiness output.
- Included README-linked architecture, design, roadmap, documentation, and examples in the npm package.
- Stopped treating documented Skill-local support paths as stale and resolved `scripts/**` helper commands against an unambiguous owning Skill using repository snapshot evidence.

### Compatibility

- Preserved scaffold and `suggest-metadata` JSON field shapes, stdout-only prompt behavior, and non-editing metadata suggestions.
- Kept Skill-specific guidance out of Context Asset and Context Lens scaffold and suggestion output.

## [0.16.0] - 2026-07-11

### Added

- Added Agent Skills specification validation to `scan`, including stable diagnostics for entrypoint naming, frontmatter, metadata, and body requirements.
- Added deterministic migration assistance to `suggest-metadata` for pre-0.16 Skill entrypoints and metadata, with conflict detection and canonical candidate validation.
- Added comprehensive Agent Skills compatibility and migration documentation, canonical authoring guidance, and a Context Lens example for boundary-value spec review.

### Changed

- Required operational Skills to use specification-valid Agent Skills frontmatter with Renma extensions under flat, string-valued `metadata.renma.*` keys.
- Updated catalog, graph, ownership, readiness, BOM, security, scaffold, and reporting consumers to use canonical Skill metadata while retaining legacy forms only as migration input.
- Expanded the README, architecture, design, user manual, security guidance, and example repository for the 0.16.0 Skill format and repository model.

### Fixed

- Corrected the repository-owned release-prep Skill syntax and kept its operational workflow in the required release context.

## [0.15.2] - 2026-07-10

### Added

- Added an authoritative Repository Context BOM v1 contract document covering schema compatibility, snapshot consistency, reproducibility, provenance, and future consumed-context evidence boundaries.
- Added a normalized BOM v1 contract-shape test that pins stable JSON fields, nested shapes, deterministic ordering, and scope declarations.

### Changed

- Hardened `renma bom` so graph, readiness, diagnostics, Context Lens evidence, security posture, and security policy inventory are derived from the same collected repository snapshot as catalog assets.
- Captured referenced helper and dependency path existence in `RepositorySnapshot` so snapshot-derived BOM and scan reports do not query the live filesystem during rule evaluation.
- Clarified `--omit-generated-at` as a same-environment reproducibility option that removes only the run-time `generatedAt` field and does not normalize freshness metadata, absolute paths, file moves, UTC evaluation date changes, or cross-runner portability.

## [0.15.1] - 2026-07-10

### Added

- Added command-specific CLI help for every command, including purpose, use cases, boundaries, examples, next steps, and relevant options for human and coding-agent workflows.

### Changed

- Expanded top-level CLI help with Renma's deterministic governance boundaries, start-here workflows, and command-selection questions.
- Clarified command-specific option help with accepted output formats, defaults, owner behavior, scaffold output modes, and BOM timestamp/path boundaries.
- Improved CLI usage errors to point to the relevant command help page where applicable.

## [0.15.0] - 2026-07-09

### Added

- Added `renma bom` for a declared Repository Context BOM that combines catalog assets, graph dependency resolution, readiness evidence, diagnostics, security posture, and security policy inventory.
- Added JSON and Markdown BOM output with explicit scope metadata stating that runtime usage is false and telemetry is not collected.
- Added `renma bom --omit-generated-at` for BOM artifacts that omit run-time generation timestamps.

### Changed

- Reused one shared repository evidence snapshot for BOM catalog assets and graph dependencies.
- Escaped repository-derived BOM Markdown table cells for safer PR-friendly output.

## [0.14.1] - 2026-07-08

### Added

- Added repository configuration for Renma's own release and governance checks.

### Changed

- Improved diagnostic messages, docs, and examples for discovery and security policy guidance.

## [0.14.0] - 2026-07-08

### Added

- Added `renma trust-graph` for deterministic Trust Graph evidence over catalog, dependency, owner, lifecycle, security policy, and diagnostic signals.
- Added `trustGraph` to JSON scan output for downstream CI and tooling consumers.

## [0.13.2] - 2026-07-08

### Added

- Added `renma suggest-metadata` for deterministic metadata retrofit prompts and JSON payloads for existing assets.
- Added documentation and tests for safe metadata retrofit workflows, including explicit owner handling and preservation of existing asset content.

## [0.13.1] - 2026-07-08

### Added

- Added owner-grouped ownership reports and `renma ownership --owner <owner>` filtering for owner-specific JSON and Markdown output.

### Changed

- Clarified ownership policy so missing `owner` metadata is accepted as unowned coverage information instead of becoming a default scan finding.

## [0.13.0] - 2026-07-07

### Added

- Added LLM-actionable diagnostics v2 in scan JSON output with typed `repairConstraints`, structured `verificationSteps`, concise `llmHint` guidance, stable codes, and source locations.
- Added deterministic review bundles that group related diagnostics by duplicate IDs, unresolved references, orphaned context assets, and shared dependency/reference sources.
- Added documentation and tests for v2 diagnostic metadata, review bundles, suppression handling, and compatibility with existing scan findings.

## [0.12.0] - 2026-07-07

### Added

- Added deterministic Context Lens governance summaries for scan, catalog JSON, readiness, and inspect output.
- Added stable coded Context Lens diagnostics for missing required fields, duplicate IDs, unresolved targets, path normalization mismatches, unsupported kind/scope/version values, empty or governance-meaningless definitions, malformed frontmatter, and deprecated field aliases.
- Added readiness integration with a `context_lens.governance` check and additive `summary.contextLens` JSON output.
- Added inspect output that reports Context Lens detected state, lens counts, diagnostic counts, representative diagnostic code, definition paths, and target references.
- Added Context Lens authoring examples, CI guidance, invalid diagnostic examples, and a multi-lens fixture.

### Changed

- Stabilized Context Lens as deterministic repository governance: Renma verifies declared lens definitions and relationships without runtime selection, prompt assembly, context injection, external tool signal imports, or automatic LLM judgment.

## [0.11.1] - 2026-07-06

### Added

- Added `renma graph --view layered` for Mermaid graph output that groups skills, context lenses, contexts, support assets, and unresolved targets into readable layers.
- Added `renma graph --view lens` as an alias for the layered context-lens graph view.

### Changed

- Focused graph output for context lenses now clearly preserves inbound skill lens references and outbound `applies_to` context edges in the layered view.

## [0.11.0] - 2026-07-05

### Added

- Added experimental `context_lens` assets, including default `lenses/**/*.md` discovery, cataloging, graph edges, and authoring docs.
- Added `requires_lens`, `optional_lens`, and `applies_to` metadata relationships for static skill-to-lens-to-context graphs.
- Added `inspect` and `scaffold context_lens` support for lens metadata, relationships, and deterministic starter files.
- Added context lens diagnostics for missing purpose or `applies_to` metadata, orphaned active lenses, and active lenses that apply to inactive contexts.

### Changed

- Updated docs and examples for the context lens model, including clearer boundaries around runtime selection, prompt assembly, and context injection.

## [0.10.0] - 2026-07-05

### Added

- Added metadata budget diagnostics for oversized frontmatter and long metadata list items.
- Added shared context usage-boundary diagnostics for missing or placeholder `when_to_use` and `when_not_to_use` metadata.
- Added shared context language diagnostics for vague wording, relative currentness wording, and prompt/runtime-selection wording.
- Added shared context lifecycle diagnostics for deprecated assets, invalid `superseded_by` targets, and supersession cycles.
- Added context conflict graph diagnostics for invalid `conflicts` metadata and skills that require conflicting contexts.

### Changed

- Simplified security policy frontmatter handling around canonical snake_case metadata keys.
- Expanded diagnostics documentation for metadata budgets and shared context governance checks.

## [0.9.0] - 2026-07-03

### Added

- Added security posture summaries to readiness and CI reports, derived from existing security findings and `riskClass` metadata.
- Added effective security policy inventory summaries for readiness and CI reporting, derived from asset policy metadata, security profiles, and repository security config.
- Added security-aware semantic diff summaries that compare security finding posture and effective policy inventory across revisions.

### Changed

- Kept security posture reporting non-gating in v1; readiness score, readiness level, scan `fail_on`, and CI status semantics remain unchanged.
- Kept policy inventory reporting non-gating in v1; scan `fail_on`, readiness score/level, and CI status semantics remain unchanged.
- Kept security-aware diff reporting non-gating in v1; scan `fail_on`, readiness score/level, and CI status semantics remain unchanged.

## [0.8.1] - 2026-07-03

### Added

- Added a GitHub Actions workflow that publishes the npm package from version tags via npm trusted publishing.

## [0.8.0] - 2026-07-03

### Added

- Added `riskClass` to security scan findings so reviewers can distinguish `violation`, `suspicious`, and `advisory` results without changing severity thresholds.
- Added scan review signal docs and security policy taxonomy guidance for `severity`, `confidence`, and `riskClass`.

### Changed

- Surfaced risk classes in text scan output, readiness reports, semantic diffs, and CI reports.
- Added npm version and download badges to the README.

### Fixed

- Made semantic diff cleanup preserve primary snapshot errors while retrying temporary directory removal.

## [0.7.0] - 2026-07-02

### Changed

- Refined deterministic security diagnostics for agent-facing context assets without adding package or CI workflow scanning.
- Reduced false positives for guarded or defensive security guidance around destructive commands, privileged commands, remote script execution, unpinned installs, and external uploads.
- Clarified the 0.7.0-and-later roadmap: security diagnostics stabilization first, security posture summaries next, Trust Graph as deterministic repository evidence, and Repository Context BOM as a declared manifest rather than runtime usage telemetry.
- Added a user-manual quickstart for security policy metadata and reusable security profiles.
- Expanded the user manual with metadata authoring guidance, security policy examples, reusable security profile guidance, and common security diagnostic fixes for the 0.7.0 line.
- Added a first-skill authoring walkthrough that shows how to use scaffold, inspect, scan, graph, readiness, and LLM-assisted repair loops to create and refine skills.
- Added guidance for deriving related router skills from existing skills, including an Appium setup example.
- Split the expanded user manual into focused authoring and security policy guides while keeping the user manual as the CLI entrypoint.

## [0.6.1] - 2026-06-29

### Changed

- Updated the release-prep workflow to allow local version commits and annotated tags when release finalization is requested.
- Moved release-prep validation mechanics into a deterministic tool script to reduce skill/context token usage.

## [0.6.0] - 2026-06-29

### Added

- Added freshness diagnostics for context assets.
- Added suppressions for managing accepted diagnostics.
- Added the project changelog to document release history.
- Added a release-prep skill and context asset that dogfood Renma reports during release preparation.

### Changed

- Centralized diagnostic IDs in one module.
- Simplified the example spec and improved example README documentation.
- Updated package metadata so published packages include the changelog, license, and README.
- Clarified README layout and redaction wording so Renma's own scan reports stay clean.

## [0.5.1] - 2026-06-27

### Changed

- Modified README documentation.
- Included minor maintenance updates after the `0.5.0` release.

## [0.5.0] - 2026-06-26

### Added

- Added a bundled example context repository.
- Added field-level metadata and dependency evidence.
- Added command documentation guardrails to keep user-facing CLI docs aligned with implementation.
- Added smoke coverage for the example repository.

### Changed

- Improved CI report output.
- Linked the example repository from README and the User Manual.
- Expanded documentation and test coverage for the new example, metadata behavior, and docs synchronization.

## [0.4.0] - 2026-06-25

### Added

- Added scaffolding support for new context repository assets.
- Added focused graph views.
- Added scaffold output modes for file, prompt, and JSON output.

### Changed

- Improved metadata parsing for deterministic block-list fields.
- Required explicit owners for file scaffolding to avoid committing placeholder ownership.

## [0.3.0] - 2026-06-24

### Added

- Added security policy diagnostics and related configuration enhancements.
- Added checks for approved domains, disallowed commands, and contradictory policy guidance.
- Added security profiles in `renma.config.json`.
- Added simple block-list parsing for selected security policy fields.

### Changed

- Updated project planning documentation for the security policy work.
- Kept artifact-local explicit denials stricter than inherited repository or profile allowances.

## [0.2.0] - 2026-06-23

### Added

- Added repeated-context diagnostics.
- Added semantic diff reporting.
- Added CI report generation.
- Added a GitHub Actions example for generating and uploading a Renma CI report.

### Changed

- Updated planning documentation for security-related work.

## [0.1.1] - 2026-06-22

Tag-only release. No GitHub Release entry was published for this version.

### Changed

- Polished README and documentation.
- Updated package metadata for the early npm package release.

## [0.1.0] - 2026-06-22

### Added

- Added the initial Renma CLI for scanning agent-facing context repositories.
- Added catalog, ownership, graph, readiness, and reporting commands.
- Added workflow diagnostics for clarity, required inputs, completion criteria, optional context, and summaries.
- Added metadata governance, advisory diagnostics, local path checks, and semantic split suggestions.
- Added the initial project documentation, architecture notes, package metadata, tests, and license.

[Unreleased]: https://github.com/KazuCocoa/renma/compare/v0.22.5...HEAD
[0.22.5]: https://github.com/KazuCocoa/renma/compare/v0.22.4...v0.22.5
[0.22.4]: https://github.com/KazuCocoa/renma/compare/v0.22.3...v0.22.4
[0.22.3]: https://github.com/KazuCocoa/renma/compare/v0.22.2...v0.22.3
[0.22.2]: https://github.com/KazuCocoa/renma/compare/v0.22.1...v0.22.2
[0.22.1]: https://github.com/KazuCocoa/renma/compare/v0.22.0...v0.22.1
[0.22.0]: https://github.com/KazuCocoa/renma/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/KazuCocoa/renma/compare/v0.20.2...v0.21.0
[0.20.2]: https://github.com/KazuCocoa/renma/compare/v0.20.1...v0.20.2
[0.20.1]: https://github.com/KazuCocoa/renma/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/KazuCocoa/renma/compare/v0.19.2...v0.20.0
[0.19.2]: https://github.com/KazuCocoa/renma/compare/v0.19.1...v0.19.2
[0.19.1]: https://github.com/KazuCocoa/renma/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/KazuCocoa/renma/compare/v0.18.3...v0.19.0
[0.18.3]: https://github.com/KazuCocoa/renma/compare/v0.18.2...v0.18.3
[0.18.2]: https://github.com/KazuCocoa/renma/compare/v0.18.1...v0.18.2
[0.18.1]: https://github.com/KazuCocoa/renma/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/KazuCocoa/renma/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/KazuCocoa/renma/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/KazuCocoa/renma/compare/v0.15.2...v0.16.0
[0.15.2]: https://github.com/KazuCocoa/renma/compare/v0.15.1...v0.15.2
[0.15.1]: https://github.com/KazuCocoa/renma/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/KazuCocoa/renma/compare/v0.14.1...v0.15.0
[0.14.1]: https://github.com/KazuCocoa/renma/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/KazuCocoa/renma/compare/v0.13.2...v0.14.0
[0.13.2]: https://github.com/KazuCocoa/renma/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/KazuCocoa/renma/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/KazuCocoa/renma/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/KazuCocoa/renma/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/KazuCocoa/renma/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/KazuCocoa/renma/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/KazuCocoa/renma/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/KazuCocoa/renma/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/KazuCocoa/renma/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/KazuCocoa/renma/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/KazuCocoa/renma/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/KazuCocoa/renma/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/KazuCocoa/renma/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/KazuCocoa/renma/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/KazuCocoa/renma/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/KazuCocoa/renma/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/KazuCocoa/renma/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/KazuCocoa/renma/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/KazuCocoa/renma/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KazuCocoa/renma/releases/tag/v0.1.0
