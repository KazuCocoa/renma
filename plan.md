# Renma Roadmap

## Current Checkpoint

Renma 0.25.0 is a focused internal security-analysis checkpoint after the
precision corrections completed in 0.24.4.

The checkpoint replaces body-policy sentence orchestration with private clause
facts for domain, modality, scope, and completeness. It preserves the
high-confidence public diagnostic boundary and does not add a product feature
or intentionally change public behavior.

The current product remains a single-repository, deterministic Context
Repository governance CLI:

```text
LLM proposes. Renma verifies. Human approves.
```

Current contracts live in [architecture.md](architecture.md),
[design.md](design.md), and the [documentation index](docs/README.md).
Historical release detail belongs only in [CHANGELOG.md](CHANGELOG.md).

## Stabilization Priorities

The current stabilization phase prioritizes:

- keeping documentation aligned with executable command, schema, diagnostic,
  path, metadata, ordering, and compatibility contracts;
- preserving one immutable repository-evidence snapshot per analyzed repository
  state;
- keeping static Skill Discovery, security analysis, composition, impact,
  Readiness, diff, CI, Trust Graph, and BOM boundaries explicit;
- keeping body-policy clause semantics private, precision-first, clause-bounded,
  and separate from shared lexical vocabulary;
- removing obsolete chronology and duplicated contract lists from evergreen
  documentation;
- protecting documented deep imports and compatibility re-exports;
- improving maintainability without adding dependencies or broadening runtime
  responsibility.

## Open Core Candidates

These candidates have no assigned release and require independent evidence and
contract review:

- hard-fail Skill Discovery CI gating after operational experience with the
  existing opt-in warn-only policy;
- broader source-to-sink analysis for additional languages or syntax, including
  any separately versioned public evidence contract;
- observed Skill-reference evidence kept separate from authoritative declared
  continuation routes;
- product or ownership projections derived only from stable IDs, exact tags,
  and existing Context or Lens relationships;
- richer focused visualization over existing stable report data;
- additive Trust Graph or BOM evidence whose compatibility impact is explicit.

None is a commitment. A candidate becomes product work only after its user
problem, deterministic inputs, output contract, compatibility effect, and
non-goals are reviewed.

### External review governance experiment

This unassigned candidate evaluates whether Renma can govern external-review
requirements and generated receipts without depending on or becoming an
external reviewer. SkillSpector is the first evaluation producer, and current
repository Skills plus separately classified example-repository probes are the
initial corpus. The methodology lives in the
[SkillSpector experiment](experiments/skillspector/README.md), and the durable
boundary is in
[External Review Governance](docs/external-review-governance.md).

The candidate separates stable review requirements from generated receipts.
Future `renma-<tool>-adapter` companion tools may parse supported published
reports and bind them to public Renma repository evidence. Renma core would not
load those adapters or depend on the producers. There is no commitment yet to a
public receipt schema, metadata field, CLI, configuration field, adapter
package, or release.

Evidence is required before product implementation. Decision gates include:

- published output can be parsed reliably;
- producer version and actual execution mode are available;
- completeness, skipped work, and limitations are visible;
- evidence can be bound to exact repository assets and content;
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
