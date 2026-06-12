# Skill Quality And Security Tool Design

This document designs a language-neutral OSS tool for reviewing AI-agent skills,
repo instructions, and workflow helpers. The goal is to combine useful
skill-quality feedback like Waza with stronger safety checks like SkillSpector,
then turn findings into concrete improvement suggestions.

## Goals

- Find whether a skill is clear, scoped, token-efficient, and easy for an LLM to
  execute.
- Detect security and safety risks in skill text, referenced scripts, examples,
  and eval fixtures.
- Produce actionable suggestions, not only pass/fail scores.
- Support rule-based checks first, then use LLM review to reason over matched
  evidence and reduce false positives.
- Work on OSS repositories without requiring a specific programming language.

## Non-Goals

- Do not execute hardware-affecting, network-affecting, destructive, or
  credential-bearing workflows during normal scans.
- Do not require a hosted LLM service. LLM review should be optional and
  pluggable.
- Do not claim a skill is safe only because static checks pass.
- Do not auto-apply changes without an explicit user or CI policy.

## Core Workflow

1. Discover candidate skill files, instruction files, references, scripts, and
   eval definitions.
2. Parse each artifact into a normalized document model with frontmatter,
   headings, links, code blocks, commands, environment variables, and referenced
   files.
3. Run deterministic quality and security rules against the normalized model.
4. Build evidence bundles for each finding, including file path, line range,
   matched text, rule id, severity, and suggested remediation.
5. Optionally send evidence bundles to an LLM reviewer with explicit rule text,
   repository context, and allowed output schema.
6. Merge deterministic and LLM-reviewed findings into a report with scores,
   suggested patches, and eval ideas.
7. Exit with policy-controlled status for local use or CI.

## Architecture

### Scanner

The scanner owns repository traversal and artifact classification.

- Include common skill paths such as `skills/**/SKILL.md`, `.agents/**`,
 `AGENTS.md`, eval manifests, and referenced helper scripts.
- Include profile paths such as `skills/**/profiles/**/*.md`, or other
 repository-configured overlays that customize a base skill.
- Follow relative links from skill and profile files, but cap recursion depth
 and file size.
- Classify artifacts as skill text, reference text, executable script, eval task,
 prompt, config, profile overlay, or unknown.
- Keep a manifest of scanned files so reports are reproducible.

### Profiles

Profiles are optional overlays for a skill. They let a user load a specific
variation of the same skill without copying the plain version.

- The plain skill remains the default entry point.
- A profile contains only the deltas needed to customize behavior, routing,
 examples, references, or domain context for a use case.
- Profiles can add addon-specific knowledge, such as `mobile` context for a
 general testing, debugging, or app-development skill.
- Profiles should declare the base skill they extend and a stable profile id,
 such as `mobile`, `web`, `hardware`, or `enterprise`.
- The scanner should resolve a selected profile against the base skill before
 running rules, so findings reflect the effective skill document.
- Profile content should stay small and focused; large shared procedures should
 still live in references.
- Conflicts between a profile and base skill should be reported with file and
 line evidence, especially when the profile weakens safety, routing, or
 verification requirements.

### Parser

The parser creates a language-neutral representation.

- Markdown sections: title, heading tree, paragraphs, lists, links, code fences.
- Skill metadata: name, description, trigger words, token count, references,
  profiles.
- Commands: shell-like command snippets, privilege indicators, network tools,
  destructive operations, env assignments.
- Secrets: likely secret names, literal tokens, passwords, private keys, and
  credential placeholders.
- Script signals: subprocess calls, dynamic dispatch, environment copying,
  filesystem writes, network calls, shell execution, package installation.

The first implementation can use lightweight parsing. Later versions can add
language-aware plugins for Python, JavaScript, shell, or other ecosystems.

### Rule Engine

Rules should be small, testable, versioned, and documented. Each rule returns:

- `id`
- `title`
- `category`
- `severity`
- `confidence`
- `evidence`
- `why_it_matters`
- `recommended_fix`
- `autofix_available`

Rules should support suppression only with a reason, for example:

```text
tool-ignore SEC-ENV-COPY: this test intentionally verifies environment passthrough
```

Suppressions should be reported so teams can audit them.

### LLM Reviewer

The LLM reviewer should not replace deterministic rules. It should review
evidence gathered by rules and answer structured questions:

- Is this finding real in this repository context?
- Is the severity correct?
- Is the suggested fix likely to preserve the workflow?
- Are there missing guardrails nearby?
- Can this be improved by moving detail into references, adding trigger text, or
  adding eval coverage?

The prompt should include only relevant snippets, not the full repository.
Output must be machine-readable JSON with no free-form hidden decisions.

### Suggestion Generator

Suggestions should be grouped by user intent:

- `quality`: clarify routing, scope, trigger wording, examples, and token budget.
- `safety`: reduce secret exposure, gate privileged actions, remove dangerous
  defaults, validate inputs.
- `structure`: split long runbooks into references, add `DO NOT USE FOR`, add
  explicit workflow phases.
- `eval`: add task coverage for success, refusal, missing-context, and safety
  behavior.
- `maintenance`: update timestamps, links, docs index entries, or manifests.

Each suggestion should include the smallest useful patch concept. When possible,
provide a unified diff preview, but keep application opt-in.

## Quality Rule Set

### Skill Shape

- Missing or weak name/description.
- Description does not say when to use the skill.
- Description contains too much procedure instead of trigger semantics.
- Missing route/scope section.
- Missing `DO NOT USE FOR` or equivalent negative routing.
- Missing examples.
- Missing error/reporting expectations.
- Missing references for long procedures.

### Token And Structure

- Skill body exceeds a configurable token budget.
- Long procedure in top-level skill should move into references.
- Too many unrelated workflows in one skill.
- Repeated instructions that should become one shared reference.
- Low heading density or confusing heading order.
- Ambiguous pronouns for dangerous targets, such as "it", "the remote", or
  "default board" without a binding step.

### Profile Overlays

- Profile is not discoverable from repository configuration or skill metadata.
- Profile does not declare the base skill it extends.
- Profile duplicates most of the base skill instead of containing only deltas.
- Profile changes routing, safety, or verification requirements without making
 the override explicit.
- Profile adds domain knowledge, such as mobile details, without linking the
 supporting references or eval coverage.
- Selected profile and base skill produce conflicting instructions.

### Agent Usability

- Skill asks the agent to guess missing target information.
- No explicit preflight step.
- No verification command or result-reporting step.
- No rollback or backup guidance for mutable remote state.
- No distinction between dry-run, staging, and execution.
- No statement of what evidence the agent should report back.

### Eval Coverage

- Missing eval manifest.
- Evals cover only happy paths.
- No eval for missing credentials or missing target host.
- No eval for refusal/confirmation around destructive or privileged actions.
- No eval proving references are discovered and used.
- Evals require unavailable proprietary tools without an alternate runner.

## Security And Safety Rule Set

### Secrets

- Literal passwords, tokens, API keys, private keys, or credentials.
- Examples that encourage committing real credentials.
- Commands that print secrets or environment dumps.
- Scripts that copy full process environments into subprocesses.
- Redaction that covers only `PASSWORD` but misses `TOKEN`, `SECRET`,
  `CREDENTIAL`, or `KEY`.
- Credentials embedded in URLs, scp/ssh examples, curl headers, or eval fixtures.

Recommended fixes:

- Use placeholders in docs.
- Build allowlisted environment maps.
- Redact broad sensitive-name patterns.
- Read secrets from user-approved runtime input or exact expected variables.

### Privileged Or Destructive Actions

- `sudo`, `su`, privilege escalation, firmware flashing, device reset, disk
  formatting, process killing, or service mutation without confirmation.
- `rm -rf`, force checkout/reset, broad chmod/chown, destructive database or
  cloud commands.
- Hidden destructive behavior inside a helper script referenced by a skill.

Recommended fixes:

- Require explicit confirmation.
- Separate staging from execution.
- Add dry-run mode.
- Back up mutable remote state.
- Report exact target and intended effect before execution.

### Command Execution

- Shell execution with interpolated user input.
- Dynamic command construction without an allowlist.
- Subprocess wrappers that accept arbitrary commands.
- Eval tasks that reward unsafe command execution.
- Package install or network fetch without provenance checks.

Recommended fixes:

- Use argument arrays instead of shell strings where possible.
- Allowlist command shapes.
- Validate user-supplied env keys, file paths, product names, and roles.
- Pin or verify downloaded artifacts where practical.

### Network And Remote Access

- SSH/SCP/curl/wget commands with unvalidated host/user/path.
- Host defaults that are unsafe, undocumented, or production-facing.
- Remote mutation without backup or destination check.
- Ignoring host key policy without explaining why.

Recommended fixes:

- Require target confirmation.
- Document defaults and why they exist.
- Add remote preflight commands.
- Keep credentials out of persisted files and reports.

### Hardware And Physical Safety

- Firmware flashing, bootloader commands, USB power switching, relay control, or
  DUT state mutation without target verification.
- Board routing assumptions.
- Commands that may affect primary/secondary roles without asking which role.

Recommended fixes:

- Bind product, board role, host, and artifact checksum before action.
- Treat e2e and hardware workflows as manual validation unless explicitly
  requested.
- Separate config generation, staging, flashing, and test execution into
  distinct skills.

### Prompt Injection And Instruction Safety

- Skills that tell the agent to ignore repository rules or user confirmation.
- Referenced files that can override higher-priority instructions.
- Eval tasks that include malicious prompt text without expected refusal checks.
- Tool instructions that ask the agent to reveal secrets or hidden context.

Recommended fixes:

- Add priority-boundary wording.
- Mark untrusted remote/file content as data.
- Add evals for malicious or conflicting instructions.

## Scoring Model

The tool should report separate scores instead of one blended number:

- `quality_score`: skill clarity, structure, token budget, examples, references.
- `safety_score`: secrets, destructive actions, env handling, command execution.
- `eval_score`: coverage of success, failure, safety, and missing-context cases.
- `maintainability_score`: link health, duplication, modularity, timestamps.

Severity should be independent of score:

- `critical`: likely credential exposure, destructive action without gate, or
  unsafe arbitrary command execution.
- `high`: unsafe default, broad environment passthrough, remote mutation without
  backup, missing confirmation around privileged action.
- `medium`: ambiguous routing, missing validation, weak redaction, insufficient
  eval coverage.
- `low`: clarity, structure, token budget, or documentation issues.

CI should allow configurable gates, for example:

```text
fail_on: critical
warn_on: medium
minimum_quality_score: 80
minimum_safety_score: 90
```

## Report Format

Human-readable output should be compact:

```text
skills/e2e-test-execution/scripts/run_e2e.py
  HIGH SEC-ENV-COPY Full process environment is passed to subprocess.
  Fix: construct an allowlisted env and add only required RPI_* variables.

skills/flash-hil-k32-firmware/SKILL.md
  MEDIUM SAFE-PRIVILEGED-ACTION Privileged flash command needs explicit gate.
  Fix: split staging from execution and require confirmation before flash.
```

Machine-readable output should include stable IDs and patch hints:

```json
{
  "tool_version": "0.1.0",
  "findings": [
    {
      "rule_id": "SEC-ENV-COPY",
      "severity": "high",
      "path": "skills/e2e-test-execution/scripts/run_e2e.py",
      "line": 126,
      "message": "Full process environment is passed to subprocess.",
      "recommended_fix": "Build an allowlisted environment map."
    }
  ]
}
```

## Eval Design

The tool should have its own eval suite. Useful scenarios:

- A strong skill with concise trigger text, references, guardrails, and evals.
- A long skill that should be split into top-level routing plus references.
- A skill with hidden credential leakage in examples.
- A script that passes `os.environ` wholesale to a subprocess.
- A hardware skill that stages safely but flashes only after confirmation.
- A malicious reference file that tries to override repo instructions.
- A false-positive case with documented suppression and narrow scope.

Eval grading should check whether the tool:

- finds the intended issue
- assigns reasonable severity
- avoids unrelated noisy findings
- suggests a safe, minimal remediation
- preserves the intended workflow

## LLM Review Prompt Contract

The LLM prompt should be rule-first:

```text
You are reviewing findings from deterministic rules.
Use only the provided snippets and rule definitions.
Do not invent files, commands, or repository behavior.
Return JSON matching the schema.
For each finding, decide: keep, downgrade, upgrade, dismiss.
Suggest the smallest safe remediation.
```

The LLM input should include:

- rule definition
- matched evidence
- nearby context
- repository policy snippets, such as `AGENTS.md`
- known safe patterns from the same repository

The LLM output should include:

- decision
- confidence
- reason
- suggested remediation
- optional eval suggestion

## Configuration

Repositories should be able to configure:

- skill file globs
- profile file globs under each skill, such as `skills/**/profiles/**/*.md`
- default profile selection for local or CI scans
- reference directories
- eval directories
- token budget
- allowed command patterns
- sensitive env name patterns
- privileged command patterns
- hardware-affecting command patterns
- CI failure thresholds
- approved suppressions
- optional LLM provider and model

Example:

```yaml
skill_paths:
  - skills/**/SKILL.md
  - .agents/**/*.md
profile_paths:
  - skills/**/profiles/**/*.md
default_profiles:
  mobile-app:
    skill: skills/app-debugging/SKILL.md
    profile: mobile
reference_paths:
  - skills/**/references/**/*.md
eval_paths:
  - evals/**/eval.yaml
token_budget: 500
sensitive_name_patterns:
  - PASSWORD
  - SECRET
  - TOKEN
  - CREDENTIAL
  - KEY
fail_on:
  - critical
```

## Suggested CLI Surface

The tool should expose a small set of commands:

```text
scan       Run quality and security rules.
explain    Explain one rule and show examples.
init       Create default config and baseline rules.
eval       Run the tool's own eval suite.
fix        Generate patch suggestions without applying them.
baseline   Record accepted existing findings for gradual adoption.
```

Useful flags:

```text
--format text|json|sarif
--with-llm
--no-llm
--fail-on critical|high|medium|low
--changed-only
--output path
```

## Adoption Plan

1. Start with deterministic Markdown and command-pattern checks.
2. Add script heuristics for environment handling, subprocess execution, and
   dynamic dispatch.
3. Add quality suggestions for skill shape, scope, references, and eval coverage.
4. Add JSON/SARIF output for CI and code scanning integrations.
5. Add optional LLM review for evidence bundles.
6. Add patch suggestion generation.
7. Add repository baselines so existing OSS projects can adopt the tool without
   fixing every historical issue at once.

## Design Principles

- Prefer precise, explainable rules over vague scores.
- Treat the LLM as a reviewer of evidence, not the source of truth.
- Make findings actionable enough that a maintainer can fix them quickly.
- Keep hardware, credentials, and destructive actions behind explicit gates.
- Reward skill structure that helps agents route, execute, verify, and report.
- Design for gradual adoption in real repositories with existing skill debt.
