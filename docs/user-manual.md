# renma User Manual

renma scans agent-facing repository assets and turns them into deterministic, agent-consumable reports. Use it to keep skills, shared context, prompts, docs, and ownership metadata reviewable in CI instead of relying on an LLM to infer repository intent.

## Install And Build

From a checkout:

```bash
npm install
npm run build
```

Run the local CLI from the built entry point:

```bash
node dist/index.js scan .
```

When renma is installed as a package, use the `renma` binary:

```bash
renma scan .
```

## Repository Layout

renma is most useful when agent knowledge is stored in predictable places:

- `skills/**/SKILL.md` for skill instructions.
- `contexts/**` for shared context assets.
- configurable prompt or documentation paths for reusable prompts and broader docs.
- `*.renma.json` for structured metadata assets.

Tool helper implementations usually belong under `tools/**`. They can be referenced from skills and commands, but they are not the same thing as user-facing documentation under `docs/**`.

Assets can declare metadata such as `id`, `owner`, `status`, `requires_context`, `optional_context`, and dependency references. The catalog and graph commands use that metadata to resolve links, identify weak references, and produce reports that can be checked in CI.

## Configuration

Use `--config <path>` with commands that scan the repository:

```bash
renma scan . --config renma.config.json
```

The JSON configuration supports the same names used by the implementation, including:

- `globs`: glob patterns to scan.
- `exclude`: paths or path prefixes to skip.
- `suppressions`: rule suppressions that remove matching findings from normal reports and failure thresholds.
- `max_file_size_bytes`: largest file renma will read.
- `max_depth`: maximum discovery depth.
- `concurrency`: scan concurrency.
- `fail_on`: scan exit threshold: `low`, `medium`, `high`, or `critical`.
- `format`: default report format.
- `layout`: workflow aliases and layout policy.
- `security`: command, network, upload, and profile policy.

CLI flags override config values when both are provided.

Use `exclude` for files Renma should not scan. Use `suppressions` for audited exceptions where Renma should scan the file, detect matching findings internally, then omit those findings from normal reports and failure decisions. A suppression applies only when both `id` and `paths` match. Each suppression includes `id`, `paths`, required `reason`, and optional `expires`; the reason lives in config for auditability.

Use a date in `YYYY-MM-DD` for temporary workarounds, or `"never"` when the exception is intentionally permanent. Permanent suppressions should still use narrow path patterns and a clear reason. Suppression path patterns are repository-relative and support exact paths, directory-prefix matches for non-glob patterns, `*` within one path segment, and `**` across directories.

If `--config` is not provided, renma looks for repository config files such as `renma.config.json` or `.renma.json` while resolving the scan target.

By default, renma scans these glob families when building its catalog and findings:

- `skills/**/SKILL.md`
- `.agents/**/*.md`
- `AGENTS.md`
- `README.md`
- `context/**/*.md`
- `contexts/**/*.md`
- `skills/**/profiles/**/*.md`
- `skills/**/references/**/*.md`
- `skills/**/examples/**/*.md`
- `skills/**/scripts/**/*`
- `tools/**/*`

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
- `owner`: real owning team or maintainer. Avoid placeholder ownership in shared assets.
- `status`: lifecycle only: `experimental`, `stable`, `deprecated`, or `archived`.
- `version`: optional asset metadata. It is not the npm package version.
- `tags`: searchable labels that help navigation, ownership review, and reporting.
- `when_to_use` and `when_not_to_use`: scope guidance for humans and agents.
- `requires_context` and `optional_context`: static graph relationships to other assets. They do not make renma select runtime context.
- `conflicts`: assets that should not be used together without review.
- `superseded_by`: replacement or migration relationships for deprecated or archived content.

The supported list-style metadata fields are `tags`, `when_to_use`, `when_not_to_use`, `requires_context`, `optional_context`, `conflicts`, and `superseded_by`.

## Skill vs Context Metadata

Skills are agent-facing entrypoints and routing contracts. They explain when a capability applies, what safety or preflight checks matter, and which owned context assets are relevant.

Context assets are independently owned source-of-truth knowledge units. They should carry stronger ownership, lifecycle, usage-boundary, and dependency metadata because they are intended to outlive a single skill.

Keep skills thin. A skill should reference context assets instead of embedding all reusable knowledge directly in `SKILL.md`.

Example skill metadata:

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

## Security Policy Quickstart

Add small security policy metadata to agent-facing skills or context assets when they include network, upload, secret-handling, command execution, or other sensitive operational instructions.

### Asset-local security policy

Use asset-local policy when one asset has stricter or unique requirements, the body contains sensitive instructions, or local denials should be explicit and reviewable:

```yaml
---
id: skill.diagnostics.local-triage
owner: qa-platform
status: stable
allowed_data:
  - public
  - sanitized diagnostics
network_allowed: true
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
forbidden_inputs:
  - secrets
  - credentials
  - tokens
---
```

Asset-local explicit denials remain stricter than inherited profile or repository allowances. For example, `external_upload_allowed: false` on an asset still blocks upload instructions even if a selected profile or repository config allows uploads elsewhere.

### Reusable security profiles

Use `security_profile` when many assets share the same policy, a team wants a reusable security contract, or policy should be centrally updated in `renma.config.json`.

Configure profiles under `security.profiles`:

```json
{
  "security": {
    "profiles": {
      "disclosed-local-diagnostics": {
        "allowedData": ["public", "sanitized diagnostics"],
        "networkAllowed": true,
        "externalUploadAllowed": false,
        "secretsAllowed": false,
        "humanApprovalRequired": true,
        "forbiddenInputs": ["secrets", "credentials", "tokens"],
        "approvedDomains": ["github.com"],
        "approvedUploadDomains": []
      }
    }
  }
}
```

Then select the profile from an asset:

```yaml
---
security_profile: disclosed-local-diagnostics
---
```

### Repository-level security config

Use repo-level `security.approvedDomains`, `security.approvedUploadDomains`, or `security.disallowedCommands` when the policy applies across the repository and common destinations or disallowed commands should be shared.

```json
{
  "security": {
    "approvedDomains": ["github.com"],
    "approvedUploadDomains": [],
    "disallowedCommands": ["gh gist create"],
    "profiles": {}
  }
}
```

### Choosing where to put policy

Prefer the narrowest policy location that matches the decision:

- Use asset-local fields for one-off restrictions, explicit denials, or sensitive instructions that need nearby review.
- Use `security_profile` for reusable team contracts shared by several assets.
- Use repository-level security config for common approved network destinations, upload destinations, or disallowed commands that apply broadly.

If settings disagree, keep the stricter effective policy. Do not relax asset-local denials through a profile or repository allowance.

### Human approval semantics

`requires_human_approval: true` requires explicit nearby approval wording for sensitive actions. Dry-run, backup, rollback, or restore guidance is useful, but it does not replace explicit approval when approval is required.

Keep approval wording close to the action it guards, especially for uploads, external sharing, privileged commands, destructive commands, or secret-handling workflows.

### Network approval vs upload approval

`approvedDomains` does not imply upload approval. Network access and upload permission are separate decisions.

Use `approved_network_destinations`, profile `approvedDomains`, or repository `security.approvedDomains` for general network destinations. Use `approved_upload_destinations`, profile `approvedUploadDomains`, or repository `security.approvedUploadDomains` for upload destinations.

### Forbidden inputs

Use `forbidden_inputs` to name data classes an asset must not request, copy, upload, summarize, or include in prompts. Common examples are `secrets`, `credentials`, `tokens`, `private keys`, `.env files`, customer data, and production logs.

Safe negative wording is useful:

```markdown
Never copy private keys, tokens, credentials, or `.env` files into prompts, logs, uploads, or diagnostics.
```

### Defensive guidance and false positives

Renma security diagnostics are conservative heuristics for discovered agent-facing assets. Defensive wording can avoid false positives when it is specific and close to the risky instruction.

Unsafe upload:

```markdown
Upload the full repository to S3.
```

Safer:

```markdown
Do not upload repository files externally. If sharing diagnostics is required, provide only redacted snippets after explicit human approval.
```

Unsafe secret handling:

```markdown
Copy ~/.ssh/id_ed25519 into the prompt.
```

Safer:

```markdown
Never copy private keys, tokens, credentials, or `.env` files into prompts, logs, uploads, or diagnostics.
```

Unsafe destructive command:

```bash
rm -rf /tmp/renma-output
```

Safer:

```markdown
Only after explicit human approval, run a scoped cleanup command. Use dry-run where available, keep a backup or rollback path, and verify the affected path before execution.
```

## Common Security Diagnostics

Use this table to choose the right kind of fix. For full finding definitions, see [Diagnostics Reference](diagnostics.md).

| Finding | Usually means | What to change | Fix area |
| --- | --- | --- | --- |
| `SEC-MISSING-POLICY-METADATA` | Sensitive instructions lack a declared policy. | Add local policy fields or select a configured `security_profile`. | Metadata |
| `SEC-INSTRUCTION-VIOLATES-POLICY` | Body text asks for behavior denied by policy. | Rewrite the instruction or adjust policy only after review. | Body text and metadata |
| `SEC-MISSING-HUMAN-APPROVAL-GUARD` | A sensitive action lacks nearby approval wording. | Add explicit human approval close to the action. | Body text |
| `SEC-UNAPPROVED-NETWORK-DESTINATION` | An instruction contacts a host outside approved network destinations. | Use an approved host or update asset/profile/repo network approvals intentionally. | Metadata or config |
| `SEC-UNAPPROVED-UPLOAD-DESTINATION` | An upload target is not in upload approvals. | Use an approved upload target or update upload approvals intentionally. | Metadata or config |
| `SEC-FORBIDDEN-INPUT-INSTRUCTION` | The asset asks for data listed in `forbidden_inputs`. | Remove the request or replace it with redaction and placeholder guidance. | Body text and metadata |
| `SEC-SECRET-MATERIAL-INSTRUCTION` | Instructions may expose private keys, tokens, credentials, or secret files. | Remove secret collection or disclosure instructions. | Body text |
| `SEC-DESTRUCTIVE-COMMAND` | A destructive command appears without enough local safety context. | Remove it, scope it tightly, or add explicit approval and recovery guidance. | Body text |
| `SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD` | `sudo` or similar privileged action lacks guardrails. | Add prerequisites, confirmation, rollback, and verification guidance. | Body text |
| `SEC-UNPINNED-REMOTE-SCRIPT` | A remote script is executed without an immutable source or verification. | Pin and verify the source, or avoid remote execution. | Body text |
| `SEC-UNPINNED-DEPENDENCY-INSTALL` | An install example lacks exact version or digest pinning. | Pin package versions or use a reproducible install source. | Body text |

## First Skill Walkthrough

Use `scaffold` when you want a safe starter file for a new skill. This command creates a minimal skill entrypoint:

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md \
  --id skill.testing.spec-review \
  --title "Spec Review" \
  --owner qa-platform \
  --tags testing,spec-review
```

The generated file is intentionally small. Treat it as a starting point for review, not as a complete skill. Fill in these sections before depending on it:

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

1. Give the scaffolded skill to the LLM.
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

## Commands

For a runnable mini-repository with a skill, shared context assets, ownership metadata, and graph relationships, see [`examples/context-repo`](../examples/context-repo).

renma commands fall into a few groups:

- Inventory and ownership: `catalog` lists discovered assets and references, `ownership` summarizes owned and unowned assets, and `graph` shows relationships between catalog nodes.
- Local inspection and authoring: `inspect` reads one file as an outline or exact line slice, `scaffold` creates starter assets or authoring prompts, and `suggest-semantic-split` packages source context and helper commands so a human or coding agent can draft a split for mixed-purpose Markdown.
- Review and CI: `scan` emits deterministic findings, `readiness` turns repository state into checks and a score, `diff` compares two refs, and `ci-report` formats the comparison for pull-request review.

### `scan`

Scans a target path and prints findings.

```bash
renma scan .
renma scan . --format json
renma scan . --fail-on high
```

Use `--fail-on` in CI when findings at or above a severity should fail the job. The JSON output includes findings, evidence, diagnostics, and summary data that other tools can consume.

Output includes scan findings, discovery or catalog diagnostics, the effective exit threshold, and evidence paths or snippets for each finding.

### `catalog`

Builds a deterministic catalog of discovered assets.

```bash
renma catalog . --format json
renma catalog . --format markdown
```

Use the catalog to review asset IDs, owners, status, dependencies, and metadata-derived references.

Output includes catalog assets, dependency edges, owners, lifecycle status, tags, and diagnostics.

### `graph`

Prints the relationship graph between assets.

```bash
renma graph . --view summary
renma graph . --view workflow --format markdown
renma graph . --view full --format mermaid
```

Views are:

- `summary`: compact graph overview.
- `workflow`: workflow-oriented relationships.
- `full`: all known graph edges.

#### Focusing The Graph

The graph command can be focused on one asset with `--focus <asset-id-or-path>`.

Use this when you want to inspect the local neighborhood around one context asset, skill, or other catalog entry instead of reading the entire repository graph. A focused graph is useful for answering questions such as:

- What does this asset depend on?
- What other assets reference this asset?
- Is this asset connected to the expected parts of the context repository?
- Is this asset isolated or unexpectedly central?

Examples:

```bash
renma graph . --focus context.testing.boundary-value-analysis
renma graph . --focus contexts/testing/boundary-value-analysis.md --view full
```

`--focus` accepts one value. The value must match either a catalog asset ID, a repository-relative source path such as `contexts/testing/boundary-value-analysis.md`, or an absolute source path. It does not match projected `summary` view node IDs such as `contexts/testing/*`.

When `--focus` is provided, renma keeps the matched asset, its directly connected incoming and outgoing graph edges, and the assets at the other ends of those edges. In other words, it filters graph contents to the focused asset's one-hop neighborhood; it does not only highlight or rearrange the full graph. If the focus value does not match an asset ID or source path, the command exits with usage code `2` and reports that `graph --focus did not match any asset id or source path`.

`--focus` runs before `--view` projection. For example, `--view summary --focus <asset>` first selects the focused neighborhood and then groups that smaller graph into the summary view. There is no separate depth option in the current graph command, and repeated `--focus` flags are not a multi-focus API.

Note: this graph `focus` argument is a CLI option. It is not a metadata field on an asset.

Output includes graph nodes, relationship edges, unresolved targets, and diagnostics. Mermaid output renders the same graph as a diagram definition.

### `inspect`

Inspects one file as an outline or exact line slice.

```bash
renma inspect skills/testing/spec-review/SKILL.md
renma inspect contexts/testing/boundary-value-analysis.md --format json
renma inspect skills/testing/spec-review/SKILL.md --lines L10-L42
```

Use this when editing one skill or context file and you want a deterministic outline without reading the whole repository catalog. Without `--lines`, output includes file size, line count, frontmatter range, headings, code fences, and links. Use `--lines <range>` for an exact source slice; ranges can look like `L10-L42` or `10-42`.

### `readiness`

Prints a deterministic readiness report.

```bash
renma readiness .
renma readiness . --format markdown
renma readiness . --format json
```

Readiness combines catalog diagnostics, ownership metadata, graph resolution, required and optional context references, asset status, and selected scan findings into an agent-readiness score.

Output includes a readiness score and level, workflow checks, diagnostics, scan findings that affect readiness, and graph or ownership summary data.

Planned security posture summaries should remain static repository evidence in this report: effective policy, security profile resolution, allowed data, forbidden inputs, approved destinations, human approval requirements, and high-risk findings. Readiness does not choose runtime context or describe what an LLM actually used.

### `diff`

Compares deterministic readiness reports for two git refs.

```bash
renma diff . --from main --to HEAD
renma diff . --from main --to HEAD --format markdown
```

Use this to review what changed between branches or commits. The command builds readiness data for both refs and reports asset, graph, check, and finding deltas.

Output includes readiness deltas, changed assets, graph edge changes, check changes, and added or removed findings.

### `ci-report`

Formats a diff result for CI or pull-request review.

```bash
renma ci-report . --from main --to HEAD --format markdown
renma ci-report . --from main --to HEAD --format json
```

The report summarizes readiness deltas, graph-resolution changes, added and removed findings, and policy-relevant status. It is CI-oriented: `PASS` and `WARN` exit `0`, `FAIL` exits `1`, and usage, command, or configuration errors exit `2`.

Output includes a CI status (`PASS`, `WARN`, or `FAIL`), a summary, readiness changes, graph changes, and review-focused finding changes.

Future CI output may include security posture changes and declared Repository Context BOM evidence. Those artifacts should describe repository state, not prompt assembly, context injection, agent execution, or runtime telemetry.

### `ownership`

Reports asset ownership.

```bash
renma ownership .
renma ownership . --include-owned
renma ownership . --format json
```

Use this to find unowned assets and to review what each owner is responsible for.

Output includes total asset count, owned asset count, ownership coverage, unowned assets, and optionally owned asset details when `--include-owned` is provided.

### `scaffold`

Creates a starter skill or context asset.

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md --owner qa-platform
renma scaffold context contexts/testing/boundary-value-analysis.md --owner qa-platform
renma scaffold skill skills/testing/spec-review/SKILL.md --owner qa-platform --format prompt
```

`scaffold --format file` writes a starter file, `--format prompt` emits an authoring prompt, and `--format json` emits structured scaffold data. The generated content is intentionally minimal; fill in metadata, dependencies, and verification steps before depending on it in automation.

### `suggest-semantic-split`

Suggests a semantic split for large or mixed-purpose assets.

```bash
renma suggest-semantic-split docs/large-runbook.md
renma suggest-semantic-split docs/large-runbook.md --format json
renma suggest-semantic-split docs/large-runbook.md --max-context-bytes 32768
```

Use this as an editing aid when an asset has grown beyond one clear responsibility.

Output is a prompt by default. With `--format json`, output includes source context, sibling-file context, helper commands, and a structured review bundle. The command does not apply a split itself; it gives a human or coding agent enough context to draft a proposal.

## Output Formats

Use `--format <format>` to select output and `--json` as a shortcut where the command supports JSON.

| Command | Formats |
| --- | --- |
| `scan` | `text`, `json` |
| `catalog` | `json`, `markdown` |
| `ownership` | `json`, `markdown` |
| `readiness` | `json`, `markdown` |
| `diff` | `json`, `markdown` |
| `ci-report` | `json`, `markdown` |
| `graph` | `json`, `markdown`, `mermaid` |
| `inspect` | `text`, `json` |
| `scaffold` | `file`, `prompt`, `json` |
| `suggest-semantic-split` | `prompt`, `json` |

Prefer JSON in automation and markdown for human review in pull requests. Use Mermaid when you want to render a graph diagram.

## CI Workflow

A typical CI flow is:

1. Build renma.
2. Run `renma scan . --fail-on high`.
3. Run `renma readiness . --format json` and store the result as an artifact.
4. Compare refs with `renma diff . --from main --to HEAD`.
5. Publish `renma ci-report` in the pull-request summary.

Example:

```bash
npm run build
renma scan . --fail-on high
renma readiness . --format json > renma-readiness.json
```

## Interpreting Results

renma reports three related but different kinds of output:

- Diagnostics: problems reading files, parsing metadata, or resolving catalog data. See [Diagnostics Reference](diagnostics.md).
- Scan findings: rule results from `scan`, such as layout, security, maintenance, quality, profile, and support issues. Each scan finding has a finding identifier, such as `SEC-LITERAL-SECRET`, that labels the kind of issue independently from the file path, asset ID, or human-readable message.
- Readiness checks: workflow-level pass, warning, or error states derived from catalog, graph, ownership, and finding data.

Treat errors as blockers for deterministic automation. Treat warnings as review items that can become blockers when they affect agent reliability.
