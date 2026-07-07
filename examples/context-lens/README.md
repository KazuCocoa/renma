# Context Lens Example

This fixture demonstrates Context Lens governance for Renma 0.12.0.

It includes:

- one reusable context asset: `contexts/testing/boundary-value-analysis.md`
- two valid lenses over that context:
  - `lenses/testing/spec-review-boundary-values.md`
  - `lenses/testing/test-design-boundary-values.md`
- one skill that declares static `requires_lens` and `optional_lens` relationships

The boundary is:

```text
LLM proposes. Renma verifies. Human approves.
```

Renma verifies the definitions and relationships. It does not choose a runtime lens, assemble prompts, inject context, or judge lens quality with an LLM.

## Try It

```bash
renma readiness examples/context-lens --format markdown
renma readiness examples/context-lens --format json
renma inspect examples/context-lens/lenses/testing/spec-review-boundary-values.md --format text
renma graph examples/context-lens --view lens --format mermaid
```

Readiness includes a `Context Lens` summary. JSON output includes `summary.contextLens`; inspect JSON includes an additive `contextLens` summary.

## Minimal Valid Lens

```yaml
---
id: lens.testing.spec-review.boundary-values
type: context_lens
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Lens for Boundary Values

Review the boundary value analysis context for ambiguity and missing limits.
```

## Invalid Example

```yaml
---
id: lens.testing.invalid
owner: qa-platform
applies_to:
  - ./contexts/testing/missing.md
---
# Invalid Lens
```

Expected diagnostics:

- `CONTEXT-LENS-MISSING-REQUIRED-FIELD` for the missing `purpose`.
- `CONTEXT-LENS-PATH-NORMALIZATION-MISMATCH` for the `./` path prefix.
- `CONTEXT-LENS-TARGET-NOT-FOUND` because the target does not resolve.

## CI Use

Use readiness as the blocking CI command for Context Lens governance:

```bash
renma readiness examples/context-lens --json
```

The command exits `1` when blocking Context Lens diagnostics are present.
