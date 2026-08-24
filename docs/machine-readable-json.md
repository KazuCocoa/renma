# Machine-Readable JSON Compatibility

Every public `--format json` document identifies its top-level contract with
`schemaVersion`. Consumers must select a parser from that value rather than
from the Renma package version, command name, field order, or an implementation
path.

## Contract identifiers

| Command or output        | Top-level `schemaVersion`                  | Repository compatibility assurance                          |
| ------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| `scan`                   | `renma.scan.v2`                            | Representative whole-document golden                        |
| `catalog`                | `renma.catalog.v1`                         | Representative whole-document golden                        |
| `graph`                  | `renma.graph.v1`                           | Representative whole-document golden                        |
| `readiness`              | `renma.readiness.v2`                       | Representative whole-document golden                        |
| `ownership`              | `renma.ownership.v1`                       | Representative whole-document golden                        |
| `diff`                   | `renma.diff.v1`                            | Representative revision-diff whole-document golden          |
| `ci-report`              | `renma.ci-report.v1`                       | Representative revision-report whole-document golden        |
| `inspect` outline        | `renma.inspect-outline.v1`                 | Representative whole-document golden                        |
| `inspect --lines`        | `renma.inspect-slice.v1`                   | Representative whole-document golden                        |
| `guide skill`            | `renma.skill-authoring-guide.v1`           | Representative whole-document golden                        |
| `scaffold`               | `renma.scaffold.v1`                        | Representative whole-document golden                        |
| `suggest-metadata`       | `renma.metadata-suggestion.v1`             | Representative whole-document golden                        |
| `suggest-semantic-split` | `renma.semantic-split-suggestion.v1`       | Representative whole-document golden                        |
| `skill-index`            | `renma.skill-index.v1`                     | Representative whole-document golden                        |
| `trust-graph`            | `renma.trustGraph.v2`                      | Published JSON Schema plus frozen semantic contract fixture |
| `bom`                    | `renma.repository-context-bom.v3`          | Published JSON Schema plus whole-document golden            |
| `execution-contract`     | `renma.experimental-execution-contract.v1` | Explicitly experimental tests; no stable 1.x assurance      |

The test-owned `PUBLIC_JSON_SCHEMA_VERSIONS` registry mirrors this table and
separates stable identifiers from the explicitly experimental execution
contract. Repository tests compare the registry and this documentation so a
public top-level document cannot be added, removed, or renamed on only one
side without adding runtime inventory code.

The compatibility-assurance column is also intentional release evidence. The
golden suite normalizes checkout-local paths and package-derived versions, then
compares the complete serialized document. The Trust Graph uses its published
Draft 2020-12 schema and an exact semantic contract fixture instead because
those guards are stronger than adding a second representative golden.

`renma.trustGraph.v2` intentionally retains its established camel-case
spelling. It is already a published stable identifier used by the schema,
producers, tests, and consumer documentation. Renaming it for stylistic
consistency would itself be a breaking wire-contract change, so Renma 1.x keeps
the spelling and its compatibility test locks that decision.

The execution contract remains explicitly experimental under its documented
compatibility policy. Published BOM, Trust Graph, and Skill Authoring Handoff
JSON Schemas remain the normative schemas for those artifacts. A versioned
nested object, such as inspection coverage or a Skill Discovery diff, keeps its
own identifier; the outer identifier does not replace or reinterpret it.

Readiness v2 replaces the producerless
`layout.disallowed_skill_assets` check with `skills.support_integrity`. The
replacement uses authoritative `inspectionCoverage` issues marked as static
Skill-support expectations, plus missing-reference Finding evidence where no
coverage issue is intentionally created. Excluded, symlinked, unreadable,
oversized, depth-limited, and unsupported explicit support fails the check;
unrelated repository coverage issues do not. Finding suppression does not turn
authoritative support-inspection incompleteness into a pass. Because BOM embeds
the Readiness check collection, BOM v3 carries the same breaking migration.
Consumers of Readiness v1 or BOM v2 must update check-ID allowlists, maps, and
comparisons; the old check ID has no alias in the new contracts.

`formatJsonDocument` is also used internally as a serialization utility. An
internal object does not become a public contract merely because it can be
serialized, and internal working values do not receive `schemaVersion`
blindly.

For scan consumers, the public TypeScript `ScanJsonDocument` models the wire
shape with literal `schemaVersion: "renma.scan.v2"` and `format: "json"`.
Renma's pre-serialization core scan model has no supported public library
producer and remains internal; `formatJson()` remains the authoritative
serializer. Its dedicated `toScanJsonDocument()` projection explicitly selects
every supported top-level field; it never spreads the internal `ScanResult`
model into the wire document.

Scan v2 replaces the three overlapping pre-1.0 projections (`findings`, legacy
`diagnostics`, and `diagnosticsV2`) with one canonical normalized `diagnostics`
array. Suppressed results use the same diagnostic shape under
`suppressedDiagnostics`, paired with their suppression evidence. Consumers
must branch on `schemaVersion` and migrate field access rather than treating v2
as an additive v1 extension.

Classification `matchedRule` and `reasonCode` values are open enums in JSON and
in the public TypeScript wire types. Consumers must retain unfamiliar future
strings and fail closed. The exported `KnownAssetClassificationRule` and
`KnownAssetClassificationReasonCode` helpers describe only values known to the
current Renma version and are appropriate for exhaustive handling followed by
an unknown-value fallback.

## Compatibility during 1.x

For a stable identifier, Renma 1.x may make backward-compatible additions:

- add optional fields;
- add new array entries or map keys where the contract already permits an open
  collection;
- add enum values only where the contract tells consumers to preserve or
  tolerate unknown values; and
- clarify prose without changing the meaning of structured fields.

Renma must use a new schema identifier for a breaking change, including
removing or renaming a field, changing its type or established meaning, making
an optional field unconditionally required for existing producers, changing
closed-enum behavior, or reinterpreting identity and ordering rules. A package
major version by itself is not a substitute for a schema version, and a schema
version change still requires release notes and migration guidance.

Consumers should ignore unknown optional fields, preserve unknown open-enum
values when forwarding evidence, and fail clearly when they do not support the
document's top-level `schemaVersion`.

## Renma 1.0 release-candidate freeze

The stable identifiers in the contract table are the Renma 1.0
release-candidate top-level JSON identities. Their exact command-to-identifier
mapping is pinned independently of the producer constants, while the existing
whole-document goldens, published schemas, and semantic fixtures continue to
freeze document shape and meaning. The checked-in public TypeScript API
snapshot separately freezes the supported npm type entrypoints.

This freeze does not include `renma.experimental-execution-contract.v1`,
internal `ScanResult` fields, implementation module paths, diagnostic prose,
or environment-derived values documented below. After the freeze, a breaking
change to a stable JSON contract requires a new schema identity and migration
guidance; updating producer code and documentation together is not sufficient.

## Determinism and environment-derived values

Deterministic machine ordering uses ECMAScript UTF-16 code-unit comparison and
does not depend on the host locale. The same command, repository bytes,
configuration, explicit options, and relevant revision inputs therefore
produce the same ordered projection across locale settings. This applies to
serialized evidence, identity/digest inputs, diagnostic selection, and
suppression selection. It does not mean every value is portable across
machines.

The locale-independent ordering correction is an implementation bug fix that
restores the stable-order promises already made by scan v1, catalog v1, graph
v1, diff v1, CI report v1, Trust Graph v2, and the BOM ordering contract. Those
contracts are not versioned again for the fix. The experimental execution
contract remains v1 because its evidence digest was already specified as a
deterministic projection and carries no long-term compatibility promise.
Readiness and BOM versions change for the check-collection migration, not for
the comparator fix.

In particular:

- top-level `root`, inspect paths, and semantic-split source or Skill paths may
  be absolute and therefore depend on checkout location;
- scaffold `path` echoes the caller's target spelling;
- BOM `generatedAt` is time-derived unless `--omit-generated-at` is used;
- BOM generator version and guide `renmaVersion` come from the installed Renma
  package;
- diff and CI endpoints reflect the supplied Git revisions and repository
  evidence; and
- operating-system error text is not a machine-readable success contract.

Golden compatibility fixtures normalize the absolute repository root where
necessary. Consumers comparing portable identities should use documented
content hashes, digests, stable IDs, repository-relative paths, or command
options such as `--omit-generated-at`, not compare environment-derived fields
as though they were universal constants.
