# Metadata Budget Guidance

Renma intentionally keeps asset frontmatter small. Frontmatter should work as a deterministic index for cataloging, graph checks, readiness checks, and security diagnostics. It should not become a second copy of the asset body.

Use frontmatter for concise fields such as `id`, `owner`, `status`, `tags`, `when_to_use`, `when_not_to_use`, and declared context relationships. Put detailed guidance, examples, procedures, policy rationale, and long routing prose in the markdown body or in referenced context assets.

Current metadata budget diagnostics:

| Finding | Meaning | Typical fix |
| --- | --- | --- |
| `META-FRONTMATTER-TOO-LARGE` | Frontmatter has grown beyond the compact index budget. | Move long prose, examples, procedures, or rationale into the body or referenced context assets. |
| `META-LIST-ITEM-TOO-LONG` | A block-list metadata item is too long to serve as concise routing/index metadata. | Keep the list item short and move detailed conditions into body sections. |

These diagnostics are intentionally advisory. They should help reduce LLM-facing catalog noise and token usage without deleting substantive knowledge.
