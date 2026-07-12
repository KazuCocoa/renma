# Context Lens Example

This current example demonstrates how Context Lenses give different workflows
purpose-specific interpretations of the same governed Context Asset.

It includes:

- one reusable Context Asset:
  [`contexts/testing/boundary-value-analysis.md`](contexts/testing/boundary-value-analysis.md);
- two valid Lenses over that Context:
  [`spec-review-boundary-values.md`](lenses/testing/spec-review-boundary-values.md)
  and
  [`test-design-boundary-values.md`](lenses/testing/test-design-boundary-values.md);
- one canonical nested Agent Skills-compatible
  [`SKILL.md`](skills/testing/spec-review/SKILL.md) with static required and
  optional Lens relationships.

The Skill is a thin routing and workflow layer. The Context Asset owns reusable
boundary-value knowledge. Each Lens explains how to apply that knowledge for a
particular purpose without copying it into the Skill.

```text
Skill -> Context Lens -> Context Asset
```

These are static repository relationships. Renma validates their definitions,
metadata, resolution, and repository health. The consuming agent reads and
applies the declared Context and Lens; Renma does not choose a runtime Lens,
assemble prompts, inject Context, execute the workflow, or judge Lens quality
with an LLM. A human reviews the result.

```text
LLM proposes. Renma verifies. Human approves.
```

## Inspect The Example

From the Renma repository root after building the CLI:

```bash
node dist/index.js scan examples/context-lens --fail-on high
node dist/index.js catalog examples/context-lens --format markdown
node dist/index.js readiness examples/context-lens --format markdown
node dist/index.js inspect examples/context-lens/lenses/testing/spec-review-boundary-values.md --format text
node dist/index.js graph examples/context-lens --view layered --format mermaid
```

The expected result is one valid nested Skill, two valid Context Lenses, one
governed Context Asset, resolved Skill-to-Lens-to-Context relationships, zero
scan findings, and readiness level `ready` with score 100. Readiness includes a
`Context Lens` summary; JSON output exposes the same evidence under
`summary.contextLens`.

## Minimal Valid Lens

```yaml
---
id: lens.testing.spec-review.boundary-values
type: context_lens
owner: qa-platform
status: experimental
version: 1
scope: context
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Lens for Boundary Values

Review the boundary-value Context for ambiguity and missing limits.
```

The supported Lens schema version is `1`; the supported scope is `context`.

## Diagnostic Illustration

The following illustration is intentionally not stored as a scanned fixture:

```yaml
---
id: lens.testing.invalid
owner: qa-platform
applies_to:
  - ./contexts/testing/missing.md
---
# Invalid Lens
```

It would produce:

- `CONTEXT-LENS-MISSING-REQUIRED-FIELD` for the missing `purpose`;
- `CONTEXT-LENS-PATH-NORMALIZATION-MISMATCH` for the `./` path prefix; and
- `CONTEXT-LENS-TARGET-NOT-FOUND` because the target does not resolve.

Use readiness as the blocking CI view for Context Lens governance:

```bash
renma readiness examples/context-lens --json
```

Blocking Context Lens diagnostics make that command exit `1`.
