# Renma - 練磨

Renma is a minimal-dependency TypeScript CLI for reviewing AI-agent skills, repository instructions, profile overlays, references, and eval manifests.

The scanner reads known skill-related files, runs deterministic quality and safety rules, and emits text or JSON reports with file and line evidence.

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
evals/**/eval.{json,yaml,yml}
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
- missing top-level eval coverage for each skill
- literal credential-like values and private key material
- destructive command examples without nearby confirmation or recovery guidance
- risky remote access defaults
- broad environment copying into subprocess execution
- profile overlays that do not declare a base skill
- eval manifests missing safety or failure cases
- malformed Waza-style eval manifests, including missing `tasks` lists and scalar `regex_match` grader parameters

Static checks are only evidence. Passing a scan does not prove a skill or workflow is safe.

## Development

```bash
npm run build
npm run typecheck
npm test
```

The package build emits the CLI to `dist/index.js`. Tests compile to `dist-test/`.

## License

MIT. See [LICENSE](./LICENSE).
