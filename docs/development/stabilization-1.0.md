# Renma 1.0 Stabilization Boundary

This document records the decisions that govern the reduction work before
Renma 1.0. It is a development plan, not a promise that every current
pre-1.0 output will remain compatible.

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
are no longer serialized. Internal scan working data may remain until the
post-contract source reorganization; it is not a compatibility projection or
public producer authority.

## Implementation Order

1. Preserve current public output while separating canonical diagnostics from
   compatibility serialization.
2. Reduce prose-only diagnostics to explicit local evidence and advisory
   severity while retaining command analyzers.
3. Preserve the `ci-report` integration and remove internal diff/report
   duplication.
4. Select the 1.0 JSON contracts and remove obsolete pre-1.0 projections.
   Completed for scan as `renma.scan.v2`.
5. Reorganize source directories, serializers, documentation, and tests behind
   the settled public boundary.
6. Freeze compatibility only for the release-candidate contracts.

Refactoring must follow deletion and contract selection. Renma should not
first create a cleaner abstraction around behavior that 1.0 does not intend to
keep.
