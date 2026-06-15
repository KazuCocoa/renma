# Renma Architecture Direction

Renma should evolve from a deterministic skill scanner into a Git-native context engineering toolkit.

The core product is not prompt storage, package synchronization, or a hosted dashboard. The core product is deterministic resolution of AI skills and context, with enough provenance that teams can answer:

- What context exists?
- Who owns it?
- Why was this context selected?
- What was rejected?
- What changed?
- Can this run be reproduced?

## Product Thesis

Organizations do not only need better prompts. They need a way to engineer knowledge so AI agents can consume the right context at the right time.

Renma should treat context as software:

- versioned
- reviewable
- owned
- composable
- traceable
- reproducible

The product should remain CLI-first and Git-native. Hosted servers, dashboards, provider gateways, and synchronization transports are out of scope for this project.

## Git-Native Multi-Team Usage

Renma should work well when one shared skills and context repository is consumed by many teams, including organizations with 10+ or 50+ teams.

Renma should not implement synchronization itself. Instead, it should produce deterministic artifacts that fit normal Git workflows:

- tags and release branches for shared skill repositories
- commit SHA pinning for consumers
- generated catalogs committed or published from CI
- lockfiles that record selected context versions and hashes
- semantic diffs for code review
- trace reports that explain why a pinned revision selected specific context
- local overlays that can be reviewed separately from shared foundations

In this model, Git and CI handle distribution, review, and adoption mechanics. Renma handles validation, cataloging, resolution, provenance, and reproducibility for the files under version control.

## Current Baseline

Renma currently provides:

- deterministic discovery of skill-related files
- bounded filesystem scanning
- markdown parsing
- quality, structure, and safety findings
- text and JSON reports
- config-driven scan behavior
- CI-friendly exit codes

This is a good foundation for traceability because Renma already operates on explicit files, stable paths, line evidence, and deterministic rules.

## Target Architecture

```text
Source artifacts
  Markdown, YAML, docs snapshots, generated context
        |
        v
Importers and parsers
        |
        v
Normalized model
        |
        v
Validation and semantic checks
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

The normalized model is the contract. Markdown, YAML, URLs, internal docs, future MCP adapters, and LLM-assisted imports are adapters into the model.

Users should not need to understand the model directly. They should work with normal files and commands. The model exists to keep Renma deterministic, extensible, and testable.

## Core Concepts

### Skill

A skill defines LLM-facing behavior: role, task boundaries, workflow, safety gates, and verification expectations.

`SKILL.md` should remain concise. It should behave like an orchestrator and routing entrypoint, not a dumping ground for every reference detail.

### Context Unit

A context unit is a coherent unit of reasoning, not an arbitrary text chunk.

Good context boundaries follow:

- concept
- owner
- update frequency
- task relevance
- conflict surface

Example:

```text
product/
  overview.md
  terminology.md
  business-rules.md
  edge-cases.md
  integrations.md
```

Large source documents can remain authoritative elsewhere. Renma snapshots should be reproducible, reviewable working copies prepared for AI consumption.

```text
source of truth
        |
        v
snapshot / normalized context
        |
        v
validated normalized model
        |
        v
context injection
```

### Metadata

Skills and context units need machine-readable metadata so Renma can validate, catalog, resolve, and trace them.

Example:

```yaml
id: ios-release-process
version: 1.4.2
owner: mobile-platform
scope: org
priority: 70
status: stable
when_to_use:
  - releasing iOS apps
  - TestFlight workflows
when_not_to_use:
  - Android releases
freshness: 2026-06-01
expires_at: 2026-12-31
```

Metadata should be useful before it is complete. The first implementation can validate a small stable subset:

- `id`
- `version`
- `owner`
- `status`
- `when_to_use`
- `when_not_to_use`
- `requires_context`
- `optional_context`
- `conflicts`

### Resolution

Resolution selects the skill and context units for a task.

Inputs may include:

- task or intent
- product
- platform
- device
- environment
- profile
- explicit include or exclude flags
- repo, project, user, or conversation overlays

Resolution output should include selected and rejected candidates, with reasons.

```text
Selected:
  product.overview
    reason: required by test-design
  device.iphone-15-pro
    reason: matched --device iphone-15-pro

Rejected:
  android-device-context
    reason: conflicts with platform: ios
```

### Execution Manifest

A run should produce a manifest describing the exact context package that would be sent to an LLM or agent runtime.

The manifest should include:

- selected skill
- selected context units
- rejected candidates and reasons
- source paths
- versions
- content hashes
- policy decisions
- token estimates
- generation timestamp

The manifest is the bridge between static repository state and runtime behavior.

## Layered Roadmap

### Layer 1: Validation

Current Renma lives here.

Responsibilities:

- scan files
- parse markdown and metadata
- detect quality issues
- detect safety risks
- detect structure problems
- report evidence

Near-term additions:

- stricter metadata parsing
- duplicate ID checks
- stale and expired context checks
- context routing checks
- context size guidance

### Layer 2: Catalog

Catalog makes context discoverable without a server.

Commands:

```bash
renma catalog --format markdown
renma catalog --format json
```

Questions answered:

- What skills and context units exist?
- Who owns them?
- What status are they in?
- Which files are stale or deprecated?
- What context does a skill require?

Generated artifacts such as `CATALOG.md` and `catalog.json` can be committed, published, or consumed by future dashboards.

### Layer 3: Resolution And Trace

Resolution is where Renma moves beyond scanning.

Commands:

```bash
renma resolve test-design --product my-app --platform ios --environment staging
renma trace test-design --product my-app --platform ios --environment staging
```

Questions answered:

- Which context would be selected?
- Why was it selected?
- What was rejected?
- Which conflicts or missing requirements exist?

This layer should not call an LLM. It should only produce a deterministic context package and explanation.

### Layer 4: Lockfiles

Lockfiles make resolved context reproducible.

Command:

```bash
renma lock test-design --product my-app --platform ios --environment staging
```

Output:

```yaml
skill_id: test-design
generated_at: 2026-06-15T00:00:00Z
resolved_files:
  - path: skills/test-design/SKILL.md
    hash: sha256:...
  - path: context/product/overview.md
    hash: sha256:...
```

Lockfiles should freeze the selected context set, not replace Git history.

### Layer 5: Semantic Diff

Git shows textual changes. Renma should explain AI-behavior-relevant changes.

Command:

```bash
renma diff --from main --to HEAD
```

Diff categories:

- routing changes
- ownership changes
- priority changes
- status or lifecycle changes
- conflict changes
- required context changes
- risk changes

### Layer 6: Local Context Packaging

Execution should remain local and thin.

Command:

```bash
renma run test-design --product my-app --platform ios --environment staging
```

Initial behavior can produce an LLM-ready context package plus manifest. Invoking configured agent runtimes or providers is out of scope.

Renma should keep local packaging provider-neutral:

- no required hosted LLM
- no required server
- deterministic dry-run mode
- clear provenance for any generated prompt package

### Out Of Scope: Gateway And Synchronization

Renma should not own provider gateways, hosted dashboards, package synchronization, or organization-wide distribution workflows in this project.

Out-of-scope commands include:

```bash
renma install
renma update
renma sync
```

OpenTelemetry-style runtime observability, provider invocation, dependency resolution, version negotiation, rollout strategy, and cross-repository governance are separate product surfaces. Renma should instead focus on context provenance in Git-managed local artifacts: selected context, rejected context, versions, hashes, and policy decisions.

## Layered Context Precedence

Renma should support shared foundations and local specialization.

Recommended precedence:

```text
platform
  > organization
  > team
  > project
  > user
  > conversation
```

Higher-precedence layers should not silently override safety-critical instructions. Overrides need trace entries so reviewers can see when local context changed behavior.

## LLM-Assisted Authoring

LLMs can help users create or repair Renma artifacts, but deterministic validation remains authoritative.

Principle:

```text
LLM proposes. Renma verifies. Human approves.
```

Workflow:

```text
rough docs or source material
        |
        v
LLM-assisted draft
        |
        v
renma scan
        |
        v
renma repair / import suggestions
        |
        v
human review in Git
        |
        v
canonical Renma artifacts
```

Potential commands:

```bash
renma import ./docs --suggest
renma repair scan-report.json --print-prompt
renma repair scan-report.json --apply
```

No-LLM workflows must remain first-class.

## MVP Sequence

The next practical sequence should be:

1. Parse and validate metadata.
2. Build a repository catalog.
3. Introduce normalized model types for skills and context units.
4. Add deterministic context resolution.
5. Add trace output for selected and rejected context.
6. Add lockfiles for reproducible resolved context.
7. Add semantic diff over the normalized model and lockfiles.
8. Add `run` as deterministic context packaging.
9. Keep gateway, provider execution, hosted dashboards, and synchronization out of scope.

This sequencing preserves the current strengths while expanding toward the larger product vision one useful layer at a time.
