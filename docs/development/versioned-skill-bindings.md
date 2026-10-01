# Versioned Asset Bindings for External Builders

Status: implemented in Renma 0.40.0. The historical filename is retained for links.

Renma parses declarations and original-source evidence and validates a supplied
repository snapshot. External builders resolve sources, download historical
versions, traverse selected dependencies, maintain lockfiles, bundle files,
rewrite references and generate Plugins. Renma does none of those operations.

## Authoring contract

Bindings annotate existing composition declarations; they never add edges.
Skills, independently governed Contexts and Lenses can bind required/optional
Context and Lens relationships. Only Skills can bind required/optional Skill
relationships; only Lenses can bind `applies_to` (a Context target).
Ordinary links, `references`, Discovery continuation and `extends` are not
binding relationships. Existing required/optional membership, cycles, policy
and snapshot composition completeness remain unchanged. Catalog, composition,
reverse impact and graph projections now share binding annotations and expose
separate local binding-satisfaction summaries; see
[the binding report contract](../asset-bindings.md#dependency-analysis-and-graph-reports).

Skills use a flat metadata string containing a strict JSON array:

```yaml
metadata:
  renma.id: skill.a
  renma.version: "1.0.1"
  renma.requires-skill: '["skill.b"]'
  renma.asset-bindings: '[{"alias":"b","target":"skill.b","version":"1.0.0"}]'
```

Contexts and Lenses use a native top-level YAML sequence:

```yaml
id: lens.review
type: context_lens
version: "1"
release_version: "2026-09"
applies_to: [context.rules]
asset_bindings:
  - alias: rules
    target: context.rules
    version: "2.0"
```

Each entry requires string `alias` and `target`, plus `version` and/or `ref`.
Optional `resolved.commit` carries a full externally supplied Git SHA; see
[resolution provenance](../asset-bindings.md#resolution-provenance).
Aliases match `[a-z][a-z0-9-]*`. Aliases and targets must each be unique.
Targets must be explicit stable IDs already named by a supported declaration,
not paths or URLs. Duplicate object keys, unrecognized keys and malformed
entries are errors. Values are never silently trimmed or coerced. Empty arrays are valid.

Release versions are non-empty strings without surrounding whitespace, compared
by exact equality; no SemVer syntax or precedence is imposed. A literal range,
tag or URL is never resolved: it could match only an identical authored release
identifier. Skill `renma.version` and Context `version` retain their existing
text semantics. Lens `version` remains the format version (currently `"1"`);
only Lens `release_version` identifies a distribution release. Binding sources
need explicit IDs and release versions. Selected targets need explicit IDs and,
for a version comparison, release versions. Supporting files
without independent governance are pinned by the builder's parent inventory
and hashes, not made independently versioned by this extension.

## Body references and evidence

Write `[workflow B](renma-asset:b)`. Aliases are local to the declaring file.
Only inline Markdown links with literal, unescaped destinations are supported;
angle-delimited destinations and optional titles are supported. Images,
reference definitions/links, autolinks and HTML attributes using the reserved
scheme are diagnosed as unsupported. Queries, fragments, suffixes, percent
encoding and invalid aliases are diagnosed. Fenced/indented code, inline code,
and plain prose are inert. Renma never rewrites bodies.

Locations are half-open UTF-16 code-unit offsets into the exact original UTF-8
file decoded without removing BOM or normalizing CRLF. Each location includes
the SHA-256 digest of the original bytes, path, raw slice and one-based lines.
Consumers must check the digest before rewriting. Metadata evidence uses the
whole original YAML field plus entry index; no fictitious JSON subranges.

## Validation and API

`renma/asset-bindings` exposes `inspectAssetBindings(files)` over caller-supplied
`{ path, bytes: Uint8Array }` records. Paths must be unique normalized
repository-relative paths; invalid paths and invalid UTF-8 throw. Supply the
complete snapshot to obtain meaningful local availability results. There is no
filesystem or network access. The report's schema identity is
`renma.asset-bindings.v1` and its JSON Schema is published separately.

Reports contain document identities/release versions, existing relationships,
normalized bindings, declaration diagnostics, local satisfaction and reference
locations. Files are sorted by UTF-16 path order; bindings retain array order,
relationships retain catalog order, references retain source order. The API
reuses the existing classification, operational metadata and catalog edges.
All returned data is detached from inputs; no private-module imports are needed.

Declared/requested selectors and external `resolved.commit` provenance are separate
from local `satisfaction` / `satisfied`; ref-only bindings check identity/kind and
never verify a Git revision. Declaration validity is separate from local satisfaction: matched, missing,
ambiguous, kind-mismatch, target-version-invalid or version-mismatch. A version
never disambiguates duplicate IDs. Candidate identities include original-source
evidence. Invalid source identity/version, duplicate aliases/targets, undeclared
targets and unsupported source relationships are separate declaration errors.
Existing metadata errors remain visible in the report.

`compareAssetBinding(binding, candidates)` compares already inspected identity
records from a separate acquired snapshot. A historical B 1.0.0 can match A's
pin while local B 2.0.0 remains a mismatch in A's original report. This helper
does not fetch, select an origin or establish integrity. Builders recursively
inspect selected snapshots to validate Skill → Skill → Context, Skill → Lens →
Context and Context → Context chains; Renma does not create a second closure.

Validation is opt-in through this dedicated API, not an addition to scan output
or its exit thresholds. Existing public JSON families and unbound-document
behavior are unchanged. Builders must require this API version explicitly.

## External Builder Responsibilities

The builder receives Renma declarations, its own source registry, and its own
plugin configuration. IDs are repository-governed, not globally unique: the
registry must map each dependency in its source context to one authoritative
origin, and reject collisions instead of guessing from ID or version alone.

The builder then:

1. Resolves exact requested versions to immutable source revisions or artifacts.
   A movable tag is insufficient as a final lock identity.
2. Verifies supplied identities and versions, and traverses selected transitive
   dependencies. Missing required versions fail; current main is never a fallback.
3. Records origins, revisions, source paths, exact versions, full component file
   inventories/digests, and per-caller bindings in a builder-owned lockfile.
   It detects same-version content changes and supports frozen-lock verification.
4. Includes required Skills, declared Context/Lens dependencies, and necessary
   support/scripts/assets. A graph of declared Skills is not a complete file
   manifest. File closure and ordinary relative links must be independently
   checked; unsupported external resources fail with an explicit limitation.
5. Applies explicit optional-inclusion and exposure settings. Selected optional
   dependencies must satisfy their pins and required descendants. An omitted
   dependency with a body link cannot leave a dangling alias: initially, fail
   the build rather than delete or reinterpret the authored workflow.
6. Emits isolated destinations and rewrites supported references to the selected
   copies. It preserves source-to-output provenance and hashes of transformed
   files separately from original hashes. Original governance IDs are not
   casually renamed to evade collisions.
7. Validates the final archive, links, manifest, and host-specific Skill behavior.
   No reserved alias references may remain unresolved in executable instructions.

Public versus supporting-resource packaging is a builder decision with semantic
consequences. Moving B into A's resources changes how B is discovered and used;
it is not assumed equivalent to exposing B as a standalone Skill. Plugin names,
plugin versions, host capabilities, install/update policy, and registry/lock
formats remain builder-owned. Unsupported cycles fail in the initial builder;
Renma retains its existing finite cycle evidence.

Pinning bundled files cannot freeze a remote MCP implementation, dependencies
downloaded by scripts, or model behavior. The builder must state these limits.
This extension claims reproducible declared inputs, not reproducible execution.
