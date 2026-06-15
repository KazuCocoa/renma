# Renma - 練磨

Renma is a minimal-dependency TypeScript CLI for reviewing AI-agent skills, repository instructions, profile overlays, references, and examples.

The scanner reads known skill-related files, runs deterministic quality and safety rules, and emits text or JSON reports with file and line evidence.

Renma's longer-term direction is a Git-native context engineering toolkit: validation, cataloging, context resolution, traceability, lockfiles, semantic diff, and local context packaging. It is designed for skill and context repositories that multiple teams can consume through normal Git versioning, pinned revisions, and CI review workflows. See [architecture.md](./architecture.md) and [plan.md](./plan.md) for the design direction.

## Requirements

- Node.js 22.17 or newer
- npm

## Install

For local development:

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
```

Options:

```text
-c, --config <path>      Read JSON config from path
    --fail-on <level>    Exit 1 when findings meet severity: low, medium, high, critical
    --format <format>    Output format: text or json
    --json               Shortcut for --format json
-h, --help               Show help
-v, --version            Show version
```

Examples:

```bash
renma scan .
renma scan ./my-repo --json
renma scan . --fail-on medium
renma scan . --config ./renma.config.json
```

## What Gets Scanned

By default, Renma looks for:

```text
skills/**/SKILL.md
.agents/**/*.md
AGENTS.md
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
    "AGENTS.md"
  ],
  "exclude": [
    "node_modules",
    "dist",
    ".git"
  ],
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

Invalid config fields exit code `2`.

## Exit Codes

- `0`: Scan completed and no findings met the failure threshold
- `1`: Scan completed and at least one finding met `fail_on`
- `2`: CLI usage error, invalid config, or unreadable required input

## Checks

Current rules cover early quality and safety signals, including:

- missing skill description, examples, preflight, verification, negative routing, or explicit routing clarity
- short frontmatter descriptions that make skill routing ambiguous
- oversized `SKILL.md` entrypoints that should move detailed procedures into `references/`
- oversized nested context files in `profiles/`, `references/`, and `examples/`
- literal credential-like values and private key material
- destructive command examples without nearby confirmation or recovery guidance
- risky remote access defaults
- broad environment copying into subprocess execution
- profile overlays that do not declare a base skill
- context files under profiles, references, and examples that are not routed from the top-level skill

Static checks are only evidence. Passing a scan does not prove a skill or workflow is safe.

## Development

```bash
npm run build
npm run typecheck
npm test
```

The package build emits the CLI to `dist/index.js`. Tests compile to `dist-test/`.

## Inspirations

Renma is inspired by ideas from:

- [Waza](https://github.com/microsoft/waza), especially skill eval coverage, task-based regression checks, and readiness-oriented validation.
- [SkillSpector](https://github.com/NVIDIA/skillspector), especially deterministic security scanning, risk-oriented findings, SARIF/reporting direction, and analyzer-style rule organization.

Renma is an independent implementation focused on lightweight deterministic preflight checks for AI-agent skill repositories.

## License

MIT. See [LICENSE](./LICENSE).
