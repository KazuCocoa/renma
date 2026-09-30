# Versioned Skill Bindings for External Builders

Status: design extension; not implemented or assigned to a release.

This document defines the proposed authoring contract for an external plugin
builder for Renma. The current CLI does not interpret the new metadata or
reference syntax below. Existing user manuals and public schemas remain the
authority for shipped behavior.

## Problem and Decision

Skill A 1.0.1 requires Skill B 1.0.0 while B's current main contains 2.0.0.
An external builder must be able to distribute A with the intended B and bind
A's references to that copy. A version declaration alone neither retrieves B
nor makes a model use the right copy.

Renma owns deterministic declarations, source evidence, and local validation.
A separate builder owns source lookup, acquisition, immutable resolution,
lockfiles, packaging, reference rewriting, and target-host validation. No
network access, package resolver, plugin manifest, or runtime behavior enters
Renma core through this extension.

Reuse existing `renma.id`, `renma.version`, `renma.requires-skill`, and
`renma.optional-skill`. Add a binding annotation, not a second dependency graph.
Keep flat string-valued Agent Skills metadata. The nested YAML dependency map
discussed during exploration is not the proposed canonical serialization.

## Proposed Metadata

```yaml
---
name: skill-a
description: Perform workflow A using its declared supporting workflow.
metadata:
  renma.id: skill.a
  renma.version: "1.0.1"
  renma.requires-skill: '["skill.b"]'
  renma.skill-bindings: '[{"alias":"b","target":"skill.b","version":"1.0.0"}]'
---

Before completing A, follow [workflow B](renma-skill:b).
```

`renma.skill-bindings` is one optional string containing a JSON array of
objects. Each object has exactly three required string fields:

| Field | Meaning |
| --- | --- |
| `alias` | Source-Skill-local name matching `[a-z][a-z0-9-]*` |
| `target` | Exact stable Skill ID already declared in requires-skill or optional-skill |
| `version` | Exact SemVer 2.0.0 release identifier; no ranges, tags, URLs, or paths |

Aliases and targets are unique within one source Skill's bindings. Empty
arrays are valid. Empty strings, unknown object fields, duplicate JSON object
keys, and non-object entries are errors. Values are not silently trimmed or
coerced. Native YAML arrays or mappings remain invalid metadata values.

Binding targets must use stable IDs, even though existing unbound composition
declarations may use supported path forms. This avoids coupling a portable
binding to the source repository layout. A binding annotates all declarations
of that exact target; it never overrides required/optional membership or
deduplicates their provenance. Existing duplicate-declaration rules still apply.

Prerelease and build identifiers are allowed. Version comparison is exact
string equality, including build metadata; SemVer precedence does not choose
a candidate. There is no implicit `v` prefix removal or latest-version fallback.
For bound distribution inputs, the source and selected target must both have
explicit IDs and valid SemVer versions. Existing unbound `renma.version` text
semantics are unchanged; this is an opt-in restriction, not a global migration.

The first iteration permits one version per target within a source Skill.
Different callers may bind different versions of B. The builder owns their
isolation and must reject a target format that cannot represent that isolation.
Supporting two B versions directly from one A is deferred.

## Explicit Body References

The initial reference form is an inline Markdown link with a destination of
exactly `renma-skill:<alias>`. It denotes a declared binding, not a URL to fetch,
a runtime invocation, a Discovery continuation, or a new dependency edge.

Only actual inline link nodes in the source Skill's SKILL.md body participate.
Fenced/inline code, images, HTML, reference-style links, and plain prose do not.
Queries, fragments, file suffixes, and encoded aliases are unsupported. An
actual inline link using the reserved scheme with an invalid or undeclared
alias produces a diagnostic. Unsupported link forms using the reserved scheme
must be reported as unsupported, never silently treated as rewritable links.
Examples in code remain inert. Alias matching is case-sensitive.

A binding need not appear in the body: it can describe a structural dependency.
Every supported body reference must have a valid binding. Repeated references
retain separate original source locations. The builder rewrites parsed link
destination spans only, preserving labels and unrelated prose; it must not use
global text replacement. Renma does not rewrite source documents.

For the first iteration, local support files keep ordinary relative links.
Portable alias references in support files require a separate ownership and
scope design. Builders must detect and reject them rather than assume the
nearest Skill owns them. Declaring a binding does not make free-form mentions
of B mechanically resolvable or prove that all runtime dependencies are known.

## Static Validation and Local Evidence

Renma parses bindings and references once from its immutable repository
snapshot and preserves field, entry index, path, range, and raw source evidence.
Where exact JSON subranges are unavailable, evidence uses the containing YAML
field plus the array index; it must not invent precise locations.

Validation separates declaration validity from local target availability:

| Local evidence | Binding result |
| --- | --- |
| One Skill with the declared ID and exact version | matched |
| One Skill with that ID but a different version | version-mismatch |
| One Skill with that ID but absent/invalid version | target-version-invalid |
| No target with that ID | missing |
| Multiple target candidates | ambiguous; retain sorted candidate paths |
| Target is not a Skill | kind-mismatch |

Malformed binding syntax, duplicate aliases/targets, undeclared targets, and
invalid body references are declaration errors independently of this table.
Results retain all applicable evidence rather than hiding one issue behind
another. A version never disambiguates duplicate IDs in the repository catalog.

With A pinned to B 1.0.0 and local B at 2.0.0, existing composition can still
describe the local A-to-B edge. The new validation reports the version mismatch
separately: local composition completeness is not version satisfaction.
Missing/ambiguous targets retain existing composition diagnostics. A missing
target is not presumed to be an external dependency that has been satisfied.
Existing graph, impact, BOM, Trust Graph, and completeness contracts are not
silently redefined by this design.

Cross-snapshot resolution remains outside the local catalog. The builder can
inspect B 1.0.0 at a historical revision as a separate snapshot and validate
its identity/version against A's requirement. That does not clear or rewrite a
diagnostic about B 2.0.0 in A's original working tree.

## Consumer Contract

The implementation should expose a small, explicitly versioned read-only
library contract for builders. Exact export names and schema identifiers must
be reviewed before implementation; none is introduced by this design commit.
Do not depend on private `dist/` imports or repurpose Discovery exports.

The contract needs to provide:

- source Skill identity/version and original document evidence;
- binding annotations joined to existing required/optional declarations;
- supported reference aliases and exact rewrite spans with a documented offset unit;
- declaration errors, local resolution state, and expected/observed versions;
- deterministic ordering by source path, declaration index, and source offset.

Consumers must bind offsets to the exact original file digest and refuse a
rewrite if the bytes changed. A small pure comparison operation over supplied
source/target records may validate exact identity/version without fetching,
merging repositories, or selecting candidates. It does not establish content
integrity. Changes to public exports and existing JSON families require their
normal independent compatibility review and fixtures.

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

## Compatibility and Delivery Plan

This is an opt-in extension. Existing Skills, required/optional declarations,
Discovery routes, metadata-required policy, and public output remain unchanged
when no bindings are present. Old Renma versions may preserve the unknown key
without validating it; a builder must explicitly require the new contract's
supported version and fail on an older implementation.

Implementation sequence:

1. Add bounded JSON binding parsing and evidence with negative fixtures.
2. Add the reserved Markdown reference recognizer and local validation.
3. Review/export the minimal consumer contract and its compatibility tests.
4. Update the operational metadata table, diagnostics, and authoring guidance
   only when implemented; decide report additions explicitly.
5. Build source acquisition, lock, bundling, and host adapters in the separate
   builder project. Do not add them to Renma's CLI or runtime dependencies.

Acceptance scenarios for implementation:

- A 1.0.1 plus B 1.0.0 matches; main B 2.0.0 reports mismatch; the external
  builder can acquire historical B 1.0.0 and records that distinct snapshot.
- Missing, ambiguous, wrong-kind, unversioned, malformed, and duplicate inputs
  fail visibly; version pins never select one of duplicate local IDs.
- Required/optional routes retain their existing provenance and membership.
- Inline aliases resolve; code examples stay inert; unsupported forms and
  undeclared aliases cannot disappear silently.
- Transitive pins, conflicting caller pins, omitted referenced optionals,
  cycles, missing support files, and origin collisions are exercised in builder
  integration fixtures.
- Rebuilding from a frozen lock is deterministic; altered content under the
  same version or stale rewrite offsets fail verification.
- Existing unbound fixtures and public schema/export baselines remain stable.

Version ranges, automatic upgrades, multi-repository federation in core,
multiple direct versions of one target, support-file aliases, and runtime
dependency enforcement are explicitly deferred.
