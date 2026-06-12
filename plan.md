# SkillForge Minimal-Dependency CLI MVP Plan

## Summary

Build SkillForge as a TypeScript npm CLI with a small dependency footprint. Prefer Node 22.17+ built-ins, but allow minimal runtime dependencies when they clearly improve correctness, maintainability, or CLI ergonomics.

The MVP is a scanner: it reads skill and agent instruction files, runs deterministic quality and safety rules, and emits text or JSON reports with evidence ranges. It should avoid blocking the event loop during repository scans by using async filesystem APIs and bounded concurrency.

## Runtime And Packaging

- Runtime target: Node 22.17+.
- Add `package.json` `engines.node: ">=22.17"`.
- Add a startup version check that exits with a clear error on unsupported Node versions.
- Publish an npm package with a `skillforge` bin pointing to compiled `dist/index.js`.
- Build with `tsc`.
- Use ESM or CommonJS consistently across source, build output, and package metadata.

## Dependencies

- Keep runtime dependencies minimal, not necessarily zero.
- Prefer Node built-ins:
  - `node:util` `parseArgs` for CLI flags.
  - `node:fs/promises` `glob`, `readFile`, `stat`, and related async APIs for scanning.
  - `node:path` for filesystem-safe path handling.
  - `node:test` and `node:assert/strict` for tests.
- Use sync filesystem APIs only for tiny startup checks where blocking is negligible.
- Dev dependencies:
  - `typescript`
  - `@types/node`
- Avoid Markdown AST packages such as `unified` and `remark` in the MVP.
- Prefer a small hand-written config validator unless a minimal schema dependency clearly pays for itself.
- If a concurrency helper is needed, either implement a tiny local limiter or choose one small dependency explicitly in the plan before implementation.

## CLI Contract

- Implement `skillforge scan [path]`.
- Default `[path]` to the current working directory.
- Support flags:
  - `--config <path>`
  - `--format text|json`
  - `--fail-on <severity>`
  - `--output <path>`
  - `--help`
  - `--version`
- Print manual help text for invalid commands and `--help`.
- Define `--fail-on` values as `info`, `warning`, `error`, and `off`.
- Use exit code `0` when no finding meets the failure threshold.
- Use exit code `1` when findings meet `--fail-on`.
- Use exit code `2` for CLI usage errors, invalid config, or unreadable required inputs.

## Config

- Support `skillforge.config.json`.
- Support `.skillforge.json`.
- Defer YAML support until after MVP.
- Use `fail_on` in config and map it to the CLI `--fail-on` flag.
- Define precedence as defaults, then config file, then CLI flags.
- Validate unknown fields and invalid enum values with actionable error messages.

## Discovery

- Use `fs.promises.glob` for configured globs.
- Keep scan internals async where practical:
  - async glob expansion
  - async file reads and stats
  - bounded concurrency for large repositories
  - no sync filesystem calls in the hot scan path
- Start with a default concurrency limit, for example `16`, and make it configurable only if users need it.
- Aggregate per-file read/parse errors into findings or diagnostics instead of failing the whole scan unless the configured root/config is invalid.
- Default include globs:
  - `skills/**/SKILL.md`
  - `.agents/**/*.md`
  - `AGENTS.md`
  - `skills/**/profiles/**/*.md`
  - `skills/**/references/**/*.md`
  - `evals/**/eval.json`
- Add scan bounds:
  - deterministic sorted file order
  - max file size
  - max recursion depth or bounded glob defaults
  - explicit symlink policy
  - default excludes for dependency/build directories such as `node_modules`, `dist`, `.git`
- Normalize report paths to stable repo-relative POSIX-style strings while using `node:path` for actual filesystem operations.

## Parsing

- Implement a lightweight Markdown scanner for:
  - headings
  - links
  - code fences
  - frontmatter-like metadata blocks
  - line numbers and evidence ranges
- Lightweight Markdown parsing is sufficient for v1 because SkillForge needs evidence ranges, headings, links, and code fences, not a full Markdown renderer.
- Preserve enough source context to produce actionable findings without loading entire large files into reports.

## Rule Model

- Implement deterministic rules as plain TypeScript functions.
- Define a small typed rule contract before adding rules:
  - rule id
  - title
  - category
  - severity
  - input artifact type
  - evidence range
  - suggested remediation
- Initial categories:
  - skill shape
  - token and structure issues
  - profile overlays
  - secrets
  - privileged actions
  - command execution risks

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

- Use compiled tests with the Node test runner.
- Add `tsc --noEmit` or equivalent type-check verification.
- Cover:
  - CLI argument parsing
  - help, version, and invalid-command behavior
  - JSON config loading and validation
  - config and CLI precedence
  - async glob-based artifact discovery
  - bounded async file reads and stats
  - deterministic file ordering
  - scan bounds and default excludes
  - path normalization in reports
  - Markdown heading, code fence, link, metadata, and line extraction
  - profile overlay discovery and conflict findings
  - secret, destructive command, and weak skill-shape rules
  - text and JSON report output
  - `--fail-on` and config `fail_on` exit-code behavior

## Assumptions

- Minimal dependencies are preferred, but maintainability and correctness can justify small runtime packages.
- Node 22.17+ compatibility is acceptable for the MVP.
- JSON config is enough for the MVP.
- `util.parseArgs` is stable in modern Node, and `fs.promises.glob` is stable in Node 22.17+ / 24+.
