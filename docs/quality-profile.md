# Renma Quality Profile

`renma-quality` is Renma's internal quality-profile family. Reports identify
the active profile as `renma-quality@<Renma package version>`, derived from
`package.json` at build time. The source is `src/quality-profile.ts`. The current
implementation does not expose quality overrides in `renma.config.json`; fixed
defaults preserve comparable repository reports. The internal shape is
versioned so later releases can add declared overrides without scattering
constants across rules.

`estimated_tokens` means Renma's deterministic, model-neutral estimate. Latin
words, identifiers, URLs, and paths are lexical units; consecutive CJK text is
grouped in two-code-point units; other punctuation is grouped in units of up to
three code points. It is not an exact token count for any model. Skill budgets
measure Markdown after frontmatter. Content-asset budgets measure the full file.

Contexts, references, profiles, and examples may record a declared human
decision and effective limit with top-level `token_budget_override` and
`token_budget_rationale` metadata. The override must be a positive safe integer
greater than the asset kind's unchanged default. Optional
`token_budget_reviewed_at` must be a real `YYYY-MM-DD` date. Renma does not add
these fields automatically. When an asset exceeds its default, an agent should
first ask whether it can be split along meaningful boundaries without harming
coherence or execution order, and split only after the user agrees. An override
is appropriate only when the user confirms the long-form asset is intentionally
coherent or ordered; it is not a general ignore mechanism. Renma validates the
declaration but cannot prove that human review occurred.

## Agent Skills requirements and recommendations

| Field | Value | Unit and trigger | Severity | Source | Rationale and false-positive risk | Diagnostic | Reviewed | Configurable later |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `agentSkills.nameMaxChars` | 64 | characters; above is invalid | error | Agent Skills specification | Portable identity limit | `AS-SKILL-INVALID-NAME` | 0.18.0 | no |
| `agentSkills.descriptionMinChars` | 1 | characters; below is invalid | error | Agent Skills specification | Required discovery metadata | `AS-SKILL-MISSING-DESCRIPTION` / `AS-SKILL-INVALID-DESCRIPTION` | 0.18.0 | no |
| `agentSkills.descriptionMaxChars` | 1,024 | characters; above is invalid | error | Agent Skills specification | Portable hard limit | `AS-SKILL-DESCRIPTION-TOO-LONG` | 0.18.0 | no |
| `agentSkills.compatibilityMaxChars` | 500 | characters; above is invalid | error | Agent Skills specification | Keeps optional environment requirements concise | `AS-SKILL-COMPATIBILITY-TOO-LONG` | 0.18.0 | no |
| `agentSkills.skillBodyRecommendedMaxTokens` | 5,000 | recommended body tokens | medium Renma advisory above | Agent Skills recommendation | Large focused workflows can still be valid | `QUAL-SKILL-TOKEN-BUDGET` | 0.18.0 | no |
| `agentSkills.skillRecommendedMaxLines` | 500 | recommended `SKILL.md` lines | documented review evidence | Agent Skills recommendation | Line count alone does not prove mixed responsibility | none | 0.18.0 | no |
| `agentSkills.recommendedReferenceDepth` | 1 | resource hop from `SKILL.md`; Renma accepts one additional index hop | low beyond two static hops | Agent Skills recommendation plus Renma reachability policy | An index may be useful; deep chains are easy to miss | `SUPPORT-DEEP-REFERENCE-CHAIN` | 0.18.0 | possibly |

The Agent Skills body has no prescribed format. Step-by-step instructions,
examples, edge cases, short commands, and the optional `scripts/`, `references/`,
and `assets/` directories are valid. See the official
[specification](https://agentskills.io/specification) and
[description guidance](https://agentskills.io/skill-creation/optimizing-descriptions).

## Renma workflow and content advisories

| Field | Value | Unit and trigger | Severity | Source | Rationale and false-positive risk | Diagnostic | Reviewed | Configurable later |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `descriptionMinChars` | 0 | characters; disabled | none | Renma | Length does not establish selection clarity | `QUAL-SHORT-DESCRIPTION` removed from default behavior | 0.18.0 | possibly |
| `skillTokenWarn` | 2,000 | `estimated_tokens`; body above | low | Renma | Early progressive-disclosure review; focused workflows may exceed it | `QUAL-SKILL-TOKEN-BUDGET` | 0.18.0 | possibly |
| `skillTokenStrongWarn` | 5,000 | `estimated_tokens`; body above | medium | Agent Skills recommendation with Renma severity | Stronger review, not a required split | `QUAL-SKILL-TOKEN-BUDGET` | 0.18.0 | possibly |
| `contentTokenWarn.context` | 4,000 | `estimated_tokens`; full file above effective limit | low | Renma | Prefer an agreed semantic split when coherence survives; intentionally coherent or ordered assets may record a declared decision | `QUAL-SUPPORT-ASSET-TOKEN-BUDGET` | 0.18.1 | metadata only after human decision |
| `contentTokenWarn.reference` | 5,000 | same | low | Renma | Detailed local references may legitimately be long | same | 0.18.1 | same |
| `contentTokenWarn.profile` | 2,000 | same | low | Renma | Profiles should remain reviewable overlays | same | 0.18.1 | same |
| `contentTokenWarn.example` | 2,500 | same | low | Renma | Complete examples may legitimately be long | same | 0.18.1 | same |
| `lowHeadingDensityMinTokens` | 400 | body `estimated_tokens`, with fewer than 2 headings | low | Renma | Long prose can still be intentionally linear | `QUAL-LOW-HEADING-DENSITY` | 0.18.0 | possibly |
| `lowHeadingDensityMinHeadings` | 2 | headings | low | Renma | Navigation heuristic only | same | 0.18.0 | possibly |

## Metadata advisories

| Field | Value | Unit and trigger | Severity | Source | Rationale and false-positive risk | Diagnostic | Reviewed | Configurable later |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `frontmatterMaxLines` | 48 | lines; above | low | Renma | Metadata should be a compact index | `META-FRONTMATTER-TOO-LARGE` | 0.18.0 | possibly |
| `frontmatterMaxChars` | 4,096 | characters; above | low | Renma | Separate from Agent Skills validity | same | 0.18.0 | possibly |
| `metadataListItemMaxChars` | 256 | characters per JSON-array or YAML-list element; above | low | Renma | Tags and prose routing should be compact; IDs, URLs, and paths are exempt where practical | `META-LIST-ITEM-TOO-LONG` | 0.18.0 | possibly |

## Reuse candidate advisories

| Detector | Eligibility and evidence | Severity | Source | Rationale and false-positive risk | Diagnostic | Reviewed | Configurable later |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reusableContextCandidate` | 60 lines **or** 800 body `estimated_tokens`; 4 distinct reusable signals; at least one reusable-knowledge signal | low | Renma | Verification, Examples, Edge Cases, Risks, Do not, Always, Never, and procedure headings do not qualify by themselves | `QUAL-SKILL-MIXED-RESPONSIBILITY` | 0.18.0 | possibly |
| `sharedSupportCandidate` | 80 lines **or** 1,200 full-file `estimated_tokens`; 3 reusable headings; 4 reusable phrases | low | Renma | Promotion still requires cross-Skill use, duplication, independent lifecycle, or source-of-truth evidence | `MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE` | 0.18.0 | possibly |

## Repeated-context evidence

| Field | Default | Trigger | Severity | Source | False-positive control | Diagnostic | Reviewed | Configurable later |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `repeatedContext.exactSectionMinTokens` | 40 | normalized section estimated tokens at or above | medium | Renma | combined with character and file floors | `MAINT-REPEATED-SECTION` | 0.18.0 | possibly |
| `repeatedContext.exactSectionMinChars` | 240 | normalized section characters at or above | medium | Renma | combined with token and file floors | same | 0.18.0 | possibly |
| `repeatedContext.exactSectionMinFiles` | 2 | files containing the exact section | medium | Renma | requires maintained duplication | same | 0.18.0 | possibly |
| `repeatedContext.exactCodeMinChars` | 80 | normalized fenced-code characters at or above | medium | Renma | combined with token and file floors | `MAINT-REPEATED-CODE-BLOCK` | 0.18.0 | possibly |
| `repeatedContext.exactCodeMinTokens` | 10 | normalized fenced-code estimated tokens at or above | medium | Renma | combined with character and file floors | same | 0.18.0 | possibly |
| `repeatedContext.exactCodeMinFiles` | 2 | files containing the exact block | medium | Renma | requires maintained duplication | same | 0.18.0 | possibly |
| `repeatedContext.headingMinChars` | 24 | normalized heading characters at or above | low | Renma | excludes short generic headings | `MAINT-REPEATED-HEADING` | 0.18.0 | possibly |
| `repeatedContext.headingMinTokens` | 3 | normalized heading estimated tokens at or above | low | Renma | excludes terse boilerplate | same | 0.18.0 | possibly |
| `repeatedContext.headingMinFiles` | 3 | files containing the same heading | low | Renma | heading equality is review evidence only | same | 0.18.0 | possibly |
| `repeatedContext.tokenShingleTokens` | 40 | estimated tokens in one normalized sequence | medium | Renma | common boilerplate excluded; near duplicates collapsed | `MAINT-REPEATED-CONTEXT-PATTERN` | 0.18.0 | possibly |
| `repeatedContext.tokenShingleMinFiles` | 3 | files containing the sequence | medium | Renma | requires broader repeated evidence | same | 0.18.0 | possibly |
| `repeatedContext.tokenShingleNearbyLineWindow` | 8 | source lines | n/a | Renma | collapses overlapping nearby matches from the same repeated passage | same | 0.18.0 | possibly |
| `repeatedContext.tokenShingleMinUniqueTokens` | 12 | unique estimated-token units | medium | Renma | excludes repetitive boilerplate sequences | same | 0.18.0 | possibly |
| `repeatedContext.tokenShingleMinUsefulTokens` | 14 | non-boilerplate estimated-token units | medium | Renma | requires meaningful lexical evidence | same | 0.18.0 | possibly |
| `repeatedContext.tokenShingleMinChars` | 140 | normalized characters | medium | Renma | excludes compact coincidental matches | same | 0.18.0 | possibly |
| `repeatedContext.findingCap` | 10 | findings per repeated-context category | n/a | Renma | presentation only; prevents category domination | all repeated-context IDs | 0.18.0 | possibly |
| repeated links | disabled | same target repeated | none | Renma | links to the same official source are normal | `MAINT-REPEATED-LINK` removed from default findings | 0.18.0 | possibly |

## Readiness policy

Readiness starts at 100. Specification failures, high or critical security
findings, diagnostic errors, and unresolved required graph closure remain
blocking even when the numeric score would otherwise pass. Deprecated or
archived assets have no existence penalty.

The 0.23.0 Skill Discovery checks are visibility-first and have no separate
score weight. Partial or not-adopted coverage never subtracts points, and a
cycle warning alone never creates a hard failure. Authoritative coverage and
declared-route problems reuse existing prepared diagnostics as compact check
evidence; those diagnostics are not copied into Readiness diagnostics, so the
new checks cannot subtract a second time for the same condition. Existing
Readiness penalties and thresholds below are unchanged.

| Field | Default | Unit and trigger | Effect | Source | Rationale and false-positive risk | Related check or diagnostic | Reviewed | Configurable later |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `readiness.blockingDiagnosticPenalty` | 40 | points; one or more diagnostic errors | subtract once and fail check | Renma | Structural errors require correction; diagnostic aggregation avoids multiplying one root cause | `diagnostics.errors` | 0.18.0 | possibly |
| `readiness.unresolvedRequiredGraphPenalty` | 30 | points; one or more unresolved required edges | subtract once and fail check | Renma | Required context closure is operationally necessary; optional edges are excluded | `graph.unresolved_edges` | 0.18.0 | possibly |
| `readiness.ownershipMaximumPenalty` | 20 | points; proportional to unowned assets | subtract 0-20 | Renma | Ownership supports review, but small or imported repositories may intentionally omit it | `ownership.coverage` | 0.18.0 | possibly |
| `readiness.emptyInventoryPenalty` | 10 | points; no cataloged assets | subtract once | Renma | Usually signals a wrong root or incomplete repository; an intentionally empty repository can be valid | `assets.minimum_inventory` | 0.18.0 | possibly |
| `readiness.workflowClarityPenalty` | 10 | points; workflow clarity warning | subtract once | Renma | Missing routing clarity impairs use; prose phrasing may evade static recognition | `workflow.clarity` and related `RN-SKILL-*` diagnostics | 0.18.0 | possibly |
| `readiness.workflowOptionalContextPenalty` | 5 | points; unusable optional context | subtract once | Renma | Optional context should resolve but does not block the core workflow | `workflow.optional_context` | 0.18.0 | possibly |
| `readiness.workflowRequiredInputsPenalty` | 5 | points; required inputs are unclear | subtract once | Renma | Review signal only because some Skills require no external inputs | `workflow.required_inputs` | 0.18.0 | possibly |
| `readiness.workflowCompletionCriteriaPenalty` | 10 | points; completion criteria are unclear | subtract once | Renma | Review signal only because completion language varies by workflow | `workflow.completion_criteria` | 0.18.0 | possibly |
| `readiness.layoutWarningPenalty` | 5 | points per warning layout/path check | subtract per check | Renma | Keeps resolvable path and layout debt visible without making one advisory blocking | `layout.*` / `paths.helper_commands` | 0.18.0 | possibly |
| `readiness.layoutFailurePenalty` | 15 | points per failing layout/path check | subtract per check and fail | Renma | Strict layout failures can make repository evidence unusable | `layout.*` / `paths.helper_commands` | 0.18.0 | possibly |
| `readiness.readyMinimumScore` | 90 | score; at or above with no failing check | `ready` | Renma | Maintains a high bar without making subjective advisories blocking | Readiness `level` | 0.18.0 | possibly |
| `readiness.needsAttentionMinimumScore` | 70 | score; below | `not_ready`; 70-89 is `needs_attention` | Renma | Separates accumulated review debt from isolated advisories | Readiness `level` | 0.18.0 | possibly |

## Security proximity, scan operations, and presentation

| Field | Default | Unit and trigger | Effect | Source | Rationale and false-positive risk | Related check or diagnostic | Reviewed | Configurable later |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `security.precedingLineFastPath` | 2 | preceding source lines | supplements structural guard association | Renma | Preserves nearby-guard detection while headings, paragraphs, and list structure reduce formatting false positives | applicable `SEC-*` command diagnostics | 0.18.0 | no |
| `scan.defaultMaxFileSizeBytes` | 524,288 | bytes per discovered file | bound reading and hashing work | Renma operational default | Protects scans from unexpectedly large files; larger legitimate files may require existing scan configuration | discovery diagnostic | 0.18.0 | already configurable |
| `scan.defaultMaxDepth` | 16 | directory levels | bound discovery depth | Renma operational default | Prevents runaway traversal; unusually deep repositories may need existing scan configuration | discovery diagnostic | 0.18.0 | already configurable |
| `scan.defaultConcurrency` | 16 | concurrent file operations | bound scan concurrency | Renma operational default | Balances throughput and file-descriptor pressure | none | 0.18.0 | already configurable |
| `presentation.markdownReadinessFindingCap` | 50 | findings in Readiness Markdown | truncate presentation only | Renma | Keeps human reports readable without changing JSON evidence or score | Readiness Markdown | 0.18.0 | possibly |
| `presentation.topSummaryItemCap` | 10 | items in compact summaries | truncate presentation only | Renma | Avoids unbounded summaries; reviewers can use full reports | report summaries | 0.18.0 | possibly |

Structural guard proximity includes the same constraint or safety section, the
same list item, a directly associated paragraph, or a parent Human Approval,
Safety, or Constraints heading. The two-line fast path does not cross a
Markdown heading or frontmatter boundary, so a guard in an unrelated peer
section cannot authorize a later action. Binary snippets are never exposed.
Scan operational limits retain their existing public config fields; none of
the quality or Readiness thresholds above are currently configurable.
