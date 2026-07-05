# Context Conflict Graph Diagnostics

Renma checks declared `conflicts` metadata so incompatible context assets do not become required together without review.

These diagnostics are deterministic catalog diagnostics. They do not choose runtime context, infer conflict intent, create scan finding IDs, or rewrite metadata.

## Invalid conflicts metadata

Renma warns when an asset's `conflicts` metadata points at itself or points at an asset that does not exist in the catalog.

Example messages:

```text
Asset conflicts metadata references itself: "context.testing.boundary-analysis".
Asset conflicts target "context.testing.missing" does not match a catalog entry.
```

Fix self references by removing the conflict entry. Fix missing targets by correcting the asset ID, adding the missing asset, or removing stale metadata.

## Conflicting required context

Renma warns when a skill requires two context assets that are declared as conflicting:

```text
Skill requires conflicting context assets "context.testing.boundary-analysis" and "context.testing.fuzz-testing".
```

A skill should not require conflicting context assets as always-loaded base knowledge. Split the skill, move one context to `optional_context`, remove stale `conflicts` metadata, or document a safer static relationship.

## Relationship to context lens

These checks are useful before adding purpose-oriented lens assets. A lens should not have to compensate for skills that require mutually conflicting base context.
