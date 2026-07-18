# Diagnostics Reference

This page documents diagnostics and finding identifiers emitted by the current renma implementation. It does not list planned diagnostics.

Thresholds, units, provenance, and false-positive controls are canonical in the
[Renma Quality Profile](quality-profile.md). Agent Skills specification
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

## Classification Evidence

`inspect`, `suggest-metadata`, and relevant scan finding or diagnostic
`details` include additive `classification` evidence. Classification answers
what path rule matched; governance separately answers whether owner, policy, or
metadata is declared, inherited, missing, or not required. A file's kind never
implies that it has an owner. `inspect` additionally exposes
`repositoryBoundary`, preserving resolution source and repository-relative path
when resolved or stable unresolved/ambiguous reason evidence and candidate
roots when no safe boundary can be selected.

For marker-free directory-segment inference, only `.agents`, `skills`,
`contexts`, `context`, `lenses`, and `tools` can positively establish a
structural boundary. Recognized root filenames are handled separately:
`AGENTS.md` may establish its containing directory as the structural root when
no stronger repository marker is available, while `renma.config.json` and
`.renma.json` normally establish the boundary through repository-marker
detection. The support-like names `profiles`, `references`, `examples`,
`scripts`, and `assets` are guards only: they can block a later boundary-like
segment or contribute ambiguity evidence, but never establish a repository root
by themselves.

> Classification describes how Renma interpreted repository structure. It does
> not by itself prove ownership, policy, lifecycle, source-of-truth status, or
> human intent.

> Governance evidence describes what is actually declared or inherited.

> Decision evidence describes whether Renma recommends a change, blocks one,
> requires confirmation, or recommends no change.

### How to Read Classification Evidence

These fields answer different questions and must not be substituted for one
another:

| Field | What it indicates | What it does not indicate |
| --- | --- | --- |
| `kind` | The semantic parsing or inventory role Renma assigned to the file. | Governance scope, ownership, policy, lifecycle, validity, or human intent. |
| `scope` | The structural governance boundary implied by the path. | That governance metadata exists, is valid, or may be inherited. |
| `matchedRule` | The primary stable structural rule that classified the normalized repository-relative path. | That the resulting asset is owned, current, authoritative, or safe to change. |
| `reasonCode` | A more specific deterministic reason for the rule result. | Governance or a repair decision by itself. |
| `parentResolution` | How repository evidence resolved the parent implied by a Skill-local path. | The parent's owner or policy values. It is normally absent outside Skill-local classification. |
| `governance` | Declared or inherited ownership, policy, and metadata provenance supported by repository evidence. | Human intent beyond the declarations Renma found. |
| `decisionStatus` | The application gate for a command that can recommend a change. It is decision evidence, not classification evidence. | A different structural classification or permission to ignore blocked evidence. |

`kind` is one of `skill`, `agent`, `context`, `context_lens`, `profile`,
`reference`, `example`, `script`, `asset`, `config`, or `unknown`. It selects a
semantic parsing or inventory role. It is not equivalent to `scope`: for
example, a `reference` can be `skill-local`, while a repository tool currently
has `kind: "unknown"` and `scope: "repository-support"`. Metadata can refine a
file under a Context root from `context` to `context_lens` without changing the
structural rule that matched.

Optional classification fields add evidence without changing those core
meanings:

| Field | Meaning | Do not infer |
| --- | --- | --- |
| `reason` | Human-readable explanation of the current result. | A stable machine branch; wording may improve without a contract change. |
| `recognizedRoot` | The repository-relative asset root or boundary recognized by the matched rule, such as `skills`, `.agents/skills`, or `contexts`. | The absolute filesystem repository root; use `repositoryBoundary` for that evidence. |
| `parentAssetCandidatePath` | The parent Skill path implied by structure before repository resolution. | That the file exists or supplies governance. |
| `parentAssetPath` | The one parent Skill source path selected by a `resolved` result. | That the parent declares an owner or policy. |
| `parentAssetCandidates` | All plausible parent Skill paths retained by an `ambiguous` result. | That the first candidate is preferred or safe to select. |
| `supportDirectory` | The support-like directory involved in classification, such as `references` or `scripts`. | That the directory is valid Skill-local support without the matching rule and parent evidence. |
| `ignoredNestedSegments` | Nested support-like names that did not override a higher-priority recognized root. | That Renma ignored the file's content or omitted it from inventory. |
| `competingRules` | Stable negative evidence explaining why a nearby alternative rule did not match. | An additional positive classification or permission to choose that rule. |

#### Scope

| `scope` | Meaning | Do not infer |
| --- | --- | --- |
| `independent` | The path establishes a recognized first-class asset or agent boundary rather than Skill-local or repository-support placement. | That owner, policy, lifecycle, or source-of-truth metadata exists or is valid. |
| `skill-local` | The path is under a recognized canonical Skill support directory. | That a parent Skill exists or that inheritance is valid. Check `parentResolution` and `governance`. |
| `repository-support` | The path is recognized as repository implementation or configuration support. | That it is an independently governed Context Asset. |
| `unknown` | The path rule does not establish a known governance scope. | That the file is irrelevant, safe, unowned, or outside the repository. |

#### Matched Rules

`matchedRule` is the primary stable structural classification. Rules are applied
in the precedence shown after this table, so a higher-priority match prevents a
later, more generic interpretation.

| `matchedRule` | Repository evidence matched | Indicates | Must not be inferred |
| --- | --- | --- | --- |
| `skill-entrypoint` | A recognized canonical or historical Skill entrypoint shape under `skills/**` or `.agents/skills/**`. | The file is classified as a Skill entrypoint with independent scope. | That Agent Skills frontmatter is valid, that governance is complete, or that no migration is needed. |
| `skill-local-support` | A path inside `references/`, `profiles/`, `examples/`, `scripts/`, or `assets/` beneath a recognized Skill path shape. | The file has a structurally implied Skill parent candidate and Skill-local scope. | That the parent exists or inheritance is valid. Require `parentResolution: "resolved"` and governance evidence. |
| `context-root` | A file under `contexts/**`. | The file is an independent Context Asset by structure; metadata may refine its `kind` to `context_lens`. | That owner, lifecycle, policy, or source-of-truth metadata is complete or valid. |
| `context-root-legacy` | A file under the supported legacy `context/**` root. | The file is an independent Context Asset by the compatibility path rule. | That it is current, owned, authoritative, or should be moved automatically. |
| `lens-root` | A file under `lenses/**`. | The file is an independent Context Lens by structure. | That Lens targets, governance, or policy declarations are valid. |
| `agent-root` | `AGENTS.md` or a file under `.agents/**` after higher-priority Skill entrypoint rules. | The file is repository agent guidance with independent scope. | That it is an Agent Skill, that its instructions are valid, or that governance is complete. |
| `repository-tool` | A file under top-level `tools/**`. | The file is repository implementation with repository-support scope. | That it is an independently governed Context Asset. |
| `config-file` | A filename matching `renma.config.json` or `.renma.json` after higher-priority rules. | The file is recognized as Renma configuration support. | That its contents are valid, effective for a particular target, or proof of asset governance. |
| `generic-reference` | A nested `references/` directory outside recognized independent and Skill-local asset boundaries. | The file receives the `reference` parsing or inventory role, but its scope remains unknown. | That it belongs to a Skill, may inherit governance, or is an independent Context Asset. |
| `generic-example` | A nested `examples/` directory outside recognized independent and Skill-local asset boundaries. | The file receives the `example` parsing or inventory role, but its scope remains unknown. | That it belongs to a Skill, may inherit governance, or is independently governed. |
| `generic-profile` | A nested `profiles/` directory outside recognized independent and Skill-local asset boundaries. | The file receives the `profile` parsing or inventory role, but its scope remains unknown. | That it is selected by a Skill, may inherit governance, or defines effective policy. |
| `unknown` | No supported positive structural rule matched, or the path uses an unsupported reserved layout. | Renma has no more specific structural classification for the path. | That the file is irrelevant, harmless, unowned, safe to edit, or outside the resolved repository. |

The stable path-rule precedence is:

1. `skill-entrypoint`.
2. `skill-local-support` inside a recognized Skill boundary.
3. Recognized asset roots: `context-root`, `context-root-legacy`, `lens-root`,
   and `agent-root`.
4. Repository support or configuration: `repository-tool` and `config-file`.
5. Compatible nested rules: `generic-reference`, `generic-example`, and
   `generic-profile`.
6. `unknown`.

#### Parent Skill Resolution

`parentResolution` is meaningful for `skill-local-support`. Only `resolved`
permits Renma to claim one parent Skill, and even then consumers must inspect
`governance` to learn whether that parent supplies an owner or policy.

| `parentResolution` | Meaning | Consumer behavior |
| --- | --- | --- |
| `structural-candidate` | Path classification derived a possible `parentAssetCandidatePath`, but repository evidence has not resolved it. | Do not claim inheritance. Resolve the repository and parent evidence first. |
| `resolved` | Repository evidence found exactly one parent Skill and exposes it as `parentAssetPath`. | Inheritance may be reported only as supported by the accompanying governance evidence. |
| `missing` | No parent Skill exists at the structurally implied location. | Do not claim inheritance; treat a related change recommendation as blocked until the layout is reviewed. |
| `ambiguous` | More than one parent Skill candidate remains plausible; candidates may appear in `parentAssetCandidates`. | Do not choose a parent or claim inheritance; require layout or human resolution. |

For example, these two files have the same semantic role and structural scope,
but only the first has one resolved parent:

```json
{
  "classification": {
    "kind": "reference",
    "scope": "skill-local",
    "matchedRule": "skill-local-support",
    "parentResolution": "resolved",
    "parentAssetPath": "skills/foo/SKILL.md"
  },
  "governance": {
    "ownership": {
      "declaredOwner": null,
      "effectiveOwner": "docs",
      "source": "inherited"
    }
  }
}
```

```json
{
  "classification": {
    "kind": "reference",
    "scope": "skill-local",
    "matchedRule": "skill-local-support",
    "parentResolution": "missing"
  },
  "governance": {
    "ownership": {
      "declaredOwner": null,
      "effectiveOwner": null,
      "source": "unowned"
    }
  }
}
```

The resolved example may inherit the owner shown by governance evidence. The
missing example must not inherit merely because its scope remains
`skill-local`.

#### Reason Codes

`reasonCode` narrows the primary structural result without replacing
`matchedRule`. Representative groups are:

- Skill boundary evidence: `under-canonical-skill-root`,
  `under-skill-support-directory`, `unsupported-skill-local-directory`, and
  `outside-recognized-skill-boundary`.
- Independent asset roots: `under-recognized-context-root`,
  `under-legacy-context-root`, `under-recognized-lens-root`, and
  `under-recognized-agent-root`.
- Repository support: `repository-tool-not-context` and
  `recognized-config-file`.
- Generic or negative boundary evidence: `under-generic-support-directory`,
  `outside-recognized-context-root`, and
  `outside-recognized-asset-boundary`.

Some negative reason codes occur inside `competingRules`, where `matched: false`
records why a nearby interpretation did not apply. Human-readable `reason`
wording may improve over time. Machine consumers should branch on
`matchedRule` and `reasonCode`, retain unfamiliar future values, and never infer
governance from a reason code alone.

#### Governance and Decision Evidence

Governance is separate from classification. `ownership` reports declared and
effective owners plus whether the source is `declared`, `inherited`, or
`unowned`. When available, `policySource`, `policyInheritedFrom`, and
`metadataState` report equivalent provenance for policy and metadata. A
resolved parent can still be unowned or have missing policy, so classification
alone is never enough to construct governance.

Commands that make recommendations expose one of these `decisionStatus`
values:

| `decisionStatus` | Meaning | Consumer behavior |
| --- | --- | --- |
| `deterministic` | Renma has enough supported evidence to construct the reported change candidate. | Review and apply only the reported candidate; do not infer additional changes. |
| `human-confirmation-required` | Renma constructed candidate evidence, but human intent or semantics must be confirmed before application. | Do not apply until the required human confirmation occurs. |
| `blocked` | Conflicting, incomplete, unsafe, or unresolved evidence prevents a change recommendation. | Hard stop. Do not apply a patch even if another payload field looks candidate-like. |
| `no-change-recommended` | Renma successfully determined that no edit is recommended. | Treat as a successful no-edit result; do not manufacture a patch. |

`decisionStatus` is the authoritative application gate. The accompanying
decision `reasonCode` and `summary` explain that outcome; neither changes the
structural classification.

#### Safe Consumer Rules

1. Do not infer ownership from `kind`.
2. Do not infer inheritance from `scope: "skill-local"`.
3. Require `parentResolution: "resolved"` plus governance evidence before
   claiming inheritance.
4. Treat `decisionStatus: "blocked"` as a hard stop.
5. Treat `decisionStatus: "no-change-recommended"` as a successful no-edit
   result.
6. Use `matchedRule` and `reasonCode` for machine branching, not the
   human-readable `reason`.
7. Preserve forward compatibility with unknown future enum values. Retain the
   raw value and fail closed rather than guessing its meaning.

Example additive details:

```json
{
  "classification": {
    "kind": "context",
    "scope": "independent",
    "matchedRule": "context-root",
    "reasonCode": "under-recognized-context-root",
    "recognizedRoot": "contexts",
    "ignoredNestedSegments": ["references"],
    "reason": "The file is under the recognized contexts/** root. The nested references/ segment does not change its classification."
  }
}
```

Adding classification evidence does not emit a finding for every file, change
diagnostic severity, or change scan pass/fail behavior. Existing
`requires_human_decision` repair constraints remain the mechanism for intent
that Renma cannot infer.

`suggestedMode: "no-proposal"` with `no-change-recommended` is a successful
result, especially for ordinary Skill-local support that inherits governance.
Suggestion consumers should also handle unknown future `suggestedMode` values
conservatively. These command-contract refinements do not change scan finding
severity, scan pass/fail thresholds, or Readiness scoring.

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

## Presenting Renma Evidence to a User

Raw Renma JSON is evidence for an LLM or coding agent, not usually the best
user-facing explanation. The consumer should translate the relevant fields into
plain language while preserving the boundary between confirmed facts,
recommendations, and unresolved human intent.

The overall loop is:

```text
Renma emits deterministic evidence
-> LLM summarizes the evidence
-> user supplies missing intent
-> LLM performs the smallest supported change
-> Renma verifies the result
-> LLM summarizes the new state
```

In practice, an LLM or coding agent should:

1. Read Renma's deterministic evidence.
2. Summarize the important facts in user-facing language.
3. Separate confirmed facts from recommendations and unresolved intent.
4. Ask only for human decisions that Renma cannot determine.
5. Rerun the relevant Renma command after the user supplies new intent.
6. Explain how the evidence or recommendation changed.
7. Repeat until the intended repository state is explicit and Renma verifies
   it.

A useful summary normally contains:

- **Confirmed repository facts:** paths, declarations, resolved relationships,
  and other evidence Renma actually observed.
- **Renma's deterministic interpretation:** the classification, governance,
  and decision evidence without added assumptions.
- **Current recommendation:** the smallest change Renma supports, or an
  explicit successful no-change result.
- **Unresolved human decisions:** only intent that repository evidence cannot
  determine.
- **Next safe verification step:** the relevant structured Renma command, or a
  statement that no executable action is safe yet.

For example:

```text
Renma classified this file as a Skill-local Reference.

One parent Skill resolved at skills/foo/SKILL.md, and the effective owner is
inherited from that Skill.

No independent metadata change is currently recommended.

A human decision is needed only if this knowledge is intended to be reused
outside this Skill. If so, consider promoting it to contexts/** and then rerun
Renma.
```

LLM consumers must follow these guardrails:

- Do not expose raw diagnostics without summarizing their meaning when a
  user-facing explanation is expected.
- Do not ask the user to decide facts Renma already resolved.
- Do not invent an owner, policy, lifecycle, reference, or source-of-truth
  claim.
- Do not convert `structural-candidate` into `resolved`.
- Do not claim inheritance without `parentResolution: "resolved"` and matching
  governance evidence.
- Do not present `decisionStatus: "blocked"` as an applicable patch.
- Do not assume every diagnostic requires an edit.
- Do not hide unresolved human intent behind an automatic recommendation.
- Treat `no-change-recommended` as a valid successful outcome.
- After new user intent is provided, rerun Renma rather than relying on an old
  result.

### Iterative Example

Initial Renma evidence:

```text
kind: reference
scope: skill-local
parentResolution: resolved
decisionStatus: no-change-recommended
```

LLM summary:

```text
This file is local support for one Skill and already inherits its governance.
No metadata change is needed. Should this knowledge remain local, or is it
intended for reuse by other Skills?
```

User:

```text
It should be reusable by three Skills.
```

LLM response:

```text
That changes the repository-design intent. I will treat promotion to an
independent Context Asset as the candidate direction, preserve the original
meaning, and rerun Renma after the placement and references are updated.
```

After the intended patch, Renma verifies:

```text
kind: context
scope: independent
matchedRule: context-root
```

LLM summary:

```text
The knowledge is now an independent Context Asset under contexts/**. Renma
verified the new classification. Ownership and references should now be
reviewed as independent governance rather than inherited Skill-local state.
```

This example is conceptual. Renma does not automatically move files, invent
references, or decide that local knowledge should be promoted.

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
| `warning` | `Skipping symbolic link; repository discovery never follows symlink targets.` | Renma found a leaf or directory symlink and skipped it without reading or enumerating its target. | Replace it with a regular repository file or directory. A referenced path at or below the symlink also emits `SUPPORT-SYMLINK-PATH`. |
| `warning` | `Skipping file larger than max_file_size_bytes (<bytes>).` | A file exceeded the configured size limit.          | Raise `max_file_size_bytes`, exclude the file, or split the asset.          |
| `error`   | `Could not read file: <error>`                             | The file matched discovery but could not be read.   | Fix permissions, remove the bad path, or exclude the file.                  |

## Metadata And Catalog Diagnostics

These diagnostics are emitted after files are parsed into catalog entries. For shared-context wording details, see [Context Language Diagnostics](context-language-diagnostics.md).

Owner absence is handled as ownership coverage information. Shared assets
without `owner` are accepted and reported as unowned by `renma ownership`;
Renma does not invent an owner. Skill-local support is the exception: it uses
deterministic effective ownership only after repository evidence resolves one
parent Skill with an effective owner, and reports that inherited provenance
separately from declared metadata.

| Severity  | Message                                                                                           | Meaning                                                                                                                        | Fix                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `warning` | `Invalid status "<status>". Expected one of: experimental, stable, deprecated, archived.`         | An asset status does not match the accepted status values.                                                                     | Replace the status with a supported value.                                                                      |
| `warning` | `Invalid last_reviewed_at "<date>". Expected ISO date YYYY-MM-DD.`                                | Freshness metadata has an invalid human review date.                                                                           | Replace it with a real ISO date such as `2026-06-28`.                                                           |
| `warning` | `Invalid expires_at "<date>". Expected ISO date YYYY-MM-DD.`                                      | Freshness metadata has an invalid expiration date.                                                                             | Replace it with a real ISO date such as `2026-12-31`.                                                           |
| `warning` | `Invalid review_cycle "<duration>". Expected supported ISO 8601 day duration such as P90D.`       | Freshness metadata uses a review cycle renma cannot evaluate.                                                                  | Use a day-based duration such as `P90D` or `P180D`.                                                             |
| `warning` | `Metadata dependency "<to>" from "<from>" does not match a catalog entry.`                        | A metadata dependency points at an asset renma did not discover.                                                               | Correct the reference, add the missing asset, or update include/exclude config.                                 |
| `warning` | `Metadata dependency "<to>" from "<from>" targets a <status> asset.`                              | A dependency points at a deprecated or archived catalog target.                                                                | Retarget the dependency to a stable replacement or document the migration.                                      |
| `warning` | `Asset is missing an id.`                                                                         | A cataloged asset has no stable ID.                                                                                            | Add an `id` metadata field.                                                                                     |
| `warning` | `Asset is missing an owner.`                                                                      | A shared catalog asset has no declared owner metadata. Missing owner is allowed and appears as unowned in ownership coverage; nearest-Skill support inheritance does not apply to shared assets. | If ownership matters for this repository, choose an `owner` through human review or team policy. Do not invent one. |
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
| `CONTEXT-LENS-TARGET-NOT-CONTEXT`          | `error`              | An `applies_to` target resolves to a cataloged asset whose kind is not `context`.                             | `applies_to` must reference a Context Asset ID or path; Skills, support assets, other Lenses, and repository metadata are not valid Lens targets. |
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

Security diagnostics focus on high-signal heuristics for agent-facing or context-bearing artifacts Renma already discovers, such as skills, contexts, `AGENTS.md`, references, profiles, examples, and Markdown tool guidance. Defensive wording and nearby human approval, dry-run, backup, or rollback guidance may reduce or avoid command-risk findings when they are local to the risky instruction. When the effective human-approval policy is true, dry-run, backup, rollback, or restore guidance does not replace explicit human approval. Renma does not scan `package.json`, GitHub Actions workflows, Dockerfiles, dependency manifests, or repository-wide supply-chain metadata by default.

These checks inspect repository knowledge and operational instructions. They are
not language-specific SAST, dependency scanning, a safety proof, runtime
monitoring, sandboxing, permission enforcement, or telemetry collection. A scan
with no findings means only that the enabled deterministic checks found no
matching evidence; it does not establish that an agent workflow is safe.

### Instruction-integrity boundaries

`SEC-SAFEGUARD-BYPASS-INSTRUCTION` reports explicit guidance to disable or
circumvent security checks, weaken policy to pass diagnostics, suppress
warnings, replace approval with post-hoc review, choose a more dangerous
permission fallback, or execute automatically after no user response. The safe
repair is to keep the existing safeguard, stop and report missing authority,
and rerun `renma scan` without relaxing policy or adding suppression. Direct
prohibitions such as “Do not bypass human approval,” quoted examples,
HTML-comment content, and fenced prose clearly bounded as an unsafe or negative
example are excluded from this semantic prose rule. Visible text before or
after an HTML comment span remains scannable. A fenced `text` or `markdown`
payload explicitly routed by surrounding prose, an instruction label, or an
operational instruction heading is scanned as an instruction. A defensive
sentence does not protect a separate contradictory bypass instruction.
Comment-like `<!--` and `-->` text inside any fenced code block is literal
fence content and never opens or closes an HTML comment for subsequent lines.
Matched Markdown inline-code spans use the same literal treatment, including
variable-length backtick delimiters. Closing-delimiter lookup stays within the
same Markdown paragraph or list-item continuation and does not cross blank
paragraph boundaries, ATX or Setext headings, thematic breaks, fences, or
sibling and nested list items. CommonMark HTML blocks that can interrupt a
paragraph, including raw tags, comments, processing instructions, declarations,
CDATA, and recognized block-level tags, also end lookup; arbitrary inline HTML
such as `<span>` does not. Valid multiline spans within that block remain
supported. Comment and fence state starts fresh after YAML frontmatter, so
frontmatter scalar or block values cannot affect body scanning or evidence line
numbers.

`SEC-UNTRUSTED-CONTENT-AS-INSTRUCTION` reports guidance that makes an external
page, issue body, log, tool output, attachment, downloaded document, or fetched
Markdown authoritative or executes its embedded commands without review. Safe
reading, quoting, summarizing, provenance capture, and locally reviewed or
validated fact extraction are outside the rule. Repair the instruction by
treating source content as untrusted data, preserving provenance, validating
task-relevant facts, and keeping execution authority in reviewed repository
guidance or explicit human approval.

Semantic windows remain within one Markdown list item: sibling bullet or
numbered items and nested child items establish new instruction boundaries,
while indented continuation lines stay associated with their owning item.
Ordinary adjacent prose lines can still form one bounded instruction. A review
guard applies only when it precedes and names the same execution action, so a
later defensive sentence cannot retroactively suppress an unsafe action and a
guard for `apply` does not cover a later `execute`. Multiline matches are
deduplicated only after an emitted action span is selected; a guarded raw regex
match does not suppress a later contradictory action. An action that proceeds
regardless of review findings, despite failed validation or inspection, or
without reviewing, validating, verifying, inspecting, or checking explicitly
rejects the preceding guard and remains an untrusted-content finding. Guard and
contradiction matching use the same review vocabulary and inflected forms.

`SEC-UNBOUNDED-EXTERNAL-SOURCE-TRAVERSAL` is an advisory for explicit recursive
link, issue, attachment, page, or source traversal when the same bounded
Markdown section states none of the expected scope, relevance, visited/cycle,
depth/count/time, failure-stop, or unresolved-scope boundaries. A single named
source read is not recursive traversal. A boundary in an unrelated peer section
does not apply. The finding is normally low/advisory; it becomes
medium/suspicious, not high, when the same local section also directs sensitive
data disclosure or upload. Renma reports the missing governance but never
crawls the sources itself.

### Data-sharing source and sink boundaries

The existing bulk-data, overbroad-context, no-redaction, secret-material, and
upload diagnostics now distinguish broad sources from disclosure sinks. A
local read of a whole repository may still be an overbroad context-collection
advisory, but it is not bulk sharing without a prompt/context attachment,
stdout/log output, or upload/share sink. Full logs, all environment variables,
whole repositories, and credential directories become bulk-sharing evidence
when instructions attach, print, log, paste, send, or upload them. Minimal
task-relevant sanitized snippets and explicit defensive redaction wording are
excluded. `process.env.NAME` is environment API access, not a `.env` file path;
an actual `.env` reference remains sensitive-file evidence, while a local read
alone is not secret disclosure.

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

Script and asset bytes never declare local policy. They participate in the
security policy inventory even when they have no effective policy. Local
support inherits policy only from one unambiguous owning Skill; text scripts
may be scanned under that inherited policy from line 1. Ordinary assets and
binary files do not contribute instruction text. Orphan scripts receive no
policy-dependent repository-config evaluation without traceable ownership.
The inventory distinguishes local metadata, inherited policy, effective policy,
and no-effective-policy states. Trust Graph policy edges exist only for
artifacts with effective policy and list every contributing policy source.

Security profiles in `renma.config.json` retain the existing JSON schema.
Artifact-local explicit denials remain stricter than inherited profile or
repository allowances, and network approvals remain separate from upload
approvals. See the [Security Policy Guide](security-policy.md) for complete
examples by asset kind.

| Identifier                                       | Meaning                                              | Typical cause                                                                                      | How to fix                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `COMPOSITION-DECLARED-CONFLICT`                  | Required declared composition contains conflicting assets. | Two assets connected to the same focused composition through required routes have an explicit `conflicts` declaration. | Review both inclusion routes and the conflict declaration; change relationships only from reviewed intent and never select a winner from order. |
| `COMPOSITION-OPTIONAL-CONFLICT`                  | Declared composition has an optional conflict candidate. | At least one member of an explicit conflict pair is reachable only after an optional edge. | Keep the candidate visible to runtime consumers or revise the reviewed declarations; Renma does not select optional Context. |
| `COMPOSITION-OPTIONAL-CYCLE`                     | Optional declared composition contains a cycle.      | A cycle becomes reachable only after an optional route.                                             | Review responsibility boundaries while preserving optional provenance; do not infer precedence or repeated loading. |
| `COMPOSITION-REQUIRED-CYCLE`                     | Required declared composition contains a cycle.      | Required `requires_context`, `requires_lens`, or Lens `applies_to` edges form a strongly connected component. | Split, consolidate, or relate assets differently after review; the finite closure may remain complete even while `cycleFree` is false. |
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
| `META-DEPENDENCY-SOURCE-KIND-MISMATCH`           | A relationship originates from the wrong asset kind. | `applies_to` is authored outside a Context Lens, independently of whether its target resolves or has the correct kind. | Move, change, or remove the declaration from reviewed repository intent; do not change or create a target merely to hide the source violation. |
| `META-DEPENDENCY-TARGET-KIND-MISMATCH`           | A resolved relationship targets the wrong asset kind. | For example, `requires_context` points to a Context Lens, `requires_lens` points to Context, or Lens `applies_to` points outside Context. | Correct the target or declaration using repository intent; do not create placeholders or reject valid Context-to-Context dependencies. |
| `META-DUPLICATE-DECLARED-DEPENDENCY`             | One metadata field repeats the same dependency value. | The exact target appears multiple times in the same `requires_context`, `optional_context`, Lens, conflict, or lifecycle declaration field. | Keep one exact value after review; preserve legitimate multi-parent routes and distinct stable IDs. |
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
| `QUAL-INVALID-TOKEN-BUDGET-OVERRIDE`             | Support-asset decision metadata is invalid.           | The decision is malformed, unsafe to represent exactly, ambiguous, incomplete, orphaned, duplicated, or unnecessary while the asset remains within its default. | Correct or remove the declaration. Ask about a meaningful split first; use an override only after the user confirms the asset should remain intentionally long. |
| `QUAL-SUPPORT-ASSET-TOKEN-BUDGET`                | Support asset exceeds its effective advisory estimate. | A context, reference, profile, or example exceeds its default or valid declared override.          | Ask whether a semantic split preserves coherence and execution order. Split only with user agreement; otherwise record an explicit rationale, never an override added merely to pass diagnostics. |
| `QUAL-USER-LOCAL-PATHS`                          | User-local path appears in content.                  | Guidance includes machine-specific paths such as home directories.                                 | Replace local paths with repository-relative or configurable paths.                                    |
| `SEC-DESTRUCTIVE-COMMAND`                        | Destructive command appears.                         | Content includes risky commands such as forced deletion or reset.                                  | Remove it, gate it with explicit safety guidance, or use a safer command.                              |
| `SEC-ENV-COPY`                                   | Environment copying is suggested.                    | Content copies broad environment or secret-bearing files.                                          | Narrow the copied data and document secret handling.                                                   |
| `SEC-LITERAL-SECRET`                             | Literal secret-like value appears.                   | Content includes token, password, key, or credential patterns.                                     | Remove the secret and replace it with a placeholder.                                                   |
| `SEC-PRIVATE-KEY`                                | Private key material appears.                        | Content includes a private key block.                                                              | Remove the key and rotate it if it was real.                                                           |
| `SEC-REMOTE-DEFAULT`                             | Remote command default is unsafe.                    | Guidance defaults to network commands, prod hosts, or insecure flags.                              | Use safe examples and require explicit approval for risky remotes.                                     |
| `SUPPORT-MISSING-REACHABILITY-GUIDANCE`          | Local resources are not discoverable.                | A Skill has local references, scripts, assets, profiles, or examples without routing guidance.     | State when each resource should be read, executed, or used.                                            |
| `SUPPORT-DEEP-REFERENCE-CHAIN`                   | Local resource is behind more than two hops.         | A resource is reachable only through a deep static chain.                                          | Reference it directly or through one directly referenced index.                                       |
| `SUPPORT-MISSING-PATH`                           | Referenced local resource does not exist.            | `SKILL.md` names a path under a standard local resource directory that is absent.                  | Create the intended resource or correct the Skill-root-relative path.                                  |
| `SUPPORT-SYMLINK-PATH`                           | A symbolic-link resource is intentionally unusable.  | Discovery encountered a symlink, or Skill guidance references a path at or below one.              | Replace it with a regular repository file or directory; Renma never follows symlink targets.           |
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
| `SEC-SAFEGUARD-BYPASS-INSTRUCTION`               | Instructions explicitly bypass a security safeguard. | Content disables checks, weakens policy, skips approval, suppresses warnings, or uses a riskier fallback. | Preserve the safeguard, stop and report missing authority, and verify again without policy relaxation. |
| `SEC-SECRET-MATERIAL-INSTRUCTION`                | Instructions expose or request secret material.      | Content includes or asks for private keys, tokens, or credentials.                                 | Remove secret material and describe secure handling instead.                                           |
| `SEC-SENSITIVE-FILE-REFERENCE`                   | Instructions reference sensitive files.              | Content points at credentials, keys, or local secret paths.                                        | Replace with safe examples or redacted placeholders.                                                   |
| `SEC-UNBOUNDED-EXTERNAL-SOURCE-TRAVERSAL`        | Recursive external traversal has no local boundary.  | Content recursively follows links, issues, pages, or attachments without any stated scope or termination control. | Add source, relevance, visited/cycle, cap, failure-stop, and unresolved-scope guidance in the same section. |
| `SEC-UNAPPROVED-NETWORK-DESTINATION`             | Network destination is not approved.                 | Instructions contact a host outside the allowed list.                                              | Enumerate the actual required domains in approved network destinations after review.                   |
| `SEC-UNAPPROVED-UPLOAD-DESTINATION`              | Upload destination is not approved.                  | Instructions upload data to an unapproved service or host.                                         | Use an approved destination or update policy intentionally.                                            |
| `SEC-UNPINNED-DEPENDENCY-INSTALL`                | Dependency install is not pinned.                    | Examples install packages without exact versions or digests.                                       | Pin package versions or use a reproducible install source.                                             |
| `SEC-UNPINNED-REMOTE-SCRIPT`                     | Remote script execution is unpinned.                 | Commands pipe or execute remote scripts without an immutable reference.                            | Pin the script source and verify it before execution.                                                  |
| `SEC-UNTRUSTED-CONTENT-AS-INSTRUCTION`           | Untrusted source content becomes executable guidance. | Content follows fetched, downloaded, attached, logged, or tool-produced instructions as authority without review. | Treat the content as data, preserve provenance, validate facts, and use reviewed local authority for actions. |

## How To Fix Results

1. Fix `error` diagnostics first. They usually mean renma could not build a deterministic view of the repository.
2. Fix unresolved references before quality findings. Reference failures can hide or distort later reports.
3. For scan findings, use the finding ID, evidence path, line number, snippet, and remediation text in the JSON output.
4. Re-run the same command with `--format json` when a markdown or text report does not contain enough detail.
