# Context Lens Assets

`context_lens` is a Renma asset type for purpose-oriented interpretation over reusable context assets.

It keeps the Renma core boundary intact:

```text
LLM proposes. Renma verifies. Human approves.
```

Renma catalogs and validates repository assets. Agents and tools decide what to do at runtime.

Renma does not select lenses for a task, rank lenses, assemble prompts, inject context, or run an LLM to judge lens quality.

## Model

```text
references -> contexts -> context_lenses -> skills
```

The design principle is:

```text
Knowledge should be reusable.
Interpretation should be purpose-oriented.
Execution should be skill-specific.
```

Use this split when the same base context should be read differently for different purposes.

For example, a payment retry context can support:

- a spec review lens that focuses on ambiguity and source-of-truth gaps
- a test design lens that focuses on boundary values and expected results
- a failure analysis lens that focuses on observed symptoms and logs

The base context remains reusable. The lens explains how that context should be interpreted for a purpose.

See [`examples/context-lens`](../examples/context-lens) for a runnable fixture with two valid lenses, readiness output, inspect output, and an invalid diagnostic example.

## Minimal Valid Lens

A minimal valid lens declares a stable ID, owner, purpose, and at least one `applies_to` target.

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

Review the boundary value analysis context for ambiguity, missing limits, and unclear sources of truth.
```

`type: context_lens` is optional for files under `lenses/**`, but it is recommended because it makes the file's intent obvious in code review. It is required when a lens is stored under `context/**` or `contexts/**`.

## Multiple Lenses

Multiple lenses can interpret the same base context for different review purposes:

```yaml
---
id: lens.testing.spec-review.boundary-values
type: context_lens
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
focus:
  - ambiguity
  - missing boundary
expected_outputs:
  - unresolved questions
  - risk notes
---
```

```yaml
---
id: lens.testing.test-design.boundary-values
type: context_lens
owner: qa-platform
status: experimental
purpose: test_design
applies_to:
  - context.testing.boundary-value-analysis
focus:
  - inclusive limits
  - zero and empty values
  - overflow behavior
expected_outputs:
  - test cases
  - edge-case checklist
---
```

A skill declares static lens relationships with `requires_lens` or `optional_lens`:

```yaml
---
id: skill.testing.spec-review
owner: qa-platform
status: experimental
requires_context:
  - context.testing.boundary-value-analysis
requires_lens:
  - lens.testing.spec-review.boundary-values
---
```

These fields create catalog and graph relationships. They do not make Renma choose runtime context or inject the lens into an agent.

## Supported Fields

Prefer compact, flat metadata. Detailed interpretation guidance belongs in the Markdown body, not in frontmatter.

- `id`: required stable lens ID. Prefer the `lens.<domain>.<purpose>` prefix style.
- `type`: recommended `context_lens` discriminator.
- `owner`: required accountable owner.
- `status`: optional lifecycle status: `experimental`, `stable`, `deprecated`, or `archived`.
- `version`: optional lens schema version. The 0.12.0 governance checks support `version: 1`.
- `scope`: optional lens scope. The 0.12.0 governance checks support `scope: context`.
- `purpose`: required short purpose label such as `spec_review`, `test_design`, or `failure_analysis`.
- `applies_to`: required context asset IDs or repository-relative paths this lens interprets.
- `focus`: optional compact review focus terms.
- `expected_outputs`: optional compact output expectations.

Deprecated field aliases such as `target`, `targets`, `output`, and `outputs` produce warnings. Use `applies_to` and `expected_outputs`.

## Diagnostics

Context Lens governance diagnostics use stable string codes in JSON output. The detailed diagnostics appear in `scan` and `readiness`; concise summaries appear in `readiness` and `inspect`.

Invalid example:

```yaml
---
id: lens.testing.spec-review.boundary-values
owner: qa-platform
applies_to:
  - ./contexts/testing/missing.md
---
# Spec Review Lens
```

Expected diagnostics include:

- `CONTEXT-LENS-MISSING-REQUIRED-FIELD` because `purpose` is missing.
- `CONTEXT-LENS-PATH-NORMALIZATION-MISMATCH` because `./contexts/testing/missing.md` normalizes to `contexts/testing/missing.md`.
- `CONTEXT-LENS-TARGET-NOT-FOUND` because the target path does not resolve to a cataloged asset.

Blocking Context Lens diagnostics are `error` diagnostics. Warnings are reported by default but do not fail readiness unless another policy makes the repository not ready.

## Readiness And Inspect

`renma readiness --json` includes an additive `summary.contextLens` object:

```json
{
  "summary": {
    "contextLens": {
      "enabled": true,
      "detected": true,
      "totalLensCount": 2,
      "validLensCount": 2,
      "invalidLensCount": 0,
      "diagnosticCounts": {
        "error": 0,
        "warning": 0,
        "info": 0
      }
    }
  }
}
```

Markdown readiness includes a `Context Lens` section with lens counts, diagnostic counts, a representative diagnostic code, definition paths, and target references.

`renma inspect <file> --format text` includes a concise Context Lens summary:

```text
Context Lens:
- Enabled: yes
- Detected: yes
- Lenses: 2/2 valid (0 invalid)
- Diagnostics: error 0, warning 0, info 0
- Representative diagnostic: (none)
- Definition paths: lenses/testing/spec-review-boundary-values.md, lenses/testing/test-design-boundary-values.md
- Target references: context.testing.boundary-value-analysis
```

`renma inspect <file> --format json` includes the same additive `contextLens` summary object.

## CI Usage

Use readiness in CI when Context Lens governance should block merges:

```bash
renma readiness . --json
```

The command exits `1` when readiness is not ready, including when blocking Context Lens diagnostics are present.

For pull-request review artifacts, `renma ci-report` continues to report deterministic catalog, graph, readiness, finding, and security deltas. It does not call an LLM or make subjective lens-quality judgments.

## Authoring Helpers

Use `scaffold` to create a compact starter lens:

```bash
renma scaffold context_lens lenses/testing/spec-review-boundary-values.md \
  --id lens.testing.spec-review.boundary-values \
  --title "Spec Review Boundary Values Lens" \
  --owner qa-platform \
  --tags testing,spec-review
```

Use `inspect` on a lens to review its purpose metadata and declared graph neighborhood. Lens inspection shows inbound skill references, outbound `applies_to` context targets, and the static `skill -> lens -> context` chain.

## Good Lens Boundaries

A lens should answer:

- What purpose is this context being read for?
- Which context assets does it apply to?
- What questions, risks, checks, or evidence should be emphasized?
- What output shape should the agent or human reviewer produce?

A lens should not become:

- a copy of the base context
- a long prompt template
- a runtime routing rule
- a QA-specific rule hardcoded into Renma core
- a replacement for the skill entrypoint

## Non-Goals For 0.12.0

Renma 0.12.0 intentionally does not implement:

- runtime selection
- prompt assembly
- context injection
- automatic LLM judgment or subjective scoring
- external signal imports from Codex, Claude, IDEs, or similar tools

The release stabilizes deterministic Context Lens governance: summary output, diagnostics, readiness integration, inspect integration, docs, and examples.
