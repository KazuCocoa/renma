# Context Lifecycle Diagnostics

Renma checks lifecycle metadata so temporarily suspended assets remain auditable
and deprecated context assets do not point at stale replacements.

These diagnostics are deterministic catalog diagnostics. They do not choose replacement context at runtime, infer migration intent, create scan finding IDs, or rewrite metadata.

## Temporary suspension

`suspended` is an intentionally temporary inactive lifecycle state. Renma keeps
the asset in inventory and evidence projections, but does not treat it as usable
for active dependency, composition, publication, routing, reachability, or cycle
analysis. Omitted status retains the established use-eligible behavior;
`experimental` and `stable` are declared active, while `suspended`, `deprecated`,
and `archived` are inactive.

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
is an error while suspended and a warning for any other status. The changed
date records the latest reviewed lifecycle transition; it is not
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

## Scope

These diagnostics apply to governed shared context assets: context assets with a `context.*` id, owner metadata, and usage-boundary metadata (`when_to_use` and `when_not_to_use`). Lightweight fixtures or unmanaged context-like files are ignored.

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
