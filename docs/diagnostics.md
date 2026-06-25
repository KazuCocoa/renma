# Diagnostics Reference

This page documents diagnostics and finding identifiers emitted by the current renma implementation. It does not list planned diagnostics.

## Diagnostic Types

renma uses two severity systems:

- Discovery, metadata, catalog, and readiness diagnostics use `info`, `warning`, and `error`.
- Scan findings use rule severities such as `low`, `medium`, `high`, and `critical`.

In JSON output, diagnostics usually appear as structured objects with a `severity`, a `message`, and, when available, a `path`.

## Discovery Diagnostics

These diagnostics are emitted while renma discovers files.

| Severity | Message | Meaning | Fix |
| --- | --- | --- | --- |
| `error` | `Could not evaluate glob "<pattern>": <error>` | An include pattern could not be evaluated. | Fix or remove the glob pattern in config or CLI input. |
| `warning` | `Skipping symbolic link.` | renma found a symlink and skipped it. | Point config at the real file or directory if the target should be scanned. |
| `warning` | `Skipping file larger than max_file_size_bytes (<bytes>).` | A file exceeded the configured size limit. | Raise `max_file_size_bytes`, exclude the file, or split the asset. |
| `error` | `Could not read file: <error>` | The file matched discovery but could not be read. | Fix permissions, remove the bad path, or exclude the file. |

## Metadata And Catalog Diagnostics

These diagnostics are emitted after files are parsed into catalog entries.

| Severity | Message | Meaning | Fix |
| --- | --- | --- | --- |
| `warning` | `Invalid status "<status>". Expected one of: draft, active, deprecated, superseded.` | An asset status does not match the accepted status values. | Replace the status with a supported value. |
| `warning` | `Metadata dependency "<to>" from "<from>" does not match a catalog entry.` | A metadata dependency points at an asset renma did not discover. | Correct the reference, add the missing asset, or update include/exclude config. |
| `warning` | `Metadata dependency "<to>" from "<from>" targets a <status> asset.` | A dependency points at an inactive catalog target such as a deprecated or superseded asset. | Retarget the dependency to an active asset or document the migration. |
| `warning` | `Shared context asset is missing an id.` | A shared context asset has no stable ID. | Add an `id` metadata field. |
| `warning` | `Shared context asset is missing an owner.` | A shared context asset has no owner metadata. | Add an `owner` metadata field. |

## Readiness Diagnostics

`renma readiness` converts lower-level data into workflow checks. These messages are produced by readiness checks and may wrap discovery, catalog, graph, ownership, status, or scan-finding data.

| Severity | Message | Meaning | Fix |
| --- | --- | --- | --- |
| `error` | discovery or catalog diagnostic message | A lower-level error diagnostic was present. | Fix the original diagnostic first. |
| `warning` | discovery or catalog diagnostic message | A lower-level warning diagnostic was present. | Review and fix if it affects automation reliability. |
| `error` | `Missing owner metadata.` | A catalog asset lacks owner metadata. | Add `owner` metadata to the asset. |
| `error` | `<kind> reference "<target>" does not resolve.` | A graph edge points to a missing target. | Correct the reference or add the target asset. |
| `error` | `Required context reference "<target>" does not resolve.` | A required context reference is missing. | Add the context asset or correct `requires_context`. |
| `error` | `Required context "<target>" resolves to <status> asset <path>.` | Required context exists but is not active. | Move the dependency to an active context asset. |
| `warning` | `Optional context reference "<target>" does not resolve.` | An optional context reference is missing. | Correct it or remove it if it is no longer useful. |
| `warning` | `Optional context "<target>" resolves to <status> asset <path>.` | Optional context exists but is not active. | Retarget or remove the optional dependency. |
| `warning` | `Asset status is <status>.` | A catalog asset is deprecated, superseded, or otherwise not active. | Migrate dependents or update the asset status. |
| `error` or `warning` | scan finding remediation text | A scan finding is severe enough to affect readiness. | Fix the finding listed in the readiness detail. |

## Scan Finding Identifiers

`renma scan` emits finding IDs from the rule engine. The current identifiers are:

| ID | Area |
| --- | --- |
| `DOCS-LAYOUT-INCONSISTENT` | Documentation layout |
| `LAYOUT-CONTEXT-LEGACY-ROOT` | Repository layout |
| `LAYOUT-DISALLOWED-SKILL-ASSET` | Repository layout |
| `LAYOUT-SKILL-EXECUTABLE-COMMAND` | Repository layout and command policy |
| `LAYOUT-SKILL-NOT-THIN` | Skill layout |
| `MAINT-ASSET-REFERENCES-SUPERSEDED-ASSET` | Maintenance |
| `MAINT-CONTEXT-PATH-NON-SEMANTIC` | Maintenance |
| `MAINT-ORPHANED-CONTEXT-ASSET` | Maintenance |
| `MAINT-REFERENCE-DEPRECATED-ASSET` | Maintenance |
| `MAINT-REPEATED-CODE-BLOCK` | Maintenance |
| `MAINT-REPEATED-CONTEXT-PATTERN` | Maintenance |
| `MAINT-REPEATED-HEADING` | Maintenance |
| `MAINT-REPEATED-LINK` | Maintenance |
| `MAINT-REPEATED-SECTION` | Maintenance |
| `MAINT-SKILL-CONTEXT-REFERENCE-NOT-DECLARED` | Maintenance |
| `MAINT-SKILL-REFERENCES-SUPERSEDED-ASSET` | Maintenance |
| `MAINT-SKILL-REUSABLE-CONTEXT-CANDIDATE` | Maintenance |
| `MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE` | Maintenance |
| `META-DUPLICATE-ASSET-ID` | Metadata |
| `META-UNKNOWN-REFERENCE` | Metadata |
| `PATH-HELPER-COMMAND-SKILL-SCRIPTS` | Path and helper command policy |
| `PATH-HELPER-COMMAND-UNRESOLVED` | Path and helper command policy |
| `PROF-MISSING-BASE` | Profile coverage |
| `QUAL-LOW-HEADING-DENSITY` | Quality |
| `QUAL-MISSING-COMPLETION-CRITERIA` | Quality |
| `QUAL-MISSING-DESCRIPTION` | Quality |
| `QUAL-MISSING-EXAMPLES` | Quality |
| `QUAL-MISSING-NEGATIVE-ROUTING` | Quality |
| `QUAL-MISSING-PREFLIGHT` | Quality |
| `QUAL-MISSING-REQUIRED-INPUTS` | Quality |
| `QUAL-MISSING-ROUTING-CLARITY` | Quality |
| `QUAL-MISSING-VERIFICATION` | Quality |
| `QUAL-SHORT-DESCRIPTION` | Quality |
| `QUAL-SKILL-TOKEN-BUDGET` | Quality |
| `QUAL-SUPPORT-ASSET-TOKEN-BUDGET` | Quality |
| `QUAL-USER-LOCAL-PATHS` | Quality |
| `SEC-DESTRUCTIVE-COMMAND` | Security |
| `SEC-ENV-COPY` | Security |
| `SEC-LITERAL-SECRET` | Security |
| `SEC-PRIVATE-KEY` | Security |
| `SEC-REMOTE-DEFAULT` | Security |
| `SUPPORT-MISSING-REACHABILITY-GUIDANCE` | Supportability |
| `SUPPORT-UNREACHABLE-EXAMPLE` | Supportability |
| `SUPPORT-UNREACHABLE-PROFILE` | Supportability |
| `SUPPORT-UNREACHABLE-REFERENCE` | Supportability |

## How To Fix Results

1. Fix `error` diagnostics first. They usually mean renma could not build a deterministic view of the repository.
2. Fix unresolved references before quality findings. Reference failures can hide or distort later reports.
3. For scan findings, use the finding ID, evidence path, line number, snippet, and remediation text in the JSON output.
4. Re-run the same command with `--format json` when a markdown or text report does not contain enough detail.
