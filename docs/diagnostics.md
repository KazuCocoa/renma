# Diagnostics Reference

This page documents diagnostics and finding identifiers emitted by the current renma implementation. It does not list planned diagnostics.

## Diagnostic Types

renma uses two severity systems:

- Discovery, metadata, catalog, and readiness diagnostics use `info`, `warning`, and `error`.
- Scan findings use rule severities such as `low`, `medium`, `high`, and `critical`.

In JSON output, diagnostics usually appear as structured objects with a `severity`, a `message`, and, when available, a `path`.

## Scan Review Signals

Renma scan findings always include `severity` and `confidence`. Security findings may also include `riskClass`, a human security-review interpretation.

- `severity`: CI gating, urgency, and impact. Values are `low`, `medium`, `high`, and `critical`.
- `confidence`: detector certainty. Values are `low`, `medium`, and `high`.
- `riskClass`: human security-review interpretation for security findings. Values are `violation`, `suspicious`, and `advisory`.

`violation` means a rule or safety contract is broken. Examples include unapproved network or upload destinations, policy contradictions, forbidden inputs, literal secrets, private keys, secret exposure, and dangerous commands.

`suspicious` means a risky or ambiguous instruction should be reviewed but is not necessarily a direct policy violation. Examples include external upload instructions, cloud upload instructions, broad data sharing, overbroad context collection, unpinned remote scripts, unpinned dependency installs, privileged commands without guardrails, and risky temporary paths.

`advisory` means a governance or hardening recommendation. For example, `SEC-MISSING-POLICY-METADATA` advises adding explicit policy metadata.

`riskClass` also powers aggregate security posture summaries in readiness and CI reports.

`riskClass` does not replace `severity` and does not change `fail_on` behavior. Severity remains the CI threshold signal.

## Discovery Diagnostics

These diagnostics are emitted while renma discovers files.

| Severity | Message | Meaning | Fix |
| --- | --- | --- | --- |
| `error` | `Could not evaluate glob "<pattern>": <error>` | A configured discovery glob could not be evaluated. | Fix or remove the glob pattern in config or CLI input. |
| `warning` | `Skipping symbolic link.` | renma found a symlink and skipped it. | Point config at the real file or directory if the target should be scanned. |
| `warning` | `Skipping file larger than max_file_size_bytes (<bytes>).` | A file exceeded the configured size limit. | Raise `max_file_size_bytes`, exclude the file, or split the asset. |
| `error` | `Could not read file: <error>` | The file matched discovery but could not be read. | Fix permissions, remove the bad path, or exclude the file. |

## Metadata And Catalog Diagnostics

These diagnostics are emitted after files are parsed into catalog entries.

| Severity | Message | Meaning | Fix |
| --- | --- | --- | --- |
| `warning` | `Invalid status "<status>". Expected one of: experimental, stable, deprecated, archived.` | An asset status does not match the accepted status values. | Replace the status with a supported value. |
| `warning` | `Invalid last_reviewed_at "<date>". Expected ISO date YYYY-MM-DD.` | Freshness metadata has an invalid human review date. | Replace it with a real ISO date such as `2026-06-28`. |
| `warning` | `Invalid expires_at "<date>". Expected ISO date YYYY-MM-DD.` | Freshness metadata has an invalid expiration date. | Replace it with a real ISO date such as `2026-12-31`. |
| `warning` | `Invalid review_cycle "<duration>". Expected supported ISO 8601 day duration such as P90D.` | Freshness metadata uses a review cycle renma cannot evaluate. | Use a day-based duration such as `P90D` or `P180D`. |
| `warning` | `Metadata dependency "<to>" from "<from>" does not match a catalog entry.` | A metadata dependency points at an asset renma did not discover. | Correct the reference, add the missing asset, or update include/exclude config. |
| `warning` | `Metadata dependency "<to>" from "<from>" targets a <status> asset.` | A dependency points at a deprecated or archived catalog target. | Retarget the dependency to a stable replacement or document the migration. |
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
| `error` | `Required context "<target>" resolves to <status> asset <path>.` | Required context exists but is deprecated or archived. | Move the dependency to a stable context asset. |
| `warning` | `Optional context reference "<target>" does not resolve.` | An optional context reference is missing. | Correct it or remove it if it is no longer useful. |
| `warning` | `Optional context "<target>" resolves to <status> asset <path>.` | Optional context exists but is deprecated or archived. | Retarget or remove the optional dependency. |
| `warning` | `Asset status is <status>.` | A catalog asset is deprecated or archived. | Migrate dependents or update the asset status. |
| `error` or `warning` | scan finding remediation text | A scan finding is severe enough to affect readiness. | Fix the finding listed in the readiness detail. |

## Scan Finding Identifiers

`renma scan` emits finding IDs from the rule engine. A scan finding identifier is a machine-readable label for the kind of issue found during a scan.

It is different from:

- an asset ID, which identifies a context asset or other catalog entry
- a file path, which identifies where the issue was found
- a diagnostic message, which is written for humans and may contain contextual details

Finding identifiers are useful when you want to group, filter, document, or automate responses to scan results. CI systems, editor integrations, docs, and LLM-assisted repair workflows can use the identifier to understand the category of problem without relying on the exact wording of the human-readable message.

The identifiers below are part of the current scan output. The current implementation does not declare them as a permanent public API, so integrations should avoid assuming stronger stability than the project documents. If renma adopts long-term stability guarantees later, identifier changes should come with documented migrations.

Security diagnostics focus on high-signal heuristics for agent-facing or context-bearing artifacts Renma already discovers, such as skills, contexts, `AGENTS.md`, references, profiles, examples, and tool guidance. Defensive wording and nearby human approval, dry-run, backup, or rollback guidance may reduce or avoid command-risk findings when they are local to the risky instruction. When `requires_human_approval` is true, dry-run, backup, rollback, or restore guidance does not replace explicit human approval. Renma does not scan `package.json`, GitHub Actions workflows, Dockerfiles, or repository-wide supply-chain metadata by default.

### Security Policy Metadata

Security policy diagnostics read small metadata fields from skill and context frontmatter. If a skill or context omits both `allowed_data` and inherited policy data, Renma can emit `SEC-MISSING-POLICY-METADATA` with evidence such as `missing allowed_data policy metadata`.

Supported policy metadata includes:

| Field | Accepted aliases | Meaning | Related findings |
| --- | --- | --- | --- |
| `allowed_data` | `allowedData` | Declares the asset's allowed data entries. It accepts scalar, inline list, and block list forms; `allowed_data: disclosed`, `allowed_data: [disclosed]`, and a one-item block list are equivalent. | `SEC-MISSING-POLICY-METADATA`, `SEC-FORBIDDEN-INPUT-INSTRUCTION`, `SEC-INSTRUCTION-VIOLATES-POLICY` |
| `network_allowed` | `networkAllowed` | Declares whether the asset may perform network actions such as fetching URLs or contacting APIs. Explicit `false` blocks network instructions even when repository config has approved domains. | `SEC-INSTRUCTION-VIOLATES-POLICY`, `SEC-BODY-POLICY-CONTRADICTION`, `SEC-UNAPPROVED-NETWORK-DESTINATION` |
| `external_upload_allowed` | `externalUploadAllowed` | Declares whether the asset may upload, publish, submit, sync, push, or otherwise send repository data externally. | `SEC-INSTRUCTION-VIOLATES-POLICY`, `SEC-EXTERNAL-UPLOAD-INSTRUCTION`, `SEC-UNAPPROVED-UPLOAD-DESTINATION` |
| `secrets_allowed` | `secretsAllowed` | Declares whether secret material is allowed as input or content for the asset. | `SEC-INSTRUCTION-VIOLATES-POLICY`, `SEC-SECRET-MATERIAL-INSTRUCTION`, `SEC-SENSITIVE-FILE-REFERENCE` |
| `requires_human_approval` | `human_approval_required`, `requiresHumanApproval`, `humanApprovalRequired` | Requires a nearby human approval guard before sensitive network, upload, secret-handling, or high-risk actions. | `SEC-MISSING-HUMAN-APPROVAL-GUARD` |
| `approved_network_destinations` | `approvedNetworkDestinations`, `allowed_network_destinations`, `allowedNetworkDestinations` | Lists approved network destinations for URL or domain-like network instructions. | `SEC-UNAPPROVED-NETWORK-DESTINATION` |
| `approved_upload_destinations` | `approvedUploadDestinations`, `approved_upload_domains`, `approvedUploadDomains` | Lists approved upload destinations. Upload approvals are checked separately from general network approvals. | `SEC-UNAPPROVED-UPLOAD-DESTINATION` |
| `forbidden_inputs` | `forbiddenInputs` | Lists inputs the asset must not request or process, such as `secrets`, `credentials`, or `tokens`. | `SEC-FORBIDDEN-INPUT-INSTRUCTION` |
| `security_profile` | `securityProfile` | Selects a repository security profile from `renma.config.json`. Artifact-local explicit denials remain stricter than inherited profile or repository allowances. | `SEC-POLICY-PROFILE-NOT-FOUND`, `SEC-POLICY-PROFILE-CYCLE`, `SEC-POLICY-OVERRIDE-CONTRADICTION` |

Boolean policy fields accept values such as `true`, `false`, `yes`, `no`, `allowed`, `denied`, `allow`, and `deny`. List-valued fields accept comma-separated inline values, bracket-style inline lists, or simple block lists.

Example:

```yaml
allowed_data: public
network_allowed: true
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
forbidden_inputs:
  - secrets
  - credentials
  - tokens
```

`security_profile` inherits policy values from `renma.config.json`. Security profile list fields such as `allowedData` / `allowed_data`, `forbiddenInputs` / `forbidden_inputs`, `approvedDomains`, `approvedUploadDomains`, and `disallowedCommands` accept either a string or an array of strings. Profiles may still use `allowedDataClass` or `allowed_data_class` for a broad data class, but `allowedData` / `allowed_data` is the simpler shape for new config. Artifact-local explicit denials, such as `network_allowed: false` or `external_upload_allowed: false`, remain stricter than inherited profile or repository allowances. Network destination approvals and upload destination approvals are separate; approving a host for network access does not approve uploads to that host.

| Identifier | Meaning | Typical cause | How to fix |
| --- | --- | --- | --- |
| `DOCS-LAYOUT-INCONSISTENT` | Documentation points at non-canonical layout. | Docs mention stale roots or skill-local support paths. | Update docs to reference canonical `skills/`, `contexts/`, and `tools/` layout. |
| `LAYOUT-CONTEXT-LEGACY-ROOT` | Context lives under a legacy root. | Shared context is stored outside the configured context root. | Move the asset to the canonical context root or update layout config. |
| `LAYOUT-CONTEXT-REFERENCE-NON_CANONICAL` | Reference uses non-canonical path layout. | A declared dependency points outside canonical `contexts/`, `skills/`, or `tools/` paths. | Rewrite the dependency to the canonical asset path or ID. |
| `LAYOUT-DISALLOWED-SKILL-ASSET` | Skill-local asset should live elsewhere. | A skill contains support content that policy routes to shared roots. | Move reusable assets to the canonical shared location and update references. |
| `LAYOUT-HELPER-NON_TOOLS` | Helper file is outside the tools root. | A helper script lives under a non-canonical scripts directory. | Move helper code under the configured `tools/**` root. |
| `LAYOUT-SKILL-EXECUTABLE-COMMAND` | `SKILL.md` includes executable command detail. | A skill entrypoint contains shell commands instead of delegating to helpers. | Move commands to approved helpers and keep `SKILL.md` as routing guidance. |
| `LAYOUT-SKILL-NOT-THIN` | Skill entrypoint is too large or procedural. | `SKILL.md` contains long procedures, setup, or troubleshooting content. | Split detailed material into references, profiles, examples, or tools. |
| `MAINT-ASSET-REFERENCES-SUPERSEDED-ASSET` | Asset references superseded context. | Metadata or content points at an asset marked superseded. | Retarget the reference to the stable replacement. |
| `MAINT-ASSET-EXPIRED` | Asset freshness metadata is expired. | `expires_at` is before today's date. | Review the asset with its owner, then update freshness metadata, status, or references. |
| `MAINT-CONTEXT-PATH-NON-SEMANTIC` | Context path is not semantically grouped. | Context is stored under vague folders such as misc or general. | Move it under a meaningful path such as `contexts/tools/`, `contexts/domain/`, or `contexts/testing/`. |
| `MAINT-ASSET-REVIEW-OVERDUE` | Asset freshness review is overdue. | `last_reviewed_at + review_cycle` is before today's date. | Revalidate the asset with a human owner, then update `last_reviewed_at` or review cadence. |
| `MAINT-ORPHANED-CONTEXT-ASSET` | Shared context has no incoming references. | A first-class context asset is not used by skills or other assets. | Link it from consumers, archive it, or remove it after review. |
| `MAINT-REFERENCE-DEPRECATED-ASSET` | Reference targets deprecated context. | Metadata dependency resolves to a deprecated asset. | Point dependents at a stable asset or finish the migration. |
| `MAINT-REPEATED-CODE-BLOCK` | Duplicate code block appears across assets. | Copy-pasted examples or procedures repeat in multiple files. | Extract shared guidance or consolidate the repeated block. |
| `MAINT-REPEATED-CONTEXT-PATTERN` | Repeated context-like wording appears. | Multiple assets duplicate the same reusable context pattern. | Promote the shared pattern into a context asset and reference it. |
| `MAINT-REPEATED-HEADING` | Same heading repeats across assets. | Similar sections are copied through several files. | Consolidate or reference a shared source of truth. |
| `MAINT-REPEATED-LINK` | Same link repeats across assets. | Repeated references suggest duplicated guidance. | Centralize the reference or keep only necessary local links. |
| `MAINT-REPEATED-SECTION` | Similar section text repeats. | A section has been copied into multiple assets. | Extract common material or reduce duplication. |
| `MAINT-SKILL-CONTEXT-REFERENCE-NOT-DECLARED` | Skill mentions context without metadata. | Body text references `contexts/...` but `requires_context` omits it. | Add the context to `requires_context` or remove the stale mention. |
| `MAINT-SKILL-REFERENCES-SUPERSEDED-ASSET` | Skill refers to superseded context. | Skill content names a superseded context asset. | Update the skill to the stable replacement context asset. |
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
| `META-CATALOG-DIAGNOSTIC` | Catalog diagnostic was promoted to a scan finding. | Catalog validation emitted a lower-level diagnostic. | Fix the original catalog diagnostic shown in the finding evidence. |
| `META-INACTIVE-DEPENDENCY` | Metadata points to an inactive asset. | A dependency targets a deprecated or archived asset. | Retarget the dependency to a stable asset or update asset status intentionally. |
| `META-INVALID-EXPIRES-AT` | Freshness expiration date is invalid. | `expires_at` is present but is not a real `YYYY-MM-DD` date. | Replace it with a valid ISO date or remove the field until reviewed. |
| `META-INVALID-LAST-REVIEWED-AT` | Freshness review date is invalid. | `last_reviewed_at` is present but is not a real `YYYY-MM-DD` date. | Replace it with a valid ISO date or remove the field until reviewed. |
| `META-INVALID-REVIEW-CYCLE` | Freshness review cycle is unsupported. | `review_cycle` is present but is not a supported day duration. | Use a duration such as `P90D` or `P180D`. |
| `META-INVALID-STATUS` | Metadata status is invalid. | An asset declares an unsupported status value. | Replace it with a supported lifecycle status. |
| `META-MISSING-ID` | Metadata is missing an asset ID. | A shared context asset has no stable `id`. | Add an `id` metadata field. |
| `META-MISSING-OWNER` | Metadata is missing an owner. | An asset has no owner metadata. | Add an `owner` metadata field. |
| `META-UNKNOWN-DEPENDENCY` | Metadata dependency is unresolved. | A dependency points at an asset renma did not discover. | Correct the dependency, add the missing asset, or update discovery config. |
| `SEC-BODY-POLICY-CONTRADICTION` | Body text contradicts a security policy. | Asset instructions override or weaken policy expectations. | Align the asset content with the active policy profile. |
| `SEC-BULK-DATA-SHARING-INSTRUCTION` | Instructions allow broad data sharing. | Content tells an agent to share large or sensitive data without bounds. | Narrow the sharing scope and add approval or redaction guidance. |
| `SEC-CLOUD-UPLOAD-INSTRUCTION` | Instructions allow cloud upload. | Content sends files or data to cloud storage without policy controls. | Add approved destinations, limits, and approval requirements. |
| `SEC-CREDENTIAL-IN-COMMAND-ARG` | Command embeds a credential-like value. | Example commands include secrets in arguments. | Move credentials to secure environment or secret-management guidance. |
| `SEC-DANGEROUS-TOOL-INSTRUCTION` | Instructions permit dangerous tool use. | Content allows destructive or high-risk commands without guardrails. | Require review, dry runs, or explicit user approval before execution. |
| `SEC-EXTERNAL-UPLOAD-INSTRUCTION` | Instructions allow external upload. | Content sends artifacts to external services without controls. | Restrict uploads to approved destinations and document review steps. |
| `SEC-FORBIDDEN-INPUT-INSTRUCTION` | Instructions request forbidden input. | Content asks for secrets or other disallowed sensitive values. | Remove the request or replace it with safe placeholder guidance. |
| `SEC-INSTRUCTION-VIOLATES-POLICY` | Instruction conflicts with active policy. | Asset content violates a configured security profile. | Update the instruction or policy metadata so they agree. |
| `SEC-MISSING-HUMAN-APPROVAL-GUARD` | High-risk operation lacks approval guidance. | Content describes sensitive actions without human confirmation. | Add explicit approval requirements before the action. |
| `SEC-MISSING-POLICY-METADATA` | Security policy metadata is missing. | Asset content needs a policy profile but does not declare one. | Add the appropriate security policy metadata. |
| `SEC-NO-REDACTION-INSTRUCTION` | Sensitive data flow lacks redaction guidance. | Content shares logs, files, or context without redaction steps. | Add instructions to redact or minimize sensitive data before sharing. |
| `SEC-OVERBROAD-CONTEXT-INSTRUCTION` | Instructions request excessive context. | Content tells an agent to include broad repository or user data. | Scope context collection to the minimum required files and fields. |
| `SEC-POLICY-CONTRADICTION` | Security policy settings contradict each other. | Profile rules define incompatible requirements. | Resolve the conflicting policy fields. |
| `SEC-POLICY-OVERRIDE-CONTRADICTION` | Policy override contradicts inherited policy. | An override weakens or conflicts with the base profile. | Adjust the override or split the profile intentionally. |
| `SEC-POLICY-PROFILE-CYCLE` | Policy profiles form a cycle. | Profile inheritance refers back to itself. | Break the cycle in policy profile inheritance. |
| `SEC-POLICY-PROFILE-NOT-FOUND` | Referenced policy profile is missing. | Metadata names a profile renma cannot resolve. | Add the profile or correct the reference. |
| `SEC-PREDICTABLE-TEMP-PATH` | Command uses a predictable temp path. | Examples write to fixed `/tmp` paths or similar locations. | Use a unique temporary directory or safe temp-file helper. |
| `SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD` | Privileged command lacks guardrails. | Content runs `sudo` or equivalent privileged actions without checks. | Add prerequisites, confirmation, and rollback guidance. |
| `SEC-SECRET-MATERIAL-INSTRUCTION` | Instructions expose or request secret material. | Content includes or asks for private keys, tokens, or credentials. | Remove secret material and describe secure handling instead. |
| `SEC-SENSITIVE-FILE-REFERENCE` | Instructions reference sensitive files. | Content points at credentials, keys, or local secret paths. | Replace with safe examples or redacted placeholders. |
| `SEC-UNAPPROVED-NETWORK-DESTINATION` | Network destination is not approved. | Instructions contact a host outside the allowed list. | Use an approved destination or update policy intentionally. |
| `SEC-UNAPPROVED-UPLOAD-DESTINATION` | Upload destination is not approved. | Instructions upload data to an unapproved service or host. | Use an approved destination or update policy intentionally. |
| `SEC-UNPINNED-DEPENDENCY-INSTALL` | Dependency install is not pinned. | Examples install packages without exact versions or digests. | Pin package versions or use a reproducible install source. |
| `SEC-UNPINNED-REMOTE-SCRIPT` | Remote script execution is unpinned. | Commands pipe or execute remote scripts without an immutable reference. | Pin the script source and verify it before execution. |

## How To Fix Results

1. Fix `error` diagnostics first. They usually mean renma could not build a deterministic view of the repository.
2. Fix unresolved references before quality findings. Reference failures can hide or distort later reports.
3. For scan findings, use the finding ID, evidence path, line number, snippet, and remediation text in the JSON output.
4. Re-run the same command with `--format json` when a markdown or text report does not contain enough detail.
