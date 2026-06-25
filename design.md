# Renma Product Design

Renma is a Git-native deterministic governance and quality CLI for repositories that hold
Codex/Claude-ready context assets and skills.

Current product surface includes `scan`, `catalog`, `ownership`, `graph`, focused graph views, `readiness`, repeated-context diagnostics, semantic diff, `ci-report`, `inspect`, `scaffold`, `suggest-semantic-split`, and security diagnostics v1 for agent-facing operational instructions.

```text
Renma prepares the environment.
Agents operate within that environment.
```

Renma helps teams keep shared knowledge discoverable, owned, validated,
reviewable, and reusable in Git. It is not an agent runtime and does not decide
what context an agent should load at task time.

## Core Distinction

```text
Skill = Codex/Claude-ready entrypoint / routing contract / usage guide
Context = independently owned source-of-truth knowledge asset
```

Skills tell an agent when and how to use a capability. They can reference
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
- Deterministic readiness reports for repository maintainers

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

## LLM-Actionable Diagnostics

Security diagnostics v1 focuses on conservative operational-instruction risks. It does not yet implement disclosed-area policy metadata, approved destination validation, or runtime enforcement.

Security diagnostics are deterministic review guardrails for LLM-facing operational instructions. They flag patterns such as unpinned remote shell execution, unpinned dependency installs, privileged commands without nearby guardrails, predictable temporary paths, and credential-like command arguments; they do not replace SAST, secret scanning, dependency scanning, or human security review.

Renma findings should be useful not only to humans, but also to LLM coding
agents. A good Renma diagnostic should explain what is wrong, why it matters for
repository governance, where the evidence is, what direction a safe fix should
take, what constraints must be preserved, and how to verify the fix.

Renma should not apply large semantic rewrites by itself. It should produce
structured diagnostics that can be pasted into Codex, Claude, Cursor, or another
agent to guide a reviewable repository patch.

Existing findings already include evidence, `whyItMatters`, and `remediation`.
Over time, findings may also include repair constraints, verification steps, and
LLM-specific hints. These fields should remain deterministic rule output, not
LLM-generated validation.

Example diagnostic shape:

```json
{
  "id": "RMA-SKILL-TOO-MONOLITHIC",
  "severity": "medium",
  "category": "structure",
  "title": "Skill mixes reusable knowledge with usage guidance",
  "evidence": {
    "path": "skills/testing/test-case-generation.skill.md",
    "startLine": 42,
    "endLine": 78,
    "snippet": "boundary value analysis"
  },
  "whyItMatters": "Reusable QA and domain knowledge should be owned, reviewed, and reused as shared context assets instead of being buried in one skill.",
  "remediation": "Split reusable knowledge into first-class shared context assets and keep the skill as an LLM-facing usage guide.",
  "constraints": [
    "Do not introduce task context selection.",
    "Do not create prompt packages.",
    "Keep the skill as a routing contract / usage guide.",
    "Each context asset should have id, owner, status, and short scope."
  ],
  "verificationSteps": [
    "Run renma scan.",
    "Run any project-specific validation checks that apply to this repository.",
    "Ensure the skill no longer mixes reusable domain knowledge with usage guidance."
  ],
  "llmHint": "Create shared context assets for reusable QA knowledge, update skill metadata, and preserve the skill as a concise usage guide."
}
```

Central repair workflow:

1. A single `SKILL.md` contains reusable domain knowledge, tool guidance, and
   QA heuristics.
2. Renma emits structured findings explaining that the skill is too monolithic
   and mixes usage guidance with reusable context.
3. Codex or Claude reads the diagnostics and proposes a patch that moves
   reusable knowledge into first-class context assets under `contexts/`, keeps
   the skill concise, adds metadata, and updates declared context references.
4. A human reviews the patch.
5. Renma scans the repository again and confirms the skill/context separation is
   healthier.

Optional LLM-assisted evaluation is advisory and outside core validation. See
`architecture.md` section `Optional LLM Evaluation Boundary` for the rule:
`scan`, catalog construction, and deterministic rule evaluation do not call an
LLM; optional helpers may prepare review bundles or suggestions for a human or
calling agent to apply.

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

Renma can also flag large skill-local support files as shared-context candidates when they contain generic source-of-truth structure such as setup, decision logic, troubleshooting, validation, constraints, policy, or procedure guidance. This advisory does not decide semantic reuse itself. It surfaces structurally broad support files and asks the calling LLM or human to inspect the repository for similar concepts, overlapping guidance, and reuse opportunities before making a reviewable patch.

Shared context assets should be organized by semantic scope, not migration state. Folders such as `contexts/promoted/` or `contexts/generated/` can be useful temporary staging concepts, but final context assets should live under meaning-oriented paths such as `contexts/tools/...`, `contexts/domain/...`, `contexts/testing/...`, `contexts/teams/...`, `contexts/policies/...`, or `contexts/platform/...`.

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
---
id: context.testing.boundary-value-analysis
title: Boundary Value Analysis
kind: context
owner: qa-platform
status: stable
version: 1.0.0
tags:
  - testing
  - qa
when_to_use:
  - Designing tests around numeric, date, quantity, or limit boundaries
when_not_to_use:
  - Exploratory testing notes that do not depend on boundaries
requires_context:
  - testing.negative-testing
optional_context:
  - domain.payment.duplicate-charge
conflicts:
  - archived.testing.boundary-v0
---
```

The current parser supports full YAML frontmatter for these deterministic metadata fields. Supported block-list fields include `when_not_to_use`, `requires_context`, `optional_context`, `depends_on`, `related`, `relates_to`, `replaces`, and `supersedes`.

Initial status values:

- `experimental`
- `stable`
- `deprecated`
- `archived`

`status` describes lifecycle only. It should not be used for replacement,
delegation, migration provenance, or canonical-source relationships. For
example, a skill-local reference replaced by a shared context asset should use a
valid lifecycle status such as `deprecated`, plus a separate relationship field
such as `superseded_by: contexts/tools/example/setup.md` when the repository
needs to preserve that link. Renma may catalog `superseded_by` as a static
reference relationship, but it should not treat values such as `active` or
`delegated` as valid lifecycle statuses.

When reusable knowledge is promoted from a skill-local support file into
`contexts/`, the original `skills/*/references/` file may remain temporarily as
a compatibility shim. Renma can warn when a skill still routes readers through a
deprecated or superseded local support asset instead of referencing the
canonical shared context directly.

Renma can also warn when other repository assets continue to reference a
deprecated or superseded support file instead of the canonical shared context.
This broader advisory helps remove hidden indirection after context promotion
while preserving compatibility shims when they are intentionally needed.

Renma starts deterministic validation for fields it actually uses: duplicate IDs,
invalid statuses, missing owner or ID on published shared context, unknown
declared references, dependencies on deprecated or archived assets, and orphaned
first-class shared context assets. Declared references resolve by exact asset ID
or repository-relative path, with a leading `./` normalized away. Renma does not
use fuzzy matching, semantic search, LLM inference, or runtime context selection
for these checks.

## Dependency Model

Dependencies are typed relationships between assets:

- `requires`: the target asset is needed for the source asset to be complete
- `optional`: useful context that is not always required
- `conflicts`: assets that should not both be active without human review
- `extends`: overlay or profile relationship
- `references`: declared static relationship from a skill or support asset toward a context asset or local file
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

Implemented deterministic rules focus on repository health:

- Missing context asset ID
- Missing owner on shared context assets
- Invalid lifecycle status
- Duplicate asset IDs
- Unknown declared references
- Declared dependency on deprecated or archived context
- Orphaned shared context asset
- Superseded local support asset reference advisories
- Oversized skill entrypoint
- Skill may contain reusable context worth extracting
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

Current reporting includes deterministic readiness output, ownership coverage,
context graph snapshots, and static safety findings for agent-facing repository
content. Near-term reporting should extend repeated context discovery, semantic
diffs, stronger security and supply-chain safety diagnostics, CI examples, and
optional external-LLM advisory evaluation bundles.

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

Skills can reference those assets for tasks such as test-case generation, spec
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

## Repository Health Readiness

Readiness v1 is a deterministic static repository-health report for maintainers:

```bash
renma readiness [path] [--format json|markdown]
```

It answers repository-level questions:

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

The Markdown report is intentionally compact for PR review: level, score, workflow readiness, graph resolution, ownership coverage, diagnostics, and layout status. The JSON report exposes the same deterministic facts for CI.

Readiness does not call an LLM, select runtime context, assemble prompts, auto-repair files, perform cross-document semantic consistency analysis, score repairability, or plan per-skill patches.

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
