# Diagnostics Reference

This page documents diagnostics and finding identifiers emitted by the current renma implementation. It does not list planned diagnostics.

Thresholds, units, provenance, and false-positive controls are canonical in the
[Renma 0.18.0 Quality Profile](quality-profile.md). Agent Skills specification
errors are kept separate from Renma quality advisories.

Agent Skills validation also reports authoring-only `RN-SKILL-*` warnings. In
0.18.0, `RN-SKILL-DESCRIPTION-MISSING-CAPABILITY` identifies a generic
description that does not say what the Skill does;
`RN-SKILL-DESCRIPTION-MISSING-USAGE-BOUNDARY` covers when to use it; and
`RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY` covers an important body
exclusion missing from discovery metadata. These warnings do not make an
otherwise specification-valid Skill invalid.

## Diagnostic Types

renma uses two severity systems:

- Discovery, metadata, catalog, and readiness diagnostics use `info`, `warning`, and `error`.
- Scan findings use rule severities such as `low`, `medium`, `high`, and `critical`.

In JSON output, diagnostics usually appear as structured objects with a `severity`, a `message`, and, when available, a `path`.

## LLM-Actionable Diagnostics V2

`renma scan --json` includes an additive `diagnosticsV2` array. Existing
`findings` and `diagnostics` fields remain compatible; v2 is a normalized view
for LLM-assisted repair, code review tools, and humans who want explicit repair
guardrails.

Each v2 diagnostic includes:

- `version`: currently `2`.
- `code`: stable diagnostic or finding code.
- `severity`: `error`, `warning`, or `info`. Scan finding severities are mapped
  into this simpler diagnostic scale, while the original `findingSeverity`
  remains in `details`.
- `message`: concise human-readable issue summary.
- `repairPolicy`: currently `preserve_semantics` when repairs must preserve the
  intended behavior rather than merely satisfying the scanner.
- `location`: repository path, line range, and snippet when available.
- `repairConstraints`: typed guardrails for what must be preserved, what must
  not change, allowed repair shapes, human decisions, and risks.
- `verificationSteps`: concrete follow-up checks. When a command is known,
  Renma uses real project commands such as `renma scan`, `renma catalog`,
  `renma readiness`, `renma graph`, or `npm test`.
- `llmHint`: short practical guidance for an LLM or coding agent. It is not a
  source of truth; the diagnostic evidence and repair constraints remain
  authoritative.
- `details`: compatibility metadata plus stable structured facts when known,
  such as asset IDs, lens IDs, source paths, targets, duplicate paths, reference
  kinds, and target lifecycle status.

Structured facts in `details` are the authoritative inputs for review tooling.
`llmHint` is guidance only; changing hint wording should not change bundle
grouping, affected files, affected assets, or repair decisions.

Example:

```json
{
  "version": 2,
  "code": "META-DUPLICATE-ASSET-ID",
  "severity": "warning",
  "message": "Duplicate asset id",
  "repairPolicy": "preserve_semantics",
  "location": {
    "path": "contexts/alpha/overview.md",
    "startLine": 2,
    "endLine": 2,
    "snippet": "id: context.demo.duplicate"
  },
  "repairConstraints": [
    {
      "kind": "must_preserve",
      "text": "Preserve existing references where possible and update only references affected by the chosen canonical id."
    },
    {
      "kind": "must_not_change",
      "text": "Do not rename every duplicate blindly; identify the canonical asset or ask for review when intent is ambiguous."
    }
  ],
  "verificationSteps": [
    {
      "text": "Run renma scan.",
      "command": "renma scan",
      "expected": "No diagnostics with code META-DUPLICATE-ASSET-ID are reported."
    }
  ],
  "llmHint": "Find all assets with id \"context.demo.duplicate\", compare their scope and metadata, and propose a merge/deprecation path or unique replacement ids.",
  "details": {
    "assetId": "context.demo.duplicate",
    "duplicatePaths": [
      "contexts/alpha/overview.md",
      "contexts/beta/overview.md"
    ],
    "sourcePath": "contexts/alpha/overview.md"
  }
}
```

`repairConstraints` are deliberately conservative. A `must_preserve` constraint
names repository intent or content that should survive the repair.
`must_not_change` names unsafe shortcuts, such as creating fake dependencies or
deleting orphaned context assets automatically. `allowed_change` describes safe
edit shapes. `requires_human_decision` marks ambiguity that should not be guessed
by automation. `risk` highlights security, data-handling, or destructive-action
concerns.

## Review Bundles

`renma scan --json` also includes `reviewBundles`, a deterministic grouping of
related v2 diagnostics. Bundles help reviewers decide what to inspect together,
which files or assets are involved, and what order to follow.

Renma currently groups duplicate IDs by duplicated id, unresolved references by
source, orphaned context assets separately from hard validation errors, and
dependency/reference issues by affected source. Bundles are generated from
structured `details` facts and source locations first, with human-facing prose
parsing used only as a legacy fallback. Suppressed findings are omitted from both
`diagnosticsV2` and `reviewBundles`.

Example:

```json
{
  "id": "duplicate-id:context.demo.duplicate",
  "title": "Duplicate id review: context.demo.duplicate",
  "summary": "2 diagnostics report the same declared id and should be reviewed together before renaming or merging assets.",
  "severity": "warning",
  "diagnosticCodes": ["META-DUPLICATE-ASSET-ID"],
  "affectedAssets": ["context.demo.duplicate"],
  "affectedFiles": ["contexts/alpha/overview.md", "contexts/beta/overview.md"],
  "suggestedReviewOrder": [
    "Inspect duplicate declaration in contexts/alpha/overview.md",
    "Inspect duplicate declaration in contexts/beta/overview.md",
    "Choose canonical id before editing references.",
    "Update references and rerun Renma scan."
  ],
  "llmHint": "Pick one canonical asset id before editing references; do not rename every duplicate in one blind pass."
}
```

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

Readiness and CI reports may include two security summaries: security posture from static findings, and security policy inventory from effective asset metadata, security profiles, and repository security config. The inventory is reporting-only and does not change scan `fail_on`, readiness scoring, or CI status.

Semantic diff and CI reports may include security deltas, including added/resolved security findings grouped by `riskClass` and effective policy inventory count changes. These summaries are reporting-only and do not change scan `fail_on`, readiness scoring, or CI status.

## Discovery Diagnostics

These diagnostics are emitted while renma discovers files.

| Severity  | Message                                                    | Meaning                                             | Fix                                                                         |
| --------- | ---------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `error`   | `Could not evaluate glob "<pattern>": <error>`             | A configured discovery glob could not be evaluated. | Fix or remove the glob pattern in config or CLI input.                      |
| `warning` | `Skipping symbolic link.`                                  | renma found a symlink and skipped it.               | Point config at the real file or directory if the target should be scanned. |
| `warning` | `Skipping file larger than max_file_size_bytes (<bytes>).` | A file exceeded the configured size limit.          | Raise `max_file_size_bytes`, exclude the file, or split the asset.          |
| `error`   | `Could not read file: <error>`                             | The file matched discovery but could not be read.   | Fix permissions, remove the bad path, or exclude the file.                  |

## Metadata And Catalog Diagnostics

These diagnostics are emitted after files are parsed into catalog entries. For shared-context wording details, see [Context Language Diagnostics](context-language-diagnostics.md).

Owner absence is handled as ownership coverage information. Assets without `owner` are accepted and reported as unowned by `renma ownership`; Renma does not infer owners automatically.

| Severity  | Message                                                                                           | Meaning                                                                                                                        | Fix                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `warning` | `Invalid status "<status>". Expected one of: experimental, stable, deprecated, archived.`         | An asset status does not match the accepted status values.                                                                     | Replace the status with a supported value.                                                                      |
| `warning` | `Invalid last_reviewed_at "<date>". Expected ISO date YYYY-MM-DD.`                                | Freshness metadata has an invalid human review date.                                                                           | Replace it with a real ISO date such as `2026-06-28`.                                                           |
| `warning` | `Invalid expires_at "<date>". Expected ISO date YYYY-MM-DD.`                                      | Freshness metadata has an invalid expiration date.                                                                             | Replace it with a real ISO date such as `2026-12-31`.                                                           |
| `warning` | `Invalid review_cycle "<duration>". Expected supported ISO 8601 day duration such as P90D.`       | Freshness metadata uses a review cycle renma cannot evaluate.                                                                  | Use a day-based duration such as `P90D` or `P180D`.                                                             |
| `warning` | `Metadata dependency "<to>" from "<from>" does not match a catalog entry.`                        | A metadata dependency points at an asset renma did not discover.                                                               | Correct the reference, add the missing asset, or update include/exclude config.                                 |
| `warning` | `Metadata dependency "<to>" from "<from>" targets a <status> asset.`                              | A dependency points at a deprecated or archived catalog target.                                                                | Retarget the dependency to a stable replacement or document the migration.                                      |
| `warning` | `Asset is missing an id.`                                                                         | A cataloged asset has no stable ID.                                                                                            | Add an `id` metadata field.                                                                                     |
| `warning` | `Asset is missing an owner.`                                                                      | A cataloged asset has no declared owner metadata. Missing owner is allowed and appears as unowned in ownership coverage; it is not converted into a scan finding by default. | If ownership matters for this repository, choose an `owner` through human review or team policy. Do not infer or invent an owner automatically. |
| `warning` | `Shared context asset is missing when_to_use metadata.`                                           | An active, owned shared context asset has no positive usage boundary.                                                          | Add compact `when_to_use` metadata that states when humans or agents should apply the context.                  |
| `warning` | `Shared context asset is missing when_not_to_use metadata.`                                       | An active, owned shared context asset has no negative usage boundary.                                                          | Add compact `when_not_to_use` metadata so agents do not over-apply the context.                                 |
| `warning` | `Shared context asset usage-boundary metadata contains placeholder values in <field>.`            | Usage-boundary metadata is present but still says TODO, TBD, unknown, none, or similar.                                        | Replace placeholders with reviewed scope boundaries, or remove the field until it can be completed.             |
| `warning` | `Shared context asset contains vague wording "<term>".`                                           | A canonical active shared context uses broad English wording such as usually, often, quickly, soon, as needed, or major.       | Replace it with concrete applicability conditions, evidence, thresholds, or explicit uncertainty handling.      |
| `warning` | `Shared context asset contains currentness wording "<term>" without an explicit date or version.` | A canonical active shared context uses relative English currentness wording such as recently, latest, currently, or as of now. | Add an explicit date, version, freshness metadata, or stable wording.                                           |
| `warning` | `Shared context asset contains prompt or runtime-selection wording "<term>".`                     | A canonical active shared context looks like a prompt artifact or runtime context-selection rule.                              | Move prompt assembly, assistant role instructions, and runtime context selection outside shared context assets. |

## Context Lens Diagnostics

Context Lens governance diagnostics use stable `code` values in JSON output. `error` diagnostics are blocking for readiness; `warning` diagnostics are reported by default for review.

| Code                                       | Severity             | Meaning                                                                                                       | Fix                                                                                                     |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `CONTEXT-LENS-DEPRECATED-FIELD`            | `warning`            | A lens uses an old field alias such as `target`, `targets`, `output`, or `outputs`.                           | Use `applies_to` or `expected_outputs`.                                                                 |
| `CONTEXT-LENS-DUPLICATE-ID`                | `error`              | Two or more lens definitions declare the same `id`.                                                           | Give each lens a unique stable ID and update references.                                                |
| `CONTEXT-LENS-EMPTY-DEFINITION`            | `error`              | A discovered lens file is empty.                                                                              | Add required metadata and body guidance, or remove the file.                                            |
| `CONTEXT-LENS-GOVERNANCE-MEANINGLESS`      | `warning`            | A lens has no purpose, target, focus, expected output, or body guidance.                                      | Add compact governance metadata or reviewed interpretation guidance.                                    |
| `CONTEXT-LENS-MISSING-REQUIRED-FIELD`      | `error`              | A lens is missing `id`, `owner`, `purpose`, or `applies_to`.                                                  | Add the required field in frontmatter.                                                                  |
| `CONTEXT-LENS-PATH-NORMALIZATION-MISMATCH` | `warning`            | A path target normalizes to a different repository-relative path.                                             | Use the normalized path shown by the diagnostic.                                                        |
| `CONTEXT-LENS-TARGET-NOT-FOUND`            | `error`              | An `applies_to` target does not resolve to a cataloged asset ID or path.                                      | Correct the target, add the missing context asset, or update discovery config.                          |
| `CONTEXT-LENS-UNPARSEABLE-FRONTMATTER`     | `error`              | A lens frontmatter block starts with `---` but does not close.                                                | Add the closing `---` delimiter or remove malformed frontmatter.                                        |
| `CONTEXT-LENS-UNSUPPORTED-KIND`            | `warning` or `error` | `type: context_lens` appears under an unsupported artifact kind, or a lens file declares an unsupported type. | Store lens definitions under `lenses/**`, `context/**`, or `contexts/**`, and use `type: context_lens`. |
| `CONTEXT-LENS-UNSUPPORTED-SCOPE`           | `error`              | A lens declares a value outside the supported `context` scope.                                                | Use `scope: context` or omit the field.                                                                 |
| `CONTEXT-LENS-UNSUPPORTED-VERSION`         | `error`              | A lens declares a value outside supported schema version `1`.                                                 | Use `version: 1` or omit the field.                                                                     |

## Readiness Diagnostics

`renma readiness` converts lower-level data into workflow checks. These messages are produced by readiness checks and may wrap discovery, catalog, graph, ownership, status, or scan-finding data.

| Severity             | Message                                                          | Meaning                                                | Fix                                                  |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `error`              | discovery or catalog diagnostic message                          | A lower-level error diagnostic was present.            | Fix the original diagnostic first.                   |
| `warning`            | discovery or catalog diagnostic message                          | A lower-level warning diagnostic was present.          | Review and fix if it affects automation reliability. |
| `warning`            | `Missing owner metadata.`                                        | A catalog asset has no declared owner metadata.        | If ownership matters, choose an owner through human review or team policy. |
| `error`              | `<kind> reference "<target>" does not resolve.`                  | A graph edge points to a missing target.               | Correct the reference or add the target asset.       |
| `error`              | `Required context reference "<target>" does not resolve.`        | A required context reference is missing.               | Add the context asset or correct `requires_context`. |
| `error`              | `Required context "<target>" resolves to <status> asset <path>.` | Required context exists but is deprecated or archived. | Move the dependency to a stable context asset.       |
| `warning`            | `Optional context reference "<target>" does not resolve.`        | An optional context reference is missing.              | Correct it or remove it if it is no longer useful.   |
| `warning`            | `Optional context "<target>" resolves to <status> asset <path>.` | Optional context exists but is deprecated or archived. | Retarget or remove the optional dependency.          |
| `warning`            | `Asset status is <status>.`                                      | A catalog asset is deprecated or archived.             | Migrate dependents or update the asset status.       |
| `error` or `warning` | scan finding remediation text                                    | A scan finding is severe enough to affect readiness.   | Fix the finding listed in the readiness detail.      |

## Scan Finding Identifiers

`renma scan` emits finding IDs from the rule engine. A scan finding identifier is a machine-readable label for the kind of issue found during a scan.

It is different from:

- an asset ID, which identifies a context asset or other catalog entry
- a file path, which identifies where the issue was found
- a diagnostic message, which is written for humans and may contain contextual details

Finding identifiers are useful when you want to group, filter, document, or automate responses to scan results. CI systems, editor integrations, docs, and LLM-assisted repair workflows can use the identifier to understand the category of problem without relying on the exact wording of the human-readable message.

The identifiers below are part of the current scan output. The current implementation does not declare them as a permanent public API, so integrations should avoid assuming stronger stability than the project documents. If renma adopts long-term stability guarantees later, identifier changes should come with documented migrations.

Security diagnostics focus on high-signal heuristics for agent-facing or context-bearing artifacts Renma already discovers, such as skills, contexts, `AGENTS.md`, references, profiles, examples, and tool guidance. Defensive wording and nearby human approval, dry-run, backup, or rollback guidance may reduce or avoid command-risk findings when they are local to the risky instruction. When the effective human-approval policy is true, dry-run, backup, rollback, or restore guidance does not replace explicit human approval. Renma does not scan `package.json`, GitHub Actions workflows, Dockerfiles, or repository-wide supply-chain metadata by default.

### Security Policy Metadata

Security policy diagnostics use two explicit syntax boundaries. Skills must be
specification-valid Agent Skills and declare policy through string-valued
`metadata.renma.*` keys. Contexts and other non-Skill assets retain the
top-level snake_case syntax.

Canonical Skill keys are `renma.allowed-data`, `renma.network-allowed`,
`renma.external-upload-allowed`, `renma.secrets-allowed`,
`renma.requires-human-approval`, `renma.forbidden-inputs`,
`renma.approved-network-destinations`,
`renma.approved-upload-destinations`, and `renma.security-profile`. Skill
booleans must be the exact strings `"true"` or `"false"`; Skill lists must be
JSON-array strings containing strings only. Invalid recognized values emit
`SEC-INVALID-CANONICAL-POLICY-METADATA` and fail closed. Renma preserves
already-reviewed restrictive inherited policy while preventing permissive
inheritance: allowed-data permissions remain unresolved, inherited forbidden
inputs remain active, and invalid destination allowlists continue reporting
concrete destinations as unapproved.

Non-Skill assets continue to use `allowed_data`, `network_allowed`,
`external_upload_allowed`, `secrets_allowed`, `requires_human_approval`,
`forbidden_inputs`, `approved_network_destinations`,
`approved_upload_destinations`, and `security_profile`. Their existing scalar,
inline-list, and block-list behavior is unchanged. Pre-0.16 top-level Skill
security fields are migration input only.

Security profiles in `renma.config.json` retain the existing JSON schema.
Artifact-local explicit denials remain stricter than inherited profile or
repository allowances, and network approvals remain separate from upload
approvals. See the [Security Policy Guide](security-policy.md) for complete
examples by asset kind.

| Identifier                                       | Meaning                                              | Typical cause                                                                                      | How to fix                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DOCS-LAYOUT-INCONSISTENT`                       | Documentation contradicts the supported repository model. | Docs use deprecated roots, old prompt-library framing, or another independently stale statement. | Describe canonical Skill roots and valid local support separately from governed `contexts/**` assets and shared `tools/**` helpers. |
| `LAYOUT-CONTEXT-LEGACY-ROOT`                     | Context lives under the legacy `context/**` root.    | Shared context is stored under the compatibility root instead of `contexts/**`.                    | Move the shared Context Asset to `contexts/**` and update its references.                               |
| `LAYOUT-CONTEXT-REFERENCE-NON_CANONICAL`         | Declared dependency uses a non-canonical reference root. | A declared dependency points outside accepted `contexts/**`, `skills/**`, `.agents/skills/**`, or `tools/**` reference paths. | Rewrite the dependency to an accepted repository-relative asset path or ID.                             |
| `LAYOUT-DISALLOWED-SKILL-ASSET`                  | Compatibility identifier for specific local-policy violations. | Valid Agent Skills support paths do not emit this finding solely because of location. Reusable knowledge is handled by evidence-based maintenance advisories. | Review the specific evidence; keep genuinely local support in place or promote reusable knowledge through human review. |
| `LAYOUT-HELPER-NON_TOOLS`                        | Helper file is outside supported helper locations.   | A helper script is neither under `tools/**` nor a valid Skill-local `scripts/` directory.                    | Move shared helper code under `tools/**`, or keep a genuinely Skill-specific helper in local `scripts/`. |
| `LAYOUT-SKILL-EXECUTABLE-COMMAND`                | Removed 0.17 compatibility identifier.               | 0.17 treated any command as evidence against a thin router.                                        | No replacement based on command presence; security and helper-path diagnostics remain.                 |
| `LAYOUT-SKILL-NOT-THIN`                          | Removed 0.17 compatibility identifier.               | 0.17 treated procedures and word counts as evidence against a thin router.                         | Review `QUAL-SKILL-MIXED-RESPONSIBILITY` or progressive-disclosure evidence instead.                    |
| `MAINT-ASSET-REFERENCES-SUPERSEDED-ASSET`        | Asset references superseded context.                 | Metadata or content points at an asset marked superseded.                                          | Retarget the reference to the stable replacement.                                                      |
| `MAINT-ASSET-EXPIRED`                            | Asset freshness metadata is expired.                 | `expires_at` is before today's date.                                                               | Review the asset with its owner, then update freshness metadata, status, or references.                |
| `MAINT-CONTEXT-LENS-APPLIES-TO-INACTIVE-CONTEXT` | Context lens applies to inactive context.            | An active context lens applies to a deprecated or archived context asset.                          | Point `applies_to` at an active replacement, or update the lens lifecycle after review.                |
| `MAINT-CONTEXT-PATH-NON-SEMANTIC`                | Context path is not semantically grouped.            | Context is stored under vague folders such as misc or general.                                     | Move it under a meaningful path such as `contexts/tools/`, `contexts/domain/`, or `contexts/testing/`. |
| `MAINT-ASSET-REVIEW-OVERDUE`                     | Asset freshness review is overdue.                   | `last_reviewed_at + review_cycle` is before today's date.                                          | Revalidate the asset with a human owner, then update `last_reviewed_at` or review cadence.             |
| `MAINT-ORPHANED-CONTEXT-ASSET`                   | Shared context has no incoming references.           | A first-class context asset is not used by skills or other assets.                                 | Link it from consumers, archive it, or remove it after review.                                         |
| `MAINT-ORPHANED-CONTEXT-LENS`                    | Context lens has no skill references.                | An active context lens is not referenced by any skill through `requires_lens` or `optional_lens`.  | Link it from a skill, archive it, or leave it staged with reviewed lifecycle metadata.                 |
| `MAINT-REFERENCE-DEPRECATED-ASSET`               | Reference targets deprecated context.                | Metadata dependency resolves to a deprecated asset.                                                | Point dependents at a stable asset or finish the migration.                                            |
| `MAINT-REPEATED-CODE-BLOCK`                      | Duplicate code block appears across assets.          | Copy-pasted examples or procedures repeat in multiple files.                                       | Extract shared guidance or consolidate the repeated block.                                             |
| `MAINT-REPEATED-CONTEXT-PATTERN`                 | Repeated context-like wording appears.               | Multiple assets duplicate the same reusable context pattern.                                       | Promote the shared pattern into a context asset and reference it.                                      |
| `MAINT-REPEATED-HEADING`                         | Same heading repeats across assets.                  | Similar sections are copied through several files.                                                 | Consolidate or reference a shared source of truth.                                                     |
| `MAINT-REPEATED-LINK`                            | Removed from default maintenance findings in 0.18.0. | Repeated links to one official source are normal.                                                   | No action based on link equality alone.                                                                |
| `MAINT-REPEATED-SECTION`                         | Similar section text repeats.                        | A section has been copied into multiple assets.                                                    | Extract common material or reduce duplication.                                                         |
| `MAINT-SKILL-CONTEXT-REFERENCE-NOT-DECLARED`     | Skill mentions context without metadata.             | Body text references `contexts/...` but `requires_context` omits it.                               | Add the context to `requires_context` or remove the stale mention.                                     |
| `MAINT-SKILL-REFERENCES-SUPERSEDED-ASSET`        | Skill refers to superseded context.                  | Skill content names a superseded context asset.                                                    | Update the skill to the stable replacement context asset.                                              |
| `MAINT-SKILL-REUSABLE-CONTEXT-CANDIDATE`         | Disabled compatibility identifier.                   | 0.17 used broad workflow signals for reusable Context candidates.                                  | Review `QUAL-SKILL-MIXED-RESPONSIBILITY`; keep core workflow and Skill-specific detail local.           |
| `MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE`   | Support asset looks reusable.                        | A reference, profile, or example contains content useful beyond one skill.                         | Promote it to shared context when reuse is intended.                                                   |
| `META-CATALOG-DIAGNOSTIC`                        | Catalog diagnostic was promoted to a scan finding.   | Catalog validation emitted a lower-level diagnostic.                                               | Fix the original catalog diagnostic shown in the finding evidence.                                     |
| `META-CONTEXT-MISSING-WHEN-TO-USE`               | Shared context usage boundary is missing.            | An active, owned shared context asset lacks `when_to_use`.                                         | Add compact positive scope guidance.                                                                   |
| `META-CONTEXT-MISSING-WHEN-NOT-TO-USE`           | Shared context negative boundary is missing.         | An active, owned shared context asset lacks `when_not_to_use`.                                     | Add compact exclusions so agents do not over-apply the context.                                        |
| `META-CONTEXT-PLACEHOLDER-USAGE-BOUNDARY`        | Shared context usage boundary contains placeholders. | `when_to_use` or `when_not_to_use` contains TODO, TBD, unknown, none, or similar placeholder text. | Replace placeholders with reviewed boundaries.                                                         |
| `META-DUPLICATE-ASSET-ID`                        | Asset ID is not unique.                              | Two catalog entries declare the same ID.                                                           | Give each asset a unique ID and update references.                                                     |
| `META-FRONTMATTER-TOO-LARGE`                     | Frontmatter metadata is too large.                   | Frontmatter has too many lines or characters to stay a compact index.                              | Move long prose, examples, procedures, or rationale into the body or referenced context assets.        |
| `META-UNKNOWN-REFERENCE`                         | Metadata reference does not resolve.                 | A dependency points to a missing asset ID or path.                                                 | Fix the reference, add the missing asset, or remove the dependency.                                    |
| `PATH-HELPER-COMMAND-NON_TOOLS`                  | Helper command points outside supported helper locations. | A command references a script that is neither in the owning Skill's `scripts/**` nor under `tools/**`. | Keep a Skill-specific helper local or move a helper shared across workflows to `tools/**`, then update the command. |
| `PATH-HELPER-COMMAND-SKILL-SCRIPTS`              | Compatibility identifier for the former path-only policy. | Valid commands may point to resolvable Skill-local `scripts/`; location alone no longer emits this finding. | Keep Skill-specific helpers local, or move shared helpers to `tools/**` after review.                  |
| `PATH-HELPER-COMMAND-UNRESOLVED`                 | Helper command path is missing or unsafe.            | A referenced `tools/**` helper or Skill-local script is missing, or a relative path escapes its owning Skill. | Add the helper, correct the command path, or keep a relative local path inside the owning Skill. |
| `PROF-MISSING-BASE`                              | Profile lacks base guidance.                         | A profile does not clearly relate to base skill behavior.                                          | Add base-profile context or inheritance guidance.                                                      |
| `QUAL-LOW-HEADING-DENSITY`                       | Asset has too little structure.                      | Long content has few headings.                                                                     | Add meaningful headings or split the asset.                                                            |
| `QUAL-MISSING-COMPLETION-CRITERIA`               | Completion criteria are missing.                     | The asset does not say when work is done.                                                          | Add explicit completion or acceptance criteria.                                                        |
| `QUAL-MISSING-DESCRIPTION`                       | Description is missing.                              | Metadata or introductory purpose is absent.                                                        | Add a concise description.                                                                             |
| `QUAL-MISSING-EXAMPLES`                          | Examples are missing.                                | Instructional content has no concrete example.                                                     | Add representative positive examples.                                                                  |
| `QUAL-MISSING-NEGATIVE-ROUTING`                  | Negative routing is missing.                         | Skill guidance omits when not to use it.                                                           | Add exclusions or handoff guidance.                                                                    |
| `QUAL-MISSING-PREFLIGHT`                         | Preflight guidance is missing.                       | The asset omits checks to run before acting.                                                       | Add required inputs, checks, or setup steps.                                                           |
| `QUAL-MISSING-REQUIRED-INPUTS`                   | Required inputs are unclear.                         | The asset does not state what information is needed.                                               | Add an explicit required-inputs section.                                                               |
| `QUAL-MISSING-ROUTING-CLARITY`                   | Routing guidance is unclear.                         | A skill does not clearly say when to use it.                                                       | Clarify triggers, audience, and handoffs.                                                              |
| `QUAL-MISSING-VERIFICATION`                      | Verification guidance is missing.                    | The asset lacks checks for validating the result.                                                  | Add verification steps or expected evidence.                                                           |
| `QUAL-SHORT-DESCRIPTION`                         | Disabled compatibility identifier.                   | 0.17 applied an independent 150-character minimum.                                                  | Use Agent Skills validity and selection-boundary diagnostics; short clear descriptions are accepted.  |
| `QUAL-SKILL-MIXED-RESPONSIBILITY`                | Skill may mix workflow and reusable knowledge.       | A sufficiently large Skill has multiple distinct reusable-knowledge signals.                       | Promote only independently owned shared knowledge; keep Skill-local workflow and detail local.         |
| `QUAL-SKILL-PROGRESSIVE-DISCLOSURE`              | Progressive disclosure needs review.                 | Reserved 0.18 focused-workflow contract identifier.                                                | Keep read conditions and core workflow in `SKILL.md`; place details by semantic responsibility.        |
| `QUAL-SKILL-TOKEN-BUDGET`                        | Skill body exceeds an advisory estimate.             | Markdown body exceeds 2,000 or 5,000 estimated tokens.                                             | Review progressive disclosure without splitting or moving content by size alone.                       |
| `QUAL-SUPPORT-ASSET-TOKEN-BUDGET`                | Support asset exceeds an advisory estimate.          | A context, reference, profile, or example exceeds its token budget.                                | Review coherent scope, structure, read conditions, reference depth, responsibility mixing, and duplication; size alone does not require a split. |
| `QUAL-USER-LOCAL-PATHS`                          | User-local path appears in content.                  | Guidance includes machine-specific paths such as home directories.                                 | Replace local paths with repository-relative or configurable paths.                                    |
| `SEC-DESTRUCTIVE-COMMAND`                        | Destructive command appears.                         | Content includes risky commands such as forced deletion or reset.                                  | Remove it, gate it with explicit safety guidance, or use a safer command.                              |
| `SEC-ENV-COPY`                                   | Environment copying is suggested.                    | Content copies broad environment or secret-bearing files.                                          | Narrow the copied data and document secret handling.                                                   |
| `SEC-LITERAL-SECRET`                             | Literal secret-like value appears.                   | Content includes token, password, key, or credential patterns.                                     | Remove the secret and replace it with a placeholder.                                                   |
| `SEC-PRIVATE-KEY`                                | Private key material appears.                        | Content includes a private key block.                                                              | Remove the key and rotate it if it was real.                                                           |
| `SEC-REMOTE-DEFAULT`                             | Remote command default is unsafe.                    | Guidance defaults to network commands, prod hosts, or insecure flags.                              | Use safe examples and require explicit approval for risky remotes.                                     |
| `SUPPORT-MISSING-REACHABILITY-GUIDANCE`          | Local resources are not discoverable.                | A Skill has local references, scripts, assets, profiles, or examples without routing guidance.     | State when each resource should be read, executed, or used.                                            |
| `SUPPORT-DEEP-REFERENCE-CHAIN`                   | Local resource is behind more than two hops.         | A resource is reachable only through a deep static chain.                                          | Reference it directly or through one directly referenced index.                                       |
| `SUPPORT-MISSING-PATH`                           | Referenced local resource does not exist.            | `SKILL.md` names a path under a standard local resource directory that is absent.                  | Create the intended resource or correct the Skill-root-relative path.                                  |
| `SUPPORT-UNREACHABLE-ASSET`                      | Local asset is unreachable.                          | A Skill-local asset has no direct or transitive static reference.                                  | Add an explicit use condition and path from the Skill or its direct index.                             |
| `SUPPORT-UNREACHABLE-SCRIPT`                     | Local script is unreachable.                         | A Skill-local script has no direct or transitive static reference.                                 | Add an explicit execution condition and path from the Skill or its direct index.                       |
| `SUPPORT-UNREACHABLE-EXAMPLE`                    | Example is unreachable.                              | A skill-local example is not referenced by the skill.                                              | Link it from the skill or move/remove it.                                                              |
| `SUPPORT-UNREACHABLE-PROFILE`                    | Profile is unreachable.                              | A skill-local profile is not referenced by the skill.                                              | Link it from the skill or move/remove it.                                                              |
| `SUPPORT-UNREACHABLE-REFERENCE`                  | Reference is unreachable.                            | A skill-local reference is not referenced by the skill.                                            | Link it from the skill or move/remove it.                                                              |
| `META-CATALOG-DIAGNOSTIC`                        | Catalog diagnostic was promoted to a scan finding.   | Catalog validation emitted a lower-level diagnostic.                                               | Fix the original catalog diagnostic shown in the finding evidence.                                     |
| `META-INACTIVE-DEPENDENCY`                       | Metadata points to an inactive asset.                | A dependency targets a deprecated or archived asset.                                               | Retarget the dependency to a stable asset or update asset status intentionally.                        |
| `META-INVALID-EXPIRES-AT`                        | Freshness expiration date is invalid.                | `expires_at` is present but is not a real `YYYY-MM-DD` date.                                       | Replace it with a valid ISO date or remove the field until reviewed.                                   |
| `META-INVALID-LAST-REVIEWED-AT`                  | Freshness review date is invalid.                    | `last_reviewed_at` is present but is not a real `YYYY-MM-DD` date.                                 | Replace it with a valid ISO date or remove the field until reviewed.                                   |
| `META-INVALID-REVIEW-CYCLE`                      | Freshness review cycle is unsupported.               | `review_cycle` is present but is not a supported day duration.                                     | Use a duration such as `P90D` or `P180D`.                                                              |
| `META-INVALID-STATUS`                            | Metadata status is invalid.                          | An asset declares an unsupported status value.                                                     | Replace it with a supported lifecycle status.                                                          |
| `META-LIST-ITEM-TOO-LONG`                        | Metadata list item is too long.                      | A block-list metadata item contains routing prose or detailed conditions.                          | Keep the item short and move detailed guidance into body sections or referenced context assets.        |
| `META-MISSING-ID`                                | Metadata is missing an asset ID.                     | A cataloged asset has no stable `id`.                                                              | Add an `id` metadata field.                                                                            |
| `META-UNKNOWN-DEPENDENCY`                        | Metadata dependency is unresolved.                   | A dependency points at an asset renma did not discover.                                            | Correct the dependency, add the missing asset, or update discovery config.                             |
| `SEC-BODY-POLICY-CONTRADICTION`                  | Body text contradicts a security policy.             | Asset instructions override or weaken policy expectations.                                         | Align the asset content with the active policy profile.                                                |
| `SEC-BULK-DATA-SHARING-INSTRUCTION`              | Instructions allow broad data sharing.               | Content tells an agent to share large or sensitive data without bounds.                            | Narrow the sharing scope and add approval or redaction guidance.                                       |
| `SEC-CLOUD-UPLOAD-INSTRUCTION`                   | Instructions allow cloud upload.                     | Content sends files or data to cloud storage without policy controls.                              | Add approved destinations, limits, and approval requirements.                                          |
| `SEC-CREDENTIAL-IN-COMMAND-ARG`                  | Command embeds a credential-like value.              | Example commands include secrets in arguments.                                                     | Move credentials to secure environment or secret-management guidance.                                  |
| `SEC-DANGEROUS-TOOL-INSTRUCTION`                 | Instructions permit dangerous tool use.              | Content allows destructive or high-risk commands without guardrails.                               | Require review, dry runs, or explicit user approval before execution.                                  |
| `SEC-EXTERNAL-UPLOAD-INSTRUCTION`                | Instructions allow external upload.                  | Content sends artifacts to external services without controls.                                     | Restrict uploads to approved destinations and document review steps.                                   |
| `SEC-FORBIDDEN-INPUT-INSTRUCTION`                | Instructions request forbidden input.                | Content asks for secrets or other disallowed sensitive values.                                     | Remove the request or replace it with safe placeholder guidance.                                       |
| `SEC-INSTRUCTION-VIOLATES-POLICY`                | Instruction conflicts with active policy.            | Asset content violates a configured security profile.                                              | Update the instruction or policy metadata so they agree.                                               |
| `SEC-INVALID-CANONICAL-POLICY-METADATA`          | Canonical Skill security metadata is invalid.        | A recognized `metadata.renma.*` field has an invalid boolean, list, or profile encoding.            | Confirm the intended policy and replace it with the exact documented string encoding; do not guess.    |
| `SEC-MISSING-HUMAN-APPROVAL-GUARD`               | High-risk operation lacks approval guidance.         | Content describes sensitive actions without human confirmation.                                    | Add explicit approval requirements before the action.                                                  |
| `SEC-MISSING-POLICY-METADATA`                    | Security policy metadata is missing.                 | Asset content needs a policy profile but does not declare one.                                     | Add the appropriate security policy metadata.                                                          |
| `SEC-NO-REDACTION-INSTRUCTION`                   | Sensitive data flow lacks redaction guidance.        | Content shares logs, files, or context without redaction steps.                                    | Add instructions to redact or minimize sensitive data before sharing.                                  |
| `SEC-OVERBROAD-CONTEXT-INSTRUCTION`              | Instructions request excessive context.              | Content tells an agent to include broad repository or user data.                                   | Scope context collection to the minimum required files and fields.                                     |
| `SEC-POLICY-CONTRADICTION`                       | Security policy settings contradict each other.      | Profile rules define incompatible requirements.                                                    | Resolve the conflicting policy fields.                                                                 |
| `SEC-POLICY-OVERRIDE-CONTRADICTION`              | Policy override contradicts inherited policy.        | An override weakens or conflicts with the base profile.                                            | Adjust the override or split the profile intentionally.                                                |
| `SEC-POLICY-PROFILE-CYCLE`                       | Policy profiles form a cycle.                        | Profile inheritance refers back to itself.                                                         | Break the cycle in policy profile inheritance.                                                         |
| `SEC-POLICY-PROFILE-NOT-FOUND`                   | Referenced policy profile is missing.                | Metadata names a profile renma cannot resolve.                                                     | Add the profile or correct the reference.                                                              |
| `SEC-PREDICTABLE-TEMP-PATH`                      | Command uses a predictable temp path.                | Examples write to fixed `/tmp` paths or similar locations.                                         | Use a unique temporary directory or safe temp-file helper.                                             |
| `SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD`           | Privileged command lacks guardrails.                 | Content runs `sudo` or equivalent privileged actions without checks.                               | Add prerequisites, confirmation, and rollback guidance.                                                |
| `SEC-SECRET-MATERIAL-INSTRUCTION`                | Instructions expose or request secret material.      | Content includes or asks for private keys, tokens, or credentials.                                 | Remove secret material and describe secure handling instead.                                           |
| `SEC-SENSITIVE-FILE-REFERENCE`                   | Instructions reference sensitive files.              | Content points at credentials, keys, or local secret paths.                                        | Replace with safe examples or redacted placeholders.                                                   |
| `SEC-UNAPPROVED-NETWORK-DESTINATION`             | Network destination is not approved.                 | Instructions contact a host outside the allowed list.                                              | Enumerate the actual required domains in approved network destinations after review.                   |
| `SEC-UNAPPROVED-UPLOAD-DESTINATION`              | Upload destination is not approved.                  | Instructions upload data to an unapproved service or host.                                         | Use an approved destination or update policy intentionally.                                            |
| `SEC-UNPINNED-DEPENDENCY-INSTALL`                | Dependency install is not pinned.                    | Examples install packages without exact versions or digests.                                       | Pin package versions or use a reproducible install source.                                             |
| `SEC-UNPINNED-REMOTE-SCRIPT`                     | Remote script execution is unpinned.                 | Commands pipe or execute remote scripts without an immutable reference.                            | Pin the script source and verify it before execution.                                                  |

## How To Fix Results

1. Fix `error` diagnostics first. They usually mean renma could not build a deterministic view of the repository.
2. Fix unresolved references before quality findings. Reference failures can hide or distort later reports.
3. For scan findings, use the finding ID, evidence path, line number, snippet, and remediation text in the JSON output.
4. Re-run the same command with `--format json` when a markdown or text report does not contain enough detail.
