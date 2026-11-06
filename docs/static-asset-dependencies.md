# Static Asset Dependencies

Use static asset dependency views when a Skill, Context, or Lens depends on support
files as well as other Renma assets:

```bash
renma graph . --view dependencies --focus skill.release --format mermaid
renma graph . --view asset-impact --focus skills/git/scripts/create-tag.mjs --format markdown
```

These views expose file-reference topology for downstream selection and export
consumers; they do not implement export. The existing `full` graph separately
exposes `owns_local_resource` for cataloged Skill-local distribution contents
and scripts belonging to a uniquely resolved Context/Lens package README.
A consumer can combine that inventory with reference closure when it needs all
supported files belonging to a selected Skill.

Both views require `--focus`. JSON, Markdown, and Mermaid use the same finite,
cycle-safe closure. Focus accepts an exact asset ID or source path; an ambiguous
ID requires an exact path. JSON retains `renma.graph.v1` and adds
`dependencyTraversal.focusPath` and `dependencyTraversal.direction` only for
these views. Nodes retain content hashes and ownership evidence. Edges retain
kind, source path, declaration/binding evidence, and static reference location.
When the same source refers to a support target more than once, the shared
catalog retains the earliest detected reference as representative evidence.

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

## Context, Lens, and cross-distribution references

No additional dependency metadata is required. Markdown bodies can name
cataloged support files with links, quoted paths, or the existing bounded
helper-command grammar. For a Context at `contexts/release/policy.md`:

```markdown
Read [the script guide](../../skills/git/references/tagging.md).
Use `skills/git/assets/tag-format.json`.
Run `node skills/git/scripts/create-tag.mjs`.

[Local validator](scripts/validate.py)

Run: `python scripts/validate.py`
```

New cross-distribution Markdown references resolve exact relative paths from
the source document's directory. Paths beginning with `skills/`,
`.agents/skills/`, `contexts/`, or `lenses/` are repository-relative. Helper
commands in Contexts/Lenses resolve relative paths from their source document,
while explicit repository-root helper paths retain their existing meaning. Existing
Skill-local support references retain their Skill-relative and unique-basename
resolution behavior.

Cross-distribution resolution never guesses a repository-wide basename. It
rejects URLs, absolute paths, repository escapes, dynamic paths, directory
selectors, and globs. Only discovered, cataloged support targets (`script`,
`asset`, `reference`, `profile`, or `example`) become new static edges. It does
not fetch dependencies or install packages. Supported executable files under
`contexts/**` and `lenses/**` are discovered by default. An exact reference to
one of these scripts can also make that individual file inspectable under narrow
discovery globs; exclusions, depth/size limits, and symlink safety still apply.
Directory references never admit their children. Excluded, missing, unreadable,
or noncataloged targets do not become resolved edges. Files outside existing
catalog boundaries, such as repository `tools/` executables, remain available
through the separate `executable` view.

The shared catalog emits these resolved support edges once, so full graph,
BOM dependency/dependent rows, and Trust Graph also retain them. Adding a
Context reference does not transfer ownership or policy from that Context to
the target, and does not expand the Skill-local security inspection boundary.

## Context/Lens script parents

For `contexts/<package>/scripts/**` and `lenses/<package>/scripts/**`, the
structural parent candidate is `<package>/README.md`. Supported executable
files immediately alongside that README have the same parent. `<package>`
may contain multiple directory segments. A deeper directory outside `scripts/`
needs its own README; Renma does not search ancestors for a replacement parent.

Inheritance requires exactly one discovered, parser-eligible Context or Lens
README in that directory. README filename case variants count as candidates;
multiple candidates are ambiguous. Missing, excluded, unreadable, or otherwise
uninspected parents do not supply governance. Other Markdown filenames and
README files inside `scripts/` do not establish a parent. Root-level
`contexts/scripts/**` and `lenses/scripts/**` remain shared scripts even if a
root README exists.

Scripts inherit the parent's declared owner when present and its effective
security policy independently. They retain their `script` kind and
`repository-script` scope. The full graph exposes `owns_local_resource`,
`inherits_owner` (when an owner was inherited), and `inherits_policy`; the
executable graph exposes structural `contains` edges. An unused script still
belongs to the package. These edges do not make it part of reference closure.

Parent reachability follows exact references from the README through discovered
local Markdown documents, with minimum hop counts and cycle protection. It
does not cross into another README package, follow references from outside the
package, or interpret script imports as Markdown references. Executable import
reachability remains separately reported. Unreachable scripts, absent reachable
script-reference guidance, and deep reference chains produce the existing
`SUPPORT-UNREACHABLE-SCRIPT`, `SUPPORT-MISSING-REACHABILITY-GUIDANCE`, and
`SUPPORT-DEEP-REFERENCE-CHAIN` diagnostics. Missing parents are exposed as
resolution evidence; they do not by themselves require a README for shared
scripts.

## Interpretation

Static edges are evidence of references, not proof of runtime reads or script
execution. Reverse closure is change-review scope, not guaranteed breakage.
Unresolved composition remains visible in the forward view, but only uniquely
resolved, kind-correct targets are expanded. Missing support references do not
create speculative nodes. A closure is not a complete inventory or an assurance
that every runtime dependency was captured.

A script's own packages, imports, and portable environment are the responsibility
of its language and packaging tools (for example, Python tooling), rather than
Renma. This feature does not introduce a language import resolver. Use
[`graph --view executable`](user-manual.md#inspect-executable-relationships)
for the existing canonical script invocation and script dependency topology.
