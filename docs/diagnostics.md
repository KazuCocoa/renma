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

`renma scan` emits finding IDs from the rule engine. A scan finding identifier is a machine-readable label for the kind of issue found during a scan.

It is different from:

- an asset ID, which identifies a context asset or other catalog entry
- a file path, which identifies where the issue was found
- a diagnostic message, which is written for humans and may contain contextual details

Finding identifiers are useful when you want to group, filter, document, or automate responses to scan results. CI systems, editor integrations, docs, and LLM-assisted repair workflows can use the identifier to understand the category of problem without relying on the exact wording of the human-readable message.

The identifiers below are part of the current scan output. The current implementation does not declare them as a permanent public API, so integrations should avoid assuming stronger stability than the project documents. If renma adopts long-term stability guarantees later, identifier changes should come with documented migrations.

| Identifier | Meaning | Typical cause | How to fix |
| --- | --- | --- | --- |
| `DOCS-LAYOUT-INCONSISTENT` | Documentation points at non-canonical layout. | Docs mention stale roots or skill-local support paths. | Update docs to reference canonical `skills/`, `contexts/`, and `tools/` layout. |
| `LAYOUT-CONTEXT-LEGACY-ROOT` | Context lives under a legacy root. | Shared context is stored outside the configured context root. | Move the asset to the canonical context root or update layout config. |
| `LAYOUT-CONTEXT-REFERENCE-NON_CANONICAL` | Reference uses non-canonical path layout. | A declared dependency points outside canonical `contexts/`, `skills/`, or `tools/` paths. | Rewrite the dependency to the canonical asset path or ID. |
| `LAYOUT-DISALLOWED-SKILL-ASSET` | Skill-local asset should live elsewhere. | A skill contains support content that policy routes to shared roots. | Move reusable assets to the canonical shared location and update references. |
| `LAYOUT-HELPER-NON_TOOLS` | Helper file is outside the tools root. | A helper script lives under a non-canonical scripts directory. | Move helper code under the configured `tools/**` root. |
| `LAYOUT-SKILL-EXECUTABLE-COMMAND` | `SKILL.md` includes executable command detail. | A skill entrypoint contains shell commands instead of delegating to helpers. | Move commands to approved helpers and keep `SKILL.md` as routing guidance. |
| `LAYOUT-SKILL-NOT-THIN` | Skill entrypoint is too large or procedural. | `SKILL.md` contains long procedures, setup, or troubleshooting content. | Split detailed material into references, profiles, examples, or tools. |
| `MAINT-ASSET-REFERENCES-SUPERSEDED-ASSET` | Asset references superseded context. | Metadata or content points at an asset marked superseded. | Retarget the reference to the active replacement. |
| `MAINT-CONTEXT-PATH-NON-SEMANTIC` | Context path is not semantically grouped. | Context is stored under vague folders such as misc or general. | Move it under a meaningful path such as `contexts/tools/`, `contexts/domain/`, or `contexts/testing/`. |
| `MAINT-ORPHANED-CONTEXT-ASSET` | Shared context has no incoming references. | A first-class context asset is not used by skills or other assets. | Link it from consumers, archive it, or remove it after review. |
| `MAINT-REFERENCE-DEPRECATED-ASSET` | Reference targets deprecated context. | Metadata dependency resolves to a deprecated asset. | Point dependents at an active asset or finish the migration. |
| `MAINT-REPEATED-CODE-BLOCK` | Duplicate code block appears across assets. | Copy-pasted examples or procedures repeat in multiple files. | Extract shared guidance or consolidate the repeated block. |
| `MAINT-REPEATED-CONTEXT-PATTERN` | Repeated context-like wording appears. | Multiple assets duplicate the same reusable context pattern. | Promote the shared pattern into a context asset and reference it. |
| `MAINT-REPEATED-HEADING` | Same heading repeats across assets. | Similar sections are copied through several files. | Consolidate or reference a shared source of truth. |
| `MAINT-REPEATED-LINK` | Same link repeats across assets. | Repeated references suggest duplicated guidance. | Centralize the reference or keep only necessary local links. |
| `MAINT-REPEATED-SECTION` | Similar section text repeats. | A section has been copied into multiple assets. | Extract common material or reduce duplication. |
| `MAINT-SKILL-CONTEXT-REFERENCE-NOT-DECLARED` | Skill mentions context without metadata. | Body text references `contexts/...` but `requires_context` omits it. | Add the context to `requires_context` or remove the stale mention. |
| `MAINT-SKILL-REFERENCES-SUPERSEDED-ASSET` | Skill refers to superseded context. | Skill content names a superseded context asset. | Update the skill to the active context asset. |
| `MAINT-SKILL-REUSABLE-CONTEXT-CANDIDATE` | Skill contains reusable context. | `SKILL.md` includes broadly reusable setup, troubleshooting, or risk guidance. | Move reusable content to shared context and reference it. |
| `MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE` | Support asset looks reusable. | A reference, profile, or example contains content useful beyond one skill. | Promote it to shared context when reuse is intended. |
| `META-DUPLICATE-ASSET-ID` | Asset ID is not unique. | Two catalog entries declare the same ID. | Give each asset a unique ID and update references. |
| `META-UNKNOWN-REFERENCE` | Metadata reference does not resolve. | A dependency points to a missing asset ID or path. | Fix the reference, add the missing asset, or remove the dependency. |
| `PATH-HELPER-COMMAND-NON_TOOLS` | Helper command points outside tools. | A command references a scripts path that is not under `tools/**`. | Move the helper to `tools/**` and update the command. |
| `PATH-HELPER-COMMAND-SKILL-SCRIPTS` | Helper command is skill-local. | A command points into `skills/*/scripts`. | Move helper code to the configured `tools/**` location. |
| `PATH-HELPER-COMMAND-UNRESOLVED` | Helper command path is missing. | A referenced helper under `tools/**` does not exist. | Add the helper or correct the command path. |
| `PROF-MISSING-BASE` | Profile lacks base guidance. | A profile does not clearly relate to base skill behavior. | Add base-profile context or inheritance guidance. |
| `QUAL-LOW-HEADING-DENSITY` | Asset has too little structure. | Long content has few headings. | Add meaningful headings or split the asset. |
| `QUAL-MISSING-COMPLETION-CRITERIA` | Completion criteria are missing. | The asset does not say when work is done. | Add explicit completion or acceptance criteria. |
| `QUAL-MISSING-DESCRIPTION` | Description is missing. | Metadata or introductory purpose is absent. | Add a concise description. |
| `QUAL-MISSING-EXAMPLES` | Examples are missing. | Instructional content has no concrete example. | Add representative positive examples. |
| `QUAL-MISSING-NEGATIVE-ROUTING` | Negative routing is missing. | Skill guidance omits when not to use it. | Add exclusions or handoff guidance. |
| `QUAL-MISSING-PREFLIGHT` | Preflight guidance is missing. | The asset omits checks to run before acting. | Add required inputs, checks, or setup steps. |
| `QUAL-MISSING-REQUIRED-INPUTS` | Required inputs are unclear. | The asset does not state what information is needed. | Add an explicit required-inputs section. |
| `QUAL-MISSING-ROUTING-CLARITY` | Routing guidance is unclear. | A skill does not clearly say when to use it. | Clarify triggers, audience, and handoffs. |
| `QUAL-MISSING-VERIFICATION` | Verification guidance is missing. | The asset lacks checks for validating the result. | Add verification steps or expected evidence. |
| `QUAL-SHORT-DESCRIPTION` | Description is too short. | Metadata description is present but not informative. | Expand it enough to explain purpose and scope. |
| `QUAL-SKILL-TOKEN-BUDGET` | Skill content is too large. | A skill exceeds the configured token budget. | Split support content out of the skill entrypoint. |
| `QUAL-SUPPORT-ASSET-TOKEN-BUDGET` | Support asset is too large. | A reference, profile, or example exceeds its token budget. | Split the asset or shorten nonessential material. |
| `QUAL-USER-LOCAL-PATHS` | User-local path appears in content. | Guidance includes machine-specific paths such as home directories. | Replace local paths with repository-relative or configurable paths. |
| `SEC-DESTRUCTIVE-COMMAND` | Destructive command appears. | Content includes risky commands such as forced deletion or reset. | Remove it, gate it with explicit safety guidance, or use a safer command. |
| `SEC-ENV-COPY` | Environment copying is suggested. | Content copies broad environment or secret-bearing files. | Narrow the copied data and document secret handling. |
| `SEC-LITERAL-SECRET` | Literal secret-like value appears. | Content includes token, password, key, or credential patterns. | Remove the secret and replace it with a placeholder. |
| `SEC-PRIVATE-KEY` | Private key material appears. | Content includes a private key block. | Remove the key and rotate it if it was real. |
| `SEC-REMOTE-DEFAULT` | Remote command default is unsafe. | Guidance defaults to network commands, prod hosts, or insecure flags. | Use safe examples and require explicit approval for risky remotes. |
| `SUPPORT-MISSING-REACHABILITY-GUIDANCE` | Support docs are not discoverable. | A skill has local profiles, references, or examples without routing guidance. | Add guidance that explains when to load each support asset. |
| `SUPPORT-UNREACHABLE-EXAMPLE` | Example is unreachable. | A skill-local example is not referenced by the skill. | Link it from the skill or move/remove it. |
| `SUPPORT-UNREACHABLE-PROFILE` | Profile is unreachable. | A skill-local profile is not referenced by the skill. | Link it from the skill or move/remove it. |
| `SUPPORT-UNREACHABLE-REFERENCE` | Reference is unreachable. | A skill-local reference is not referenced by the skill. | Link it from the skill or move/remove it. |

## How To Fix Results

1. Fix `error` diagnostics first. They usually mean renma could not build a deterministic view of the repository.
2. Fix unresolved references before quality findings. Reference failures can hide or distort later reports.
3. For scan findings, use the finding ID, evidence path, line number, snippet, and remediation text in the JSON output.
4. Re-run the same command with `--format json` when a markdown or text report does not contain enough detail.
