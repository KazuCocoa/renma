# Context Lens Assets

`context_lens` is Renma's asset kind for purpose-specific interpretation of one
or more declared Context Assets. Use a Lens when the same reusable knowledge
needs to be read with different questions, risks, evidence priorities, or
output expectations for a particular purpose.

A Lens requires Context to interpret. Do not create a Context Lens when there
is no Context Asset to put in `applies_to`.

The governing model is:

```text
Skill = focused task and workflow
Context Asset = durable reusable knowledge
Context Lens = purpose-specific interpretation of Context
```

The design principles remain:

```text
Knowledge should be reusable.
Interpretation should be purpose-oriented.
Execution should be skill-specific.
```

A Lens should make an interpretation reproducible enough that another reviewer
or LLM can identify the same questions, risks, evidence, and expected output.
Renma can validate the declared structure and relationships, but it cannot
deterministically prove that this semantic guidance is professionally sound.

See
[`examples/context-lens`](https://github.com/KazuCocoa/renma/tree/main/examples/context-lens)
for a runnable fixture
with two valid Lenses, a complete focused workflow, and zero scan findings.

## The Problem A Lens Solves

A reusable Context Asset may support several purposes. For example, payment
retry rules can be interpreted for:

- specification review, emphasizing ambiguity and missing sources of truth;
- test design, emphasizing boundary values and expected results; or
- failure analysis, emphasizing observed symptoms and logs.

The base facts should not be copied into three Skills. Each Lens records one
purpose-specific way of reading the same facts, while each Skill retains its
focused task and workflow.

Use a direct relationship when no separate interpretation is needed:

```text
Skill -> Context Asset
```

Use a Lens only when purpose-specific interpretation adds meaningful reusable
structure:

```text
Skill -> Context Lens -> Context Asset
```

These are static repository relationships, not a runtime loading pipeline.

## Placement Decision

Before creating an asset, apply this sequence:

1. Is this the task, workflow, or completion contract? Put it in the Skill.
2. Is this durable, reusable, source-backed knowledge? Create or reuse a
   Context Asset.
3. Does declared Context need to be interpreted differently for a specific
   purpose? Create a Context Lens.
4. Is this a Skill-local overlay or execution variant? Use a Profile if the
   current Profile semantics fit.
5. Is this supporting detail used by only one Skill? Use a Reference.
6. Is this a local fixture or demonstration? Use an Example.
7. Is this only generic persona or tone framing? Usually keep it local; do not
   create an asset solely for the persona.

If review criteria apply only to one workflow and do not interpret reusable
Context, keep them in the Skill body, a Skill-local Reference, or a Skill-local
Profile when they genuinely form an overlay or variant.

## Lens Fields And Body

Prefer compact, flat frontmatter. Detailed interpretation belongs in the
Markdown body rather than turning metadata into a prompt template.

- `id`: required stable Lens ID. Prefer a `lens.<domain>.<purpose>` style.
- `type`: recommended `context_lens` discriminator. It is optional under
  `lenses/**` and required when a Lens is stored under `context/**` or
  `contexts/**`.
- `owner`: required accountable owner.
- `status`: optional lifecycle state: `experimental`, `stable`, `deprecated`,
  or `archived`.
- `version`: optional schema version. The supported Lens schema version is `1`.
- `scope`: optional scope. The supported value is `context`.
- `purpose`: required short label for why the Context is being interpreted,
  such as `spec_review`, `test_design`, or `failure_analysis`.
- `applies_to`: required list of existing Context Asset IDs or
  repository-relative paths. These are the assets the Lens interprets.
- `focus`: optional compact list of questions, risks, checks, or evidence themes
  to emphasize.
- `expected_outputs`: optional compact list of outputs the interpretation should
  shape.

The Markdown body should explain how to apply those fields. It may provide a
brief professional framing, then should define concrete interpretation
questions, important risks, evidence expectations, prioritization rules, and
the expected output. It should not copy the Context or take over the Skill's
ordered workflow and completion contract.

Deprecated aliases such as `target`, `targets`, `output`, and `outputs` produce
warnings. Use `applies_to` and `expected_outputs`.

## Minimal Structural Example

A minimal valid Lens declares a stable ID, owner, purpose, and at least one real
`applies_to` target:

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

Review the boundary-value Context for ambiguity, missing limits, and unclear
sources of truth. Cite the specification evidence behind each finding.
```

This is structurally valid only when the target resolves to a Context Asset. It
is useful only if the body makes the purpose-specific interpretation concrete
enough for review.

## Persona Framing Is Not A Lens

A persona may frame a Lens, but a persona alone does not define one.

Do not create a Lens that says only “Act as a senior QA engineer.” Describe the
concrete questions, risks, checks, evidence, and expected outputs that the
professional perspective implies.

### Insufficient Lens

```markdown
# Senior QA Engineer Lens

Act as a senior QA engineer.
```

This is insufficient because it:

- does not identify what Context is being interpreted;
- does not define a useful purpose;
- does not identify review questions or risks;
- does not say what evidence should be emphasized;
- does not define an expected output; and
- can become generic prompt-role wording rather than a reusable interpretation
  asset.

### Better Lens

The following Context Asset and Lens use repository-defined example IDs. They
are not built into Renma. An author must create or identify the real Context
Asset before declaring it in `applies_to`.

The complete responsibility chain is:

```text
Context Asset -> reusable test-quality knowledge
Context Lens  -> test-code-review interpretation criteria
Skill         -> review task and output contract
```

#### Example Context Asset

```yaml
---
id: context.testing.test-quality
owner: qa-platform
status: stable
when_to_use:
  - Reviewing automated test design or implementation quality
when_not_to_use:
  - Reviewing application behavior without test-quality concerns
---
# Test Quality

Reliable automated tests trace assertions to intended requirements, avoid
false confidence, behave deterministically, isolate unrelated state, and emit
failure evidence that helps distinguish product defects from test defects.
```

This Context Asset owns the reusable test-quality knowledge. A Skill may use it
directly, or use the following Lens when test-code-review interpretation adds
reusable structure.

#### Context Lens Over The Example Asset

```yaml
---
id: lens.testing.test-code-review.quality
type: context_lens
owner: qa-platform
status: experimental
purpose: test_code_review
applies_to:
  - context.testing.test-quality
focus:
  - requirement coverage
  - false-positive and false-negative risk
  - determinism
  - test isolation
  - failure diagnosability
expected_outputs:
  - prioritized findings
  - evidence-backed rationale
  - recommended corrections
---
# Test Code Review Quality Lens

Evaluate the applied test-quality Context from the perspective of an
experienced QA engineer responsible for release confidence.

## Interpretation Criteria

- Determine whether each test verifies the intended requirement rather than
  merely exercising code.
- Identify assertions or missing checks that can produce false confidence,
  false positives, or false negatives.
- Examine whether timing and synchronization assumptions are deterministic.
- Check whether tests are isolated from unrelated state and ordering.
- Distinguish product defects from test implementation defects when analyzing
  failures.
- Prefer failure output that identifies the violated requirement and likely
  underlying cause.

## Evidence And Output

Cite relevant code, requirements, repository guidance, or observed failure
evidence. Produce prioritized findings with rationale and recommended
corrections; keep unresolved assumptions explicit.
```

The framing sentence is optional. The concrete criteria and evidence contract
are what make the Lens useful.

The important boundary is:

```text
Skill defines the review task.
Lens defines what purpose-specific review judgment means when interpreting Context.
```

## How A Lens Differs From Adjacent Assets

| Asset or responsibility | What it owns |
| --- | --- |
| Skill | Focused task or workflow: activation boundaries, inputs, ordered instructions, decisions, constraints, verification, output, and completion criteria |
| Context Asset | Durable, reusable, source-backed knowledge with independent ownership and lifecycle |
| Context Lens | Purpose-specific interpretation of one or more declared Context Assets |
| Profile | Skill-local overlay or variant when current Profile semantics fit |
| Reference | Supporting detail owned and loaded by one Skill |
| Example | Skill-local example, fixture, or demonstration |
| External agent or runtime | Live asset selection, loading or injection, prompt assembly, tool execution, and application of the finished workflow |

A schema-valid Lens can still be semantically weak. Renma can prove that an ID,
owner, purpose, and `applies_to` relationship to a Context Asset exist. It
cannot prove that vague focus words, generic persona language, or an
underspecified body capture useful professional judgment. That quality remains
an authoring and human-review responsibility; Renma does not call an LLM or add
subjective Lens scores.

## Canonical Skill Relationships

A canonical Agent Skills `SKILL.md` declares Renma relationships as flat,
string-valued `metadata.renma.*` fields. List values are JSON-array strings:

```yaml
---
name: spec-review
description: Review specifications for ambiguity and missing boundaries. Use when requirements need evidence-backed review before implementation.
metadata:
  renma.id: skill.testing.spec-review
  renma.owner: qa-platform
  renma.status: experimental
  renma.requires-context: '["context.testing.boundary-value-analysis"]'
  renma.requires-lens: '["lens.testing.spec-review.boundary-values"]'
  renma.optional-lens: '[]'
---
```

Do not use pre-0.16 top-level Skill metadata in current examples. The
`metadata.renma.*` relationships create catalog and graph evidence; they do not
make Renma select a Lens, load Context, or inject either into an agent.

## Runtime Responsibility Boundary

Renma catalogs and validates repository assets. An external agent or runtime:

- selects relevant assets for a live task;
- loads or injects Context and Lens content;
- assembles prompts;
- executes tools and the focused Skill workflow; and
- applies or presents the result.

Renma does not select or rank Lenses, assemble prompts, inject Context, execute
a Skill, infer semantic intent, or use an LLM to judge Lens quality.

```text
LLM proposes. Renma verifies. Human approves.
```

## Diagnostics, Readiness, And Inspect

Context Lens governance diagnostics use stable string codes in `scan` and
`readiness`. Blocking `error` diagnostics include missing required fields,
duplicate Lens IDs, unresolved `applies_to` targets, and resolved targets that
are not Context Assets. Warnings are reported for review but do not fail
readiness unless another policy makes the repository not ready.

For example, this invalid definition is missing `purpose`, uses a path that
normalizes differently, and targets no cataloged asset:

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

- `CONTEXT-LENS-MISSING-REQUIRED-FIELD`;
- `CONTEXT-LENS-PATH-NORMALIZATION-MISMATCH`; and
- `CONTEXT-LENS-TARGET-NOT-FOUND`.

`renma readiness --json` exposes Lens counts and diagnostics under
`summary.contextLens`; Markdown readiness includes a `Context Lens` section.
`renma inspect <file> --format text` shows the definition paths, targets, and
static graph neighborhood. These views report repository evidence, not runtime
use.

Context Lenses support the same explicit freshness metadata as Skills and
Context Assets: `last_reviewed_at`, `review_cycle`, and `expires_at`. Scan uses
the existing `MAINT-ASSET-REVIEW-OVERDUE` and `MAINT-ASSET-EXPIRED` identifiers;
missing optional freshness metadata is not itself a finding.

A focused Declared Composition view follows a required or optional Lens to its
`applies_to` Context. The Context is required when the Lens route is required
and optional when the route is optional. Wrong-kind `applies_to` targets are
separate from unknown targets and make that route's composition incomplete.

```bash
renma graph . --view composition \
  --focus skill.testing.spec-review \
  --format markdown
```

This projection retains each Lens and Context stable ID plus line-level
declaration provenance. It does not select a Lens, load Context, or assemble a
runtime prompt.

## Authoring And Verification

Use `scaffold` for a starter, then replace every placeholder with
repository-grounded values:

```bash
renma scaffold context_lens lenses/testing/spec-review-boundary-values.md \
  --id lens.testing.spec-review.boundary-values \
  --title "Spec Review Boundary Values Lens" \
  --owner qa-platform \
  --tags testing,spec-review
```

Before review:

1. Replace `purpose`, every `applies_to` target, `focus`, and
   `expected_outputs`.
2. Confirm that each target is an existing Context Asset and that the Lens adds
   meaningful interpretation rather than copying it.
3. Keep the focused workflow in the Skill and reusable knowledge in Context.
4. Replace persona-only wording with concrete criteria, evidence expectations,
   and outputs.
5. Run:

```bash
renma scan . --fail-on high
renma catalog . --format markdown
renma graph . --view layered --format mermaid
renma readiness . --format markdown
```

The final semantic decision belongs to a human reviewer.

## Zero-Context Classification Self-Check

An unfamiliar author or LLM should classify these cases as follows:

1. Payment retry rules and retry limits → **Context Asset**, because they are
   durable domain knowledge that may support several workflows.
2. Review a test implementation and produce prioritized findings → **Skill**,
   because this is the focused task and output contract.
3. Emphasize false-confidence risk, determinism, isolation, and diagnosability
   while interpreting shared test-quality guidance → **Context Lens**, because
   it defines purpose-specific interpretation of declared reusable Context.
4. “Act as a senior QA engineer” → **insufficient by itself**; it may be brief
   local framing, but it does not define concrete interpretation criteria.
5. A strict Skill-local review variant → **Profile**, when the current Profile
   overlay semantics fit.
6. Detailed framework-specific notes used only by one review Skill →
   **Reference**, because the detail is locally owned and loaded.
7. Select the most relevant Lens dynamically for the current task → **external
   agent or runtime**, because Renma core and Lens assets do not perform live
   selection.

## Current Non-Goals

Renma does not implement:

- runtime Lens or Context selection;
- prompt assembly or Context injection;
- Skill or tool execution;
- automatic semantic inference;
- automatic LLM judgment or subjective Lens scoring; or
- external runtime signal imports from agents, IDEs, or similar tools.

Context Lens support remains deterministic repository governance: discovery,
metadata and relationship validation, diagnostics, readiness, inspect, graph,
documentation, and examples.
