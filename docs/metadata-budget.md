# Metadata Budget Guidance

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
kind's default content limit, and `token_budget_rationale` must be a non-empty
string. `token_budget_reviewed_at` is optional and must be a real `YYYY-MM-DD`
date when present. Invalid metadata does not replace the default limit.
The three fields form one decision bundle: rationale and review-date fields are
invalid without an override. Duplicate fields, relevant YAML errors, and an
override declared while the full file remains within its default limit also
produce `QUAL-INVALID-TOKEN-BUDGET-OVERRIDE`. Renma selects no value from an
ambiguous or invalid bundle, and catalog output omits all three normalized
fields.

These fields record a declared human decision; Renma never inserts them. When
the default is exceeded, first ask whether the asset can be split along
meaningful semantic boundaries without harming coherence or execution order.
Split only after the user agrees. Use an override only when the user confirms
the asset should remain intentionally long, and never recommend one merely to
make diagnostics pass.

Renma records and validates this declaration; it cannot prove that a human
actually reviewed the asset. `token_budget_reviewed_at` is declared provenance,
not independently verified evidence.

Current metadata budget diagnostics:

| Finding | Meaning | Typical fix |
| --- | --- | --- |
| `META-FRONTMATTER-TOO-LARGE` | Frontmatter has grown beyond the compact index budget. | Move long prose, examples, procedures, or rationale into the body or referenced context assets. |
| `META-LIST-ITEM-TOO-LONG` | A block-list metadata item is too long to serve as concise routing/index metadata. | Keep the list item short and move detailed conditions into body sections. |
| `QUAL-INVALID-TOKEN-BUDGET-OVERRIDE` | Support-asset token-budget decision metadata is invalid or ambiguous. | Correct or remove it after an explicit user decision; invalid metadata leaves the default content limit active. |

These diagnostics are intentionally advisory. They should help reduce LLM-facing catalog noise and token usage without deleting substantive knowledge.
