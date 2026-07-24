# Renma Documentation

Use this index to choose the smallest document that answers your question.

## Start Here

- [README](../README.md): product identity, boundaries, quick start, primary
  workflows, and command orientation.
- [User Manual](user-manual.md): operational workflows, command behavior,
  output formats, and CI usage.
- [Authoring Guide](authoring-guide.md): canonical new-Skill and existing-Skill
  authoring workflows. New Skill generation and intentional boundary redesign
  start with the interactive clarification protocol printed by
  `renma guide skill`; the consuming LLM conducts the conversation while Renma
  remains deterministic and non-interactive. Ordinary existing-Skill
  maintenance starts with `scan`.

## Format And Governance Contracts

- [Agent Skills Compatibility and Migration](agent-skills-compatibility.md):
  canonical Skill format, pre-0.16 migration, conflicts, and blocked migration.
- [Security Policy Guide](security-policy.md): security metadata semantics,
  profiles, diagnostics, and review boundaries.
- [Repository Context BOM](repository-context-bom.md): authoritative BOM v2
  snapshot, output, reproducibility, migration, and provenance contract.
- [Trust Graph v2 Contract](trust-graph.md): authoritative node, edge,
  provenance, ordering, and compatibility contract.
- [Published JSON Schemas](schemas/): machine-readable BOM v2 and Trust Graph
  v2 contracts included in the npm package.
- [Diagnostics Reference](diagnostics.md): scan finding identifiers and repair
  guidance.
- [Declared Composition](declared-composition.md): required and optional
  closure, provenance, completeness, cycle, conflict, and graph-view contract.
- [Declared Impact](declared-impact.md): reverse required and optional
  composition closure, dependent Skill summaries, provenance, and change-review
  boundary.
- [Skill Discovery Graph and Index](skill-discovery.md): canonical Skill continuation and
  publication metadata, repository-wide adoption, exact resolution,
  eligibility/usability, diagnostics, structural roots, the discovery graph
  view, and canonical `renma.skill-index.v1` command/report.
- [Renma Quality Profile](quality-profile.md): canonical thresholds,
  units, provenance, rationale, false-positive risks, and configuration status.

## Focused References

- [Advanced Skill Authoring](advanced-skill-authoring.md): deriving focused,
  bounded Skills from existing workflows while using progressive disclosure.
- [Context Lens](context-lens.md): canonical semantics, placement decisions,
  persona guidance, fields, examples, and runtime boundaries.
- [Context Lifecycle Diagnostics](context-lifecycle-diagnostics.md)
- [Context Conflict Diagnostics](context-conflict-diagnostics.md)
- [Context Language Diagnostics](context-language-diagnostics.md)
- [Metadata Budget](metadata-budget.md)

## Product Model And Direction

- [Product Design](../design.md): asset semantics and relationships.
- [Architecture](../architecture.md): processing architecture and product
  boundaries.
- [Internal Architecture](internal-architecture.md): contributor-facing
  snapshot, evidence, decision, rendering, and fail-closed boundaries.
- [Current Roadmap](https://github.com/KazuCocoa/renma/blob/main/plan.md):
  shipped baseline, product boundaries, and forward-looking priorities.
- [Skill Discovery Design](https://github.com/KazuCocoa/renma/blob/main/plan-discovery.md):
  complete layered design and
  release slicing. The 0.22.0 route foundation, 0.22.1 publication/adoption,
  0.22.2 reachability/coverage, 0.22.3 Skill Index, and 0.22.4 route-cycle
  stabilization slices are operational.

## Examples

- [Interactive Placeholder Example](https://github.com/KazuCocoa/renma/tree/main/examples/interactive-placeholder):
  a
  minimal hands-on clarify-before-act Skill interaction with a local tool.
- [Example Context Repository](https://github.com/KazuCocoa/renma/tree/main/examples/context-repo):
  richer
  repository-aware Skill, Context Lens, and Context Asset governance.
- [Context Lens Example](https://github.com/KazuCocoa/renma/tree/main/examples/context-lens):
  focused Context Lens
  governance.
- [GitHub Actions example](https://github.com/KazuCocoa/renma/blob/main/examples/github-actions/renma-ci-report.yml):
  live
  Skill validation, focused composition, catalog, CI report artifacts, and an
  updatable CI report comment on same-repository pull requests.
