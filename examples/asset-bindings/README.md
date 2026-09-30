# Asset bindings example

This snapshot demonstrates Skill → Skill → Context, Skill → Lens → Context,
and Context → Context pins. All pins match the supplied release identifiers.
The Lens format is `1`; its release is `2026-09`.

Pass the five Markdown assets under `skills/` and `contexts/` to
`inspectAssetBindings` from `renma/asset-bindings` as repository-relative
`{ path, bytes }` records. See the [builder API](../../docs/asset-bindings.md).

To observe a local mismatch, inspect a separate in-memory copy where Skill B's
`renma.version` is `2.0.0`; A's declaration remains valid and its B pin reports
`version-mismatch`. An external builder can inspect the original B snapshot and
use `compareAssetBinding` to validate B 1.0.0 separately.

The optional Lens has a body reference. A builder that omits it must reject the
dangling reference. No Plugin, lockfile, download or rewritten output is produced
by Renma.
