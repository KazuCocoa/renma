# Renma Roadmap

This roadmap should be read with [architecture.md](./architecture.md). The
direction is to evolve Renma from a skill scanner into a Git-native context
engineering toolkit, while preserving its current deterministic, minimal
dependency CLI foundation.

## Strategic Sequence

1. **Metadata and validation**: parse stable skill/context metadata, validate
   ownership, status, versions, lifecycle fields, routing hints, and duplicate
   IDs.
2. **Catalog**: generate static `CATALOG.md` and `catalog.json` artifacts so
   teams can discover skills, context units, owners, statuses, and required
   context without a server.
3. **Normalized model**: introduce internal model types for skills,
   context units, metadata, relationships, and findings. Markdown/YAML remain
   user-facing adapters.
4. **Resolution and trace**: deterministically select required and optional
   context for a task, then explain selected and rejected candidates with
   reasons.
5. **Lockfiles**: freeze resolved context packages with paths, versions, hashes,
   and policy decisions for reproducibility.
6. **Semantic diff**: report AI-context behavioral changes such as routing,
   priority, ownership, lifecycle, conflict, and risk changes.
7. **Run packaging**: keep `renma run` focused on deterministic local context
   packaging and execution manifests, without owning provider gateways or
   synchronization.

Gateway, hosted dashboard, and synchronization features are out of scope for
this project. Metadata, catalog, trace, lock, diff, and local packaging are
smaller, closer to the current architecture, and provide independent value.

Renma should still assume multi-team Git usage. A shared skills repository may be
used by 10+ or 50+ teams through normal Git mechanics such as tags, branches,
commit SHAs, submodules, package mirrors, or vendored snapshots. Renma's job is
to make those Git-managed assets easy to validate, catalog, resolve, trace, lock,
and review; it should not implement the synchronization transport itself.


## Product Shape

Renma is a deterministic, minimal-dependency CLI for reviewing AI-agent skills and related repository instructions.

It should stay fast enough for local development and CI. It should catch structural, safety, and context-readiness issues before a heavier tool such as Waza or SkillSpector runs.

Renma is not currently an eval runner, LLM judge, or full malware scanner. Those can remain future directions unless there is a clear reason to expand scope.

## Key Direction: Context Mixins

Renma should help teams maintain one shared skill repository without splitting every small variation into a separate top-level skill.

The core model is:

> One shared skill, many composable context slices. The top-level skill routes; mixins provide focused context.

This is similar to mixins in programming. A top-level `SKILL.md` should act as an orchestrator that selects the right context for the user's request. Context mixins can represent platform, tool, workflow phase, risk level, setup mode, troubleshooting mode, or team-specific conventions.

Examples:

- `platform:android`
- `platform:ios`
- `target:simulator`
- `target:real-device`
- `tool:appium`
- `flow:setup`
- `flow:troubleshooting`
- `safety:privileged-change`

Each mixin can route to the right profiles, references, examples, scripts, and evals. This gives an LLM better context without loading every file or forcing teams to maintain many nearly identical top-level skills.

Renma should validate that this orchestration stays understandable:

- mixins have clear triggers
- conflicts and required base mixins are explicit
- references and examples are not orphaned
- deterministic checks are offered as scripts when useful
- eval coverage maps to important mixins and combinations
- token-heavy prose moves out of `SKILL.md`
- eval files stay out of runtime context

## Current Features

### CLI

- `renma scan [path]`
- `--config <path>`
- `--fail-on <level>`
- `--format text|json`
- `--json`
- `--help`
- `--version`
- Exit `0` when no finding meets the threshold.
- Exit `1` when findings meet `--fail-on`.
- Exit `2` for CLI usage errors, invalid config, or unreadable required input.

### Config

- Supports `renma.config.json`.
- Supports `.renma.json`.
- Uses JSON config.
- Applies config in this order:
  1. Defaults
  2. Config file
  3. CLI flags
- Supports `fail_on`.
- Supports `format`.
- Supports `globs`.
- Supports `exclude`.
- Supports `max_file_size_bytes`.
- Supports `max_depth`.
- Supports `concurrency`.

### Discovery

Default globs:

- `skills/**/SKILL.md`
- `.agents/**/*.md`
- `AGENTS.md`
- `skills/**/profiles/**/*.md`
- `skills/**/references/**/*.md`
- `skills/**/examples/**/*.md`

Scan behavior:

- Async glob expansion.
- Async file reads and stats.
- Bounded concurrency, default `16`.
- Deterministic sorted file order.
- Max file size.
- Max depth.
- Skips symlinks.
- Default excludes: `node_modules`, `dist`, `.git`.
- Stable repo-relative POSIX-style report paths.

### Parsing

- Lightweight Markdown scanning.
- Headings.
- Links.
- Code fences.
- Frontmatter-like metadata.
- Line numbers and evidence snippets.

### Current Rule Areas

- Skill structure and quality:
  - missing description
  - short description
  - missing routing clarity
  - missing negative routing
  - missing examples
  - missing preflight
  - missing verification
  - oversized `SKILL.md`
- Profile overlays:
  - missing base skill declaration
- Context mixin foundation:
  - profiles, references, and examples scanned as context artifacts
  - context files should be routed from top-level `SKILL.md`
  - unused profiles, references, and examples can be reported
- Safety and command risks:
  - literal secret-like values
  - private key material
  - destructive commands without nearby confirmation
  - risky remote defaults
  - broad environment copying into subprocesses

### Reporting

- Text output.
- JSON output.
- Finding fields:
  - id
  - title
  - category
  - severity
  - confidence
  - evidence
  - why it matters
  - remediation
- Scan result fields:
  - root
  - config path
  - scanned file count
  - format
  - findings
  - diagnostics
  - exit threshold

## Context Mixin Orchestration

Current Renma conventions are useful defaults, but they should become configurable enough for a top-level skill to act as a context-mixin orchestrator. The orchestrator should tell an LLM what context to load, when to load it, and what not to load.

### Lossless Refactoring Principle

When Renma suggests splitting a large `SKILL.md` into references, examples, scripts, or mixins, the fix should preserve the original operational content.

LLM-oriented remediation should say:

- do not delete concrete commands, prerequisites, edge cases, or verification steps
- move detailed procedures into context files instead of summarizing them away
- keep the top-level `SKILL.md` as a router/index
- link each moved section from the relevant context mixin or routing branch
- preserve warnings, safety gates, and rollback/verification guidance
- after restructuring, compare the original and new files to confirm no required step was lost

This is especially important for shared team skills: the goal is better context selection, not less domain knowledge.

### Current Behavior

- `profiles` are scanned as files under `skills/**/profiles/**/*.md`.
- `references` are scanned as files under `skills/**/references/**/*.md`.
- Eval support is planned, but not part of the current implementation.
- Renma does not yet understand which references or profiles are relevant for a specific request.
- Renma does not yet understand which examples are relevant for a specific request.
- Renma does not yet verify that `SKILL.md` gives good context-routing instructions.

### Desired Model

The top-level `SKILL.md` should be an orchestrator, not a giant context dump.

It should provide:

- when to use the skill
- when not to use the skill
- required preflight questions
- which profiles apply to which modes, platforms, tools, or user intents
- which references to load for each branch
- which examples to show for each branch
- which deterministic scripts to run before asking the LLM to reason
- which evals or task examples cover expected behavior
- what context should stay out of the LLM prompt unless requested

### Configurable Context Map

Add a future config or manifest shape for routing context mixins:

```json
{
  "contexts": [
    {
      "id": "target:ios-real-device",
      "requires": ["platform:ios", "tool:appium"],
      "conflicts": ["platform:android"],
      "when": ["real device", "WebDriverAgent", "provisioning"],
      "profiles": ["profiles/ios-real-device.md"],
      "references": ["references/wda-signing.md"],
      "examples": ["examples/real-device-session.md"],
      "scripts": ["scripts/check-xcode.sh"],
      "evals": ["evals/xcuitest-real-device-config/eval.yaml"]
    }
  ]
}
```

This can live in `renma.config.json`, a future `skill.context.json`, or frontmatter in `SKILL.md`. The exact location should be decided after testing the ergonomics.

### New Checks

Add rules that help an orchestrator give better context:

- `CTX-MISSING-ROUTING-MAP`: skill has profiles/references but no routing map.
- `CTX-MIXIN-MISSING-TRIGGERS`: mixin has no clear `when` triggers.
- `CTX-MIXIN-CONFLICT`: selected mixins can conflict but no conflict rule is declared.
- `CTX-MIXIN-MISSING-REQUIREMENT`: mixin depends on base context but does not declare `requires`.
- `CTX-UNUSED-REFERENCE`: reference exists but is not linked or routed.
- `CTX-UNUSED-PROFILE`: profile exists but no trigger/mode points to it.
- `CTX-UNUSED-EXAMPLE`: example exists but no trigger/mode points to it.
- `CTX-AMBIGUOUS-REFERENCE`: many references are listed without when-to-use guidance.
- `CTX-AMBIGUOUS-EXAMPLE`: examples exist but are not tied to concrete request shapes.
- `CTX-OVERLOADED-SKILL`: `SKILL.md` includes too much procedure that should move to references or scripts.
- `CTX-MISSING-SCRIPT-HANDOFF`: deterministic checks are described in prose but no script/helper is offered.
- `CTX-EVAL-NOT-LINKED`: eval coverage exists but is not tied to the behavior or context branch it protects.

### LLM Benefits

This makes Renma output more useful for coding agents:

- smaller prompts
- fewer irrelevant references loaded
- more deterministic setup checks
- less flaky LLM execution
- clearer fix instructions
- better mapping from findings to files the agent should edit

## LLM-Friendly Output

Renma should be easy for another coding agent to run, understand, and act on. Findings should include enough structured context for an LLM to fix straightforward issues with minimal extra exploration.

### Definitions

`severity` describes the impact if the issue remains unfixed:

- `low`: quality or maintainability issue; unlikely to cause direct harm.
- `medium`: could cause wrong routing, incomplete execution, missing tests, or unsafe ambiguity.
- `high`: could cause data loss, secret exposure, privilege misuse, or dangerous command execution.
- `critical`: clear malicious behavior, credential exfiltration, destructive automation, persistence, or severe command execution blast radius.

`risk` describes how dangerous it is for an LLM to apply the suggested fix:

- `safe`: docs-only or additive clarification; unlikely to break behavior.
- `needs-review`: changes behavior, policy, routing, eval expectations, or security posture.
- `dangerous`: could remove safety guardrails, modify commands, touch credentials, or authorize privileged/destructive behavior.

`fixability` describes how automatically the issue can be repaired:

- `automatic`: deterministic patch can be generated with low ambiguity.
- `assisted`: an LLM can draft a likely fix, but should inspect context.
- `manual`: requires human/project knowledge or external validation.
- `not_applicable`: informational finding or intentionally not fixable.

### Agent-Oriented Reporting

Add an LLM-focused output mode:

- `--format llm-json` or `--agent`
- Stable schema version, for example `renma.llm.v1`
- Group findings by file
- Order actions by safe fix sequence
- Include `risk` and `fixability`
- Include related files when useful
- Include conservative suggested patches only for `safe` / `automatic` findings
- Include verification commands where Renma knows them

Candidate action shape:

```json
{
  "id": "QUAL-MISSING-VERIFICATION",
  "path": "skills/demo/SKILL.md",
  "startLine": 12,
  "problem": "Skill lacks verification guidance.",
  "fix": "Add a verification step after the main workflow.",
  "severity": "medium",
  "risk": "safe",
  "fixability": "assisted"
}
```

### Deterministic Script Opportunities

Renma should optionally suggest when a skill could move repetitive or fragile instructions into a deterministic script. The goal is to reduce token usage, reduce LLM interpretation work, and avoid flaky multi-step behavior.

This should be a suggestion, not a requirement. Some skills are mostly reasoning or coordination and should remain instruction-first.

Good candidates:

- repeated shell command sequences
- long environment diagnostics
- version/path detection
- dependency presence checks
- structured report generation
- file inventory or validation steps
- deterministic transformations
- setup checks that return pass/fail evidence

Poor candidates:

- judgment-heavy troubleshooting
- ambiguous user-intent routing
- safety decisions that require context
- privileged/destructive actions unless the script is a dry-run checker
- anything that would hide important reasoning from the user

Suggested finding shape:

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

### Implementation Tasks

1. Extend `Finding` with `risk` and `fixability`.
2. Move rule defaults for `severity`, `risk`, and `fixability` into rule metadata.
3. Add `--format llm-json` or `--agent`.
4. Group LLM output by file and ordered action.
5. Add tests for stable machine-readable output.
6. Keep generated patches conservative and avoid auto-patches for security-sensitive behavior.
7. Add optional script-opportunity suggestions for deterministic, repetitive, or token-heavy workflows.

## Near-Term Roadmap

### Waza-Inspired Improvements

1. **Real YAML parsing and schema validation**
   Current YAML checks are lightweight structural checks. Add a small YAML parser or parser boundary and validate eval/task files more faithfully.

2. **Full eval task schema checks**
   Validate more Waza task fields:
   - repositories
   - workdir constraints
   - environment blocks
   - follow-up prompts
   - task-level skill directories
   - output assertions

3. **Grader schema validation by type**
   Validate common grader configs beyond `regex_match`, including text, code, file, JSON schema, behavior, tool-call, and prompt graders.

4. **Coverage strength**
   Add Waza-like coverage grades:
   - none
   - partial
   - full

   A likely first version: full coverage requires at least one task and at least two grader types.

5. **Readiness summary**
   Add an optional summary similar to Waza `check`:
   - quality status
   - token status
   - eval status
   - link/reference status
   - next steps

6. **Configurable token limits**
   Replace the fixed `SKILL.md` budget with config/env values.

### General Quality Improvements

1. **Broken link checks**
   Verify local Markdown links and report broken references.

2. **Orphan reference checks**
   Detect reference files that are never linked from `SKILL.md` or related docs.

3. **Markdown report output**
   Generate human-readable scan reports for PR comments and audits.

4. **Better confidence values**
   Current confidence is mostly static. Let each rule set confidence based on evidence quality.

## SkillSpector-Inspired Future Features

SkillSpector is more security-scanner-heavy than Renma. The best ideas to borrow are deterministic security features that fit Renma’s lightweight preflight role.

### Highest Value

1. **SARIF output**
   Add `--format sarif` for GitHub code scanning, CI integrations, and IDE security tooling.

2. **Risk score**
   Compute a deterministic risk score from severity, category, confidence, and finding count.

3. **Security rule packs**
   Organize security checks into optional packs:
   - prompt injection
   - data exfiltration
   - privilege escalation
   - supply chain
   - excessive agency
   - output handling
   - system prompt leakage
   - memory poisoning
   - tool misuse
   - rogue agent behavior
   - trigger abuse

4. **MCP security checks**
   Add checks for:
   - overprivileged MCP tool access
   - underdeclared permissions
   - least-privilege mismatch
   - tool poisoning
   - rug-pull behavior

5. **Dangerous code pattern scanning**
   Start with lightweight static checks for:
   - `eval`
   - `exec`
   - dynamic imports
   - subprocess shell execution
   - network exfiltration patterns
   - persistence hooks

### Medium Value

1. **YARA-like rule packs**
   Add built-in or external signature support for:
   - malware
   - webshells
   - cryptominers
   - hacktools

   Start with regex-based signatures before considering a YARA runtime dependency.

2. **Remote and archive input scanning**
   Support scanning:
   - single files
   - zip files
   - Git repos
   - URLs

   This should require explicit design because it adds network and temporary-file concerns.

3. **Risk threshold exits**
   Add `--fail-score <number>` alongside `--fail-on`.

4. **Rule/analyzer registry**
   Organize rules by category and support enabling/disabling packs.

### Lower Priority / Larger Scope

1. **Optional LLM semantic analysis**
   Useful for intent and deception checks, but conflicts with Renma’s deterministic/minimal default.

2. **Taint tracking**
   Powerful for security analysis, but much heavier than the current architecture.

3. **OSV or package vulnerability lookup**
   Useful for dependency security, but not central to skill linting.

4. **REST/API serving mode**
   Useful for hosted scanning, but not needed for the CLI-first roadmap.

5. **Eval execution, grading, comparison, and result cache**
   These overlap strongly with Waza. Renma should only add them if the project intentionally grows beyond preflight scanning.

## Recommended Priority

1. LLM-friendly output and finding metadata: `risk`, `fixability`, and ordered actions.
2. Deterministic script opportunity suggestions for token-heavy or flaky workflows.
3. Context mixins and orchestration maps for profiles, references, examples, scripts, and evals.
4. SARIF output.
5. Real YAML parsing for eval/task validation.
6. Coverage strength findings.
7. MCP security checks.
8. Security rule pack for prompt injection, exfiltration, and privilege escalation.
9. Risk score and `--fail-score`.
10. Markdown report output.
11. Link/reference integrity checks.
12. Configurable token budgets.
13. Optional external rule packs.

## Test Plan

Use compiled tests with Node test runner.

Cover:

- CLI argument parsing.
- Help, version, and invalid-command behavior.
- JSON config loading and validation.
- Config, env, and CLI precedence.
- Async glob-based artifact discovery.
- Bounded file reads and stats.
- Deterministic file ordering.
- Scan bounds and default excludes.
- Path normalization.
- Markdown heading, code fence, link, metadata, and line extraction.
- Profile overlay findings.
- Secret, destructive command, and weak skill-shape rules.
- Eval manifest and eval task findings.
- Future context-mixin and orchestrator findings for profiles, references, examples, scripts, and evals.
- Text and JSON report output.
- Future LLM-friendly output, including `risk`, `fixability`, grouped actions, and stable schema version.
- Future deterministic script opportunity suggestions.
- `--fail-on` and config `fail_on` exit-code behavior.
- Future SARIF and Markdown output once added.
- Future risk score and `--fail-score` behavior once added.

## Assumptions

- Minimal dependencies are preferred.
- Correctness can justify small runtime dependencies.
- Node 22.17+ compatibility is acceptable.
- JSON config is enough for the current CLI.
- `util.parseArgs` is stable in modern Node.
- `fs.promises.glob` is stable in Node 22.17+ / 24+.
