# Static Asset Dependencies

Use static asset dependency views when a Skill or Context depends on support
files as well as other Renma assets:

```bash
renma graph . --view dependencies --focus skill.release --format mermaid
renma graph . --view asset-impact --focus skills/git/scripts/create-tag.mjs --format markdown
```

Both views require `--focus`. JSON, Markdown, and Mermaid use the same finite,
cycle-safe closure. Focus accepts an exact asset ID or source path; an ambiguous
ID requires an exact path. JSON retains `renma.graph.v1` and adds
`dependencyTraversal.focusPath` and `dependencyTraversal.direction` only for
these views. Nodes retain content hashes and ownership evidence. Edges retain
kind, source path, declaration/binding evidence, and static reference location.

## Relationships

The closure follows valid explicit composition (`requires`, `optional`, and
`applies_to`) and `statically_references` support edges. It includes optional
composition without claiming every referenced file is required at runtime.
`dependencies` traverses outgoing edges; `asset-impact` traverses incoming
edges and preserves their original direction.

For example, a Skill can declare another Skill:

```yaml
---
name: release
description: Prepare a release.
metadata:
  renma.id: skill.release
  renma.requires-skill: '["skill.git"]'
---
```

The helper Skill can refer to its script in its body:

```markdown
Run `scripts/create-tag.mjs`.
```

The dependency view then includes `skill.release → skill.git →
skills/git/scripts/create-tag.mjs`. Changing the script makes both Skills
visible in `asset-impact`, provided the static references exist.

Containment alone does not create this closure. An unused file in the same
`scripts/` directory is inventory, not evidence that its owning Skill uses it.
Ownership, policy inheritance, conflicts, general references, Discovery
continuations, and lifecycle relationships are excluded from traversal.
Existing `composition` and `impact` views continue to follow only explicit
composition.

## Context and cross-distribution references

No additional dependency metadata is required. Markdown bodies can name
cataloged support files with links, quoted paths, or the existing bounded
helper-command grammar. For a Context at `contexts/release/policy.md`:

```markdown
Read [the script guide](../../skills/git/references/tagging.md).
Use `skills/git/assets/tag-format.json`.
Run `node skills/git/scripts/create-tag.mjs`.
```

New cross-distribution Markdown references resolve exact relative paths from
the source document's directory. Paths beginning with `skills/`,
`.agents/skills/`, `contexts/`, or `lenses/` are repository-relative. Helper
commands retain the existing helper path-resolution grammar. Existing
Skill-local support references retain their Skill-relative and unique-basename
resolution behavior.

Cross-distribution resolution never guesses a repository-wide basename. It
rejects URLs, absolute paths, repository escapes, dynamic paths, directory
selectors, and globs. Only discovered, cataloged support targets (`script`,
`asset`, `reference`, `profile`, or `example`) become new static edges. It does
not discover additional files, fetch dependencies, install packages, or inspect
excluded, missing, unreadable, or noncataloged targets. Files outside existing
catalog boundaries, such as repository `tools/` executables, remain available
through the separate `executable` view.

The shared catalog emits these resolved support edges once, so full graph,
BOM dependency/dependent rows, and Trust Graph also retain them. Adding a
Context reference does not transfer ownership or policy from that Context to
the target, and does not expand the Skill-local security inspection boundary.

## Interpretation

Static edges are evidence of references, not proof of runtime reads or script
execution. Reverse closure is change-review scope, not guaranteed breakage.
Unresolved composition remains visible in the forward view, but only uniquely
resolved, kind-correct targets are expanded. Missing support references do not
create speculative nodes. A closure is not a complete inventory or an assurance
that every runtime dependency was captured.

This feature does not introduce a language import resolver. Use
[`graph --view executable`](user-manual.md#inspect-executable-relationships)
for the existing canonical script invocation and script dependency topology.
