# Version-pinned asset references

Asset bindings let an external builder validate an exact release dependency
without changing Renma's declared composition graph. Validation is available
through the read-only `renma/asset-bindings` library API and as annotations on
existing catalog and graph dependency edges. Composition and reverse impact
consume the same normalized declarations and validation results. Bindings do
not add edges or change Discovery, policy, executable relationships, Trust Graph
relationships, or CLI exit thresholds.

The [complete example repository](https://github.com/KazuCocoa/renma/tree/main/examples/asset-bindings)
shows both Skill dependency chains and Context-to-Context pins.

## Metadata

For a Skill, retain the flat string-valued Agent Skills metadata convention:

```yaml
---
name: workflow-a
description: Use this Skill to perform workflow A with workflow B.
metadata:
  renma.id: skill.a
  renma.version: "1.0.1"
  renma.requires-skill: '["skill.b"]'
  renma.asset-bindings: '[{"alias":"b","target":"skill.b","version":"1.0.0"}]'
---

Follow [workflow B](renma-asset:b).
```

For an independently governed Context or Lens, use a native YAML sequence:

```yaml
---
id: lens.review
type: context_lens
version: "1"
release_version: "2026-09"
owner: review-team
purpose: Review the declared rules.
applies_to: [context.rules]
asset_bindings:
  - alias: rules
    target: context.rules
    version: "2.0"
---

Review [the rules](renma-asset:rules).
```

Lens `version` remains the **format version**. Lens `release_version` is the
independent release identifier. Contexts use `version`; Skills use
`metadata.renma.version`. Binding versions are exact, non-empty strings without
surrounding whitespace. No SemVer restriction, range interpretation, tag lookup,
normalization, ordering or latest fallback applies. `1.0` differs from `1.0.0`;
build metadata also participates in equality.

Each binding requires `alias` and `target` string fields and at least one of
`version` or `ref`. Optional `resolved` contains exactly one `commit` string. Aliases
match `[a-z][a-z0-9-]*`. Aliases and targets are each unique within a document;
duplicate JSON/YAML keys and unrecognized entry fields are invalid. Targets are
explicit stable IDs without whitespace, `/`, `\`, `:`, `#` or `?`, and cannot
be `.` or `..`. Sources need explicit identities and release versions. Selected targets need
explicit identities; a target release version is required for version comparisons.

| Source | Annotatable existing relationships | Target kind |
| --- | --- | --- |
| Skill, Context, Lens | `requires_context`, `optional_context` | Context |
| Skill, Context, Lens | `requires_lens`, `optional_lens` | Lens |
| Skill only | `requires_skill`, `optional_skill` | Skill |
| Lens only | `applies_to` | Context |

Skill relationship spellings use their existing `metadata.renma.*` forms.
A binding annotates every declaration naming that exact target, preserving
required/optional declarations and their indexes. Paths remain supported by
existing unbound composition but cannot be binding targets. Ordinary links,
`references`, `extends` and Discovery continuation do not become dependencies.
Support documents, scripts and assets remain in their parent's distribution;
a builder pins them using inventories and original file hashes. Shared Contexts
retain independent governance.

## Resolution provenance

Keep declared selectors and externally supplied evidence separate:

```yaml
asset_bindings:
  - alias: rules
    target: context.rules
    version: "1.2.0"
    ref: v1.2.0
    resolved:
      commit: "7e91d1654daaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  - alias: workflow
    target: skill.workflow
    ref: main
    resolved:
      commit: "7e91d1654daaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
```

Use the same object shape inside a Skill's `renma.asset-bindings` JSON-array
string. `ref` is an exact non-empty string without surrounding whitespace.
`resolved.commit` is optional and accepts only full Git object IDs: 40 hexadecimal
characters for SHA-1 or 64 for SHA-256. Abbreviations, whitespace, non-string
values, empty objects and unknown nested fields are invalid. Renma preserves the
supplied spelling and full SHA; human-readable graph labels may shorten it.
Existing version-only bindings remain valid and emit no new fields. Ref-only
review labels explicitly mark the declared ref as unverified.

`version` and `ref` are declared/requested dependency information.
`resolved.commit` is resolution provenance supplied by an external producer,
such as CI, repository tooling or a future plugin builder. Renma never obtains
it, resolves refs, checks that the commit exists, or verifies correspondence
between a ref, release version, commit and supplied snapshot. Do not append the
SHA to `version` to represent provenance.

With `version`, local satisfaction retains the exact release comparison, even
when `ref` and `resolved.commit` are supplied. With only `ref`, local comparison
checks unique target identity and relationship kind; it does not require a target
release version. `matched` / `satisfied: true` then mean only that those local
checks passed, **not** that the Git ref or supplied commit was verified. Missing,
ambiguous and wrong-kind candidates still fail. Declaration validity remains
independent, including the existing source identity/release requirements.

Graph edge `resolved` remains a boolean indicating local target availability.
A binding's nested `resolved.commit` records external provenance; it does not
change that boolean, `satisfaction`, or composition completeness. No resolver,
installer, fetching, asset download, vendoring, lockfile or packaging behavior is
introduced. Optional evidence supports plain Git workflows where it is absent
and future builders that supply it; content digests and packaged inventories
remain outside this extension.

## Body references

`[label](renma-asset:alias)` refers to a binding in the same document. Literal
inline Markdown links support angle-delimited destinations and optional titles.
Only the destination span is offered for rewriting. Renma does not modify files.

Images, reference-style links/definitions, autolinks and HTML attributes using
the reserved scheme are unsupported and diagnosed. HTML `href` and `src`
values are checked after HTML attribute character-reference decoding and URL
input preprocessing: ASCII tab, LF and CR are removed wherever they occur, and
leading/trailing C0 controls (U+0000–U+001F) and spaces (U+0020) are trimmed.
This interpretation never changes the original-source evidence or offsets. The
Unicode hyphen lookalike `renma‐asset:` (including `&hyphen;`) is also diagnosed
as unsupported; it is not normalized into a valid asset scheme. HTML comments,
foreign-content CDATA, ordinary text, unrelated attributes and raw-text element
contents are excluded. Bogus-comment recovery, HTML/SVG/MathML integration
points and foreign-content self-closing rules apply when deciding whether an
attribute is effective. HTML inspection includes the container tags generated
by CommonMark paragraphs, headings, lists and blockquotes; evidence still points
to the original authored HTML.

Queries, fragments, encoded or escaped aliases and suffixes are unsupported. Fenced/indented code, inline
code and plain text are inert. Every reference needs a unique declared alias;
bindings without body references are allowed. Support-file aliases are not
implicitly scoped to a parent Skill.

## Builder API

```js
import { readFile } from "node:fs/promises";
import { inspectAssetBindings, compareAssetBinding } from "renma/asset-bindings";

const report = inspectAssetBindings([
  { path: "skills/workflow-a/SKILL.md", bytes: await readFile(aPath) },
  { path: "skills/workflow-b/SKILL.md", bytes: await readFile(bPath) },
]);
const a = report.documents.find(d => d.identity.id === "skill.a");
const binding = a.bindings[0];
// Historical files are acquired by the builder, not Renma.
const historical = inspectAssetBindings(historicalFiles);
const selected = compareAssetBinding(
  binding,
  historical.documents.map(d => d.identity),
);
```

The API accepts UTF-8 Markdown snapshot files with unique, normalized,
repository-relative paths. Invalid paths, duplicates or invalid UTF-8 throw.
Supply the full relevant snapshot; missing inputs produce missing-target results.
The API performs no filesystem access or network operations and does not mutate
inputs. Output ordering is deterministic by UTF-16 path order, authored binding
index, catalog relationship order and reference source offset.

`schemaVersion` is `renma.asset-bindings.v1`; the
[published JSON Schema](schemas/asset-bindings-v1.schema.json) defines its wire
shape. Public TypeScript interfaces are exported from the same module. Each
document includes identity/version, relationships, bindings, references,
diagnostics and `declarationValid`. Each binding has separate local
`satisfaction`, with original target identities and version evidence. The additive
optional `satisfied` boolean is emitted by current producers: it is true only
when `declarationValid` is true and the candidate comparison is `matched`.
`compareAssetBinding` remains an identity/kind/release comparison; a match alone
does not validate the caller's declaration or the selected target's own declarations.
Inspect those documents and their diagnostics as well. Direct ref-only calls
to `compareAssetBinding` require an exact non-empty `ref`; absent, empty or
whitespace-padded refs throw instead of silently making an unconstrained match.

Candidate comparison statuses are:

- `matched`: exactly one target has the required kind and, when `version` is
  supplied, the exact release string. A ref-only match does not verify Git evidence.
- `missing`: no supplied document has that explicit ID.
- `ambiguous`: multiple documents have the ID; pins never choose between them.
- `kind-mismatch`: the target is not the kind required by the relationship.
- `target-version-invalid`: the target lacks a usable release version.
- `version-mismatch`: the target has a different release string.

Declaration errors include existing Lens declaration errors (such as unsupported
format versions or scopes and missing required fields), without requiring a
Lens's targets to be present in the inspected snapshot.
Declaration errors are separate from local satisfaction diagnostics. A valid
A 1.0.1 pin for B 1.0.0 remains valid when local B is 2.0.0, but is not locally
satisfied. Comparing acquired B 1.0.0 from a separate snapshot can match without
clearing or modifying the original report. The comparison helper does not
establish origin authority, content integrity or transitive completeness.
Builders inspect the selected files and recursively validate their own bindings.

Every location includes a path, original-byte SHA-256 digest, raw source slice,
one-based inclusive lines and **half-open UTF-16 code-unit offsets**. Decode
UTF-8 preserving the BOM and original LF, CRLF or CR line endings before using
offsets. Check the original byte
digest before applying any rewrite and reject stale evidence. Metadata entry
locations cover the containing YAML field; `entryIndex` distinguishes entries.
Candidate identities carry whole-document, ID and version evidence.

## Dependency analysis and graph reports

Catalog dependency edges and graph edges carry optional `bindings` arrays.
Each entry retains the public API's alias, declared `version` and/or `ref`, optional
externally supplied `resolved.commit`, authored
`entryIndex`, declaration validity, `satisfied`, candidate comparison, relationship
indexes, and original-source evidence, plus relevant `diagnostics`. Arrays retain
invalid duplicate declarations for review. `bindingDiagnostics` preserves source
declaration errors even when malformed metadata cannot yield a normalized entry.
Only existing eligible composition declarations receive annotations. Unbound edges
keep their existing fields and presentation.

Graph `resolved` answers whether the existing dependency resolver found a target.
It does **not** answer whether the requested release is satisfied. For example,
A 1.0.1 requesting B 1.0.0 can resolve to local B 2.0.0 while its binding reports
`version-mismatch` and `satisfied: false`. Existing Context/Lens target resolution
can retain a local target even when the strict binding comparison is `ambiguous`;
Skill dependency resolution already requires a unique target. Bindings do not
change either resolution rule. Missing, ambiguous, wrong-kind, invalid target
release and mismatched release results remain distinct. An invalid source
declaration cannot be satisfied even when candidate comparison is `matched`.

Graph and composition/impact assets expose optional `releaseVersion`: Skill
`metadata.renma.version`, Context `version`, or Lens `release_version`. Lens format
`version` is never used as release identity. JSON preserves full evidence;
Markdown and Mermaid label bound edges with alias, requested release/ref, supplied
commit (shortened when present), and local status.
Grouped graph projections retain separate bound declarations and their indexes.

Composition traverses the inspected snapshot. If local B is 2.0.0, traversing
its declarations establishes the local B 2.0.0 closure, **not** the dependencies
of requested B 1.0.0. Reverse impact likewise describes incoming relationships
in the inspected snapshot, including unsatisfied pins. It does not predict impact
on a historical or acquired release. Existing `requiredComplete` and
`optionalComplete` retain their target-resolution, kind and existing lifecycle
semantics; `cycleFree` remains independent. They do not establish release
satisfaction or a complete historical release closure.

When encountered declarations contain bindings or binding declaration errors,
composition and impact add `bindingSatisfaction.requiredSatisfied` and
`bindingSatisfaction.optionalSatisfied`. Each summarizes its propagated membership
routes within that report; an empty membership set is satisfied. Optional failures
do not invalidate required membership or its satisfaction summary. These summaries
cover encountered pins only: they neither require every dependency to be pinned
nor establish the transitive closure of a requested release absent from the snapshot.

These are optional additive fields under the existing graph/catalog v1 contracts.
The dedicated API retains `renma.asset-bindings.v1` and its closed status vocabulary;
its published schema adds the optional `satisfied` property. Executable and Trust
Graphs keep their relationship semantics because execution and trust evidence are
not release-pinned composition declarations.

## Responsibility boundary

The builder owns authoritative source mapping, source resolution/downloads,
immutable revision selection, transitive traversal, optional inclusion, lockfiles,
full file inventories, hashes, bundling, destination isolation, reference
rewriting, Plugin generation and host validation. It must check declaration
validity, every selected pin, and all included references. Different callers can
pin different versions; one caller cannot bind two versions of the same target.
No package resolution, download, lockfile, bundling or Plugin generation is
implemented in Renma. Pinning declared inputs does not freeze remote MCP services,
script downloads, model behavior or runtime execution.
