# Renma Minimal-Dependency CLI Plan

## Summary

Build Renma as a TypeScript npm CLI with a small dependency footprint. Prefer Node 22.17+ built-ins, and allow small runtime dependencies only when they clearly improve correctness, maintainability, or CLI ergonomics.

Renma is a deterministic scanner. It reads skill, agent, reference, profile, and eval files; runs quality and safety rules; and emits text or JSON reports with file and line evidence.

## Runtime

- Target Node.js 22.17+.
- Publish an npm package with a `renma` bin pointing to compiled `dist/index.js`.
- Build with `tsc`.
- Use async filesystem APIs in scan paths.
- Keep startup checks small and synchronous only when simpler.

## Dependencies

- Prefer Node built-ins:
  - `node:util` / `parseArgs` for CLI flags.
  - `node:fs/promises` for `glob`, `readFile`, and `stat`.
  - `node:path` for filesystem-safe path handling.
  - `node:test` and `node:assert/strict` for tests.
- Current dev dependencies: `typescript`, `@types/node`.
- Avoid Markdown AST packages unless future evidence extraction needs them.
- A small YAML parser is acceptable for the next eval/schema validation milestone.

## CLI Contract

- `renma scan [path]`
- `--config <path>`
- `--fail-on <level>`
- `--format text|json`
- `--json`
- `--help`
- `--version`
- Exit `0` when no finding meets the threshold.
- Exit `1` when findings meet `--fail-on`.
- Exit `2` for CLI usage errors, invalid config, or unreadable required inputs.

## Config

- Support `renma.config.json`.
- Support `.renma.json`.
- Keep JSON config for now.
- Use `fail_on` in config and map it to `--fail-on`.
- Define precedence as defaults, then config file, then environment variables, then CLI flags.
- Validate unknown fields and invalid enum values with actionable errors.
- Support `eval_executor`, defaulting to `codex`.
- Support `RENMA_EVAL_EXECUTOR` for environment-specific eval runner override.

## Discovery

- Use `fs.promises.glob` for configured globs.
- Keep scan internals async:
  - async glob expansion
  - async file reads and stats
  - bounded concurrency for large repositories
  - no sync filesystem calls in the hot scan path
- Default concurrency: `16`.
- Aggregate per-file read/parse errors into diagnostics instead of failing the whole scan unless the root/config is invalid.
- Default include globs:
  - `skills/**/SKILL.md`
  - `.agents/**/*.md`
  - `AGENTS.md`
  - `skills/**/profiles/**/*.md`
  - `skills/**/references/**/*.md`
  - `evals/**/eval.{json,yaml,yml}`
  - `evals/**/tasks/*.{json,yaml,yml}`
- Enforce scan bounds:
  - deterministic sorted file order
  - max file size
  - max depth
  - explicit symlink policy
  - default excludes: `node_modules`, `dist`, `.git`
- Normalize report paths to repo-relative POSIX-style strings while using `node:path` for filesystem operations.

## Parsing

- Use a lightweight Markdown scanner for headings, links, code fences, frontmatter-like metadata, line numbers, and evidence ranges.
- Preserve enough source context for actionable findings.
- Do not add a full Markdown renderer unless rule quality requires it.

## Rule Model

- Implement deterministic rules as plain TypeScript functions.
- Keep finding fields stable:
  - rule id
  - title
  - category
  - severity
  - confidence
  - evidence range
  - remediation
- Current rule categories:
  - skill shape
  - token budget
  - profile overlays
  - secrets
  - privileged actions
  - command execution risks
  - eval coverage and eval manifest shape
  - eval task shape and task reference coverage

## Waza-Inspired Missing Pieces

Renma now covers early Waza-like preflight checks:

- top-level eval coverage under `evals/<skill-name>/eval.yaml`
- Waza-style `tasks` list presence in eval manifests
- eval task file discovery under `evals/**/tasks/*.{json,yaml,yml}`
- basic task shape: `id`, `name`, and `prompt` or `prompt_file`
- task reference checks so `tasks:` entries match scanned files
- scalar `regex_match` grader mistakes
- executor migration warnings for Copilot executor names, with default expected executor `codex`

Still missing or intentionally deferred:

- Real YAML parsing and schema validation. Current YAML checks are lightweight structural checks; Waza validates against concrete model/schema types.
- Full task schema validation. Renma checks minimum task shape, but not all Waza fields such as repositories, workdir constraints, environment, follow-up prompts, or grader-specific task options.
- Grader schema validation by type. Renma catches common `regex_match` mistakes, but does not validate every grader config shape.
- Coverage strength scoring. Waza distinguishes none, partial, and full coverage using task count plus multiple grader types; Renma currently reports missing coverage and broken task references.
- Readiness summary. Waza `check` combines compliance, token budget, links, eval schema, and next steps; Renma still emits findings only.
- Broken link and orphan reference checks. Renma scans references but does not yet verify local links, remote links, or unused reference files.
- Configurable token limits. Renma still uses a fixed `SKILL.md` budget.
- Eval execution, grading, comparison, and result cache commands. Renma should remain a deterministic preflight unless a future design explicitly expands scope.

Recommended next work:

1. Add a small YAML parser dependency or parser boundary for eval/task files.
2. Validate Waza eval and task schemas more faithfully while keeping execution out of scope.
3. Add coverage strength findings: none, partial, full.
4. Add link/reference integrity checks.
5. Add configurable token budgets via config and environment.

## Reporting

- Implement text and JSON reporters.
- Keep JSON stable enough for CI usage.
- Include:
  - scanned root
  - config path used
  - scanned file count
  - findings
  - diagnostics
  - exit threshold
- Defer SARIF, colored output, patch generation, and LLM review.

## Test Plan

- Use compiled tests with Node test runner.
- Add type-check verification.
- Cover:
  - CLI argument parsing
  - help, version, and invalid-command behavior
  - JSON config loading and validation
  - config, env, and CLI precedence
  - async glob-based artifact discovery
  - bounded file reads and stats
  - deterministic file ordering
  - scan bounds and default excludes
  - path normalization
  - Markdown heading, code fence, link, metadata, and line extraction
  - profile overlay findings
  - secret, destructive command, and weak skill-shape rules
  - eval manifest and eval task findings
  - text and JSON report output
  - `--fail-on` and config `fail_on` exit-code behavior

## Assumptions

- Minimal dependencies are preferred, but correctness can justify small runtime packages.
- Node 22.17+ compatibility is acceptable.
- JSON config is enough for the current CLI.
- `util.parseArgs` is stable in modern Node.
- `fs.promises.glob` is stable in Node 22.17+ / 24+.
