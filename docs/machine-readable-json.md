# Machine-Readable JSON Compatibility

Every public `--format json` document identifies its top-level contract with
`schemaVersion`. Consumers must select a parser from that value rather than
from the Renma package version, command name, field order, or an implementation
path.

## Contract identifiers

| Command or output        | Top-level `schemaVersion`                  |
| ------------------------ | ------------------------------------------ |
| `scan`                   | `renma.scan.v1`                            |
| `catalog`                | `renma.catalog.v1`                         |
| `graph`                  | `renma.graph.v1`                           |
| `readiness`              | `renma.readiness.v1`                       |
| `ownership`              | `renma.ownership.v1`                       |
| `diff`                   | `renma.diff.v1`                            |
| `ci-report`              | `renma.ci-report.v1`                       |
| `inspect` outline        | `renma.inspect-outline.v1`                 |
| `inspect --lines`        | `renma.inspect-slice.v1`                   |
| `guide skill`            | `renma.skill-authoring-guide.v1`           |
| `scaffold`               | `renma.scaffold.v1`                        |
| `suggest-metadata`       | `renma.metadata-suggestion.v1`             |
| `suggest-semantic-split` | `renma.semantic-split-suggestion.v1`       |
| `skill-index`            | `renma.skill-index.v1`                     |
| `trust-graph`            | `renma.trustGraph.v2`                      |
| `bom`                    | `renma.repository-context-bom.v2`          |
| `execution-contract`     | `renma.experimental-execution-contract.v1` |

The internal `PUBLIC_JSON_SCHEMA_VERSIONS` registry mirrors this table and
separates stable identifiers from the explicitly experimental execution
contract. A repository test compares the registry and this documentation so a
public top-level document cannot be added, removed, or renamed on only one
side.

The execution contract remains explicitly experimental under its documented
compatibility policy. Published BOM, Trust Graph, and Skill Authoring Handoff
JSON Schemas remain the normative schemas for those artifacts. A versioned
nested object, such as inspection coverage or a Skill Discovery diff, keeps its
own identifier; the outer identifier does not replace or reinterpret it.

`formatJsonDocument` is also used internally as a serialization utility. An
internal object does not become a public contract merely because it can be
serialized, and internal working values do not receive `schemaVersion`
blindly.

For scan consumers, the public TypeScript `ScanJsonDocument` models the wire
shape with literal `schemaVersion: "renma.scan.v1"` and `format: "json"`.
Renma's pre-serialization core scan model has no supported public library
producer and remains internal; `formatJson()` remains the authoritative
serializer.

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

## Determinism and environment-derived values

Deterministic output means the same command, repository bytes, configuration,
explicit options, and relevant revision inputs produce the same ordered
projection in the same environment. It does not mean every value is portable
across machines.

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
