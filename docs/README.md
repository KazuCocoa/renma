# Renma Documentation

Each document below has one primary responsibility. Follow the link whose
authority matches the question instead of copying its contract into another
document.

## Start Here

- [README](https://github.com/KazuCocoa/renma/blob/main/README.md) is the product entrypoint: what Renma is, why a
  Context Repository exists, the primary product boundary, installation, first
  use, and a short command overview.
- [User Manual](user-manual.md) is authoritative for the complete operational
  metadata reference and for current CLI workflows, command purposes, options,
  formats, examples, expected outputs, and next steps. Emitted `renma --help`
  and `renma <command> --help` remain the command-line authority.
- [Authoring Guide](authoring-guide.md) is authoritative for new-Skill and
  existing-Skill authoring workflows, clarification, the creation gate, and the
  boundary between Renma and the consuming LLM.

## Diagnostics And Security

- [Diagnostics Reference](diagnostics.md) defines Finding semantics, diagnostic
  interpretation, classification and evidence conventions,
  compatibility-sensitive identifiers, repair constraints, and verification
  expectations.
- [Security Policy Guide](security-policy.md) defines effective-policy
  semantics, revision-transition governance, and bounded agent-facing
  instruction analysis; the User Manual owns the complete security field
  mapping. The guide also defines the boundary between Renma, SAST, secret
  scanning, dependency scanning, and runtime controls.
- [Renma Quality Profile](quality-profile.md) records the exact deterministic
  thresholds, units, provenance, rationale, and configuration status used by
  quality checks.
- [Metadata Budget](metadata-budget.md) focuses on metadata size diagnostics.
- [Context Lifecycle Diagnostics](context-lifecycle-diagnostics.md),
  [Context Conflict Diagnostics](context-conflict-diagnostics.md), and
  [Context Language Diagnostics](context-language-diagnostics.md) explain their
  respective focused diagnostic families.

## Asset And Relationship Contracts

- [Agent Skills Compatibility and Migration](agent-skills-compatibility.md)
  defines canonical Skill paths and metadata, accepted migration-only forms,
  validation, and the one-way migration boundary.
- [Advanced Skill Authoring](advanced-skill-authoring.md) applies the canonical
  authoring model to focused workflows, orchestration, and progressive
  disclosure.
- [Context Lens](context-lens.md) defines when a Context Lens is justified, its
  fields and relationships, and its non-runtime boundary.
- [Declared Composition](declared-composition.md) defines the forward explicit
  required/optional closure, provenance, completeness, conflicts, and cycles.
- [Declared Impact](declared-impact.md) defines the reverse explicit
  composition closure and its change-review boundary.
- [Skill Discovery](skill-discovery.md) defines declared continuations,
  publication, route resolution, reachability, coverage,
  `renma.skill-index.v1`, Discovery diff, and warn-only CI policy without
  describing runtime routing.
- [Repository Context BOM v2](repository-context-bom.md) defines
  `renma.repository-context-bom.v2`, deterministic ordering, reproducibility,
  and the declared-manifest boundary.
- [Experimental Execution Contract](execution-contract.md) defines the
  `renma.experimental-execution-contract.v1` static `possible` relationship
  artifact, single-snapshot guarantee, bounded completeness, and external
  revision/hash binding boundary.
- [Trust Graph v2](trust-graph.md) defines `renma.trustGraph.v2`, node and edge
  provenance, ordering, and the distinction between evidence and a trust score.
- [Published JSON Schemas](https://github.com/KazuCocoa/renma/tree/main/docs/schemas)
  contains the machine-readable BOM v2, Trust Graph v2, and Skill Authoring
  Handoff v1 contracts shipped in the npm package.

## Development

- [Public Architecture](development/architecture.md) owns the high-level layers, data
  flow, stable product boundaries, and public contract surfaces.
- [Internal Architecture](development/internal-architecture.md) owns module
  responsibilities, dependency direction, shared projections, compatibility
  facades, invariants, and implementation rationale.
- [Product Design](development/design.md) owns durable product decisions and distinctions,
  including capabilities intentionally outside Renma core.
- [External Review Governance](external-review-governance.md) records a
  candidate design direction and SkillSpector experiment plan, not a current
  CLI, metadata, schema, or configuration contract.
- [Current Roadmap](development/plan.md) owns
  the current stabilization checkpoint, open candidates, deferred ecosystem
  concerns, and explicit non-commitments.
- [Skill Discovery Design](development/plan-discovery.md)
  records the durable rationale behind the current static Discovery boundary;
  the current operational contract remains in
  [Skill Discovery](skill-discovery.md).
- [Changelog](https://github.com/KazuCocoa/renma/blob/main/CHANGELOG.md) owns chronological release history,
  version-specific changes, and compatibility notes.

## Examples

Repository examples are source-checkout resources rather than npm package
contents:

- [Interactive Placeholder](https://github.com/KazuCocoa/renma/tree/main/examples/interactive-placeholder)
- [Example Context Repository](https://github.com/KazuCocoa/renma/tree/main/examples/context-repo)
- [Context Lens](https://github.com/KazuCocoa/renma/tree/main/examples/context-lens)
- [GitHub Actions](https://github.com/KazuCocoa/renma/blob/main/examples/github-actions/renma-ci-report.yml)

## Maintaining The Documentation Site

The Markdown in this directory remains the documentation source of truth. Run
the site locally from the repository root:

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Fenced `mermaid` blocks under `docs/` render automatically, while their
Mermaid source remains the canonical editable form. Test diagram changes with
`npm run docs:build` and a local preview. Diagrams must not require loose
security or executable click behavior.
