# Renma Product Design

Renma is a Git-native governance and quality CLI for repositories that hold
LLM-ready context assets and skills.

```text
Renma prepares the environment.
Agents operate within that environment.
```

Renma helps teams keep shared knowledge discoverable, owned, validated,
reviewable, and reusable in Git. It is not an agent runtime and does not decide
what context an agent should load at task time.

## Core Distinction

```text
Skill = LLM-facing entrypoint / routing contract / usage guide
Context = independently owned source-of-truth knowledge asset
```

Skills tell an agent when and how to use a capability. They can route toward
context assets, ask preflight questions, describe safety gates, and define
verification expectations.

Context assets hold reusable expertise. They should be maintainable outside a
single skill, owned by the right team, versioned, reviewed, and reused across
skills, agents, tools, and future agent runtimes.

## Product Boundary

Renma owns repository quality and governance:

- Asset discovery and classification
- Owner, status, lifecycle, and metadata checks
- Broken reference and dependency checks
- Catalog and graph snapshots
- Orphaned, deprecated, archived, conflicting, and missing asset diagnostics
- Deterministic evidence for repeated or duplicated knowledge
- Agent readiness reports for repository maintainers

Renma does not own runtime behavior:

- No skill selection for a user task
- No prompt construction or context bundling
- No context injection into an agent
- No task-specific context choice service
- No tool execution on behalf of an agent
- No provider gateway or agent coordination layer
- No telemetry collection responsibility

Renma may become telemetry-aware by importing external signals from CI, IDE
wrappers, Codex plugins, Claude extensions, or other agent integrations. Those
signals are offline review evidence. Renma itself should not become
telemetry-responsible.

## Repository Model

The target repository shape gives shared context assets first-class space:

```text
skills/
  testing/
    test-case-generation.skill.md
    spec-review.skill.md
    regression-planning.skill.md

contexts/
  testing/
    boundary-value-analysis.md
    negative-testing.md
    regression-risk.md
  domain/
    payment/
      idempotency.md
      duplicate-charge.md
      refund-risk.md
  mobile/
    offline-behavior.md
    background-resume.md
  tools/
    appium/
      usage-guideline.md
      limitations.md
  teams/
    checkout/
      payment-api-contracts.md
      known-risk-patterns.md

metadata/
graph/
catalog/
```

`contexts/` is preferred for shared context assets. `context/` remains supported
as a compatibility alias. Files under either root are classified as the
`context` artifact kind, not as `reference`.

Skill-local `profiles/`, `references/`, and `examples/` remain supported. They
are useful for local routing variants, nearby examples, and skill-specific
supporting text. When knowledge is reusable across skills, teams, tools, or
agents, it should move into `contexts/` as an owned context asset.

## Artifact Kinds

Renma normalizes scanned files into asset kinds:

- `skill`: LLM-facing entrypoint, routing contract, and usage guide
- `context`: shared source-of-truth knowledge asset under `contexts/` or
  `context/`
- `profile`: skill-local overlay or variant
- `reference`: skill-local supporting material
- `example`: skill-local example or fixture text
- `agent`: repository or agent instruction file
- `config`: Renma configuration
- `unknown`: scanned file that does not match a known kind

The dedicated `context` kind is central to the product model. It lets catalog,
graph, and validation output distinguish reusable team-owned knowledge from
skill-local reference material.

## Context Asset Metadata

Context assets should use small, reviewable metadata blocks:

```yaml
id: testing.boundary-value-analysis
version: 1.0.0
owner: qa-platform
status: stable
tags: testing, qa
when_to_use: Designing tests around numeric, date, quantity, or limit boundaries
when_not_to_use: Exploratory testing notes that do not depend on boundaries
requires_context: testing.negative-testing
optional_context: domain.payment.duplicate-charge
conflicts: archived.testing.boundary-v0
```

The current parser supports simple one-line values and comma-separated lists. Richer YAML block-list frontmatter can be added later without changing the product model.

Initial status values:

- `experimental`
- `stable`
- `deprecated`
- `archived`

Renma should start with deterministic validation for fields it actually uses:
duplicate IDs, invalid statuses, missing owner or ID on published shared context,
unknown dependencies, dependencies on deprecated or archived assets, and
conflicts that are declared but not visible in the catalog.

## Dependency Model

Dependencies are typed relationships between assets:

- `requires`: the target asset is needed for the source asset to be complete
- `optional`: useful context that is not always required
- `conflicts`: assets that should not both be active without human review
- `extends`: overlay or profile relationship
- `routes_to`: skill routing relationship toward a context asset or local file
- `covered_by`: evaluation or evidence coverage relationship

Edges should carry source evidence: path, range when available, declaration
form, and enough snippet text for review.

The graph is repository evidence. It must not become a task-specific context selector.

## Core Workflow

Renma should keep the deterministic path boring and reliable:

1. Load configuration from defaults, config files, and CLI flags.
2. Discover bounded repository files with stable POSIX-style paths.
3. Classify artifacts into normalized kinds, including first-class `context`.
4. Parse Markdown, frontmatter, headings, links, code fences, and metadata.
5. Build catalog entries with IDs, kind, source path, content hash, owner,
   status, tags, declared dependencies, dependents, and diagnostics.
6. Build graph snapshots from declared references and dependency metadata.
7. Run deterministic rules over parsed files and graph evidence.
8. Emit text, JSON, markdown, and future SARIF-style reports suitable for Git
   review and CI.

Optional LLM assistance may help with semantic split suggestions, duplicate
labeling, or review summaries. LLM output is advisory. Deterministic evidence is
the authority.

## Rules

Early deterministic rules should focus on repository health:

- Missing context asset ID
- Missing owner on shared context assets
- Invalid lifecycle status
- Duplicate asset IDs
- Missing required dependency
- Dependency on deprecated or archived context
- Declared conflict not present in the catalog
- Orphaned shared context asset
- Broken Markdown links
- Oversized skill entrypoint
- Oversized context or skill-local support file
- Missing skill routing guidance
- Missing negative routing guidance
- Missing preflight or verification guidance
- Unused skill-local profile, reference, or example
- Literal secret-like values
- Destructive commands without nearby confirmation or recovery guidance
- Risky remote defaults
- Broad environment copying into subprocesses
- Hardcoded user-local paths in reusable guidance

Passing Renma checks does not prove a workflow is safe. It means the repository
met the deterministic governance checks that were enabled.

## QA And Testing Focus

QA/testing is the first strong product focus because teams often ask agents to
generate tests while the real expertise lives in scattered documents or senior
engineers' heads.

Good context assets in this domain include:

- Boundary value analysis
- Negative testing heuristics
- Regression risk models
- Payment idempotency and duplicate-charge risk
- Refund edge cases
- Mobile offline and background-resume behavior
- Appium usage limits
- Team-specific test strategy
- Known checkout or payment contract risks

Skills can route to those assets for tasks such as test-case generation, spec
review, regression planning, or release readiness. The context assets remain
the source of truth.

## Catalog Output

`renma catalog` should provide deterministic inventory:

- ID
- Kind
- Source path
- Content hash
- Owner
- Status
- Tags
- Declared dependencies
- Dependents
- Diagnostics

Catalog output should be stable across filesystems and Node versions so diffs
are useful in pull requests.

## Agent Readiness

An agent readiness report should answer repository-level questions:

- Are shared context assets identifiable and owned?
- Are lifecycle states explicit?
- Are skills clear entrypoints rather than overloaded knowledge dumps?
- Are dependency declarations resolvable?
- Are deprecated or archived assets still reachable?
- Are important context assets orphaned?
- Is repeated knowledge visible enough for maintainers to consolidate it?
- Which changed assets affect which skills or teams?

Readiness is about preparing the repository for agents. It is not a guarantee
about any particular agent run.

## Implementation Principles

- Prefer deterministic analysis over hidden inference.
- Keep the CLI minimal-dependency and Git-friendly.
- Keep repository paths stable and portable.
- Parse structured metadata instead of relying on ad hoc text matching where
  reasonable.
- Preserve human ownership and review.
- Treat existing documents as changeable product design, not sacred API.
- Make shared context first-class before adding external signal features.
- Design for gradual adoption in repositories that already have skill debt.
