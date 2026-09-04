# Repository Context BOM

`renma bom` emits a declared repository manifest for review and CI consumers.
Renma currently emits only the v3 BOM schema. V2 was the first supported
long-term contract; v3 changes the embedded Readiness check contract described
below. Earlier v1 output was an experimental pre-contract surface removed
before broader adoption. Renma does not provide a legacy output mode, although
the published v2 schema remains available for consumers validating archived
artifacts.

The BOM is not a runtime usage report. It does not describe what an LLM actually consumed, assemble prompts, choose task-specific context, inject context into agents, execute agents, call an LLM, import consumed-context evidence, or collect telemetry.

The User Manual's
[authoritative metadata reference](user-manual.md#authoritative-metadata-reference)
defines which declarations feed BOM projections. This document owns the BOM
schema, snapshot, ordering, and reproducibility semantics rather than a
separate metadata field inventory.

```mermaid
flowchart TD
  Sources["Repository files and configuration"]
  Snapshot["One collected in-memory repository snapshot"]
  Catalog["Catalog and dependency graph"]
  Diagnostics["Diagnostics and Readiness"]
  Governance["Lifecycle and ownership evidence"]
  Security["Security posture and policy inventory"]
  Bom["Repository Context BOM v3"]
  Json["Authoritative JSON"]
  Markdown["Markdown review projection"]
  Revision["Git, CI, or PR context supplies revision identity"]
  Runtime["Runtime consumed-context evidence — separate artifact"]
  Sources --> Snapshot
  Snapshot --> Catalog
  Snapshot --> Diagnostics
  Snapshot --> Governance
  Snapshot --> Security
  Catalog --> Bom
  Diagnostics --> Bom
  Governance --> Bom
  Security --> Bom
  Bom --> Json
  Bom --> Markdown
  Revision -.-> Bom
```

The diagram separates collection from projection: every BOM section is derived
from one collected snapshot, JSON is authoritative, and Markdown is a review
view. `--omit-generated-at` removes generation-time noise only. Revision
identity stays in the surrounding Git, CI, or pull-request context, and any
runtime consumed-context evidence remains a separate artifact.

## Snapshot Contract

One BOM execution is derived from one in-memory repository snapshot:

1. Resolve configuration once.
2. Discover and read repository artifacts once.
3. Parse documents once.
4. Build the catalog once.
5. Derive graph, findings, diagnostics, Context Lens evidence, readiness, security posture, security policy inventory, and executable-surface inventory from that same snapshot.
6. Format JSON or Markdown only after the complete report has been built.

Renma does not freeze the working tree while another process is modifying it. If files change during collection, the BOM reflects the artifacts Renma read for that execution; after collection, all report sections are derived from the collected snapshot.

## Output Authority

JSON is the authoritative BOM output. Markdown is a compact review projection for pull requests and humans; it is not the canonical serialization.

Array ordering is deterministic, locale-independent ECMAScript UTF-16
code-unit order and is part of Renma's output contract. Asset `sourcePath`
values remain repository-relative. `root` and `configPath` remain absolute
paths from the current environment.

Assets use `ownership.declaredOwner`, `ownership.effectiveOwner`,
`ownership.source`, and optional `ownership.inheritedFrom`. Readiness uses the
effective owner.

## Reproducibility

`--omit-generated-at` means only:

- omit the run-time `generatedAt` field;
- remove clock-based differences caused by that field.

It does not mean:

- ignore `lastReviewedAt`, `reviewCycle`, or `expiresAt`;
- suppress freshness diagnostics;
- normalize `root` or `configPath`;
- make output portable across different checkout directories;
- hide file moves;
- guarantee identical output across different evaluation dates;
- freeze a repository while another process is modifying it.

Supported guarantee:

> With the same checkout path, config path, repository contents, Renma version, and UTC evaluation date, repeated `--omit-generated-at` runs should produce byte-identical JSON.

Freshness evaluation uses the UTC calendar date. Metadata dates remain part of the snapshot and must not be removed as timestamp noise. A real file move is a meaningful BOM change because `sourcePath` is repository evidence. Portable byte-for-byte output across different checkout paths is not a v3 guarantee; locale differences alone do not change ordering.

## Schema Evolution

`schemaVersion` represents the consumer-facing BOM schema. `generator.version` represents the Renma implementation version and is not the schema version.

V2 was the first supported long-term contract for normalized ownership,
first-class support assets, and static support relationships. V3 carries those
fields forward and changes the embedded Readiness check collection. Consumers
must inspect `schemaVersion` independently from `generator.version`. An
incompatible contract must use a new schema version.

Within a schema, changes should be backward-compatible and additive:

- existing fields must not be removed, renamed, or given incompatible types or meanings;
- new optional fields may be added when a real consumer requires them;
- enum additions are consumer-visible changes and must be documented;
- a breaking contract requires a new schema version rather than silently changing existing semantics.

Treat `owns_local_resource`, `statically_references`, `inherits_owner`, and
`inherits_policy` as static repository evidence, not runtime behavior. Branch
on `schemaVersion`; `generator.version` is provenance only.

The published [BOM v3 JSON Schema](schemas/repository-context-bom-v3.schema.json)
is the machine-readable contract. `generatedAt` is required when `outputMode`
is `default` and forbidden when `outputMode` is `omit_generated_at`.
`configPath` remains optional and is absent when no configuration file was
loaded. `executableSurfaceInventory` remains optional at the BOM v3 schema
boundary, preserving the v2 field requirements. Current Renma versions emit it
unconditionally. All other top-level
fields are required. Optional lifecycle, version, status, target-resolution,
and inherited-ownership fields appear only when their evidence exists. Owner
values are explicitly nullable; missing optional fields are omitted rather
than serialized as `null`.

BOM v3 carries forward v2's lifecycle status vocabulary and additively accepts
`revoked`. Asset and `lifecycle` projections may include optional
`statusReason` and `statusChangedAt` strings adjacent to status. These are
current declaration evidence only: BOM does not store transition history,
infer dates, schedule expiry, restore an asset, or propagate revocation.
Archived v2 documents without the optional fields remain valid under the
published v2 schema; the same fields remain optional in v3.

Arrays are deterministically ordered by their identity/path keys, and count
fields are non-negative integers. Count maps contain every declared enum
member, including zero counts. Policy source ordering is `local`,
`security_profile`, `repository_config`, `owning_skill`. Static support
relationships use `owns_local_resource`, `statically_references`,
`inherits_owner`, and `inherits_policy`.

The additive `executableSurfaceInventory` field retains its own explicit schema
identifier, `renma.executable-surface-inventory.v1`. Its summary counts,
path-identified surface rows, line-level invocation rows, content and inventory
fingerprints, reachability depth, interpreter hints, and bounded effective
policy correlation are complete in JSON. Current output also includes
invocation governance on every invocation and an invocation-governance
aggregate on every surface, complete executable dependency rows, and strict
per-surface incoming/outgoing and direct/transitive/unreached summaries.
Surface policy evidence remains separate and is never replaced by caller or
dependency evidence.

The inventory's closed analyzer enum additively includes `powershell` and
`batch`, and its launcher enum additively includes `pwsh`, `powershell`, `cmd`,
and their `.exe` spellings. Existing fields, analyzer values, launcher values,
relation meanings, and ordering are unchanged from v2. The nested
executable-surface inventory remains v1. Consumers that exhaustively switch on
closed enum values must accept these additions before processing repositories
with newly recognized Windows evidence.

Invocation governance retains prepared `source-artifact` and `owning-skill`
policy relationships without merging fields or applying precedence. Its
effective fingerprints are a sorted set of visible variants, not conflicts or
safety verdicts. The Markdown BOM renders separate surface-policy,
invocation-context-policy, and multiple-variant summaries plus compact
per-surface dependency counts and compact dependency rows; it does not print
complete fingerprints or source content. Surface rows are sorted by repository
path; invocation rows are sorted by source path, line, launcher, and target;
dependency rows are sorted by source path, line, analyzer, relation, target
candidates, and raw specifier.

Invocation rows combine the established fenced helper-command evidence with
bounded inline `Run`/`Run:` evidence. The inline command must be a single-line
mdast `inlineCode` node directly under a paragraph, immediately after the exact
structurally textual cue, and outside blockquotes. Text plus text-only emphasis
or strong formatting may form the cue; links, images, inline code, non-comment
HTML, reference-like nodes, and unsupported descendants may not. Both forms use
the same launcher, target resolution, occurrence ordinal, governance, and
direct/transitive reachability semantics. BOM v3 adds no syntax-origin field
and does not distinguish fenced from inline presentation. Ordinary inline code,
quoted examples, broader prose, other verbs or languages, and chained secondary
code spans do not create invocation rows.

When a recognized command path is also a static text reference, reference
evidence remains deduplicated by source path, source line, and target. One
inline `Run` occurrence therefore contributes one reference and one invocation,
not two references.

Repeated declarations, including identical declarations on one source line,
remain separate dependency rows and contribute separately to dependency
totals. Public BOM evidence exposes their shared line and distinct occurrence
ordinals, not the private source offsets used during collection. Per-surface
incoming/outgoing counts and static reachability instead use one canonical
graph edge for each unique source path and normalized target among `resolved`
and `noncanonical` rows. Import and re-export syntax for the same source-target
pair therefore stays auditable without multiplying graph topology.

BOM consumers must first branch on the presence of
`executableSurfaceInventory`, then inspect its nested `schema` identifier
before consuming its nested fields. The inventory remains additive v1. V3
carries forward the optional field boundaries introduced for Renma 0.27.0: the summary counts,
surface `invocationGovernance`, and invocation `governance` fields are optional
in the published schema. Executable `dependencies`, new dependency summary
counts, and surface `dependencyEvidence` are likewise optional for earlier
0.27.x BOM compatibility. Current Renma output emits all of them
unconditionally. Whenever a new governance, dependency, analyzer-count,
relation-count, or dependency-summary object is present, all of its nested
fields are required and unknown nested fields are rejected. Existing inventory
fields retain their established requirements.

The Readiness summary is a closed contract for asset, ownership, graph,
diagnostic, workflow, Context Lens, security posture, and security policy
inventory evidence. Coverage and readiness percentages are constrained to
`0..100`. Security posture top-finding entries require an ID, non-negative
count, and maximum severity. Security policy `assetKinds` is a complete count
map containing every generated artifact kind, including zero values.
Current output additively emits `externalUploadGovernance` in each security
policy inventory. Its five required counts distinguish denied upload, upload
allowed with approval required, upload allowed with approval not required,
upload allowed with the approval requirement unspecified, and unspecified
upload permission. The field remains optional in v3; archived v2 documents are
validated against the retained v2 schema. When present, its nested shape is
closed and all five counts are required.

### V2 to v3 migration

V3 removes the producerless `layout.disallowed_skill_assets` Readiness check
and adds `skills.support_integrity`. The new check represents explicitly
referenced Skill support that cannot be resolved or inspected. It uses
authoritative `inspectionCoverage` issues whose `expectationSource` is
`static-support-reference` for excluded, symlinked, unreadable, oversized,
depth-limited, and unsupported support, plus missing-reference Finding evidence
where inspection coverage intentionally has no missing-path issue. Suppression
may remove an ordinary Finding from the active Finding list, but cannot make
the embedded Readiness check claim that authoritative support inspection is
complete. Unrelated repository inspection issues and unreferenced Skill-local
files do not affect this check, and it creates no placement policy. Consumers
that key, count, compare, or allowlist embedded Readiness checks must migrate to
the new ID and meaning. No other BOM field, type, or nested schema identifier
changes. Locale-independent ordering fixes restore the already documented
deterministic ordering contract and therefore do not independently require
another schema version.

Representative top-level JSON (nested objects are shortened for readability;
the schema defines every nested field):

```json
{
  "schemaVersion": "renma.repository-context-bom.v3",
  "outputMode": "omit_generated_at",
  "generator": { "name": "renma", "version": "<installed-version>" },
  "root": "/checkout/repository",
  "scope": { "type": "declared_repository_manifest", "runtimeUsage": false, "telemetryCollected": false },
  "summary": { "scannedFileCount": 0, "assetCount": 0, "dependencyCount": 0, "resolvedDependencyCount": 0, "unresolvedDependencyCount": 0, "ownedAssetCount": 0, "unownedAssetCount": 0, "readinessScore": 100, "readinessLevel": "ready", "diagnosticCounts": { "error": 0, "warning": 0, "info": 0 } },
  "assets": [],
  "dependencies": [],
  "readiness": { "score": 100, "level": "ready", "checks": [], "summary": {} },
  "securityPosture": { "totalSecurityFindings": 0, "riskClasses": { "violation": 0, "suspicious": 0, "advisory": 0, "unclassified": 0 }, "severities": { "critical": 0, "high": 0, "medium": 0, "low": 0 }, "highOrCritical": 0, "topFindingIds": [] },
  "securityPolicyInventory": {},
  "executableSurfaceInventory": { "schema": "renma.executable-surface-inventory.v1", "summary": {}, "surfaces": [], "invocations": [], "dependencies": [] },
  "diagnostics": []
}
```

Generated representative reports are validated against the published schema in
the contract test suite.

`--omit-generated-at` does not make the report a generic canonical JSON format or a portable artifact.

## Source Provenance

BOM v3 provenance is deliberately repository-local:

- repository-relative source paths;
- per-asset content hashes;
- generator name and version;
- current absolute `root` and `configPath` information when available;
- lifecycle, dependency, diagnostic, readiness, security posture, security policy inventory, and executable-surface evidence.

Executable-surface evidence is static repository visibility, not a claim about
runtime use or safety. Static dependency reachability does not prove runtime
execution, and an uninvoked surface is not necessarily unused. It does not
execute files, follow symbolic links, inspect
permission bits, or scan package manifests, GitHub Actions, Dockerfiles, Git
hooks, remote scripts, ordinary external commands, or unrelated repository
files. Such sources remain intentionally unsupported in this inventory slice.

Renma does not automatically invoke Git or add Git commit, branch, tag, or
dirty-state fields. Git revision identity comes from the surrounding Git, CI,
artifact, or pull-request context.

## Consumed-Context Evidence

The BOM v3 schema describes declared repository state. Consumed-context evidence
must not redefine or mutate that meaning.

Runtime evidence should be a separate artifact or explicitly separate
attachment. Such a record should relate back to a BOM using stable values such
as a BOM digest or snapshot identity, asset ID, asset content hash, producer
identity and version, and observation timestamp.

External agents, editor integrations, wrappers, or CI tools may produce those
signals. They remain outside the BOM contract and Renma's role as a static
repository analyzer; Renma is not a telemetry collector, runtime wrapper,
dashboard, or provider gateway.
