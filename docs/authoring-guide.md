# Renma Authoring Guide

Use this guide when creating or refining Renma skills and context assets. For CLI command syntax, see the [User Manual](user-manual.md). For experimental context lens assets, see [Context Lens Assets](context-lens.md). For security-sensitive skills or context assets, read the [Security Policy Guide](security-policy.md). For finding details, use the [Diagnostics Reference](diagnostics.md). For shared-context wording guidance, see [Context Language Diagnostics](context-language-diagnostics.md).

For the target 0.16.0 `SKILL.md` format and migration rules, use the normative
[Agent Skills Compatibility and Migration](agent-skills-compatibility.md)
document. Agent Skills owns standard top-level Skill fields; Renma governance
extensions use flat `metadata.renma.*` string values.

Renma is a tool-assisted authoring and verification layer. It emits deterministic repository evidence that humans and external LLM tools can use, but Renma does not call an LLM, choose runtime context, assemble prompts, inject context into agents, execute agent workflows, or own runtime telemetry.

A practical authoring loop is:

```text
scaffold
-> edit skill/context/lens
-> inspect
-> scan
-> catalog
-> focused graph
-> readiness
-> suggest-metadata for existing assets that need compact metadata
-> give Renma output to an external LLM if useful
-> human reviews patch
-> rerun Renma
```

Principle:

```text
LLM proposes. Renma verifies. Human approves.
```

## Recommended Metadata

Assets can use simple YAML-style metadata at the top of Markdown files. For shared context assets, start with a small, deterministic block like this:

```yaml
---
id: context.testing.boundary-value-analysis
title: Boundary Value Analysis
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
  - context.testing.negative-testing
optional_context:
  - context.testing.regression-risk
---
```

Use these fields consistently:

- `id`: stable catalog asset ID. It should be deterministic and should not change when the file moves unless the asset's identity changes.
- `title`: human-readable title.
- `owner`: recommended real owning team or maintainer. Avoid placeholder ownership in shared assets.
- `status`: lifecycle only: `experimental`, `stable`, `deprecated`, or `archived`.
- `version`: optional asset metadata. It is not the npm package version.
- `type`: optional discriminator. Currently only `context_lens` has defined catalog meaning, and only for context files.
- `tags`: searchable labels that help navigation, ownership review, and reporting.
- `when_to_use` and `when_not_to_use`: scope guidance for humans and agents.
- `requires_context` and `optional_context`: static graph relationships to other assets. They do not make renma select runtime context.
- `requires_lens` and `optional_lens`: static graph relationships from a skill to context lens assets.
- `applies_to`: required static graph relationship from a context lens to the context assets it interprets.
- `purpose`, `focus`, and `expected_outputs`: compact lens metadata for deterministic Context Lens governance review.
- `conflicts`: assets that should not be used together without review.
- `superseded_by`: replacement or migration relationships for deprecated or archived content.

### Ownership policy

Renma treats `owner` as governance metadata. Declaring an owner is recommended because it makes context assets easier to review, maintain, and share across teams.

However, owner metadata is not globally required yet. Assets without an owner are accepted and reported as unowned in the ownership coverage report.

Renma does not infer owners automatically. If an asset is unowned, choose an owner through human review or team policy.

The supported list-style metadata fields are `tags`, `when_to_use`, `when_not_to_use`, `requires_context`, `optional_context`, `requires_lens`, `optional_lens`, `applies_to`, `focus`, `expected_outputs`, `conflicts`, and `superseded_by`.

Lens fields are graph, catalog, readiness, and inspect metadata. A valid 0.12.0 lens declares `id`, `owner`, `purpose`, and `applies_to`. Lens fields do not make Renma select runtime lenses, rank context, assemble prompts, or inject context into agents.

The Context Lens governance boundary is: LLM proposes. Renma verifies. Human approves.

Keep `when_to_use` and `when_not_to_use` compact. They are routing boundaries for catalog and graph review, not full procedures. Put detailed explanation, examples, caveats, and rationale in the Markdown body or referenced context assets.

For shared context bodies, avoid leaving English vague wording such as `usually`, `often`, `quickly`, or `as needed` without a concrete condition, threshold, required evidence, or explicit uncertainty-handling rule. Avoid relative currentness wording such as `recently`, `latest`, `currently`, or `as of now` unless the same line includes a stable date or version.

Shared context assets should hold reusable knowledge, not prompt artifacts or runtime routing rules. Keep assistant role instructions, prompt assembly, context priority, and runtime context-selection behavior outside shared context assets.

## Skill vs Context Metadata

Skills are agent-facing entrypoints and routing contracts. They explain when a capability applies, what safety or preflight checks matter, and which owned context assets are relevant.

Context assets are independently owned source-of-truth knowledge units. They should carry stronger ownership, lifecycle, usage-boundary, and dependency metadata because they are intended to outlive a single skill.

Keep skills thin. A skill should reference context assets instead of embedding all reusable knowledge directly in `SKILL.md`.

The following uses the pre-0.16 Renma Skill format and is a migration source for
0.16.0, not the canonical target format. See the Agent Skills compatibility
document for the canonical equivalent.

Pre-0.16 example:

```yaml
---
id: skill.testing.spec-review
title: Spec Review
owner: qa-platform
status: stable
tags:
  - testing
  - spec-review
requires_context:
  - context.testing.boundary-value-analysis
  - context.testing.negative-testing
optional_context:
  - context.domain.payment.idempotency
---
```

## First Skill Walkthrough

Use `scaffold` when you want a safe starter file for a new skill. This command creates a minimal skill entrypoint:

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md \
  --id skill.testing.spec-review \
  --title "Spec Review" \
  --owner qa-platform \
  --tags testing,spec-review
```

If you want to hand the scaffold and authoring constraints to an external or local LLM before creating the file, emit a prompt instead:

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md \
  --id skill.testing.spec-review \
  --title "Spec Review" \
  --owner qa-platform \
  --tags testing,spec-review \
  --format prompt > spec-review-authoring-prompt.md
```

Review the prompt, add any repository-specific evidence or constraints, then give it to your LLM tool. The LLM should propose a repository patch; Renma still verifies the result after you apply and review it.

For an experimental context lens starter, use:

```bash
renma scaffold context_lens lenses/testing/spec-review-boundary-values.md \
  --id lens.testing.spec-review.boundary-values \
  --title "Spec Review Boundary Values Lens" \
  --owner qa-platform \
  --tags testing,spec-review
```

Inspecting a lens shows its purpose metadata, inbound skill references, outbound `applies_to` dependencies, and the declared `skill -> lens -> context` relationship chain.

For generated skills, the file is intentionally small. Treat it as a starting point for review, not as a complete skill. Fill in these sections before depending on it:

- Purpose: the recurring task, decision, or workflow the skill guides.
- Required Inputs: the evidence, files, issue links, specs, diffs, or user answers needed before work begins.
- Instructions: the routing steps, preflight checks, decision points, and expected handoff.
- Context References: the durable context assets listed in `requires_context` and `optional_context`.
- Constraints: safety, ownership, policy, and product-boundary rules the agent must preserve.
- Validation: the checks that prove the result is ready to review.

A beginner-friendly authoring loop is:

```bash
renma inspect skills/testing/spec-review/SKILL.md
renma scan .
renma catalog . --format json
renma graph . --focus skill.testing.spec-review --format mermaid
renma readiness . --format markdown
```

Renma does not call an LLM, choose runtime task context, assemble live prompts, inject context into agents, execute agent workflows, or own runtime telemetry. It emits deterministic repository evidence. You can give that evidence to your own local or external LLM tool:

1. Give the scaffolded skill or scaffold prompt to the LLM.
2. Give relevant `renma inspect`, `scan`, `catalog`, `graph`, or `readiness` output.
3. Ask the LLM to propose a patch.
4. Review the patch as a human owner.
5. Run Renma again.
6. Repeat until the skill is thin, owned, linked, and ready.

Copyable prompt:

```text
I am authoring a Renma skill.

Use the scaffolded skill and Renma diagnostics below.
Propose a minimal patch that:
- keeps the skill as a thin routing contract
- moves reusable knowledge into context assets
- preserves supported metadata fields
- adds required/optional context references where appropriate
- fixes Renma findings without weakening safety policy
- does not invent owners, policies, dependencies, or domain facts

Renma output:
<paste scan/catalog/graph/readiness output here>
```

For finding details, use the finding ID in the output and check [Diagnostics Reference](diagnostics.md).

## Retrofitting Metadata Onto Existing Assets

Use `suggest-metadata` when an existing `SKILL.md` or context asset needs compact governance metadata but you do not want Renma to rewrite the file.

```bash
renma scan .
renma ownership .
renma suggest-metadata skills/testing/spec-review/SKILL.md --format prompt
renma suggest-metadata skills/testing/spec-review/SKILL.md --owner qa-platform --format json
```

The command emits a deterministic prompt or JSON payload for a human or coding agent. It tells the agent to inspect the existing asset, preserve the Markdown body, preserve existing frontmatter values, add only missing metadata that is clearly supported, and rerun `renma scan .` and `renma ownership .` after editing.

For a Skill target using the pre-0.16 Renma Skill format, `suggest-metadata`
produces a one-way Agent Skills metadata migration proposal. Separately,
`skill.md` and `*.skill.md` targets make any required entrypoint rename or move
explicit, even when their frontmatter already uses Agent Skills fields. For a
canonical Agent Skill, `--owner` may instead produce a
`metadata.renma.owner` retrofit; it never causes reverse migration. Unsafe or
ambiguous input blocks canonical frontmatter. See the normative compatibility
document for the detailed migration contract.

Owner policy stays the same: `owner` is recommended governance metadata, not globally required. Renma accepts unowned assets and reports them in ownership coverage. Without `--owner`, the prompt says not to add owner unless one is already declared or a maintainer provides one. With `--owner <owner>`, the prompt may include that owner because it was explicitly provided. If an existing asset already declares an owner, `suggest-metadata` preserves it; a different `--owner` value is treated as a human-review ownership change, not an automatic metadata suggestion. Renma does not infer owners from Git history, file paths, prose, or authors.

### When To Create Context Assets

Skills should not absorb all reusable knowledge. Keep the skill as the agent-facing routing contract, and move durable knowledge into owned context assets.

A skill should contain:

- when to use the capability
- when not to use it
- required inputs
- routing and preflight guidance
- which context assets to reference
- expected output and validation

A context asset should contain:

- reusable domain knowledge
- testing heuristics
- setup constraints
- tool limitations
- team-specific policy or risk
- platform-specific facts
- source-backed guidance that can outlive one skill

Example layout:

```text
Skill:
  skills/testing/spec-review/SKILL.md

Shared context:
  contexts/testing/boundary-value-analysis.md
  contexts/testing/negative-testing.md
  contexts/domain/payment/idempotency.md
```

The skill can declare static repository relationships:

```yaml
requires_context:
  - context.testing.boundary-value-analysis
  - context.testing.negative-testing
optional_context:
  - context.domain.payment.idempotency
```

Renma records and verifies these relationships in the repository catalog and graph. It does not select runtime context for a task.

## Deriving A New Router From An Existing Skill

A repository may already contain a broad skill category such as setup, test code generation, spec review, regression planning, or release preparation. Over time, teams may need separate routers for the same category:

```text
setup
  appium-ios-simulator-setup
  appium-android-emulator-setup
  appium-real-device-setup

test code generation
  mobile-ui-test-generation
  api-contract-test-generation
  payment-regression-test-generation
```

Do not turn the original skill into one giant router unless the boundaries are genuinely the same. Create thin router skills that share context assets where possible.

Start by inspecting the existing skill and its relationships:

```bash
renma inspect skills/setup/appium/SKILL.md
renma graph . --focus skill.setup.appium --format mermaid
renma catalog . --format json
```

Then ask an LLM to draft a reviewable patch:

```text
I want to derive a new Renma router skill from an existing skill.

Existing skill:
<paste inspect output or relevant file slice>

Existing graph:
<paste focused graph output>

Goal:
Create a new router for <team/platform/use case>.

Constraints:
- preserve shared context assets where they still apply
- do not duplicate reusable setup knowledge
- move new durable setup guidance into context assets
- keep the skill thin
- use requires_context for always-needed context
- use optional_context for conditional context
- add conflicts only when two routers should not be used together without review
- do not invent owners or facts
```

The LLM should produce a repository patch, not runtime behavior:

- a new `skills/.../SKILL.md`
- optionally new `contexts/.../*.md`
- updated `requires_context` and `optional_context`
- no runtime context selection logic
- no prompt assembly
- no external service calls

### Appium Setup Example

Appium setup is a good fit for derived routers because teams often share tool knowledge while splitting platform setup paths:

```text
skills/setup/appium-ios-simulator/SKILL.md
skills/setup/appium-android-emulator/SKILL.md
skills/setup/appium-real-device/SKILL.md

contexts/tools/appium/setup-basics.md
contexts/tools/appium/capabilities.md
contexts/platform/ios/simulator-setup.md
contexts/platform/android/emulator-setup.md
contexts/mobile/real-device-risk.md
```

The routing idea is:

- the broad category is `setup`
- each skill is a router for a specific setup scenario
- shared Appium knowledge goes under `contexts/tools/appium/`
- platform-specific setup knowledge goes under `contexts/platform/ios/` or `contexts/platform/android/`
- device-specific risks go under `contexts/mobile/`
- team-specific policy can go under `contexts/teams/...`

Example `skills/setup/appium-ios-simulator/SKILL.md` metadata:

```yaml
---
id: skill.setup.appium-ios-simulator
title: Appium iOS Simulator Setup
owner: mobile-platform
status: experimental
tags:
  - setup
  - appium
  - ios
requires_context:
  - context.tools.appium.setup-basics
  - context.platform.ios.simulator-setup
optional_context:
  - context.tools.appium.capabilities
---
```

Example `skills/setup/appium-android-emulator/SKILL.md` metadata:

```yaml
---
id: skill.setup.appium-android-emulator
title: Appium Android Emulator Setup
owner: mobile-platform
status: experimental
tags:
  - setup
  - appium
  - android
requires_context:
  - context.tools.appium.setup-basics
  - context.platform.android.emulator-setup
optional_context:
  - context.tools.appium.capabilities
---
```

Renma can verify that these routers are owned, thin, connected to context assets, and not duplicating the same Appium setup knowledge.

### Router Selection Guidance

Renma does not choose the router at runtime, but the repository can document routing boundaries. A good router skill should answer:

- When should this skill be used?
- When should it not be used?
- What inputs must the agent or user provide first?
- Which context assets are always required?
- Which context assets are conditional?
- Which nearby skills might be confused with this one?
- What verification should happen before the result is trusted?

Example repository guidance:

| Situation | Prefer skill | Why |
| --- | --- | --- |
| iOS Simulator setup | `skill.setup.appium-ios-simulator` | Requires iOS simulator setup context |
| Android Emulator setup | `skill.setup.appium-android-emulator` | Requires Android emulator setup context |
| Real device setup | `skill.setup.appium-real-device` | Requires device provisioning and risk context |
| General Appium capability question | `skill.setup.appium-general` or context lookup | Not platform setup specific |

This matrix is documentation for maintainers, agents, and external LLM tools. It is not Renma runtime routing.

## LLM-Assisted Repair Loop

Renma findings are useful as repair prompts because they include deterministic evidence. Capture the reports you need:

```bash
renma scan . --format json > renma-scan.json
renma readiness . --format markdown > renma-readiness.md
renma graph . --focus skill.setup.appium-ios-simulator --format mermaid > appium-ios-graph.mmd
```

Then give the files to your local or external LLM tool with a narrow repair prompt:

```text
Use the Renma scan, readiness report, and focused graph below.

Please propose a minimal patch that fixes the findings while preserving:
- skill/context separation
- existing owners
- supported status values
- security policy restrictions
- declared context relationships
- Renma's non-runtime boundary

Do not remove safety guidance just to silence findings.
Do not weaken local security policy.
Do not invent product facts.
```

A human should review the patch, apply only the parts that are correct for the repository, and rerun Renma. The loop stays:

```text
LLM proposes. Renma verifies. Human approves.
```
