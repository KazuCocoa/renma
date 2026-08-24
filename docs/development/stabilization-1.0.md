# Renma 1.0 Stabilization Boundary

This document records the completed reduction boundary for Renma 1.0. It is a
stabilization baseline, not a promise that every historical pre-1.0 output is
compatible.

## Stabilization Status

The planned reduction and internal cleanup are complete as of 2026-08-23. The
final audit found no remaining test-only production module, pass-through
facade, unsupported compatibility projection, or duplicated repository
collection path that must be removed before 1.0.

The reduction did not treat diagnostic count as a simplification target.
Stable diagnostic identities and their verification remain in place, while
several prose-only diagnostic paths now use smaller, explicit local-evidence
rules. Structural POSIX shell, PowerShell, and Windows batch analysis remains
part of the product boundary. The separate `diff` and `ci-report` workflows
also remain, with one shared internal repository-diff path.

The remaining 1.0 work is release assurance rather than another product or
source-architecture phase. New diagnostics, commands, schemas, inference
coverage, and adjacent ecosystem work require independent scope review and are
not implied by this baseline.

## Core Product Responsibility

Renma 1.0 remains a deterministic repository-governance CLI. Its core owns:

- bounded discovery and classification of agent-facing repository assets;
- metadata, ownership, lifecycle, and declared-relationship validation;
- deterministic repository evidence, diagnostics, reports, and revision
  comparison;
- bounded static command evidence for POSIX shell, PowerShell, and Windows
  batch without executing repository instructions; and
- CI review evidence, including the existing `ci-report` GitHub Actions flow.

Renma does not prove that natural-language instructions are safe. A clean scan
means that no supported explicit pattern was detected in the inspected
surfaces. It does not establish semantic completeness, runtime safety, or the
absence of prompt injection.

## Natural-Language Analysis Boundary

Natural-language security diagnostics are precision-first review aids. They
may recognize an explicit action and target in one local line or clause. They
must not depend on:

- cross-sentence subject or policy inheritance;
- pronoun or implicit-actor resolution;
- distant approval, review, or mitigation guards;
- inferred intent, equivalence, or data flow; or
- an expanding exception grammar intended to cover arbitrary prose.

Ambiguous prose remains unsupported evidence rather than being classified as
safe. A diagnostic based only on prose is advisory by default. High or
Critical security findings require structural evidence such as command
position, a parsed destination, or effective policy metadata.

This boundary does not remove the bounded POSIX shell, PowerShell, or Windows
batch analyzers. Those analyzers provide structural evidence such as command
position, arguments, quoting, pipelines, separators, redirection, interpreter
invocation, and statically identifiable script paths. Unsupported dynamic
execution remains explicit instead of being guessed.

## CLI And CI Boundary

Command count alone is not a reason to merge public workflows. In particular,
`diff` and `ci-report` remain separate user-facing commands:

- `diff` describes semantic repository change;
- `ci-report` applies CI policy and produces the bounded review artifact used
  by the documented GitHub Actions integration.

They should share one internal diff projection. `ci-report` must not rediscover
or independently reinterpret repository differences. Its command-line
arguments, Markdown/JSON output purpose, failure threshold, and exit behavior
remain covered by the GitHub Actions integration tests.

Catalog, graph, Readiness, ownership, BOM, Skill Index, Trust Graph, and the
execution contract remain distinct while they answer distinct review
questions. A later consolidation requires evidence that two commands have the
same question, output semantics, and exit behavior; superficial similarity is
not sufficient.

## Diagnostic Migration Sequence

Producers author one canonical typed diagnostic model. The `renma.scan.v2`
public document selects that model as its single active `diagnostics` array and
uses the same shape for `suppressedDiagnostics`. The overlapping pre-1.0
`findings`, legacy `diagnostics`, and transitional `diagnosticsV2` wire fields
are no longer serialized. Producer-level scan evidence remains explicitly
internal as `rawDiagnostics`; it is not a compatibility projection or public
producer authority.

## Completion Record

1. **Canonical diagnostic ownership — complete.** Scan normalization is owned
   by `src/scan-diagnostics.ts`; `ScanResult.diagnostics` contains normalized
   diagnostics and producer-level evidence is explicitly internal as
   `rawDiagnostics`.
2. **Natural-language analysis boundary — complete.** Prose-only diagnostics
   use explicit local line or clause evidence and advisory severity, while the
   structural shell-family analyzers remain intact.
3. **Shared diff and CI evidence — complete.** `diff` and `ci-report` collect
   each archived repository state once and derive their distinct user-facing
   results from the shared snapshot and diff projection.
4. **1.0 JSON contract selection — complete.** Scan uses `renma.scan.v2`; the
   obsolete overlapping pre-1.0 scan projections are no longer serialized.
5. **Post-contract source cleanup — complete.** Single-consumer abstractions,
   test-only production wrappers, unused declarations, cross-owner re-exports,
   and unsupported internal compatibility facades were removed. Remaining
   subsystem entrypoints and small modules have distinct consumers or
   responsibilities.
6. **Release-candidate contract freeze — complete.** Stable top-level JSON
   identities are pinned independently of producer constants, existing
   document and schema fixtures remain authoritative, and the experimental
   execution contract and internal working models remain outside the freeze.

Refactoring followed deletion and contract selection; it did not create a new
abstraction around behavior excluded from the 1.0 boundary.

## Remaining 1.0 Release Gates

Before creating the 1.0 release tag, maintainers must:

- run the full tests, both TypeScript checks, package and public API
  verification, documentation build, strict self-scan, supported-platform
  validation, and the maintained release-preparation workflow on the exact
  release commit;
- refresh the full and production-only dependency audits and review whether a
  supported stable VitePress upgrade resolves the documented development-only
  advisories;
- verify the external npm Trusted Publisher, GitHub Environment, reviewer,
  deployment-ref, and release-tag protection described in
  [Release Publication Security](release-security.md); and
- prepare the version-specific release metadata through the existing release
  process without broadening the stabilized product boundary.

The documented VitePress `ES2024` target warning and the observed bundle-size
warning are non-fatal tooling concerns, not reasons to weaken the supported
TypeScript target or introduce an incompatible dependency override.
