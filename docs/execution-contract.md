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
facts and limitations; and relevant diagnostics. It does not copy the complete
Repository Context BOM.

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
Generating a contract for a suspended Skill does not permit executing it.

## One Snapshot And Deterministic Output

The command collects the repository exactly once. Skill identity, lifecycle,
hashes, executable inventory, canonical graph relationships, evidence rows,
bounded coverage facts, and diagnostics are all projected from that same
in-memory `RepositorySnapshot`. The command does not invoke the public `bom` or
`graph` commands and does not rescan between sections.

The authoritative artifact uses repository-relative identities and omits
`generatedAt` and absolute checkout-root identity. With the same repository
contents, configuration, Renma version, entrypoint, and supplied revision
value, repeated JSON output is byte-identical.

The document intentionally has no self-referential whole-document digest.
External systems can bind the exact serialized bytes with SHA-256:

```bash
renma execution-contract . \
  --entrypoint skill.release-prep \
  --format json \
  > execution-contract.json

sha256sum execution-contract.json
```

The caller performs the hashing; Renma does not.

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

Renma does not invoke Git, inspect a branch or dirty state, or verify that the
value matches the analyzed files. For a historical commit, the safe workflow
is for the caller to create a detached worktree, analyze that worktree, and
provide the same commit as external provenance:

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

Git/worktree creation and hashing are caller operations, not Renma operations.

## Deferred Phases

This slice does not define an observation schema, import runtime logs, verify
conformance, store prompts or tool results, create execution policy metadata,
or add allowed/required/forbidden, ordering, call-count, approval, or
authorization semantics. Those questions remain for later observation and
verifier phases.
