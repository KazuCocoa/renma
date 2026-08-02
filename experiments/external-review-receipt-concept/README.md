# External-review receipt concept experiment

> Deliberately unstable, versionless/v0 experiment. This directory is not a
> public schema, compatibility contract, adapter design, parser, SDK, registry,
> plugin interface, Renma command, runtime input, or production implementation.

## Research question and result

Can one deliberately unstable receipt concept represent the governance
evidence observed from SkillSpector and Cisco Skill Scanner without translating
producer semantics or manufacturing binding, completeness, safety, freshness,
or requirement conclusions?

**Result: yes for an evidence-preserving conceptual envelope, no for a
production contract.** [`receipt-concept.json`](receipt-concept.json) projects
one captured SkillSpector executable-context fixture and one captured Cisco
`release-prep` scan. Both were already executed and documented elsewhere; this
experiment did not run either scanner and does not copy or modify their native
reports.

The SkillSpector capture is committed and referenced directly. Cisco's raw
reports and generated Renma evidence remain intentionally ignored and
uncommitted; Cisco values therefore cite the committed evaluation record and
its recorded raw-artifact digests. The concept does not require those local
generated files to exist.

The JSON label is
`renma.experiment.external-review-receipt-concept.v0`. Its names, nesting, and
states may change or disappear without notice. The projection uses explicit
`known`, `unknown`, `unavailable`, `unsupported`, `contradictory`, and `invalid`
states. A `known` value identifies its evidence sources. Other states retain a
reason and provenance rather than using an ambiguous `null`.

## Observed cases

| Dimension | SkillSpector captured fixture | Cisco `release-prep` |
| --- | --- | --- |
| Native artifact | SkillSpector 2.5.0 JSON with eight opaque findings | Cisco JSON plus SARIF with one opaque native finding |
| Producer version | Native JSON and process probe agree on 2.5.0 | Externally verified as 2.0.12; native JSON omits it and native SARIF incorrectly says 1.0.0 |
| Logical subject | Native `shared-owner` root correlates to one captured Renma catalog Skill | Native `release-prep` name/path correlates to one Renma catalog Skill |
| Reviewed scope | Partial: seven producer-listed paths, but no native per-component hashes | Partial: the Skill root is known, but native output omits a complete file inventory and hashes |
| Execution | Process exit 0 and native success | Process exit 0 plus SARIF `executionSuccessful: true` |
| Producer completeness | Native `is_complete: false` despite seven of seven components and 100% coverage; 20 analyzer entries completed and four were disabled | Unavailable: no comparable completeness or analyzer-work ledger |
| Required-profile completeness | Unknown: no named, digest-bound required analyzer set | Unknown: analyzer names and native policy identity do not prove internal work or required-profile completion |
| Native assessment | Opaque 32 / `MEDIUM` / `CAUTION` | Opaque `is_safe: true` / maximum `INFO` |
| Suppression or policy | No baseline supplied; native suppressed count 0; no baseline identity | Native policy fingerprint is known; suppressed count and applied-suppression ledger are unavailable |
| Relationship context | Existing captured executable `invokes` and `contains` evidence is referenced separately | Unavailable for this case |

The subject correlation binds a logical asset identity. It does not bind the
producer to the catalog's content hash: that hash is separately sourced Renma
evidence. Likewise, an observed producer component path is not exact reviewed
content without content evidence.

## What is genuinely common

The useful common concepts are producer provenance, exact artifact integrity,
logical-subject binding, reviewed-scope binding, execution status, profile or
policy identity, required-profile completeness, native findings, native
assessment, limitations, suppression/baseline identity, freshness, and
requirement satisfaction. “Common” means both producers raise the same
governance question; it does not mean their values or semantics are
interchangeable.

Producer-specific extensions remain necessary. SkillSpector owns its score,
severity, recommendation, analyzer ledger, coverage, `is_complete`, rule IDs,
and finding IDs. Cisco owns `is_safe`, maximum severity, policy metadata,
analyzer names, rule IDs, and finding IDs. No common rule taxonomy, severity
scale, score, recommendation, safety meaning, or deduplication key is created.
Native finding collections are opaque references to their respective reports.

## Unknown and unavailable evidence

Both cases lack exact producer-bound component content and a stable review-scope
digest contract. Neither case has a Renma-required profile or requirement
evaluator, so required-profile completeness and requirement satisfaction remain
unknown. Freshness remains unknown because exact scope content and a freshness
policy are absent.

Cisco additionally lacks native producer-version evidence, complete reviewed
scope, producer-native completeness, a general limitation/applicability
ledger, suppressed count, and applied-suppression identity. Its version is a
deliberate contradiction: the projection preserves the invalid native SARIF
`1.0.0`, the unavailable native JSON value, and the externally qualified
installation receipt for 2.0.12 instead of rewriting native evidence.

## Semantic audit and explicit non-claims

The concept deliberately does **not** imply any of the following:

- Successful execution means exact reviewed scope or complete analysis.
- `coverage_percent: 100` repairs SkillSpector's native
  `is_complete: false`.
- Cisco's three analyzer names establish required-profile completeness or
  internal analyzer-work completion.
- A native `SAFE`, `is_safe`, passing exit, score, severity, recommendation,
  or empty finding set proves safety or satisfies a Renma requirement.
- The repeated empty SkillSpector SARIF digest
  `sha256:ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4`
  identifies a subject or scope. That same digest was observed for at least
  four distinct targets.
- Renma executable `invokes` or `contains` edges prove scanner coverage,
  reviewed scope, ownership, runtime execution, freshness, impact, or
  requirement satisfaction.
- Renma catalog identity or content hashes were native producer facts.
- Cisco's externally verified 2.0.12 version appeared in its native report.
- Findings from the two producers can be translated, merged, compared by
  severity, or deduplicated.

The targeted
[`semantic-guardrails.test.mjs`](semantic-guardrails.test.mjs) predicates check
these separations and verify that referenced artifact digests still match the
committed evidence. They are not a general schema validator or adapter
framework.

Run them with:

```bash
node --test experiments/external-review-receipt-concept/semantic-guardrails.test.mjs
```

## Decision recommendation

Do not proceed to a production receipt, parser, adapter, public schema, generic
framework, or Renma governance implementation. The concept can honestly carry
the two observed cases only because unavailable and contradictory states remain
first-class and because producer-native objects stay opaque.

Another projection-shaping experiment is not justified yet. Upstream producer
contract gaps are the blocker: Cisco needs trustworthy native producer/report
versioning, complete scope and component identity, and a serialized
completeness/limitation contract; both producers need a content-binding
contract for complete reviewed scope; and any Renma governance evaluation
would first need an independently designed, named, digest-bound required
profile. Revisit the concept only after one of those contracts materially
changes or a third producer exposes stronger evidence that tests a genuinely
new shape.

## Production boundary

This experiment changes only files in this directory. It adds no production
command, public JSON Schema or TypeScript type, adapter/parser package, SDK,
registry, plugin interface, review-requirement metadata, BOM field or version,
catalog kind, Trust Graph relation, diagnostic, security finding, Readiness or
CI verdict, dependency, package content, or package version. The existing
SkillSpector executable-context capture is referenced without modification.
