# Renma Roadmap

## Current State

Renma's stable core is a deterministic, Git-native repository governance CLI
for a single Context Repository. It discovers Skills, Context Assets, Context
Lenses, and related support assets; normalizes their metadata, ownership,
lifecycle, and explicit relationships; evaluates bounded policy and security
rules; and emits deterministic catalog, graph, composition, impact, Readiness,
diff, CI, Trust Graph, BOM, and other review evidence from repository state.

Static executable and security evidence remains bounded and non-executing. It
does not classify a surface as safe, prove runtime execution, or propagate
caller policy through dependencies. Renma is not an agent runtime: it does not
interpret live tasks, select, rank, or execute Skills, assemble or inject
Context, or execute workflows. It is also not a package resolver, general
language SAST system, or hosted Skill marketplace.

External-review research remains at the two-producer concept stage.
SkillSpector evidence correlation, Cisco Skill Scanner evaluation, and the
deliberately unstable receipt concept remain isolated experiments. They have
not added a Renma command, diagnostic, Readiness rule, CI policy, runtime
dependency, adapter, metadata field, or public receipt schema.

The product boundary remains:

```text
LLM proposes. Renma verifies. Human approves.
```

Current contracts live in [architecture.md](architecture.md),
[design.md](design.md), and the [documentation index](../README.md).
Historical release detail belongs only in the [Changelog](../changelog.md).

Repositories used as broadly shared organizational Skill repositories may
choose stricter local metadata requirements than Renma's defaults, for example
`owner`, `status`, `last_reviewed_at`, and `review_cycle`, through the existing
[repository-required metadata policy](../user-manual.md#repository-required-metadata-policy).
This is optional repository policy, not a Renma default or portable Agent
Skills requirement, and it does not imply multi-repository federation.

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
  bounded ESM, Python-relative-import, and shell execution/source grammar, including any separately
  versioned public evidence contract;
- observed Skill-reference evidence kept separate from authoritative declared
  continuation routes;
- product or ownership projections derived only from stable IDs, exact tags,
  and existing Context or Lens relationships;
- additive Trust Graph or BOM evidence whose compatibility impact is explicit.

None is a commitment. A candidate becomes product work only after its user
problem, deterministic inputs, output contract, compatibility effect, and
non-goals are reviewed.

### External review governance research status

The non-production research sequence is complete for two producers. The
[SkillSpector evidence-correlation experiment](https://github.com/KazuCocoa/renma/tree/main/experiments/skillspector/evidence-correlation)
preserved scanner-native facts and correlated exact source paths with Renma
catalog assets. Its executable-relationship extension kept invocation and
containment evidence separate from scanner-reviewed scope. The
[Cisco evaluation](https://github.com/KazuCocoa/renma/tree/main/experiments/cisco-skill-scanner)
then evaluated a second producer, not a second adapter. Finally, the
[external-review receipt concept](https://github.com/KazuCocoa/renma/tree/main/experiments/external-review-receipt-concept)
tested a deliberately unstable projection across both producers without
creating a production contract.

The completed experiment resolves the former second-producer decision gate.
Common conceptual dimensions are useful across both producers, including
provenance, subject and reviewed-scope binding, execution, profile or policy
identity, completeness and limitations, native findings and assessment,
artifact integrity, freshness, and requirement satisfaction. Common questions
do not make producer-native findings, severities, scores, or assessments
interchangeable. Exact report digests are useful only for artifact integrity;
they do not establish semantic identity, reviewed scope, content binding, or
safety. Unavailable and contradictory evidence must remain first-class rather
than being repaired through normalization.

This result does not justify a production receipt, parser, adapter, public
schema, generic framework, Renma metadata field, or runtime behavior.
Production implementation remains blocked by untrustworthy or unversioned
producer output contracts, incomplete exact reviewed-scope binding, missing
component-content evidence, insufficient serialized completeness and
limitations evidence, and the absence of an independently designed, named,
digest-bound Renma required review profile. Additional projection-shaping
experiments are paused.

Revisit this candidate only when at least one bounded condition materially
changes the available evidence:

- a producer publishes a trustworthy, versioned report contract;
- complete reviewed-component identity or content binding becomes available;
- serialized completeness and limitation evidence materially improves;
- Renma independently designs a required review profile; or
- a third producer exposes a genuinely new evidence shape.

External reviewers continue to own native inspection, findings, and
assessment. A future separately installed adapter may preserve and bind
published evidence if the necessary contracts become available. Renma core
does not run scanners, load adapters, translate native findings, or infer
safety. The durable boundary and experiment conclusions are recorded in
[External Review Governance](../external-review-governance.md).

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
