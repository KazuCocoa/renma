# Renma Documentation

For an initial overview, read `user-manual.md`.

For authoring Skills and Context Assets, read `authoring-guide.md`.

For diagnostics and remediation, read `diagnostics.md`.

For security-related metadata and policy, read `security-policy.md`.

For machine-readable contracts, use the schemas under `schemas/`.

Development and internal design documents are under `development/`.
They describe implementation rationale and are not normative user guidance.

## Start Here

- [README](https://github.com/KazuCocoa/renma/blob/main/README.md) is the product entrypoint: what Renma is, why a
  Context Repository exists, the primary product boundary, installation, first
  use, and a short command overview.
- [User Manual](user-manual.md) is authoritative for the complete operational
  metadata and [repository configuration](user-manual.md#configuration)
  references and for current CLI workflows, command purposes, options, formats,
  examples, expected outputs, and next steps. Emitted `renma --help` and
  `renma <command> --help` remain the command-line authority.
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
- [Repository Context BOM v3](repository-context-bom.md) defines
  `renma.repository-context-bom.v3`, deterministic ordering, reproducibility,
  and the declared-manifest boundary.
- [Machine-Readable JSON Compatibility](machine-readable-json.md) inventories
  top-level command contracts, defines the 1.x additive/breaking policy, and
  identifies environment-derived fields.
- [Experimental Execution Contract](execution-contract.md) defines the
  `renma.experimental-execution-contract.v1` static `possible` relationship
  artifact, single-snapshot guarantee, bounded completeness, and external
  revision/hash binding boundary.
- [Trust Graph v2](trust-graph.md) defines `renma.trustGraph.v2`, node and edge
  provenance, ordering, and the distinction between evidence and a trust score.
- [Published JSON Schemas](https://github.com/KazuCocoa/renma/tree/main/docs/schemas)
  contains the machine-readable BOM v3, Trust Graph v2, and Skill Authoring
  Handoff v1 contracts shipped in the npm package.

The development architecture, design, and roadmap documents below are
source-repository-only and intentionally excluded from the npm package.

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
- [Renma 1.0 Stabilization Boundary](development/stabilization-1.0.md) records
  the pre-1.0 reduction order, the retained shell-family and `ci-report`
  contracts, and the precision-first boundary for natural-language analysis.
- [Skill Discovery Design](development/plan-discovery.md)
  records the durable rationale behind the current static Discovery boundary;
  the current operational contract remains in
  [Skill Discovery](skill-discovery.md).
- [Release Publication Security](development/release-security.md) documents the
  repository-visible npm publication checks, their limits, and the required
  npm and GitHub controls outside the repository.
- [Changelog](changelog.md) owns chronological release history, version-specific
  changes, and compatibility notes.

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
