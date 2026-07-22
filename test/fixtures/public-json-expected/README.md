# Public JSON compatibility baselines

These normalized golden files were produced by building commit
`cb9b7dcdb8001c53a2f8d94f0d63ed770cd64a7b` (Renma 0.22.5) and running the
six JSON commands exercised by `test/public-json-compatibility.test.ts` against
the adjacent `public-json-baseline` repository fixture.

Only the absolute fixture root was replaced with `<ROOT>`. BOM uses
`--omit-generated-at`; no diagnostic, Finding, evidence, constraint,
verification, or other public field was removed before capture.
