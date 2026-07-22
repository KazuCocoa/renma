# Public JSON compatibility baselines

These normalized golden files were produced by building commit
`cb9b7dcdb8001c53a2f8d94f0d63ed770cd64a7b` (Renma 0.22.5) and running the
six JSON commands exercised by `test/public-json-compatibility.test.ts` against
the adjacent `public-json-baseline` repository fixture.

The absolute fixture root is replaced with `<ROOT>`, and only BOM's expected
changing `generator.version` is replaced with `<VERSION>`. BOM uses
`--omit-generated-at`. No diagnostic, Finding, evidence, constraint,
verification, schema-version, repository asset metadata, or other public field
is removed before comparison.
