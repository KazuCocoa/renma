# Context Lifecycle Diagnostics

Renma checks shared context lifecycle metadata so deprecated context assets remain traceable and do not point at stale replacements.

These diagnostics are deterministic catalog diagnostics. They do not choose replacement context at runtime, infer migration intent, create scan finding IDs, or rewrite metadata.

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
