# Experimental Execution Contract

`renma execution-contract` emits a small, portable static-evidence artifact for
one exact Skill entrypoint. It packages the executable relationships Renma can
currently prove from repository contents so an external runtime tracer or
correlator can bind observations to that evidence later.

The first schema is explicitly experimental:

```json
{
  "schemaVersion": "renma.experimental-execution-contract.v1",
  "stability": "experimental"
}
```

This identity does not promise long-term schema compatibility.

## Generate A Contract

Select one exact effective Skill ID or repository-relative `SKILL.md` path:

```bash
renma execution-contract /path/to/repository \
  --entrypoint skill.release-prep \
  --format json

renma execution-contract /path/to/repository \
  --entrypoint skills/release-prep/SKILL.md \
  --format json
```

The artifact contains the generator identity; selected Skill ID, source path,
content hash, and declared lifecycle evidence; reachable repository-script
identities and fingerprints; canonical invocation relationships; separate
structural containment; exact recognized evidence rows; bounded-analysis
facts and limitations; relevant diagnostics; and an embedded Renma-calculated
digest of that selected evidence. It does not copy the complete Repository
Context BOM.

## Static `possible` Semantics

Every `invokes` relationship has this one expectation:

```json
{ "expectation": "possible" }
```

Renma traverses the same canonical, deduplicated Skill-to-script and
script-to-script `invokes` edges used by the executable graph. Direct and
transitive relationships retain every matching line-level evidence row, so
duplicate declarations remain auditable while topology stays deduplicated.

`contains` is emitted separately with
`meaning: "structural_placement_only"`. It is not traversed as invocation and
does not imply ownership, exclusive belonging, runtime execution, or required
execution. Shared repository scripts do not inherit ownership from a caller.

The contract is static repository evidence, not an authorization decision.
Generating a contract for a suspended or revoked Skill does not permit
executing it.

## One Snapshot And Deterministic Output

The command collects the repository exactly once. Skill identity, lifecycle,
hashes, executable inventory, canonical graph relationships, evidence rows,
bounded coverage facts, and diagnostics are all projected from that same
in-memory `RepositorySnapshot`. The command does not invoke the public `bom` or
`graph` commands and does not rescan between sections.

The authoritative artifact uses repository-relative identities and omits
`generatedAt` and absolute checkout-root identity. With the same repository
contents, configuration, Renma version, evaluation date, entrypoint, and
supplied revision value, repeated JSON output is byte-identical.

## Three Complementary Identities

The contract keeps three identities separate. None replaces or outranks the
others:

| Identity | Produced by | What it binds |
| --- | --- | --- |
| `sourceRevision` | Caller, optional and unverified | A revision value supplied as provenance |
| `evidenceDigest` | Renma, always present | The selected execution-contract evidence projection |
| External SHA-256 | Caller, optional | The exact serialized artifact bytes, including `sourceRevision` when supplied |

### Embedded Renma Evidence Digest

Every contract includes:

```json
{
  "evidenceDigest": {
    "algorithm": "sha256",
    "value": "sha256:<hex>",
    "scope": "selected_execution_contract_evidence_v1",
    "calculatedBy": "renma"
  }
}
```

Renma calculates this value from a versioned, domain-separated canonical
payload containing the selected subject identity and content hash, projected
executable surfaces and their hashes/fingerprints, canonical and structural
relationships, every auditable relationship and unresolved evidence row,
bounded coverage/observation facts, and relevant diagnostics. Duplicate
evidence rows remain digest-relevant even when canonical topology is
deduplicated.

The payload excludes `sourceRevision`, the digest field itself, absolute
checkout-root identity, generated timestamps, and serialized JSON formatting.
Changing only caller revision provenance therefore does not change the embedded
digest. Changing selected content or evidence does; changing an unrelated file
outside the projection does not. Source-authored raw evidence remains exact,
including an unsafe absolute target when that is the recognized unresolved
evidence—the excluded absolute identity is the checkout location, not text
declared in repository content.

This is not a repository hash, repository snapshot hash, Git-tree hash, or
complete filesystem hash. It requires no Git repository and works for dirty
working trees, non-Git directories, extracted archives, and other VCS
checkouts.

### External Exact-Artifact SHA-256

The embedded digest is intentionally not a self-referential whole-document
digest. External systems can separately bind the exact serialized bytes:

```bash
renma execution-contract . \
  --entrypoint skill.release-prep \
  --format json \
  > execution-contract.json

sha256sum execution-contract.json
```

That external value covers JSON formatting and every serialized field,
including `sourceRevision` when supplied and the embedded `evidenceDigest`.
The caller performs exact-artifact hashing; Renma calculates only the embedded
selected-evidence digest.

## Bounded Completeness

`unresolvedEvidence` retains relevant recognized invocation and dependency
rows that did not become canonical topology, including their exact resolution
classification, raw target or specifier, source path, line, launcher or
analyzer, candidates where present, and occurrence ordinal. Unsafe, missing,
ambiguous, unavailable, dynamic, and unsupported evidence is never promoted to
a resolved relationship.

The analysis boundary distinguishes these facts:

- `driftAssessmentPerformed: false`: this phase performs no observation or
  comparison.
- `noUnresolvedStaticEvidenceObserved`: only whether the recognized relevant
  static rows contained non-topological evidence.
- `runtimeOrUnsupportedBehaviorAbsenceProven: false`: zero unresolved rows
  cannot prove that dynamic, unsupported, or runtime-only behavior is absent.

Renma's helper grammar and executable dependency analyzers are intentionally
bounded. See the [User Manual](user-manual.md) for the supported syntax.

## Caller-Provided Revision Provenance

`--source-revision` records a caller-provided value verbatim:

```json
{
  "sourceRevision": {
    "value": "<git-commit-sha>",
    "providedBy": "caller",
    "verifiedByRenma": false
  }
}
```

This optional provenance complements the embedded Renma evidence digest; it is
not a more authoritative form of the same identity. Renma does not invoke Git,
inspect a branch or dirty state, or verify that the value matches the analyzed
files. For a historical commit, the safe workflow is for the caller to create
a detached worktree, analyze that worktree, and provide the same commit as
external provenance:

```bash
revision=<git-sha>
worktree=$(mktemp -d)

git -C /path/to/repository worktree add --detach "$worktree/repository" "$revision"

renma execution-contract "$worktree/repository" \
  --entrypoint skill.release-prep \
  --source-revision "$revision" \
  --format json \
  > execution-contract.json

sha256sum execution-contract.json
```

Git/worktree creation and exact-artifact hashing are caller operations, not
Renma operations.

## Deferred Phases

This slice does not define an observation schema, import runtime logs, verify
conformance, store prompts or tool results, create execution policy metadata,
or add allowed/required/forbidden, ordering, call-count, approval, or
authorization semantics. Those questions remain for later observation and
verifier phases.
