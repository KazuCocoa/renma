# Renma Documentation

Start with the README for an overview, then choose the reference for your task.
Each linked guide owns its detailed contract; this index maps where to look.

## Start Here

- [README](https://github.com/KazuCocoa/renma/blob/main/README.md): product purpose, boundaries, installation, and first commands.
- [User Manual](user-manual.md): CLI workflows, operational metadata, and [repository configuration](user-manual.md#configuration). Emitted `renma --help` and `renma <command> --help` remain the command-line authority.
- [Authoring Guide](authoring-guide.md): asset responsibilities, evidence, creation gate, and handoff. Interaction guidance is adaptive, not a prescribed LLM reasoning algorithm.

## Diagnostics And Security

- [Diagnostics Reference](diagnostics.md): Finding semantics, stable IDs, evidence, repair constraints, and verification.
- [Security Policy Guide](security-policy.md): effective policy, revision review, and supported instruction analysis. The User Manual owns field mappings; the guide explains the boundaries with SAST, secret/dependency scanning, and runtime controls.
- [Renma Quality Profile](quality-profile.md): exact thresholds, units, provenance, rationale, and configuration status.
- [Metadata Budget](metadata-budget.md): metadata-size diagnostics.
- [Context Lifecycle Diagnostics](context-lifecycle-diagnostics.md), [Context Conflict Diagnostics](context-conflict-diagnostics.md), and [Context Language Diagnostics](context-language-diagnostics.md): focused diagnostic families.

## Asset And Relationship Contracts

- [Version-pinned Asset References and Builder API](asset-bindings.md): exact references, version binding, and the read-only builder API.
- [Agent Skills Compatibility and Migration](agent-skills-compatibility.md): canonical paths and metadata, validation, and one-way migration.
- [Advanced Skill Authoring](advanced-skill-authoring.md): focused workflows, orchestration, and progressive disclosure.
- [Context Lens](context-lens.md): justification, fields, relationships, and the non-runtime boundary.
- [Declared Composition](declared-composition.md): forward required/optional closure, provenance, completeness, conflicts, and cycles.
- [Declared Impact](declared-impact.md): reverse explicit composition and change review.
- [Skill Discovery](skill-discovery.md): static publication, continuation routes, reachability, coverage, Skill Index, diff, and warn-only CI policy.
- [Repository Context BOM v3](repository-context-bom.md): deterministic, reproducible declared manifests.
- [Machine-Readable JSON Compatibility](machine-readable-json.md): top-level schemas, 1.x compatibility rules, and environment-derived fields.
- [Experimental Execution Contract](execution-contract.md): static possible relationships, one-snapshot guarantees, bounded completeness, and external revision/hash binding.
- [Trust Graph v2](trust-graph.md): evidence provenance and ordering, not a trust score.
- [Published JSON Schemas](https://github.com/KazuCocoa/renma/tree/main/docs/schemas): packaged BOM, Trust Graph, and Skill Authoring Handoff contracts.

## Development

Files under `development/` explain implementation rationale and are excluded
from the npm package. User-facing contracts remain in the references above.

- [Public Architecture](development/architecture.md): layers, data flow, and stable product boundaries.
- [Internal Architecture](development/internal-architecture.md): module ownership, dependencies, projections, compatibility seams, and invariants.
- [Product Design](development/design.md): durable decisions and capabilities outside core.
- [External Review Governance](external-review-governance.md): candidate direction and SkillSpector experiment plan, not a current product contract.
- [Current Roadmap](development/plan.md): stabilization baseline, open candidates, deferred concerns, and non-commitments.
- [Renma 1.0 Stabilization Boundary](development/stabilization-1.0.md): completed reduction, retained shell/CI contracts, precision-first analysis, and release gates.
- [Skill Discovery Design](development/plan-discovery.md): rationale behind the current static Discovery contract.
- [Versioned Asset Bindings Design](development/versioned-skill-bindings.md): reference and metadata decisions for external builders.
- [Release Publication Security](development/release-security.md): repository checks, their limits, and required external npm/GitHub controls.
- [Changelog](changelog.md): release history and compatibility notes.

## Examples

Examples require a source checkout and are not included in the npm package:

- [Interactive Placeholder](https://github.com/KazuCocoa/renma/tree/main/examples/interactive-placeholder)
- [Example Context Repository](https://github.com/KazuCocoa/renma/tree/main/examples/context-repo)
- [Context Lens](https://github.com/KazuCocoa/renma/tree/main/examples/context-lens)
- [GitHub Actions](https://github.com/KazuCocoa/renma/blob/main/examples/github-actions/renma-ci-report.yml)

## Maintaining The Documentation Site

Markdown in this directory is the documentation source of truth. From the
repository root:

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Fenced `mermaid` blocks render automatically; their source remains the editable
form. Verify diagram changes with `npm run docs:build` and a local preview.
Diagrams must not require loose security or executable click behavior.
