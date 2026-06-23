# Renma

Renma is a Context Asset Repository and health layer for LLM-consumable repository knowledge.

It helps teams keep the skills, instructions, shared context, examples, tool notes, and ownership metadata that agents rely on discoverable, reviewable, and safe to reuse. Instead of letting critical knowledge get copied into many prompts or buried in one-off Markdown files, Renma treats that knowledge as a software asset: named, owned, versioned, linked, and checked in CI.

Renma is especially useful when a repository contains agent-facing material such as:

- Codex, Claude, Cursor, or other agent skills
- `AGENTS.md` and repository instructions
- Shared product, domain, QA, platform, or tool guidance
- Team-owned context assets that should outlive a single prompt
- References and examples that agents should be able to cite or inspect

Renma is not a Markdown linter and not a prompt-management system. Markdown is the storage format today; the product is the catalog, dependency graph, ownership model, and readiness checks around LLM-era repository knowledge.

Use Renma when you need to answer repository-level questions such as:

- What LLM-facing knowledge exists in this repo?
- Which skills, context assets, examples, and tool notes are reusable?
- Which assets are unowned, stale, orphaned, incomplete, deprecated, or broken?
- Which product decisions, bug history, testing strategy, or platform guidance should be promoted from one-off prompt text into shared context?
- What changed in the agent-facing knowledge catalog during this pull request?

## The Layer Model

```text
Tools
  Codex, Claude, Cursor, CI, editors, internal CLIs

Skills
  LLM-facing entrypoints that route an agent toward a task

Context Assets
  Shared domain, product, testing, platform, and tool knowledge

Catalog
  Deterministic IDs, ownership, lifecycle state, dependencies, evidence

Repository
  Git-reviewed source of truth for agent-consumable knowledge
```

Tools decide what to do at runtime. Skills tell an agent when and how to use a capability. Context assets hold reusable knowledge. Renma catalogs and validates the layer underneath so tools and agents are not guessing from stale, orphaned, duplicated, or unowned files.

## Why Renma?

As AI-agent repositories grow, expertise often gets duplicated across skills and prompts. Testing heuristics, domain risks, tool usage notes, product decisions, and team-specific contracts drift apart. Ownership becomes unclear. References break. Deprecated guidance remains reachable. New engineers and agents cannot tell which knowledge is authoritative.

Renma gives that material the same operational posture teams expect from source code:

- Reusable across skills and agents
- Owned by a team or maintainer
- Reviewable in pull requests
- Versioned in Git
- Composable through explicit references and dependencies
- Validated with deterministic checks
- Easy to inspect locally and in CI

For example, a testing organization can keep boundary value analysis, negative testing, regression risk, payment idempotency, duplicate charge prevention, refund edge cases, mobile offline behavior, mobile automation notes, and known team-specific risks as shared context assets instead of burying them inside individual skills.

## Repository Shape

Renma supports existing skill-local references, profiles, and examples. The preferred model is to give reusable knowledge first-class space under `contexts/`:

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
```

`contexts/` is preferred. `context/` is also scanned for compatibility. Files under either root are cataloged as first-class `context` assets, while skill-local `references/` remain supported as `reference` assets.

## What Renma Does Today

Renma is a minimal-dependency TypeScript CLI that scans local repositories and builds a deterministic catalog of agent-consumable assets.

It currently scans:

- AI-agent skills
- Repository instructions such as `AGENTS.md`
- Shared context Markdown under `context/` and `contexts/`
- Skill profiles, references, and examples
- Tool guidance and support files
- README-level repository documentation

It produces:

- File and line-level diagnostics
- Catalog reports with deterministic asset IDs
- Ownership coverage reports
- Dependency graph reports
- Agent readiness reports
- JSON output for CI and downstream tooling
- Text output designed to become actionable repair prompts for humans or agents

Findings are meant to explain what is wrong, why it matters, where the evidence is, what to preserve while fixing it, and how to verify the repair. Renma does not apply large semantic rewrites itself; it emits structured diagnostics so a human or coding agent can propose a reviewable patch and run Renma again.

### Repeated context diagnostics

`renma scan` reports deterministic repeated-context candidates across discovered skills, agents, profiles, references, examples, and shared context assets. These findings are evidence for consolidation, not automatic source-of-truth decisions:

```text
LLM proposes. Renma verifies. Human approves.
```

The MVP rule IDs are:

- `MAINT-REPEATED-SECTION` for repeated normalized section hashes.
- `MAINT-REPEATED-HEADING` for repeated non-generic headings.
- `MAINT-REPEATED-CODE-BLOCK` for repeated substantial code fences.
- `MAINT-REPEATED-LINK` for repeated repository context link targets.
- `MAINT-REPEATED-CONTEXT-PATTERN` for repeated token shingles.

Renma normalizes whitespace and only reports cross-file candidates with stable parser evidence. Remediation text asks maintainers to preserve ownership boundaries, procedural detail, and human approval while consolidating owned knowledge.

## How Renma differs from adjacent tools

Prompt-management and eval tools focus on prompts, traces, and model outputs.

Renma focuses one layer lower: the reusable context assets and skills that prompts, agents, and tools depend on.

Knowledge-management tools help humans organize notes and documents.

Renma focuses on machine-consumable repository knowledge that can be owned, referenced, validated, and reused in AI workflows.

Software catalogs track services, libraries, ownership, and lifecycle.

Renma applies a similar catalog model to context assets.

## First-Time Use

Try Renma against the current repository:

```bash
npx renma scan .
npx renma catalog . --format json
npx renma graph . --format mermaid
npx renma readiness .
npx renma diff . --from main --to HEAD --format markdown
```

The first command does not require you to design a knowledge architecture up front. It scans the repository, builds a local catalog, and reports obvious health issues such as broken links, unclear ownership, risky instructions, weak structure, and context that may be hard for agents to trust.

If you are developing Renma from source:

```bash
npm install
npm run build
node dist/index.js scan .
```

Then inspect the catalog and graph:

```bash
node dist/index.js catalog . --format json
node dist/index.js graph . --format mermaid
node dist/index.js readiness .
node dist/index.js diff . --from main --to HEAD --format markdown
```

Semantic diff compares deterministic catalog, graph, readiness, and finding
snapshots across Git refs. It does not interpret arbitrary prose semantics,
assemble prompts, choose context, call an LLM, repair files, or check out or
mutate the working tree.

A practical first pass is:

1. Run `scan` to find broken links, weak structure, risky instructions, missing lifecycle metadata, and other repairable issues.
2. Run `catalog` to see which skills, context assets, references, examples, and support files Renma discovered.
3. Run `ownership` to find assets without clear ownership.
4. Run `graph` to inspect dependencies and discover orphaned or overly coupled knowledge.
5. Run `readiness` to summarize whether the repository is healthy enough for agent use.

Renma does not require an LLM for this loop. Its core analysis is deterministic so the same repository state produces stable evidence in local development, CI, and code review.

## CLI Commands

```bash
renma scan <path>
renma catalog <path>
renma ownership <path>
renma graph <path>
renma readiness <path>
renma diff <path> --from <ref> --to <ref>
renma ci-report <path> --from <ref> --to <ref>
renma inspect <path> <asset-or-file>
renma suggest-semantic-split <file>
```

Common examples:

```bash
renma scan .
renma scan . --format json
renma scan . --fail-on high
renma catalog . --format json
renma ownership . --include-owned
renma graph . --format mermaid
renma readiness .
renma diff . --from main --to HEAD --format markdown
renma ci-report . --from main --to HEAD --format markdown
renma inspect . contexts/testing/boundary-value-analysis.md
```

Use JSON output when Renma is part of CI or another tool. Use markdown output for PR-review artifacts. Use text output when a person or coding agent needs a concise repair list.

## What Gets Scanned

By default, Renma looks for:

```text
skills/**/SKILL.md
.agents/**/*.md
AGENTS.md
README.md
context/**/*.md
contexts/**/*.md
tools/**/*
```

Renma also understands skill-local support directories such as `profiles/`, `references/`, and `examples/`. Shared knowledge that is reused across skills should usually move into `contexts/` so it can have its own owner, lifecycle, dependencies, and review history.

## Configuration

Add `renma.config.json` at the repository root to tune discovery and CI behavior:

```json
{
  "fail_on": "high",
  "format": "json",
  "globs": [
    "skills/**/SKILL.md",
    "AGENTS.md",
    "contexts/**/*.md"
  ],
  "exclude": [
    "node_modules",
    "dist",
    ".git"
  ],
  "max_file_size_bytes": 524288,
  "max_depth": 16,
  "concurrency": 16,
  "layout": {
    "workflow_aliases": {}
  }
}
```

## Asset Metadata

Renma works best when reusable assets declare lightweight metadata in front matter:

```markdown
---
id: context.testing.boundary-value-analysis
kind: context
owner: qa-platform
status: active
depends_on:
  - context.testing.negative-testing
---

# Boundary Value Analysis
```

Useful metadata includes:

- `id`: Stable catalog ID
- `kind`: `skill`, `context`, `reference`, `example`, `profile`, or support type
- `owner`: Team, person, or group responsible for the asset
- `status`: Lifecycle state such as `active`, `draft`, `deprecated`, or `archived`
- `depends_on`: Other catalog IDs this asset relies on

Renma can infer some information from paths and headings, but explicit metadata makes ownership and dependency reports much more valuable.

## CI Example

For PR review artifacts, see [`examples/github-actions/renma-ci-report.yml`](examples/github-actions/renma-ci-report.yml).

```yaml
name: renma

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  renma:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx renma scan . --fail-on high --format json
```

## Design Philosophy

Renma has an opinionated design.

It is built around the idea that reusable LLM context should be treated like a software asset: owned, versioned, referenced, reviewed, and checked for readiness.

This means Renma favors structured, Git-friendly context repositories over ad hoc prompt snippets or untracked notes.

## Design Boundaries

Renma intentionally stays below the agent runtime layer.

Renma does:

- Catalog LLM-consumable repository assets
- Validate links, structure, lifecycle state, safety signals, and ownership
- Emit deterministic reports with file and line evidence
- Help humans and agents repair knowledge repositories through reviewable patches

Renma does not:

- Choose task-specific context for a live agent session
- Assemble prompts
- Inject context into model calls
- Execute agent workflows
- Act as a provider gateway
- Replace product, QA, platform, or documentation ownership

This boundary keeps Renma useful as repository infrastructure. Agent tools can consume its reports, but the catalog remains grounded in Git, code review, and deterministic checks.

## Development

```bash
npm install
npm run build
npm test
```

Run the local CLI after building:

```bash
node dist/index.js scan .
```

## Related Docs

- [architecture.md](architecture.md) for the deeper system model
- [design.md](design.md) for product and rule-design notes
- [plan.md](plan.md) for current implementation direction
