# Metadata Budget Guidance

The User Manual's
[authoritative metadata table](user-manual.md#renma-operational-metadata-table)
owns the complete field inventory and exact support-asset applicability. This
document retains the deeper token-budget decision semantics and examples.

Renma intentionally keeps asset frontmatter small. Frontmatter should work as a deterministic index for cataloging, graph checks, readiness checks, and security diagnostics. It should not become a second copy of the asset body.

Use frontmatter for concise fields such as `id`, `owner`, `status`, `tags`, `when_to_use`, `when_not_to_use`, and declared context relationships. Put detailed guidance, examples, procedures, policy rationale, and long routing prose in the markdown body or in referenced context assets.

Contexts, references, profiles, and examples also support these top-level
human-decision fields:

```yaml
token_budget_override: 6000
token_budget_rationale: "This is a single ordered workflow and splitting it would break execution order."
token_budget_reviewed_at: "2026-07-12"
```

`token_budget_override` must be a positive safe integer greater than the asset
kind's stable compatibility validation baseline (Context 4,000, Reference
5,000, Profile 2,000, Example 2,500), and `token_budget_rationale` must be a
non-empty string. These baselines validate declaration compatibility; they are
not the current repository warning defaults. `token_budget_reviewed_at` is optional and must be a real
`YYYY-MM-DD` date when present. Invalid metadata does not change repository
policy.
The three fields form one decision bundle: rationale and review-date fields are
invalid without an override. Duplicate fields, relevant YAML errors, and an
override declared while the full file remains within its compatibility validation baseline also
produce `QUAL-INVALID-TOKEN-BUDGET-OVERRIDE`. Renma selects no value from an
ambiguous or invalid bundle, and catalog output omits all three normalized
fields.

These fields record a declared human decision; Renma never inserts them. When
the default is exceeded, first ask whether the asset can be split along
meaningful semantic boundaries without harming coherence or execution order.
Split only after the user agrees. Use an override only when the user confirms
the asset should remain intentionally long, and never recommend one merely to
make diagnostics pass.

Token-budget counts are deterministic estimates, not exact model-token counts.
Exceeded-budget findings report the measured estimate, repository and effective
warning/High thresholds, the triggered threshold, severity, absolute overage,
and a rounded overage percentage. Repository defaults are Context 6,400/8,000,
Reference 7,200/9,000, Profile 3,200/4,000, and Example 4,800/6,000. A result
above warning through High is Medium; a result above High is High.

With a valid declared override, Renma keeps the compatibility validation
baseline, current Renma default, declared override, repository policy, and final
effective thresholds visible. The effective warning threshold is the greater of
the repository warning and override; the effective High threshold is the
greater of the repository High threshold and effective warning. An active
override is an explicit declared floor, not a suppression: an asset above its
effective thresholds still produces `QUAL-SUPPORT-ASSET-TOKEN-BUDGET`. A valid
override below the repository warning is a no-op, remains compatible, and never
lowers repository policy, while
an asset at or below its effective warning threshold does not.

For Markdown assets, the finding also lists at most three of the largest
heading-based sections as review candidates. Renma measures each selected
section from its heading through the next heading at the same or a shallower
depth, ranks by estimated tokens, and breaks ties by source line. Nested
headings stay inside their selected parent, so they are not double-counted as
independent top candidates. This section review is separate from the canonical
support-asset measurement, which remains the full file. A candidate is not an
automatic split point or destination assignment. Semantic ownership determines
whether reviewed material stays in `SKILL.md`, moves to Skill-local
`references/`, becomes deterministic implementation in `scripts/`, supplies
output resources in `assets/`, or belongs in independently owned `contexts/`.
If no useful headings exist, review the asset manually rather than adding or
splitting headings by token count alone.

Renma records and validates this declaration; it cannot prove that a human
actually reviewed the asset. `token_budget_reviewed_at` is declared provenance,
not independently verified evidence.

Current metadata budget diagnostics:

| Finding | Meaning | Typical fix |
| --- | --- | --- |
| `META-FRONTMATTER-TOO-LARGE` | Frontmatter has grown beyond the compact index budget. | Move long prose, examples, procedures, or rationale into the body or referenced context assets. |
| `META-LIST-ITEM-TOO-LONG` | A block-list metadata item is too long to serve as concise routing/index metadata. | Keep the list item short and move detailed conditions into body sections. |
| `QUAL-INVALID-TOKEN-BUDGET-OVERRIDE` | Support-asset token-budget decision metadata is invalid or ambiguous. | Correct or remove it after an explicit user decision; invalid metadata leaves the repository warning/High policy active. |

These diagnostics are intentionally advisory. They should help reduce LLM-facing catalog noise and token usage without deleting substantive knowledge.
