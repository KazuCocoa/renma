import assert from "node:assert/strict";
import test from "node:test";
import {
  correlateTarget,
  normalizeEvidence,
  normalizeScannerTarget,
} from "./lib.mjs";

const nativeDuplicate = {
  id: "AS3",
  finding_id: "finding-one",
  category: "Agent Snooping",
  pattern: "Skill Enumeration",
  severity: "MEDIUM",
  confidence: 0.8,
  location: { file: "./skills/demo/SKILL.md", start_line: 9, end_line: null },
  finding: "skills/Example/SKILL.md",
  explanation: "Scanner-native explanation.",
  remediation: "Scanner-native remediation.",
  code_snippet: null,
  intent: null,
  tags: ["Agent Snooping"],
};
const rawReport = {
  metadata: { skillspector_version: "2.5.0" },
  issues: [
    nativeDuplicate,
    { ...structuredClone(nativeDuplicate), finding_id: "finding-two" },
    {
      id: "LP1",
      finding_id: "finding-three",
      severity: "HIGH",
      confidence: 0.75,
      location: { file: "README.md", start_line: null, end_line: null },
      explanation: "Unmatched evidence.",
      remediation: null,
    },
  ],
};
const catalog = {
  catalog: {
    assets: [
      {
        id: "skill.demo",
        kind: "skill",
        sourcePath: "skills/demo/SKILL.md",
        contentHash: "sha256:skill",
        ownership: {
          declaredOwner: "team-demo",
          effectiveOwner: "team-demo",
          source: "declared",
        },
      },
    ],
    dependencies: [],
  },
};

test("path normalization is deterministic and rejects unsafe targets", () => {
  assert.deepEqual(
    normalizeScannerTarget(".", { file: "./skills/demo/../demo/SKILL.md" }),
    {
      status: "normalized",
      scannerPath: "./skills/demo/../demo/SKILL.md",
      repositoryRelativePath: "skills/demo/SKILL.md",
      explanation:
        "The scanner path was normalized relative to the recorded scan target.",
    },
  );
  assert.equal(
    normalizeScannerTarget("skills/demo", { file: "../../outside.md" }).status,
    "unsafe",
  );
  assert.equal(
    normalizeScannerTarget(".", { file: "C:\\outside.md" }).status,
    "unsafe",
  );
  assert.equal(normalizeScannerTarget(".", null).status, "missing");
});

test("native fields, duplicates, provenance, and unresolved evidence survive", () => {
  const input = {
    rawReport,
    rawReportText: JSON.stringify(rawReport),
    rawOutputReference: "captured/report.json",
    catalog,
    catalogReference: "captured/catalog.json",
    catalogText: JSON.stringify(catalog),
    fixtureId: "unit-fixture",
  };
  const normalized = normalizeEvidence(input);

  assert.deepEqual(
    normalized.evidence[0].scannerFact.nativeFinding,
    nativeDuplicate,
  );
  assert.notEqual(
    normalized.evidence[0].scannerFact.nativeFinding,
    nativeDuplicate,
  );
  assert.equal(normalized.evidence[0].scannerFact.provenance, "scanner-output");
  assert.equal(
    normalized.evidence[0].normalization.provenance,
    "experiment-normalization",
  );
  assert.equal(
    normalized.evidence[0].correlation.provenance,
    "experiment-correlation",
  );
  assert.equal(normalized.evidence[0].correlation.status, "correlated");
  assert.equal(normalized.evidence[2].correlation.status, "unresolved");
  assert.equal(
    normalized.evidence[2].correlation.reasonCode,
    "no-catalog-asset-at-path",
  );
  assert.equal(normalized.evidence.length, rawReport.issues.length);
  assert.deepEqual(
    normalized.observations.duplicateGroups[0].evidenceIndexes,
    [0, 1],
  );
  assert.equal(normalized.counts.duplicateEvidenceCount, 2);
  assert.equal(normalized.counts.correlatedCount, 2);
  assert.equal(normalized.counts.unresolvedCount, 1);
});

test("identical inputs produce byte-identical normalized JSON", () => {
  const input = {
    rawReport,
    rawReportText: JSON.stringify(rawReport),
    rawOutputReference: "captured/report.json",
    catalog,
    catalogReference: "captured/catalog.json",
    catalogText: JSON.stringify(catalog),
    fixtureId: "unit-fixture",
  };
  assert.equal(
    JSON.stringify(normalizeEvidence(input), null, 2),
    JSON.stringify(normalizeEvidence(input), null, 2),
  );
});

test("ambiguous exact paths remain ambiguous", () => {
  const target = normalizeScannerTarget(".", { file: "skills/demo/SKILL.md" });
  const duplicatedCatalog = {
    assets: [
      catalog.catalog.assets[0],
      { ...catalog.catalog.assets[0], id: "skill.demo.duplicate" },
    ],
    dependencies: [],
  };
  const result = correlateTarget(target, duplicatedCatalog);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});
