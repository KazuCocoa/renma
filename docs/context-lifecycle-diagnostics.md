# Context Lifecycle Diagnostics

Renma checks lifecycle metadata so inactive assets remain auditable, active
dependents of suspended or revoked assets receive deterministic review
evidence, and deprecated context assets do not point at stale replacements.

These diagnostics are deterministic catalog diagnostics. They do not choose
replacement context at runtime, infer migration intent, propagate lifecycle
status, or rewrite metadata.

## Lifecycle meanings

| Status | Meaning |
| --- | --- |
| `experimental` | Evaluation; not yet established |
| `stable` | Normal supported use |
| `suspended` | Temporarily stopped; review or restoration may follow |
| `revoked` | Trust or authorization explicitly withdrawn because of a known problem |
| `deprecated` | Still recognized, but new use is discouraged and migration is expected |
| `archived` | Lifecycle ended; retained primarily for historical evidence |

`revoked` is not an alias for `suspended`, `deprecated`, or `archived`. There is
no linear ordering among these states. A reviewed repository change may, for
example, move an asset from stable or suspended to revoked, or restore a
revoked asset to stable. Renma exposes only current repository state and does
not infer or store historical transitions.

## Temporary suspension

`suspended` is an intentionally temporary inactive lifecycle state. Renma keeps
the asset in inventory and evidence projections, but does not treat it as usable
for active dependency, composition, publication, routing, reachability, or cycle
analysis. Omitted status retains the established use-eligible behavior;
`experimental` and `stable` are declared active, while `suspended`, `revoked`,
`deprecated`, and `archived` are inactive.

A canonical Skill declares suspension with flat string values:

```yaml
metadata:
  renma.status: suspended
  renma.status-reason: Temporarily disabled while issue QE-1234 is corrected.
  renma.status-changed-at: "2026-08-03"
```

A non-Skill asset uses the corresponding top-level keys:

```yaml
status: suspended
status_reason: Temporarily disabled while issue QE-1234 is corrected.
status_changed_at: 2026-08-03
```

Both evidence fields are required for suspension. The reason must be non-blank,
and the changed date must be a real `YYYY-MM-DD` calendar date. An invalid date
is an error while suspended or revoked and a warning for any other status. The
changed date records the latest reviewed lifecycle transition; it is not
`last_reviewed_at`, which records a freshness review.

Restoration is an explicit reviewed metadata change. For example:

```yaml
metadata:
  renma.status: stable
  renma.status-reason: Restored after QE-1234 was corrected and verified.
  renma.status-changed-at: "2026-08-06"
```

Renma does not expire, restore, delete, clone, or reactivate an asset
automatically. Git history and the pull request containing each reviewed
transition provide the full audit trail; Renma exposes only the current
normalized declaration.

## Explicit revocation

`revoked` means the asset's authorization or trust for use has been explicitly
withdrawn because of a known problem. This is stronger than temporary
suspension and is not limited to security incidents. Known problems can include
compromised provenance, dangerous behavior, a material correctness failure, a
policy violation, or an explicit owner trust withdrawal.

A revoked canonical Skill requires the same canonical evidence fields, with
revocation-specific content:

```yaml
metadata:
  renma.status: revoked
  renma.status-reason: Revoked after the upstream source was found to be compromised.
  renma.status-changed-at: "2026-09-03"
```

A non-Skill asset uses:

```yaml
status: revoked
status_reason: Revoked because the documented procedure can cause unsafe destructive behavior.
status_changed_at: 2026-09-03
```

Both fields are required. A missing or blank reason, missing date, or invalid
calendar date emits `META-REVOKED-STATUS-METADATA-INCOMPLETE`, identifying the
missing and invalid fields. An invalid declared date also retains the shared
`META-INVALID-STATUS-CHANGED-AT` evidence. Revocation does not require
`superseded_by`; a revoked asset may have no replacement.

## Suspended dependency policy

For one exact, uniquely resolved direct declaration from an active source:

- `requires_context`, `requires_lens`, and Context Lens `applies_to` targeting a
  suspended asset are errors;
- `optional_context` and `optional_lens` targeting a suspended asset are
  warnings; and
- inactive sources do not receive cascading suspension dependency diagnostics.

Ambiguous or unresolved targets retain their existing diagnostics; Renma does
not select one candidate merely to emit a suspension diagnostic. Required
composition becomes incomplete when its required closure contains a suspended
asset. Optional membership remains visible and reviewable without being
silently promoted to required.

An isolated suspended asset is valid inventory. Suspension alone does not
create an orphan warning or a readiness blocker when no active source requires
it. Other unrelated diagnostics remain visible.

## Revoked dependency policy

For an active source and one exact, uniquely resolved target, required
`requires_context`, `requires_lens`, or Context Lens `applies_to` declarations
to a revoked asset emit `META-REQUIRED-REVOKED-DEPENDENCY` as a built-in High
Finding. Optional declarations emit `META-OPTIONAL-REVOKED-DEPENDENCY` as a
built-in Low Finding. Both preserve the revoked target's reason and transition
date as evidence. Invalid metadata and required revoked dependencies are strong
governance findings; optional use remains lower severity but still reports that
trust or authorization was withdrawn.

Renma does not rewrite the active dependent to `revoked` or select a repair.
Review may support removing or retargeting the dependency, changing the
dependent's lifecycle when it cannot operate safely, retaining a narrow
justified suppression, or changing the target only through a separate reviewed
lifecycle decision. Inactive sources and ambiguous targets do not receive
cascading revoked-dependency findings.

Revoked assets are excluded from active composition and Skill Discovery use.
A revoked Skill cannot be an effective published entrypoint or usable route
target; those attempts emit dedicated `DISCOVERY-REVOKED-*` diagnostics rather
than suspension or deprecation diagnostics. An isolated, fully evidenced
revoked asset remains valid inventory and does not reduce Readiness merely by
existing.

## Scope

Status parsing and suspended/revoked evidence requirements apply to canonical
Skills and cataloged non-Skill assets. Direct dependency diagnostics apply to
the supported required, optional, and `applies_to` relationships. The
deprecated-context replacement checks below apply only to governed shared
context assets: context assets with a `context.*` id, owner metadata, and
usage-boundary metadata (`when_to_use` and `when_not_to_use`).

## Deprecated context without replacement

Renma warns when a deprecated shared context asset has no `superseded_by` metadata:

```text
Deprecated shared context asset is missing superseded_by metadata.
```

Prefer linking deprecated context to the current replacement:

```yaml
status: deprecated
superseded_by:
  - context.testing.boundary-value-analysis
```

If there is intentionally no replacement, keep that rationale in the Markdown body and consider whether `archived` is more appropriate than `deprecated`.

## Invalid superseded_by targets

Renma warns when `superseded_by` points at itself, points at a missing catalog entry, or points at another inactive asset.

Example messages:

```text
Shared context asset superseded_by references itself: "context.testing.old-boundary-analysis".
Shared context asset superseded_by target "context.testing.missing" does not match a catalog entry.
Shared context asset superseded_by target "context.testing.old-target" resolves to an inactive asset with status "deprecated".
```

`superseded_by` should point at a stable or experimental catalog asset that can serve as the reviewed replacement.

## Supersession cycles

Renma warns when deprecated context assets form a replacement cycle:

```text
Shared context asset superseded_by chain forms a cycle involving "context.testing.old-a".
```

Break the cycle by pointing each deprecated asset at the actual current replacement, or by archiving assets that have no replacement.

## Relationship to context lens

These checks are useful before adding purpose-oriented lens assets. A lens should not have to reason through stale replacement chains or cycles when it depends on base context.
