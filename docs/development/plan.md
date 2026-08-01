# Renma Roadmap

## Current State

As of Renma 0.28.4, the stable core remains a single-repository,
deterministic Context Repository governance CLI. The 0.25.x line completed the
precision-first body-policy refactor and dependency-install hardening. Renma
0.26.0 added raw-source hidden-Unicode evidence, and the 0.27.x–0.28.x line
added the provider-neutral executable-surface inventory, bounded direct helper
invocations, static JavaScript/TypeScript and Python dependency evidence,
invocation reachability and governance correlation, semantic-diff and CI
visibility, and the focused executable graph.

These additions remain non-executing static evidence. They do not classify a
surface as safe, prove runtime execution, propagate caller policy through
dependencies, or broaden Renma into a runtime, package resolver, or general
language SAST system.

The documentation site, visual identity, and package homepage are now shipped.
The SkillSpector work remains an isolated evidence-correlation experiment; it
has not added a Renma command, diagnostic, readiness rule, CI policy, runtime
dependency, or public receipt schema.

The product boundary remains:

```text
LLM proposes. Renma verifies. Human approves.
```

Current contracts live in [architecture.md](architecture.md),
[design.md](design.md), and the [documentation index](../README.md).
Historical release detail belongs only in
[CHANGELOG.md](https://github.com/KazuCocoa/renma/blob/main/CHANGELOG.md).

## Stabilization Priorities

The current stabilization phase prioritizes:

- keeping documentation aligned with executable command, schema, diagnostic,
  path, metadata, ordering, and compatibility contracts;
- preserving one immutable repository-evidence snapshot per analyzed repository
  state;
- keeping static Skill Discovery, security analysis, composition, impact,
  Readiness, diff, CI, Trust Graph, and BOM boundaries explicit;
- preserving the executable-surface inventory and executable graph as bounded,
  auditable, non-executing evidence with explicit unsupported states;
- keeping body-policy semantics private, precision-first, clause-bounded, and
  separate from shared lexical vocabulary;
- removing obsolete chronology and duplicated contract lists from evergreen
  documentation;
- protecting documented deep imports and compatibility re-exports;
- keeping the VitePress site, source Markdown, README entrypoints, and packaged
  documentation aligned;
- evaluating external-review evidence without promoting experiment output into
  a core contract prematurely;
- improving maintainability without adding dependencies or broadening runtime
  responsibility.

## Open Core Candidates

These candidates have no assigned release and require independent evidence and
contract review:

- hard-fail Skill Discovery CI gating after operational experience with the
  existing opt-in warn-only policy;
- broader executable dependency or source-to-sink analysis beyond the current
  bounded ESM and Python-relative-import grammar, including any separately
  versioned public evidence contract;
- observed Skill-reference evidence kept separate from authoritative declared
  continuation routes;
- product or ownership projections derived only from stable IDs, exact tags,
  and existing Context or Lens relationships;
- additive Trust Graph or BOM evidence whose compatibility impact is explicit.

None is a commitment. A candidate becomes product work only after its user
problem, deterministic inputs, output contract, compatibility effect, and
non-goals are reviewed.

### External review governance experiment

This unassigned candidate evaluates whether Renma can govern external-review
requirements and generated receipts without depending on or becoming an
external reviewer. SkillSpector is the first evaluation producer. The
experiment now preserves scanner-native facts, correlates exact source paths
with Renma catalog assets, validates one audited fixture capture, and compares
exact scanner file evidence with the public executable graph. Invocation,
containment, ownership, reachability, reviewed scope, producer completeness,
and runtime impact remain distinct claims. The methodology lives in the
[SkillSpector experiment](https://github.com/KazuCocoa/renma/blob/main/experiments/skillspector/README.md), and the durable
boundary is in
[External Review Governance](../external-review-governance.md).

The candidate separates stable review requirements from generated receipts.
Future `renma-<tool>-adapter` companion tools may parse supported published
reports and bind them to public Renma repository evidence. Renma core would not
load those adapters or depend on the producers. There is no commitment yet to a
public receipt schema, metadata field, CLI, configuration field, adapter
package, or release.

The experimental projection remains `renma.experiment.skillspector-evidence.v0`
with no compatibility promise. Evidence is still required before product
implementation. Remaining decision gates include:

- published output can be parsed reliably;
- producer version and actual execution mode are available;
- completeness, skipped work, and limitations are visible;
- the logical subject and exact reviewed component scope can be bound to stable
  repository evidence;
- false-positive and suppression behavior is understood;
- raw evidence can remain separate from Renma findings;
- a provider-neutral core remains useful for a second producer.

## Adjacent or External Capabilities

Some useful capabilities should remain outside Renma core unless a future
product decision changes the boundary:

- LLM-assisted authoring orchestration can live in a Skill, companion workflow,
  or calling agent while Renma verifies the resulting repository assets.
- Runtime debugging and observability require evidence produced by runtimes.
  Renma may eventually validate a separate evidence artifact, but it cannot
  independently claim what a runtime selected or consumed.
- Multi-repository and organization-wide use requires separate identity,
  federation, transport, and policy decisions.
- Hosted dashboards, provider gateways, package distribution transport, and
  workflow execution are ecosystem responsibilities.

## Explicit Non-Commitments

Renma is not committed to:

- accepting free-form task text and selecting or ranking a Skill;
- fuzzy, embedding, or LLM-based runtime routing;
- prompt construction, Context bundling or injection, or agent execution;
- runtime telemetry collection or claims about actual runtime consumption;
- automatic Skill, metadata, route, policy, or generated-index edits;
- a required category, product, team, or workflow directory hierarchy;
- subjective trust, confidence, centrality, popularity, or “best Skill” scores;
- treating owner changes as product identity changes;
- making optional LLM assistance required for deterministic validation.

## Decision Rule

Prefer the smallest additive contract that answers a demonstrated repository
governance question. Keep deferred ideas visibly separate from shipped behavior,
and move completed implementation history to the changelog instead of extending
this roadmap.
