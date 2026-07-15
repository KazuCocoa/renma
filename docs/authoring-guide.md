# Renma Authoring Guide

This is the canonical guide for placing, authoring, and improving Skills,
Context Assets, Context Lenses, and Skill-local support in a Renma repository.

## Responsibility Boundary

For a new Skill, or when intentionally redesigning asset boundaries, start with
`renma guide skill`. Renma first establishes:

- the smallest non-redundant asset graph;
- Skill, Context, Context Lens, Reference, Script, and Example responsibilities;
- canonical metadata and Agent Skills compatibility;
- Context placement and source-of-truth representation;
- file and resource boundaries;
- dependency and graph validation;
- ownership and lifecycle governance;
- security policy validation;
- workflow clarity diagnostics; and
- repository-wide scan and readiness evidence.

After the clarification gate and those boundaries are established,
platform-native Skill authoring guidance may refine the name and trigger
description, usage and exclusion boundaries, instructions, workflow,
constraints, completion criteria, and examples that resolve real ambiguity. It
is not the authority for Renma metadata, Context placement, repository asset
boundaries, file count, source-of-truth representation, or whether scripts and
support files should exist.

A name change that affects the canonical Skill directory/name relationship is
an intentional path and identity change, not an ordinary semantic rewrite.
Review the move or rename and rerun Agent Skills and Renma validation. Ordinary
maintenance of an existing Skill starts with `renma scan . --fail-on high`.

Renma does not generate domain intent or automatically improve a Skill body.
Human judgment remains required for semantics, ownership, policy, dependencies,
and source authority. The central principle is:

> Create the smallest non-redundant Renma asset graph that preserves execution
> clarity and traceability.

## Interactive Clarification Protocol

`renma guide skill` remains deterministic and non-interactive. It prints the
protocol; the consuming LLM conducts the conversation and investigates
applicable evidence, the user supplies domain and governance truth, Renma
supplies deterministic rules and repository evidence, and a human approves
meaningful decisions. This elaborates—not replaces—the product boundary:
**LLM proposes. Renma verifies. Human approves.** Renma does not accept task
text, ask questions, retain conversation state, interpret answers, or create
assets.

When the user asks to create a Skill, the consuming LLM starts with
clarification instead of file creation:

```text
understand
  -> investigate available evidence
  -> classify epistemic support and progression separately
  -> ask one to three focused questions per batch and retain queued blockers
  -> propose the smallest asset structure
  -> pass the creation gate when no blocker remains
  -> scaffold and author
  -> validate
  -> repair, investigate, ask again, or justify no change
  -> re-enter the creation gate if asset boundaries may change
  -> human review
```

The user does not need to supply a plan-quality specification before this loop
begins. On the first meaningful response, keep the working state compact:

```text
Current understanding

Confirmed
- Facts supported by an applicable truth source.

Proposed
- Reversible structural defaults or justified design suggestions.

Unresolved
- Human truth or missing applicable evidence that must not be invented.

Question
- One to three closely related questions about the highest-impact gap.
```

A proposal never silently becomes confirmed. Explicit user delegation can
confirm authority to choose one reversible default, but it does not establish
unrelated domain facts.

### Progression and question batches

Confirmed, Proposed, and Unresolved describe epistemic support. A separate
progression classification determines whether authoring can proceed:

| Progression | Meaning | Examples |
| --- | --- | --- |
| Blocking | Must be resolved before the current creation gate passes | Unclear task or result, required source authority or product behavior, material security permission, unsafe failure behavior, unjustified Skill-versus-Context boundary, or a missing file-mode owner |
| Reversible default | A safe, easily changed Proposed decision that invents no domain or governance truth and broadens no security permission | No script or Context Lens by default, a tentative directory name, or another minimal choice delegated by the user |
| Deferred | Proposed or Unresolved but not needed at the current stage | Wording, optional examples, final tags, non-blocking edge cases, future reuse, or speculative features |

A reversible default remains Proposed when used. A Deferred decision remains
visible rather than becoming forgotten or implicitly resolved. If later
evidence makes a Deferred decision material to correctness, security,
completion, or asset boundaries, move it to Blocking and re-enter clarification.

Keep the complete current set of unresolved and Blocking decisions. The limit
of one to three closely related questions applies only to the current turn, not
to the total set. Ask about the highest-impact blockers, show additional ones
as queued, update the set after the user answers, and continue with the next
batch without repeating unchanged decisions in full. Never relabel an unasked
blocker as Deferred merely because the batch limit was reached. For example:

```text
Current progression

Blocking decisions: 4
- Asking now: 3 highest-impact questions
- Queued blocker: Context owner

Proceeding with reversible defaults
- No script by default
- No Context Lens by default

Deferred
- Final tags
- Additional examples unless real ambiguity emerges
```

> Proceed when no Blocking decision remains. Reversible defaults and Deferred
> decisions may remain, provided they are visible, safe, and do not conceal
> missing domain or governance truth.

When proceeding, identify the defaults and meaningful deferred items, do not
present either as Confirmed, and do not ask for redundant confirmation after
the user has authorized progress. “Use your judgment” delegates only identified
reversible choices; explain the selected default and do not infer product
behavior, source authority, ownership, security permission, or unrelated facts.

If blockers continue to branch across materially different inputs, outputs,
users, security policies, completion criteria, or workflows, reconsider whether
the request describes one focused Skill. Propose a split or narrower first
Skill, explain the independent responsibilities, keep the boundary Proposed,
ask only if evidence cannot resolve it, and re-enter the gate after the decision.
Do not split automatically because the question count is high.

### Truth sources

| Evidence source | May confirm | Required qualification |
| --- | --- | --- |
| Explicit user statements | Intent, governance decisions, source designation, fallback, and other decisions the user has authority to make | Designating a specification does not prove its contents |
| User-provided artifacts | Facts in supplied documents, specifications, examples, logs, or schemas | Provenance and applicability must be clear; identify the artifact |
| Repository evidence | Applicable and effective repository facts | Evidence must be unambiguous; deprecated, archived, stale, conflicting, unresolved, or diagnostic-blocked evidence is not Confirmed merely because it exists; identify the file, metadata, lifecycle evidence, or command result |
| Reviewed authoritative external source content | Domain facts governed by a user-designated source | The authoring environment must be permitted and able to consult it successfully; identify the source and relevant section or evidence |
| Renma structural rules | Structural constraints and proposed defaults | They do not establish product or domain truth |

A user can confirm that a URL is intended to be authoritative. Its schema,
fields, constraints, and behavior become Confirmed only after the source content
is successfully consulted or supplied through another approved process. A known
URL and model memory are not source-content evidence.

Authoring-time access is separate from finished-Skill runtime access.
Authoring-time consultation depends on the current request, tools, and
environment. Future runtime access instructions must agree with the finished
Skill's effective Renma security policy. Future metadata never retroactively
authorizes the authoring agent. If authoring-time access is unavailable, ask
for the relevant content through an approved process or keep source-dependent
facts Unresolved; do not fill them from memory or plausible assumptions.

Before asking the user, inspect applicable evidence that can answer the current
question. Use only the relevant commands rather than treating every view as
ceremony:

```bash
renma scan . --fail-on high --format json
renma catalog . --format json
renma inspect <relevant-file> --format json
renma graph . --focus <relevant-id-or-path> --format json
```

Ask only about decisions that materially affect the task, inputs, output,
completion or failure behavior, usage boundaries, placement, source authority,
Context necessity, external access, security policy, or support-file
justification. Do not ask the user to choose metadata syntax, repeat known
facts, complete a large questionnaire, or define speculative future features.
Wording, tags, examples, and formatting can be refined later.

For the minimal request:

```text
I want to create a Skill with `renma guide skill`.
```

the expected first response says it ran the guide, confirms only that the user
wants a new Skill under the Renma contract, proposes that no asset structure is
yet justified, leaves the recurring task and expected result unresolved, and
asks what recurring task the Skill should perform and what result it should
produce. It does not invent an owner, Context, script, or metadata.

### Creation gate

Before creating files, establish the focused recurring task, expected result,
meaningful completion or failure behavior, smallest justified asset structure,
source authority, authoring-time consultation, finished-Skill runtime access,
blocking security and domain decisions, and the owner required by file-mode
scaffold unless repository evidence already supplies it. Pause while a
blocking human decision remains unresolved.

The gate does not require a complete plan, every edge case, final prose, all
examples, finalized tags, future capabilities, or perfect certainty about
non-blocking details. Once the gate passes, present the smallest proposed
structure, identify remaining non-blocking proposals, and ask for confirmation
only when a meaningful discretionary boundary remains uncertain. Do not add a
redundant confirmation after the user has already authorized creation.

### Post-validation decisions

Classify each relevant finding before acting:

- **Deterministic repair:** make a bounded correction supported by the
  diagnostic and evidence only when the constraints uniquely determine the
  patch, then rerun relevant validation. Deterministic detection alone is not
  enough.
- **Repository investigation:** inspect ambiguous targets, parents, owners,
  possible Context reuse, or conflicting conventions before asking the user.
- **Human decision required:** ask a focused question when ownership, source
  authority, behavior, permissions, fallback semantics, Context necessity, or
  deliberate script use depends on human truth.
- **No change justified:** explain why the evidence does not support a repair
  or why an advisory reflects reviewed intentional design.

An invalid encoding is deterministic only when its intended supported value is
explicit and unambiguous. A path or ID typo is deterministic only when exactly
one intended existing target is proven. Remove an unsupported field
automatically only when doing so provably loses no intended meaning; otherwise
investigate whether the information belongs in the Skill body, supported
metadata, a Context Asset, or nowhere.

Repeated-context findings are evidence, not automatic consolidation patches.
Do not delete or rewrite content solely because a repeated section, code block,
or context pattern exists. Inspect all occurrences, determine ownership and the
source-of-truth boundary, prepare a consolidation proposal, and require human
review before choosing an authoritative copy, owning asset, Context placement,
or replacement references.

Follow Diagnostics v2 repair constraints and verification steps. Preserve any
explicit prohibition on automatic semantic changes.

If semantic refinement, source review, real usage, or validation reveals a
possible asset-boundary change, stop the structural edit. Record the need as
Proposed or Unresolved, inspect relevant evidence, ask only when human truth
remains necessary, and re-enter the creation gate. Change the agreed files,
metadata, Context relationships, scripts, examples, or support assets only
after the gate passes, then continue authoring and validation.

Never add a suppression automatically, weaken security policy, manufacture
metadata, rewrite semantics merely to clear a finding, or turn a human decision
into a model assumption.

### Reviewed-decision persistence

Persist durable reviewed workflow, boundary, input, output, completion,
Context, authority, fallback, metadata, and security decisions. Do not persist
the conversation transcript, private reasoning, temporary Confirmed / Proposed
/ Unresolved headings, rejected proposals, unanswered questions, speculative
work, or invented decision-state metadata. Report non-blocking uncertainty to
the user instead of hiding it in authoritative prose.

## Focused Workflow Model

A Skill is a focused workflow entrypoint, not a thin router. `SKILL.md` may own
positive and negative selection boundaries, required inputs, preflight checks,
ordered instructions, decisions, short Skill-specific commands, examples,
edge cases, safety constraints, completion criteria, and verification. Renma
does not warn merely because a Skill is procedural or includes an executable
command.

Use Agent Skills progressive disclosure deliberately:

1. Metadata: `name` and `description` let a client decide whether to activate
   the Skill.
2. Instructions: the activated `SKILL.md` carries the focused workflow and
   explicit read or execution conditions.
3. Resources: local files are read or executed only when the workflow calls
   for them.

Choose placement by responsibility, ownership, and reuse—not size alone:

| Content or responsibility | Correct placement | Ownership or reuse test | Common misuse |
| --- | --- | --- | --- |
| Review supplied test code and produce prioritized findings; define selection boundaries, inputs, ordered steps, decisions, constraints, verification, output, and completion | Skill in `SKILL.md` | Required to perform one focused workflow | Reducing the Skill to a thin redirect or moving its task contract into Context |
| Shared rules for reliable automated tests or other durable, source-backed knowledge | Context Asset under `contexts/` | May serve multiple Skills or has an independent owner, lifecycle, separate maintenance, source-of-truth role, or another explicit reason for independent review and governance; source-of-truth status alone is sufficient | Extracting task-specific knowledge merely because it matters to correctness, storing one workflow's transient state as Context, or duplicating independently maintained Context in a local Reference |
| Emphasize determinism, isolation, and false-confidence risk while interpreting declared test-quality Context | Context Lens under `lenses/` | The same Context benefits from reusable purpose-specific interpretation | Creating a Lens with no Context target, copying Context, or storing only a persona or runtime route |
| A stricter review variant for one Skill | Skill-local Profile under `profiles/`, if current Profile semantics fit | An overlay or variant owned and loaded by one Skill | Treating Profiles as generic global personas or a substitute for shared Context |
| Detailed framework-specific review notes used only by one Skill | Skill-local Reference under `references/` | Supporting detail owned and loaded by one Skill | Promoting local detail without evidence of independent reuse or ownership |
| A representative good or bad test implementation | Skill-local Example under `examples/` | A fixture or demonstration owned by one Skill | Hiding required workflow instructions only in an example |
| Deterministic, repeatedly executed implementation | Script under Skill-local `scripts/`, or shared helper under `tools/` | Code is safer and more repeatable than prose; use `tools/` when implementation is shared | Embedding a large executable implementation in prose or treating a script as knowledge |
| Templates, images, data, fonts, PDFs, or output resources | Asset under Skill-local `assets/` | Consumed, copied, or transformed as material rather than read as instructions | Putting workflow or reusable knowledge in an opaque asset |
| Provider-specific UI or presentation metadata | Provider-owned metadata such as `agents/openai.yaml` | Optional interface behavior owned by the consuming provider | Adding provider fields to Renma core metadata |
| Dynamically select a Lens, load or inject Context, assemble prompts, execute tools, or apply the workflow | External agent or runtime | Depends on the live request or execution environment | Encoding runtime behavior in a Lens or claiming Renma performs it |
| “Act as a senior QA engineer” with no concrete criteria | Usually keep as brief local framing; create no asset solely for it | Persona or tone alone has no reusable interpretation contract | Treating generic role wording as a Context Lens |

The canonical defaults and their Agent Skills/Renma provenance are in the
[Quality Profile](quality-profile.md).

## New Skill Workflow

Use this sequence for a new Skill:

```text
renma guide skill
  -> clarify human truth and inspect applicable evidence
  -> pass the creation gate and define the smallest intended asset structure
  -> renma scaffold skill
  -> scaffold or reuse justified Context Assets
  -> complete the focused workflow
  -> renma scan . --fail-on high
  -> classify findings and inspect relevant evidence
  -> re-enter the creation gate if asset boundaries may change
  -> apply uniquely supported repairs and rerun
  -> human review
```

### 1. Establish the authoring contract

Before generating files, run:

```bash
renma guide skill
```

Use its deterministic prompt to define:

- the recurring task or decision;
- the trigger and nearby cases that should not use the Skill;
- required inputs and evidence;
- the ordered workflow and decision points;
- safety and repository constraints; and
- the output and completion criteria;
- every independently maintained Context dependency; and
- the smallest set of files with distinct responsibilities.

The consuming LLM develops this understanding progressively; the user does not
need to supply every section, field, edge case, or file up front. Define the
expected output and completion criteria early. Trigger wording and examples can
be refined after the creation gate unless a usage boundary is itself blocking.
Match implementation freedom to fragility: use prose when judgment is central,
a parameterized script when a stable operation needs flexible inputs, and a
fixed script when ordering or exact behavior is safety-critical.

Do not guess missing owners, policies, dependencies, product behavior, domain
rules, or source-of-truth documents. Record gaps for a human to resolve.

“Improve with Renma” does not mean adding metadata, files, scripts, copied
specifications, or every recommendation from a generic Skill system. Do not
create a generic Skill first and enrich it afterward with Renma-like metadata.
Construct the Skill and related assets directly within the Renma authoring
contract.

Apply the truth-source and access distinctions above whenever a Skill depends
on an external authoritative URL. The user-designated source-of-truth role
normally justifies a concise Context Asset even if no other Skill reuses it,
but source-dependent domain facts stay Unresolved until content is successfully
consulted or supplied. Record what the source governs, its URL, when it must be
consulted, and necessary scope or fallback behavior. Do not copy the full
external document unless an intentional reviewed snapshot is required. Declare
the Context as required when the workflow cannot validly complete without it;
use optional Context only when it truly can.

The source-of-truth role supplies the independent authority and maintenance
boundary; correctness dependency by itself would not. Task-specific knowledge
with no independent maintenance or governance reason stays in `SKILL.md` or
justified Skill-local support. After a Context Asset is independently justified,
correctness dependency determines `requires-context` versus `optional-context`.

Separately decide whether the finished Skill reads the URL during execution or
expects source content from the user or another approved process. A Markdown
URL does not grant runtime network permission. When runtime access is intended,
review the supported effective policy for allowed data, network allowance,
approved destinations, external upload, secrets, and human approval.

Do not manufacture permissive policy values. Ensure the Skill body, Context
instructions, and effective policy agree, and preserve unresolved access intent
for human review.

Scaffold generation performs no network operations. The finished Skill may
access the reviewed external source only when its authored workflow and the
effective security policy permit that access.

Do not create a Context Lens merely because the Context exists. Do not create a
script merely because the output is JSON, YAML, XML, or another structured
format. Add a script only when exact repeated behavior, material safety,
safety-critical ordering, meaningful tests, or an explicit executable request
justifies it. Add examples only when they resolve real ambiguity. Every file
must have a distinct, reviewable responsibility.

Write only information that changes execution, interpretation, validation, or
review. State each requirement once in the asset that owns it, preserve required
inputs, exceptions, failure behavior, safety constraints, completion criteria,
and unresolved uncertainty, and remove generic introductions, conclusions, and
boilerplate. Concise does not mean omitting important decisions.

### 2. Generate one repository-compatible starting point

Run the Renma generator once:

```bash
renma scaffold skill skills/testing/spec-review/SKILL.md \
  --id skill.testing.spec-review \
  --title "Spec Review" \
  --owner qa-platform \
  --tags testing,spec-review
```

The target must be a canonical `SKILL.md` under `skills/**` or
`.agents/skills/**`. File mode refuses to overwrite an existing file and
requires an explicit owner. The output is a deterministic starting point, not
a finished Skill.

Use `--resources` only for directories with a current, justified responsibility.
It creates requested empty directories and no placeholder files. In the
completed Skill, state when each reference should be read, each script should be
run, and each asset should be used.

Do not run two independent generators against the same target file. Some tools
that provide platform-native Skill authoring guidance create files themselves,
so choose one of these safe approaches after the clarification gate:

1. Run `renma scaffold skill`, then ask the platform tool to review and refine
   that existing file.
2. Ask the platform tool to use `renma scaffold skill` as the starting point
   instead of independently generating the same target.

Use Renma as the one generator, then use platform-native Skill authoring
guidance only to refine semantics inside the established asset and metadata
boundaries. It must work from the Renma scaffold and agreed structure, must not
add metadata or assets outside that structure, and must not create a second
target.

`--format prompt` prints the deterministic scaffold and constraints without
writing the file. `--format json` prints the existing structured bundle. These
modes do not reserve or create the target path.

### 3. Review and complete the scaffold

Within the Renma boundaries, use platform-native Skill authoring guidance to
complete:

- `description`, including positive and negative trigger boundaries;
- required inputs and preflight evidence;
- instructions, decisions, and workflow;
- constraints and security behavior;
- completion criteria and validation; and
- the Skill semantics that rely on intended Renma metadata and Context
  relationships without changing those boundaries independently.

If refinement or real usage reveals a justified boundary change, stop and
return that need to the clarification protocol as Proposed or Unresolved.
Inspect evidence and re-enter the creation gate before changing the agreed
structure.

Preserve the repository's intended behavior. Use a Context Asset when knowledge
is reusable across Skills, has independent ownership or lifecycle, is maintained
separately, is an authoritative source of truth, or has another explicit reason
for independent review and governance. Correctness importance alone is not
sufficient; keep task-specific knowledge in the Skill or justified local
support.

Preserve Agent Skills optional fields, unknown `metadata.renma.*` values, and
other vendors' string metadata. Provider-specific `agents/openai.yaml` is
permitted but is not required by Renma core.

Execute and test every script. Forward-test complex Skills with raw user
prompts, outputs, and execution logs in the external runtime that consumes the
Skill. Do not leak expected answers, diagnoses, or intended fixes to evaluation
agents. Renma remains deterministic; runtime evaluation stays external.

### 4. Validate, fix, and rerun

Start with the release gate:

```bash
renma scan . --fail-on high
```

Review every relevant diagnostic and use the normative post-validation rules
above. Apply a repair only when evidence uniquely determines it, investigate
repeated-context or boundary evidence before semantic change, ask the human
when truth is missing, or explain why no change is justified. Follow
Diagnostics v2 constraints and verification steps, rerun after repairs, and do
not weaken security policy or add a suppression merely to pass.

Use other deterministic views when they answer a specific review question:

```bash
renma inspect skills/testing/spec-review/SKILL.md
renma catalog . --format markdown
renma graph . --focus skill.testing.spec-review --format mermaid
renma ownership . --format markdown
renma readiness . --format markdown
```

The final step is human review of the Skill's intent, workflow, policy,
relationships, and remaining uncertainty.

### Canonical Product A example

For this request:

```text
Create a Skill that builds a JSON body for Product A.
The official Product A URL is the source of truth.
Improve the Skill with Renma.
```

the consuming LLM first reports:

```text
Current understanding

Confirmed
- The workflow builds a Product A JSON body.
- The user designates the official Product A URL as the intended authoritative
  source.
- The request expresses authoring-time intent to consult that URL, subject to
  the current tools and authoring environment permitting access.

Proposed
- One focused Skill.
- One concise source-of-truth Context Asset.
- The Context is likely required.
- No script or Context Lens by default.

Unresolved
- The Product A schema, fields, constraints, and behavior until source content
  is successfully consulted or supplied through another approved process.
- Whether the current authoring environment is permitted and able to access the
  URL.
- Whether the finished Skill accesses the URL at execution time.
- What happens when the source cannot be accessed.
- The Context owner, unless repository evidence resolves it.

Current progression

Blocking decisions: 5
- Product A schema, fields, constraints, and behavior from consulted or supplied
  source content.
- Authoring-time source access or an approved way to supply relevant content.
- Finished-Skill runtime source-access intent.
- Safe fallback behavior when the source is unavailable.
- The Context owner when applicable repository evidence does not supply one.
- Asking now: 3 highest-impact questions below.

Queued blockers
- The Context owner when applicable repository evidence does not supply one.

Proceeding with reversible defaults
- No script by default.
- No Context Lens by default.

Deferred
- Final wording and tags.
- Additional examples unless real ambiguity emerges.

Questions
1. If the current authoring environment cannot access the official URL, can you
   provide the relevant content through an approved process?
2. Separately, should the finished Skill access the URL during execution, or
   should its future consumer receive the documentation through another
   approved process?
3. When the source is unavailable, should the Skill stop rather than infer the
   JSON schema?
```

The five-item Blocking set remains visible even though the current batch asks
only three questions; the owner is queued, not hidden or relabeled Deferred.
The reversible defaults remain Proposed. It does not create files until
blocking answers are available. It does not
confirm source-dependent facts from memory, use future Skill metadata as
authoring-time permission, or hard-code a fictional approved domain or
permissive security metadata.

After the creation gate, the smallest proposed Renma asset structure is:

```text
skills/build-product-a-json/SKILL.md
  -> requires
contexts/product-a-api.md
```

The external source reference is separate from that structure:

```text
contexts/product-a-api.md contains the reviewed official Product A URL
```

The URL is body content, not a Renma asset node or graph edge. Decide whether
the finished Skill fetches it at runtime or expects approved supplied content.
If it fetches at runtime, review the supported allowed-data, network,
destination, external-upload, secrets, and approval policy; do not hardcode an
unreviewed host or infer permissive values merely because the URL is public.
The Renma graph validates only the Skill-to-Context relationship. Neither a
clean scan nor a valid graph proves that the URL is authoritative or accessible
at runtime.

The Skill determines the requested operation, consults the declared Context,
collects missing required inputs, constructs only documented JSON fields,
reports assumptions or unresolved ambiguity, and defines output and completion
criteria. The Context identifies the governed specification and authoritative
URL, says when it must be consulted and what happens when unavailable, and does
not copy the full specification.

Do not create a JSON-generation script, second explanatory guide, Context Lens,
duplicated URL declarations, speculative metadata, or copied API documentation
by default.

## Existing Skill Workflow

Use this sequence for ordinary maintenance of an existing Skill:

```text
renma scan . --fail-on high
  -> inspect relevant diagnostics and repository evidence
  -> use suggest-metadata only for metadata or migration work
  -> prepare the smallest intended patch
  -> renma scan . --fail-on high
  -> fix relevant diagnostics
  -> rerun validation
  -> human review
```

Use `renma guide skill` only when the work intentionally reconsiders Skill and
Context boundaries, file or resource placement, source representation, scripts
or other support, or the asset graph. Platform-native authoring guidance may
refine Skill semantics within the resulting Renma boundaries;
`suggest-metadata` does not perform that review.

### 1. Scan and inspect repository evidence

```bash
renma scan . --fail-on high
renma inspect skills/testing/spec-review/SKILL.md
```

`scan` is the general deterministic starting point for an existing Skill. Use
`inspect`, `catalog`, `graph`, `ownership`, or `readiness` when one of those
commands answers a specific evidence question. Renma reports structural and
governance evidence; it does not perform the whole-Skill semantic review.

### 2. Generate a metadata or migration suggestion when needed

```bash
renma suggest-metadata skills/testing/spec-review/SKILL.md
```

Optionally provide an owner only when a human has explicitly confirmed it:

```bash
renma suggest-metadata skills/testing/spec-review/SKILL.md \
  --owner qa-platform \
  --format json
```

`suggest-metadata` reads one target and prints a deterministic prompt or JSON
payload to stdout. It does not edit, rename, or move the file. Its supported
responsibilities are:

- compact canonical metadata suggestions;
- explicit owner retrofit and one-way migration of recognized pre-0.16
  governance and security metadata;
- pre-0.16 to canonical Agent Skills migration candidates;
- conflict and unsafe-evidence detection; and
- validation of the rendered candidate.

It does not rewrite the body, infer ownership, choose between conflicting
semantic values, infer missing security policy, or propose reverse migration
for a canonical Skill. An owner candidate requires explicit human-provided
evidence. Security policy remains intentionally authored and deterministically
validated.

Do not route an already canonical Skill through `suggest-metadata` as ceremony.
Use it only for a metadata retrofit, explicit owner retrofit, recognized
pre-0.16 one-way migration, or blocked migration review.

### Evidence-first LLM preflight

When an LLM is asked to improve one existing Skill:

1. Run `renma scan . --fail-on high --format json`.
2. Run `renma inspect <SKILL.md> --format json`.
3. Inspect relevant local resources and referenced Context Assets.
4. Use `renma suggest-metadata` only when metadata retrofit or migration
   evidence exists.
5. Prepare the smallest intended patch.
6. Run `renma scan . --fail-on high --format json` again.
7. Stop without manufacturing work when Renma returns `no-proposal`.
8. Report unresolved human decisions.

For a classification-only question, `renma inspect <target> --format json` may
be the first command. `scan` remains the normal repository-level starting
point.

### 3. Review before applying

Treat the output as a candidate. Compare it with the source and apply only the
intended metadata, path migration, or migration changes. Preserve the Markdown
body and unknown vendor metadata unless a separately reviewed semantic change
requires otherwise.

If migration is blocked:

1. Review the reported conflicts or invalid evidence.
2. Confirm the Skill's intent using platform-native Skill authoring guidance
   within the established Renma boundaries.
3. Do not apply a candidate while Renma cannot generate it safely.
4. Correct the source evidence.
5. Rerun `renma suggest-metadata <SKILL.md>`.
6. After intended corrections, run `renma scan . --fail-on high` and repeat the
   fix-and-rerun loop.

Renma never chooses a semantic winner automatically. The detailed one-way
migration and blocking contract is in
[Agent Skills Compatibility and Migration](agent-skills-compatibility.md).

## Canonical Skill Metadata

Agent Skills owns the standard Skill identity and body. Renma fields are flat,
string-valued `metadata.renma.*` entries. JSON-array strings encode lists:

```yaml
---
name: spec-review
description: Review specifications for ambiguity and missing boundaries. Use when requirements need evidence-backed review before implementation.
metadata:
  renma.id: skill.testing.spec-review
  renma.title: Spec Review
  renma.owner: qa-platform
  renma.status: stable
  renma.tags: '["testing","spec-review"]'
  renma.requires-context: '["context.testing.boundary-value-analysis"]'
  renma.optional-context: '[]'
---
```

Do not use a nested `metadata.renma` mapping, native YAML booleans for canonical
security fields, or comma-separated canonical lists. See the compatibility and
security guides for the complete contracts.

Start from the installed Renma scaffold and use only fields defined by that
Renma version or the supported Agent Skills format. Do not infer future fields,
add every optional field, or invent `source_of_truth`, `trust_level`,
`refresh_policy`, `product`, or similar metadata. Represent external authority
through the supported Context relationship plus a normal Markdown link. Keep
metadata compact and put detailed instructions in the body. Preserve unknown
existing vendor metadata during review, but do not manufacture provider-specific
metadata without a requirement.

## Context Asset And Context Lens Authoring

Create a Context Asset when knowledge is reusable across Skills, has independent
ownership or lifecycle, is maintained separately, is an authoritative source
of truth, or has another explicit reason for independent review and governance.
Source-of-truth status alone is sufficient; importance to one Skill's
correctness is not. Cross-Skill reuse is not mandatory:

```bash
renma scaffold context contexts/testing/boundary-value-analysis.md \
  --owner qa-platform
```

A Context Asset should contain durable, source-backed domain knowledge,
testing heuristics, tool constraints, platform facts, reviewed policy, or a
concise external source-of-truth contract. Keep task-specific prompt
instructions and runtime selection rules out of Context.

Create a Context Lens when one purpose needs a focused interpretation of one or
more Context Assets:

```bash
renma scaffold context_lens \
  lenses/testing/spec-review-boundary-values.md \
  --owner qa-platform
```

The repository can represent both:

```text
Skill -> Context Lens -> Context Asset
Skill -> Context Asset
```

These metadata relationships are static governance evidence. Renma does not
select, load, or inject Context at runtime.

Use this placement sequence before creating an asset:

1. Is this the task, workflow, or completion contract? Put it in the Skill.
2. Is this durable, source-backed knowledge with reuse, independent ownership or
   lifecycle, separate maintenance, source-of-truth status, or another explicit
   independent governance boundary? Create or reuse a Context Asset. Any one of
   those independent reasons is enough; correctness importance alone is not.
   After Context is independently justified, use correctness dependency to
   select a required versus optional relationship.
3. Does declared Context need a reusable purpose-specific interpretation?
   Create a Context Lens. Do not create a Lens when there is no Context Asset to
   interpret.
4. Is this a Skill-local overlay or execution variant? Use a Profile only when
   the current Profile semantics fit.
5. Is this supporting detail used by only one Skill? Use a Reference.
6. Is this a local fixture or demonstration? Use an Example.
7. Is this only generic persona or tone framing? Usually keep it local and do
   not create an asset solely for the persona.

A Skill can reference a Context Asset directly when no separate interpretation
layer adds value. A Lens is justified only when it adds meaningful, reusable
structure to how declared Context is read for a purpose. See the
[Context Lens guide](context-lens.md) for field semantics, persona guidance,
examples, and a zero-context classification self-check.

Context and Context Lens scaffolds keep their top-level Renma metadata syntax;
the Agent Skills `metadata.renma.*` serialization boundary applies to Skills.

## Context Asset Discovery Boundary

The classification precedence is: explicit Skill entrypoint, explicit local
support inside a recognized Skill, recognized top-level asset root,
repository-level support or configuration, compatible generic nested rules,
then unknown. This makes the repository root authoritative:

```text
contexts/foo/references/policy.md
  -> independent Context Asset

skills/foo/references/policy.md
  -> Skill-local Reference

references/policy.md
  -> outside the Context root

tools/helper.mjs
  -> repository implementation

skills/foo/tools/helper.mjs
  -> not canonical Skill-local support
```

Use `contexts/**` for preferred independent Context and `context/**` only for
compatibility. Nested `references/`, `examples/`, `profiles/`, `scripts/`, or
`assets/` does not override either Context root. The same names are Skill-local
only inside `skills/**` or `.agents/skills/**`, where they establish a structural
parent candidate. Local metadata overrides remain supported where valid, but
are not required. `tools/**` is shared repository implementation, and a Skill
uses `scripts/`, not `tools/`, for canonical local executable support.

The Skill-local path rule establishes only a structural parent candidate. The
catalog must resolve exactly one parent entrypoint before Renma reports
inherited governance. A missing or ambiguous parent remains structurally
Skill-local but unowned or unresolved; `suggest-metadata` blocks instead of
adding independent metadata automatically. Existing explicit local owner or
policy metadata is preserved and is not described as inherited.

Humans decide whether knowledge needs independent ownership, lifecycle, reuse,
and source-of-truth status. Renma classifies the resulting placement but never
promotes or moves content automatically. A `no-proposal` result is successful:
preserve the file and stop unless a separate intentional change is supported.

For current guidance on deriving several focused, bounded workflows from a broad
existing Skill—including focused `inspect`, graph, Context reuse, and Appium
examples—see [Advanced Skill Authoring](advanced-skill-authoring.md). That guide
keeps current focused-workflow authoring separate from deferred Skill-to-Skill
route and generated-index design. Repository and local support discovery are
already implemented; `routes_to` and `skill-index` are not.

## Optional Codex Example

Codex may activate `skill-creator` when asked to create a Skill. It is one
example of platform-native Skill authoring guidance, not a Renma dependency or
the authority for Renma metadata, Context placement, repository asset
boundaries, file count, source-of-truth representation, or scripts and support
files. The expected sequence is:

```text
run renma guide skill
  -> conduct Renma clarification
  -> pass the creation gate
  -> create the Renma scaffold
  -> use skill-creator only for semantic refinement
```

If `skill-creator` is available or activates automatically, do not let it
independently create files before the Renma clarification gate is satisfied.
If semantic refinement reveals a justified asset-boundary change,
`skill-creator` must return that need to the Renma clarification protocol rather
than silently changing the repository structure.

After passing the gate, a safe request is:

```text
First run `renma guide skill`, conduct focused clarification, and resolve the
blocking creation-gate decisions. Create
`skills/testing/spec-review/SKILL.md` with `renma scaffold skill`. Then use
skill-creator only to refine its trigger description, ordered instructions,
usage boundaries, required inputs, constraints, completion criteria, and
ambiguity-resolving examples. Preserve its Renma metadata, Context placement,
file boundaries, and repository behavior. Do not independently generate a
second target file or invent owners, policy, dependencies, domain rules, or
source-of-truth claims. If refinement reveals that the agreed asset boundary
must change, stop, report it as Proposed or Unresolved, and re-enter the Renma
creation gate before changing structure. After the reviewed edits, run
`renma scan . --fail-on high`, fix relevant diagnostics, and rerun the scan.
```

Do not ask `skill-creator` to design a generic Skill first for later Renma
enrichment. The Renma scaffold and graph are the starting point.

## Review Checklist

Before human approval, confirm that:

- the description says when the Skill should and should not be selected;
- instructions, constraints, and completion criteria are explicit;
- owners, policies, dependencies, and domain claims are evidence-backed;
- reusable or independently maintained source-of-truth knowledge has an
  appropriate Context boundary;
- generated or suggested changes were reviewed rather than applied blindly;
- blocked migration evidence was resolved instead of bypassed;
- `renma scan . --fail-on high` was rerun after fixes; and
- no policy weakening or new suppression was used merely to pass validation.

The operating principle remains:

```text
LLM proposes. Renma verifies. Human approves.
```
