import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import fc from "fast-check";

import { buildCatalog } from "../src/catalog.js";
import { createDiagnosticsV2 } from "../src/diagnostics-v2.js";
import {
  DIAGNOSTIC_IDS,
  omitFromCatalogFindings,
} from "../src/diagnostic-ids.js";
import { parseDocument } from "../src/markdown.js";
import {
  CATALOG_FINDING_DEFINITIONS,
  CATALOG_FINDING_DIAGNOSTIC_CODES,
  catalogDiagnosticFindings,
} from "../src/scanner.js";
import type { Artifact, ArtifactKind, Diagnostic } from "../src/types.js";

test("catalog Finding classification is invariant under diagnostic wording", () => {
  for (const code of CATALOG_FINDING_DIAGNOSTIC_CODES) {
    const expected = catalogDiagnosticFindings([codedDiagnostic(code, "base")]);
    fc.assert(
      fc.property(fc.string(), (message) => {
        assert.deepEqual(
          catalogDiagnosticFindings([codedDiagnostic(code, message)]),
          expected,
        );
      }),
      { seed: 0x22_05, numRuns: 50 },
    );
  }
});

test("every known metadata diagnostic has a registered code conversion", () => {
  const registeredIds = new Set(Object.values(DIAGNOSTIC_IDS));
  assert.deepEqual(
    Object.keys(CATALOG_FINDING_DEFINITIONS).sort(),
    [...CATALOG_FINDING_DIAGNOSTIC_CODES].sort(),
  );
  for (const code of CATALOG_FINDING_DIAGNOSTIC_CODES) {
    assert.ok(registeredIds.has(code));
    const finding = catalogDiagnosticFindings([
      codedDiagnostic(code, "wording"),
    ]);
    assert.equal(finding.length, 1);
    assert.equal(finding[0]?.id, code);
    assert.equal(
      finding[0]?.severity,
      CATALOG_FINDING_DEFINITIONS[code].severity,
    );
    assert.deepEqual(
      finding[0]?.constraints,
      CATALOG_FINDING_DEFINITIONS[code].constraints,
    );
    assert.deepEqual(
      finding[0]?.verificationSteps,
      CATALOG_FINDING_DEFINITIONS[code].verificationSteps,
    );
    assert.deepEqual(
      createDiagnosticsV2({ findings: finding, diagnostics: [] }).map(
        (diagnostic) => diagnostic.code,
      ),
      [code],
    );
  }
});

test("metadata and catalog producers attach every known conversion code", () => {
  const longItem = "x".repeat(300);
  const extraFields = Array.from(
    { length: 50 },
    (_, index) => `routing_note_${index}: compact`,
  ).join("\n");
  const documents = [
    document(
      "contexts/invalid.md",
      "context",
      `---
id: context.invalid
owner: qa
status: active
last_reviewed_at: yesterday
expires_at: tomorrow
review_cycle: P3M
when_to_use: validation
when_not_to_use: runtime selection
---
# Invalid
`,
    ),
    document(
      "contexts/budget.md",
      "context",
      `---
id: context.budget
owner: qa
status: stable
tags:
  - ${longItem}
when_to_use: validation
when_not_to_use: runtime selection
${extraFields}
---
# Budget
`,
    ),
    document(
      "contexts/boundary.md",
      "context",
      `---
id: context.boundary
owner: qa
status: stable
when_to_use:
  - TODO
---
# Boundary
`,
    ),
    document(
      "contexts/missing-positive-boundary.md",
      "context",
      `---
id: context.missing-positive-boundary
owner: qa
status: stable
when_not_to_use: runtime selection
---
# Missing Positive Boundary
`,
    ),
    document(
      "contexts/missing-id.md",
      "context",
      `---
owner: qa
status: stable
---
# Missing ID
`,
    ),
    document(
      "contexts/source.md",
      "context",
      `---
id: context.source
owner: qa
status: stable
when_to_use: validation
when_not_to_use: runtime selection
optional_context:
  - context.unknown
  - context.inactive
---
# Source
`,
    ),
    document(
      "contexts/inactive.md",
      "context",
      `---
id: context.inactive
owner: qa
status: archived
when_to_use: historical review
when_not_to_use: current guidance
---
# Inactive
`,
    ),
  ];

  const { diagnostics } = buildCatalog(documents);
  const producedCodes = new Set(
    diagnostics
      .map((diagnostic) => diagnostic.code)
      .filter((code): code is string => code !== undefined),
  );
  assert.deepEqual(
    [...CATALOG_FINDING_DIAGNOSTIC_CODES].filter(
      (code) => !producedCodes.has(code),
    ),
    [],
  );
  for (const diagnostic of diagnostics.filter((candidate) =>
    producedCodes.has(candidate.code ?? ""),
  )) {
    assert.equal(
      Object.prototype.propertyIsEnumerable.call(diagnostic, "code"),
      false,
    );
    assert.doesNotMatch(JSON.stringify(diagnostic), /"code":/);
  }
});

test("unknown catalog diagnostics fall back safely and omissions remain typed", () => {
  const unknown: Diagnostic = {
    code: "FUTURE-CATALOG-DIAGNOSTIC",
    severity: "warning",
    message: 'Invalid status "wording that used to classify by accident".',
    path: "contexts/future.md",
  };
  const finding = catalogDiagnosticFindings([unknown]);
  assert.equal(finding.length, 1);
  assert.equal(finding[0]?.id, DIAGNOSTIC_IDS.META_CATALOG_DIAGNOSTIC);
  assert.equal(finding[0]?.title, "Catalog metadata diagnostic");

  assert.deepEqual(
    catalogDiagnosticFindings([
      omitFromCatalogFindings({
        severity: "warning",
        message: "This wording is intentionally irrelevant.",
      }),
    ]),
    [],
  );
});

test("catalog-to-Finding classification cannot branch on message prose", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src", "scanner.ts"),
    "utf8",
  );
  const adapterStart = source.indexOf(
    "export function catalogDiagnosticFindings",
  );
  const adapterEnd = source.indexOf(
    "function findingFromCatalogDiagnostic",
    adapterStart,
  );
  assert.ok(adapterStart >= 0 && adapterEnd > adapterStart);
  const adapter = source.slice(adapterStart, adapterEnd);
  assert.doesNotMatch(adapter, /diagnostic\.message\s*\.(?:match|includes)/);
  assert.doesNotMatch(adapter, /(?:test|match)\(\s*diagnostic\.message/);
});

function codedDiagnostic(code: string, message: string): Diagnostic {
  return {
    code,
    severity: "warning",
    message,
    path: "contexts/example.md",
    evidence: {
      path: "contexts/example.md",
      startLine: 2,
      endLine: 2,
      snippet: "stable evidence",
    },
    details: { field: "stable" },
  };
}

function document(path: string, kind: ArtifactKind, content: string) {
  return parseDocument(artifact(path, kind, content));
}

function artifact(
  sourcePath: string,
  kind: ArtifactKind,
  content: string,
): Artifact {
  return {
    path: sourcePath,
    absolutePath: `/tmp/${sourcePath}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
