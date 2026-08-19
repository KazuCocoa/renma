# Public JSON compatibility baselines

The original six normalized golden files were produced by building commit
`cb9b7dcdb8001c53a2f8d94f0d63ed770cd64a7b` (Renma 0.22.5). The suite now
covers every stable top-level JSON document except Trust Graph v2, whose
published JSON Schema and exact frozen semantic fixture provide the stronger
guard. Most commands run against the adjacent `public-json-baseline` repository
fixture. Diff and CI report use a temporary copy with fixed `contract-base` and
`contract-head` Git tags and one deterministic content change.

Absolute fixture roots are replaced with `<ROOT>`. BOM's expected changing
`generator.version` and the guide's package-derived `renmaVersion` are replaced
with `<VERSION>`. BOM uses `--omit-generated-at`. No diagnostic, Finding,
evidence, constraint, verification, schema-version, repository asset metadata,
or other public field is removed before comparison. Set
`UPDATE_PUBLIC_JSON_GOLDENS=1` only for an intentional reviewed contract
update; normal test runs are read-only comparisons.
