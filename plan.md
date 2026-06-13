# Renma Roadmap

## Product Shape

Renma is a deterministic, minimal-dependency CLI for reviewing AI-agent skills and related repository instructions.

It should stay fast enough for local development and CI. It should catch structural, safety, and eval-readiness issues before a heavier tool such as Waza or SkillSpector runs.

Renma is not currently an eval runner, LLM judge, or full malware scanner. Those can remain future directions unless there is a clear reason to expand scope.

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
  3. Environment variables
  4. CLI flags
- Supports `fail_on`.
- Supports `format`.
- Supports `globs`.
- Supports `exclude`.
- Supports `max_file_size_bytes`.
- Supports `max_depth`.
- Supports `concurrency`.
- Supports `eval_executor`, defaulting to `codex`.
- Supports `RENMA_EVAL_EXECUTOR`.

### Discovery

Default globs:

- `skills/**/SKILL.md`
- `.agents/**/*.md`
- `AGENTS.md`
- `skills/**/profiles/**/*.md`
- `skills/**/references/**/*.md`
- `evals/**/eval.{json,yaml,yml}`
- `evals/**/tasks/*.{json,yaml,yml}`

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
- Safety and command risks:
  - literal secret-like values
  - private key material
  - destructive commands without nearby confirmation
  - risky remote defaults
  - broad environment copying into subprocesses
- Eval readiness:
  - missing top-level eval coverage
  - malformed Waza-style eval manifests
  - missing or malformed `tasks` list
  - scalar `regex_match`
  - missing referenced task files
  - task files missing `id`, `name`, `prompt`, or `prompt_file`
  - malformed task assertion lists
  - Copilot executor migration warning

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

1. SARIF output.
2. Real YAML parsing for eval/task validation.
3. Coverage strength findings.
4. MCP security checks.
5. Security rule pack for prompt injection, exfiltration, and privilege escalation.
6. Risk score and `--fail-score`.
7. Markdown report output.
8. Link/reference integrity checks.
9. Configurable token budgets.
10. Optional external rule packs.

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
- Text and JSON report output.
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
