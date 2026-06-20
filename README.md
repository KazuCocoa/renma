# Renma - 練磨

Renma helps teams keep LLM-ready context assets and skills healthy in Git.

Renma is a Git-native governance and quality layer for shared context repositories. It prepares repositories so Codex, Claude, Cursor, and future agents can consume team-owned expertise correctly. Renma does not choose task context, assemble prompts, inject context, or execute agent workflows; agents and runtimes decide how to use the assets for a task.

```text
Skill = LLM-facing entrypoint / routing contract / usage guide
Context = independently owned source-of-truth knowledge asset
```

## Why Renma?

As AI-agent repositories grow, expertise often gets copied into many skills. Testing heuristics, domain risks, tool usage notes, and team-specific contracts drift apart. Ownership becomes unclear, references break, deprecated guidance remains reachable, and new engineers or agents cannot tell which knowledge is authoritative.

Renma treats context as a software asset:

- Reusable
- Owned
- Reviewable
- Versioned
- Composable
- Validated
- Easy to inspect in CI and code review

The first strong product focus is QA/testing: boundary value analysis, negative testing, regression risk, payment idempotency, duplicate charge prevention, refund edge cases, mobile offline behavior, Appium usage, internal test strategy, and known team-specific risks can live as shared context assets instead of being buried inside individual skills.

## Repository Shape

Renma supports skill-local references, profiles, and examples, but the target repository model gives shared context assets first-class space:

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

`contexts/` is preferred. `context/` is also scanned for compatibility. Files under either root are cataloged as first-class `context` assets, while skill-local `references/` remain `reference` assets.

## What Renma Does

Today Renma is a minimal-dependency TypeScript CLI that scans AI-agent skills, repository instructions, shared context Markdown, profile overlays, references, and examples. It runs deterministic quality, structure, and safety rules, then emits text or JSON reports with file and line evidence.

Renma findings are intended to be actionable repair prompts for humans and LLM
tools such as Codex, Claude, and Cursor. Findings should explain what is wrong,
why it matters, where the evidence is, what a safe repair should preserve, and
how to verify the fix. Renma does not apply large semantic rewrites itself; it
emits structured diagnostics so a human or agent can propose a reviewable patch
and run Renma again.

Current capabilities:

- Bounded filesystem discovery
- Stable POSIX-style repo-relative paths
- Markdown parsing for headings, links, code fences, metadata, and evidence
- Structural quality checks for skills, shared context assets, and local support files
- Safety checks for risky instructions and literal secrets
- Deterministic catalog output for assets and dependency metadata
- Repository file outline and line-slice inspection helper
- Semantic split prompt helper for oversized context files
- CI-friendly exit behavior with `--fail-on`
- Config loading from `renma.config.json` and `.renma.json`

Planned direction:

- First-class shared context asset validation
- Catalog snapshots
- Dependency and reference graph snapshots
- Graph-backed validation
- Orphaned, deprecated, missing, invalid, and conflicting context detection
- Repeated context and duplicate knowledge discovery
- Semantic diff for context changes
- Agent readiness reports
- Optional external signal import

See [architecture.md](./architecture.md) and [plan.md](./plan.md) for the current design direction.

## Requirements

- Node.js 22.17 or newer
- npm

Install:

```bash
npm install
npm run build
```

After building, run the CLI directly:

```bash
node dist/index.js scan .
```

When installed as a package, the binary name is:

```bash
renma scan .
```

## Usage

```bash
renma scan [path] [options]
renma catalog [path] [options]
renma inspect <file> [options]
renma suggest-semantic-split <file> [options]
```

`renma inspect` is a repository inspection helper for outlines and exact line slices; it does not choose task context or assemble prompts.

Options:

```text
-c, --config <path>      Read JSON config from path
    --fail-on <level>    Exit 1 when findings meet severity: low, medium, high, critical
    --format <format>    scan: text or json; catalog: json or markdown; suggest: prompt or json
    --json               Shortcut for --format json
    --lines <range>      inspect: exact line range, e.g. L10-L42
    --max-source-bytes <n>
                          suggest-semantic-split: source file byte budget
    --max-context-bytes <n>
                          suggest-semantic-split: nearby context byte budget
-h, --help               Show help
-v, --version            Show version
```

Examples:

```bash
renma scan .
renma scan ./my-repo --json
renma scan . --fail-on medium
renma scan . --config ./renma.config.json
renma catalog . --format markdown
renma catalog . --json
renma inspect contexts/testing/boundary-value-analysis.md --format json
renma inspect contexts/testing/boundary-value-analysis.md --lines L40-L90 --format text
renma suggest-semantic-split contexts/tools/appium/usage-guideline.md
```

## What Gets Scanned

By default, Renma looks for:

```text
skills/**/SKILL.md
.agents/**/*.md
AGENTS.md
context/**/*.md
contexts/**/*.md
skills/**/profiles/**/*.md
skills/**/references/**/*.md
skills/**/examples/**/*.md
```

It skips `node_modules`, `dist`, and `.git`, ignores symbolic links, enforces a maximum file size, and reports paths in stable POSIX-style form.

## Configuration

Renma automatically looks for `renma.config.json`, then `.renma.json`.

Configuration is applied in this order:

1. Defaults
2. Config file
3. CLI flags

Example:

```json
{
  "fail_on": "high",
  "format": "json",
  "globs": [
    "skills/**/SKILL.md",
    "AGENTS.md",
    "contexts/**/*.md"
  ],
  "exclude": ["node_modules", "dist", ".git"],
  "max_file_size_bytes": 524288,
  "max_depth": 16,
  "concurrency": 16
}
```

Supported fields:

- `fail_on`: `low`, `medium`, `high`, or `critical`
- `format`: `text` or `json`
- `globs`: array of glob patterns
- `exclude`: array of path segment names to skip
- `max_file_size_bytes`: positive integer
- `max_depth`: positive integer
- `concurrency`: positive integer

Invalid config fields exit with code `2`.

## Exit Codes

- `0`: Scan completed and no findings met the failure threshold
- `1`: Scan completed and at least one finding met `fail_on`
- `2`: CLI usage error, invalid config, or unreadable required input

## Checks

Current rules include:

- Missing skill description, examples, preflight, verification, negative routing, or explicit routing clarity
- Short frontmatter descriptions
- Oversized `SKILL.md` entrypoints
- Oversized shared context assets or local support files in `contexts/`, `context/`, `profiles/`, `references/`, and `examples/`
- Unreachable skill-local profiles, references, and examples
- Profile overlays missing base skill declaration
- Literal secret-like values
- Private key material
- Destructive commands without nearby confirmation or recovery context
- Risky remote defaults
- Broad environment copying into subprocesses
- Hardcoded user-local paths

Static checks are evidence. Passing a scan does not prove a repository or agent workflow is safe.

## Development

```bash
npm run build
npm run typecheck
npm test
```

The package build emits the CLI to `dist/index.js`. Tests compile to `dist-test/`.

## Inspirations

Renma is inspired by:

- [Waza](https://github.com/microsoft/waza), especially skill eval coverage, task-based regression checks, and readiness-oriented validation.
- [SkillSpector](https://github.com/NVIDIA/skillspector), especially deterministic security scanning, risk-oriented findings, SARIF/reporting direction, and analyzer-style rule organization.

Renma is an independent implementation focused on lightweight deterministic governance checks for AI-agent skill and context repositories.

## License

MIT. See [LICENSE](./LICENSE).
