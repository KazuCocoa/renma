# Renma Roadmap

Renma is evolving from a deterministic skill scanner into a Git-native context
engineering toolkit.

The goal is not only better linting. The goal is to help teams treat context as
a software asset: versioned, reviewable, reusable, composable, traceable, and
reproducible.

Renma should remain:

- deterministic by default
- minimal-dependency
- CLI-first
- Git-native
- useful in local development and CI
- independent of LLMs for core analysis

LLMs may later help with advisory review, duplicate detection, or suggested
refactors, but the core model, validation, resolution, and trace output should
remain deterministic.

## Product Direction

Large AI-agent repositories develop the same failure modes as large software
systems:

- knowledge is copied across skills
- references drift out of date
- instructions become too large to reason about
- ownership becomes unclear
- reuse is informal and hard to validate
- prompt assembly becomes difficult to reproduce

Renma should help teams answer:

- What context exists?
- Who owns it?
- Which skills use it?
- Why was this context selected?
- What was rejected, and why?
- What changed between two revisions?
- Can this context package be reproduced exactly?

## Core Thesis

Skills should become orchestration and routing layers.

Context should become reusable building blocks.

Example:

```text
context/
  appium/
    setup.md
    android.md
    ios.md
    troubleshooting.md

skills/
  mobile-testing/
    SKILL.md
  enterprise-testing/
    SKILL.md
  onboarding/
    SKILL.md
```

Instead of duplicating Appium knowledge in several skills, skills should route
to shared context units.

The top-level `SKILL.md` should explain:

- when to use the skill
- when not to use the skill
- required preflight questions
- which context applies to which modes, platforms, tools, and intents
- which examples or references should be loaded for each branch
- which deterministic scripts should run before LLM reasoning
- which checks or evals cover expected behavior
- what context should stay out of the prompt unless explicitly needed

## Current State

Renma currently provides deterministic scanning for AI-agent skill and context
repositories.

Current capabilities:

- bounded filesystem discovery
- stable POSIX-style repo-relative paths
- Markdown parsing for headings, links, code fences, metadata, and line evidence
- text and JSON reports
- CI-friendly exit behavior with `--fail-on`
- config loading from `renma.config.json` and `.renma.json`
- structural, quality, maintenance, and safety findings
- early catalog support for skills, profiles, references, and examples
- context extraction helper through `renma context`
- semantic split suggestion helper through `renma suggest-semantic-split`

Default scanned paths include:

```text
skills/**/SKILL.md
.agents/**/*.md
AGENTS.md
skills/**/profiles/**/*.md
skills/**/references/**/*.md
skills/**/examples/**/*.md
```

Current rule areas:

- missing or weak skill description
- missing routing clarity
- missing negative routing
- missing examples
- missing preflight guidance
- missing verification guidance
- oversized `SKILL.md`
- oversized profile, reference, or example files
- unused profiles, references, and examples
- profile overlays missing base skill declaration
- literal secret-like values
- private key material
- destructive commands without nearby confirmation or recovery context
- risky remote defaults
- broad environment copying into subprocesses
- hardcoded user-local paths

Current limitations:

- Renma does not yet have a complete internal graph model.
- Renma does not yet resolve context for a specific task, profile, or platform.
- Renma does not yet explain selected and rejected context candidates.
- Renma does not yet produce execution manifests or lockfiles.
- Renma does not yet understand transitive context dependencies.
- Renma does not yet discover repeated context patterns across skills, references,
  examples, agents, or repositories.
- Renma does not yet perform semantic duplicate detection.
- Eval support is planned but not part of the core implementation.

## Target Architecture

Renma should use a normalized internal representation as the contract between
source files and all higher-level features.

```text
Markdown, YAML, docs snapshots, generated context
        |
        v
Importers and parsers
        |
        v
Normalized internal model
        |
        v
Validation and graph checks
        |
        v
Context resolution
        |
        v
Execution manifest
        |
        v
Trace, lockfile, catalog, reports
```

Users should mostly work with normal Markdown and small metadata blocks. The
internal model exists so Renma can stay deterministic, extensible, and testable.

## Minimal Internal Representation

The internal representation should be small at first. It should separate assets
from relationships between assets.

### Asset

An asset is a repository object Renma can catalog, validate, reference, or
compose.

Required fields:

- `id`
- `kind`
- `source_path`
- `content_hash`
- `metadata`

Recommended metadata:

- `version`
- `owner`
- `status`
- `tags`
- `when_to_use`
- `when_not_to_use`

Possible asset kinds:

- `skill`
- `context`
- `profile`
- `reference`
- `example`
- `script`
- `eval`
- `agent`
- `config`

### Skill

A skill is LLM-facing behavior: role, task boundaries, routing, workflow,
safety gates, and verification expectations.

Additional fields:

- `routes`
- `required_context`
- `optional_context`
- `conflicts`

### Context Unit

A context unit is a coherent reusable block of knowledge.

Good context boundaries follow:

- concept
- owner
- update frequency
- task relevance
- conflict surface
- expected consumers

A context unit should be smaller than a full manual and more durable than a
single prompt snippet.

### Dependency

A dependency is a typed edge between assets.

Dependency types:

- `requires`
- `optional`
- `conflicts`
- `extends`
- `includes`
- `routes_to`
- `covered_by`

Each dependency should preserve source evidence when possible:

- source path
- line range
- declaration form
- reason

### Composition

A composition is the resolved context package for a skill, task, profile, or
set of explicit inputs.

Fields:

- selected skill
- selected assets
- rejected assets with reasons
- ordered context
- dependency edges used
- source paths
- content hashes
- token estimates
- policy decisions
- generation timestamp

Composition should be reproducible: the same repository state and the same
inputs should produce the same manifest.

## Metadata Direction

Renma should start with a small stable metadata subset and expand only when a
command uses the field.

Initial stable fields:

```yaml
id: appium.android
version: 1.0.0
owner: mobile-platform
status: stable
tags:
  - appium
  - android
when_to_use:
  - Android Appium setup
  - Android emulator troubleshooting
when_not_to_use:
  - iOS-only workflows
requires_context:
  - appium.setup
optional_context:
  - appium.troubleshooting
conflicts:
  - platform.ios
```

Status values:

- `experimental`
- `stable`
- `deprecated`
- `archived`

Renma should validate:

- duplicate IDs
- invalid status values
- missing required metadata for published assets
- unknown dependencies
- dependencies on deprecated or archived context
- conflicts that cannot be resolved
- stale or expired context once freshness fields exist

## Context Catalog

The catalog is the first major step from scanner to platform.

The catalog should answer:

- what assets exist
- what type each asset is
- where each asset lives
- who owns it
- what status it is in
- what it depends on
- what depends on it
- which assets are unused
- which assets are deprecated or archived

Commands:

```bash
renma catalog --format json
renma catalog --format markdown
```

Generated files may include:

```text
catalog.json
CATALOG.md
```

Catalog output should be deterministic and commit-friendly.

## Repeated Context Discovery

Repeated context discovery is the bridge between cataloging what exists and
refactoring knowledge into reusable context units.

The goal is not only exact duplicate detection. Renma should also identify
natural context boundaries that appear across multiple skills, references,
examples, agents, or repositories. Similar Appium setup notes, Android driver
selection guidance, failure log collection steps, secret handling policy, CI
test execution instructions, and troubleshooting workflows may represent the
same reusable context unit even when the wording differs.

This feature should remain deterministic first. Initial signals can include:

- repeated normalized headings
- repeated command blocks
- repeated links, domains, tool names, and package names
- shared metadata tags and `when_to_use` terms
- shared path segments such as `appium`, `android`, `ci`, or `secrets`
- shared keyword fingerprints from headings, lists, and short paragraphs
- similar workflow skeletons such as setup, run, collect logs, troubleshoot

The internal representation should support section-level evidence before any
LLM-assisted review is added:

- `ContextFragment`: source path, line range, heading path, normalized text
  hash, token fingerprint, command fingerprints, links, keywords, metadata
- `ContextPatternCandidate`: label, fragments, signal kinds, score, suggested
  shared context path, classification, and source evidence

Classifications should distinguish:

- `exact_duplicate`: same normalized text hash
- `near_duplicate`: high deterministic shingle or command similarity
- `semantic_candidate`: shared topic or workflow signals with weaker text
  overlap
- `skill_specific`: intentionally local context, usually backed by metadata,
  owner/scope differences, platform conflicts, or reviewer suppression

Reports should be human-reviewable and refactor-oriented. A useful report
groups evidence by candidate context unit, proposes a shared path such as
`context/appium/setup.md`, lists source ranges, explains deterministic signals,
and calls out what should remain skill-specific. LLMs may later label clusters
or draft refactor proposals, but Renma should keep deterministic evidence
authoritative.

## Context Dependency Graph

After cataloging, Renma should build a graph from asset relationships.

Graph checks:

- duplicate asset IDs
- missing dependencies
- dependency cycles
- unused context
- orphaned examples
- orphaned profiles
- skills depending on archived context
- context units with no owner
- references that are linked but not routable
- conflicts that are declared but never enforced
- overloaded skills that route to too many unrelated branches

Possible command:

```bash
renma graph --format json
```

The graph should power validation, catalog output, resolution, semantic diff,
and future visualizations.

## Context Resolution

Resolution is the feature that makes Renma more than a linter.

Resolution selects context for a skill or task using deterministic inputs.

Inputs may include:

- skill ID
- task or intent tags
- platform
- tool
- product
- environment
- profile
- explicit include IDs
- explicit exclude IDs
- repo or project overlay

Example:

```bash
renma resolve --skill mobile-testing --tag appium --platform ios
```

Resolution output should include:

- selected skill
- selected context units
- selected profiles
- selected examples
- selected scripts
- rejected candidates
- rejection reasons
- conflicts encountered
- source evidence
- ordered prompt/context package

Example trace:

```text
Selected:
  appium.setup
    reason: required by mobile-testing

  appium.ios
    reason: matched platform ios

Rejected:
  appium.android
    reason: conflicts with platform ios
```

Resolution should not hide complexity. It should make routing visible and
reviewable.

## Execution Manifest

Resolution should produce an execution manifest describing the exact context
package that would be sent to an LLM or agent runtime.

Manifest fields:

- schema version
- repository root
- selected skill
- selected assets
- rejected candidates and reasons
- dependency edges
- source paths
- versions
- content hashes
- token estimates
- policy decisions
- generated timestamp

Possible command:

```bash
renma resolve --skill mobile-testing --platform ios --format manifest
```

The manifest is the bridge between static repository analysis and runtime
behavior.

## Lockfiles

Lockfiles should come after resolution is stable.

A lockfile should pin context dependencies across repositories or packages.

It may include:

- asset ID
- version
- source repository
- source revision
- content hash
- resolved transitive dependencies

Example:

```json
{
  "schema": "renma.lock.v1",
  "context": {
    "appium.ios": {
      "version": "1.2.0",
      "source": "github:org/context-repo",
      "revision": "abc123",
      "hash": "sha256:..."
    }
  }
}
```

Do not build lockfiles before Renma can explain resolution clearly.

## Semantic Diff

Semantic diff should compare context meaningfully, not just file text.

Initial deterministic diff should compare:

- asset IDs
- metadata changes
- dependency changes
- status changes
- ownership changes
- route changes
- content hash changes
- selected manifest changes for known resolution inputs

Possible command:

```bash
renma diff main...HEAD --format json
```

Later advisory diff may include:

- changed requirements
- removed safety steps
- weakened verification
- duplicated concepts
- conflicting instructions

LLM-assisted or embedding-assisted diff should remain optional and clearly
marked as advisory.

## Duplicate Detection

Duplicate detection is valuable but should not be the next foundation.

Start deterministic:

- identical content hashes
- repeated headings
- repeated link sets
- same metadata IDs
- highly similar filenames
- matching code blocks
- matching command sequences

Then add advisory semantic detection:

- near-duplicate context units
- copied procedures with small edits
- overlapping troubleshooting guides
- skills that duplicate reference material instead of routing to it

Duplicate detection should suggest extraction and reuse, not automatic deletion.

## Reporting Direction

Existing text and JSON output should remain.

Future report modes:

- `json`
- `text`
- `markdown`
- `sarif`
- `agent-json`

Findings should eventually include:

- stable rule ID
- title
- category
- severity
- confidence
- risk
- fixability
- source evidence
- related assets
- suggested remediation
- verification hint when available

Risk values:

- `safe`
- `needs-review`
- `dangerous`

Fixability values:

- `automatic`
- `assisted`
- `manual`
- `not_applicable`

Agent-oriented output should group actions by file and order them by safe fix
sequence. Suggested patches should be conservative and limited to low-risk,
deterministic cases.

## Deterministic Script Opportunities

Renma should identify instructions that are better handled by deterministic
scripts than by LLM interpretation.

Good candidates:

- repeated shell command sequences
- environment diagnostics
- version and path detection
- dependency presence checks
- structured report generation
- file inventory or validation steps
- deterministic transformations
- setup checks that return pass/fail evidence

Poor candidates:

- judgment-heavy troubleshooting
- ambiguous user-intent routing
- safety decisions that require context
- privileged or destructive actions, except dry-run checkers
- anything that hides important reasoning from the user

Example finding:

```json
{
  "id": "QUAL-SCRIPT-OPPORTUNITY",
  "problem": "Skill contains repeated deterministic setup checks that could be moved into a script.",
  "fix": "Add a scripts/check-environment.sh helper and have SKILL.md call it before manual troubleshooting.",
  "severity": "low",
  "risk": "needs-review",
  "fixability": "assisted"
}
```

## Rule Areas To Add

Context architecture:

- `CTX-DUPLICATE-ID`
- `CTX-MISSING-DEPENDENCY`
- `CTX-DEPENDENCY-CYCLE`
- `CTX-UNUSED-ASSET`
- `CTX-ORPHANED-PROFILE`
- `CTX-ORPHANED-EXAMPLE`
- `CTX-DEPRECATED-DEPENDENCY`
- `CTX-ARCHIVED-DEPENDENCY`
- `CTX-MISSING-OWNER`
- `CTX-MISSING-ROUTING-MAP`
- `CTX-AMBIGUOUS-ROUTE`
- `CTX-CONFLICT-NOT-ENFORCED`
- `CTX-OVERLOADED-SKILL`

Skill quality:

- missing or vague trigger guidance
- missing negative routing
- missing preflight questions
- missing verification instructions
- missing rollback or recovery guidance for mutable workflows
- too much procedure text in `SKILL.md`
- references mentioned but not linked
- examples mentioned but not linked

Security and safety:

- literal credentials
- private key material
- unsafe remote defaults
- destructive commands without confirmation or recovery
- environment copying into subprocesses
- unpinned network install commands
- suspicious prompt-injection patterns in imported context
- MCP server configuration risks

Maintenance:

- stale context
- expired context
- missing owner
- archived context still routed
- duplicated scripts or command blocks
- broken local references

## Packaging And Distribution

Packaging should come after local composition and resolution work.

Possible future package concepts:

- context package
- skill package
- organization context catalog
- pinned context dependency
- reusable rule pack

The architecture should resemble package managers, but Renma should avoid
becoming a package registry too early.

Initial distribution can stay Git-native:

- tags
- branches
- submodules or vendored snapshots where teams already use them
- committed catalogs
- committed lockfiles

Hosted registries, dashboards, or API serving modes are future options, not
near-term requirements.

## Existing Systems To Learn From

Renma overlaps with several established patterns:

- package managers: dependency resolution, versioning, lockfiles
- build systems: deterministic graphs and reproducible outputs
- documentation systems: reusable pages, includes, generated indexes
- SBOM tools: provenance, ownership, hashes, manifests
- knowledge graphs: typed nodes and edges
- Terraform modules and Kustomize overlays: composable configuration
- static analyzers: rule IDs, evidence, severity, CI integration
- SARIF tooling: machine-readable findings for code review systems

Renma should borrow the durable ideas, not the full complexity.

## Development Sequence

### Phase 1: Stabilize Scanner And Metadata

Purpose: make current linting dependable while preparing for the model layer.

Work:

- keep text and JSON scan output stable
- tighten metadata parsing
- validate metadata status values
- add duplicate ID checks
- add missing owner checks for stable assets
- add broken local reference checks
- keep current quality and safety rules deterministic
- add tests for metadata edge cases

Success criteria:

- current CLI remains fast and predictable
- metadata fields are stable enough for catalog and graph work
- findings include clear evidence and source paths

### Phase 2: Promote The Normalized Model

Purpose: make the IR the core Renma abstraction.

Work:

- define `Asset`, `Skill`, `ContextUnit`, `Dependency`, and `Composition` types
- make catalog construction produce normalized assets and edges
- preserve source evidence for dependency declarations
- compute content hashes for assets
- keep artifact parsing separate from model construction

Success criteria:

- rules can consume the model instead of only raw parsed documents
- catalog, graph, and future resolution share the same data structure

### Phase 3: Catalog

Purpose: make context inventory visible and reviewable.

Work:

- add `renma catalog --format json`
- add `renma catalog --format markdown`
- list assets by kind, owner, status, path, and dependency summary
- include reverse dependency information
- make output deterministic and commit-friendly
- add catalog tests

Success criteria:

- a team can see what context exists and who owns it
- catalog output can be committed or consumed by other tools

### Phase 4: Dependency Graph

Purpose: make relationships explicit and validate reuse.

Work:

- build graph edges from metadata and links
- add graph validation rules
- detect missing dependencies, cycles, unused assets, and deprecated dependencies
- optionally add `renma graph --format json`
- use graph data in scan findings

Success criteria:

- Renma can explain context structure, not just file quality
- graph checks catch broken reuse before resolution exists

### Phase 5: Resolution And Trace

Purpose: deterministically select context for a skill or task.

Work:

- add `renma resolve`
- accept skill ID and deterministic filters such as platform, tag, profile, include, and exclude
- select required and optional context
- enforce conflicts
- order selected context
- emit selected and rejected candidates with reasons
- add manifest output

Success criteria:

- Renma can answer why context was selected or rejected
- the same inputs produce the same manifest

### Phase 6: Lockfiles And Reproducibility

Purpose: make resolved context portable and reproducible.

Work:

- define `renma.lock.v1`
- pin asset IDs, versions, hashes, and source revisions
- verify lockfile integrity
- report drift between current files and lockfile
- support committed execution manifests for known workflows

Success criteria:

- teams can reproduce a context package across machines and repositories

### Phase 7: Repeated Context Discovery

Purpose: help teams discover reusable context boundaries before formal
refactors.

Work:

- add section-level `ContextFragment` fingerprints for Markdown assets
- detect exact duplicate fragments by normalized text hash
- detect near duplicates with deterministic token shingles and command
  fingerprints
- cluster repeated headings, path terms, tags, tools, links, and workflow
  skeletons into `ContextPatternCandidate` groups
- report suggested shared context paths and source line evidence
- allow metadata-based suppression for intentionally skill-specific context
- keep LLM review optional and advisory

Success criteria:

- teams can see repeated context patterns across skills and repositories
- candidates are useful before semantic embeddings or LLM review exist
- reports help humans decide what to extract into shared context units

### Phase 8: Semantic Diff And Duplicate Detection

Purpose: help teams safely evolve context.

Work:

- add deterministic semantic diff for model-level changes
- compare manifests across revisions
- detect exact and near-exact duplicate content
- detect duplicated command blocks and headings
- compare repeated-context candidates across revisions
- add optional advisory semantic duplicate detection later

Success criteria:

- reviewers can understand the context impact of a change
- duplicated knowledge can be extracted into reusable context units

### Phase 9: Packaging And Ecosystem

Purpose: support reuse across many repositories.

Work:

- define context package conventions
- support package namespaces
- support external catalogs or vendored catalog snapshots
- support reusable rule packs
- evaluate SARIF and markdown reports
- evaluate hosted or API modes only after CLI workflows are strong

Success criteria:

- multiple repositories can share context without copying it manually

## Recommended Near-Term Priority

The next major milestone should be:

1. normalized internal model
2. catalog command
3. dependency graph
4. graph-backed validation rules
5. resolution trace prototype

Defer:

- lockfiles until resolution is stable
- semantic duplicate detection until catalog and graph exist
- hosted serving modes until CLI workflows are proven
- LLM-assisted review until deterministic evidence is strong

## Non-Goals For Now

Renma should not become these yet:

- hosted prompt registry
- LLM judge
- eval runner
- malware scanner
- package registry
- runtime agent framework
- synchronization service

Those may be adjacent future integrations, but they should not drive the core
architecture.

## Design Principles

- Prefer explicit IDs over implicit path conventions when composing context.
- Prefer deterministic graph checks before semantic inference.
- Prefer small metadata fields that directly power commands.
- Prefer source evidence for every finding and graph edge.
- Prefer additive warnings before strict failures for new schema fields.
- Keep `SKILL.md` concise, but preserve operational detail in routed context.
- Do not delete or summarize procedures when splitting context.
- Make selected and rejected context equally visible.
- Make every generated artifact deterministic and reviewable in Git.
