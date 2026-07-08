import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import {
  CONTEXT_LENS_DIAGNOSTIC_CODES,
  summarizeContextLensGovernance,
} from "../src/context-lens.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import { scan } from "../src/scanner.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

test("parseAssetMetadata captures context lens metadata", () => {
  const document = parseDocument(
    artifact(
      "lenses/testing/spec-review-boundary-values.md",
      "context_lens",
      `---
id: lens.testing.spec-review.boundary-values
type: context_lens
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
focus:
  - ambiguity
  - missing boundary
expected_outputs:
  - unresolved questions
  - risk notes
---
# Spec Review Boundary Lens
`,
    ),
  );

  const result = parseAssetMetadata(document);

  assert.equal(result.metadata.type, "context_lens");
  assert.equal(result.metadata.purpose, "spec_review");
  assert.deepEqual(result.metadata.appliesTo, [
    "context.testing.boundary-value-analysis",
  ]);
  assert.deepEqual(result.metadata.focus, ["ambiguity", "missing boundary"]);
  assert.deepEqual(result.metadata.expectedOutputs, [
    "unresolved questions",
    "risk notes",
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test("buildCatalog catalogs context lens assets and applies_to edges", () => {
  const { catalog, diagnostics } = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
when_to_use:
  - Designing boundary-focused tests
when_not_to_use:
  - Exploratory notes unrelated to limits
---
# Boundary Value Analysis
`,
      ),
    ),
    parseDocument(
      artifact(
        "lenses/testing/spec-review-boundary-values.md",
        "context_lens",
        `---
id: lens.testing.spec-review.boundary-values
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Boundary Lens
`,
      ),
    ),
  ]);

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    catalog.entries.map((entry) => [entry.id, entry.kind]),
    [
      ["context.testing.boundary-value-analysis", "context"],
      ["lens.testing.spec-review.boundary-values", "context_lens"],
    ],
  );
  assert.ok(
    catalog.dependencies.some(
      (dependency) =>
        dependency.from === "lens.testing.spec-review.boundary-values" &&
        dependency.kind === "applies_to" &&
        dependency.to === "context.testing.boundary-value-analysis",
    ),
  );
});

test("buildCatalog treats type context_lens under contexts as a lens", () => {
  const { catalog } = buildCatalog([
    parseDocument(
      artifact(
        "contexts/testing/spec-review-lens.md",
        "context",
        `---
id: lens.testing.spec-review
type: context_lens
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Lens
`,
      ),
    ),
  ]);

  assert.equal(catalog.entries[0]?.kind, "context_lens");
  assert.equal(catalog.entries[0]?.id, "lens.testing.spec-review");
});

test("buildCatalog keeps skill files as skills when type is context_lens", () => {
  const { catalog } = buildCatalog([
    parseDocument(
      artifact(
        "skills/testing/spec-review/SKILL.md",
        "skill",
        `---
id: skill.testing.spec-review
type: context_lens
owner: qa-platform
status: experimental
requires_lens:
  - lens.testing.spec-review
---
# Spec Review
`,
      ),
    ),
  ]);

  assert.equal(catalog.entries[0]?.kind, "skill");
  assert.equal(catalog.entries[0]?.id, "skill.testing.spec-review");
});

test("buildCatalog creates skill to lens dependency edges", () => {
  const { catalog } = buildCatalog([
    parseDocument(
      artifact(
        "skills/testing/spec-review/SKILL.md",
        "skill",
        `---
id: skill.testing.spec-review
requires_lens:
  - lens.testing.spec-review.boundary-values
optional_lens:
  - lens.testing.failure-analysis.symptoms
---
# Spec Review
`,
      ),
    ),
  ]);

  assert.deepEqual(
    catalog.dependencies.map((dependency) => ({
      from: dependency.from,
      to: dependency.to,
      kind: dependency.kind,
    })),
    [
      {
        from: "skill.testing.spec-review",
        to: "lens.testing.spec-review.boundary-values",
        kind: "requires",
      },
      {
        from: "skill.testing.spec-review",
        to: "lens.testing.failure-analysis.symptoms",
        kind: "optional",
      },
    ],
  );
});

test("buildCatalog warns about missing context lens wiring metadata", () => {
  const { diagnostics } = buildCatalog([
    parseDocument(
      artifact(
        "lenses/testing/spec-review.md",
        "context_lens",
        `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
---
# Spec Review Lens
`,
      ),
    ),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("missing purpose metadata"),
    ),
  );
  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("missing applies_to metadata"),
    ),
  );
});

test("buildCatalog validates lens references and applied contexts", () => {
  const { diagnostics } = buildCatalog([
    parseDocument(
      artifact(
        "skills/testing/spec-review/SKILL.md",
        "skill",
        `---
id: skill.testing.spec-review
requires_lens:
  - lens.testing.missing
---
# Spec Review
`,
      ),
    ),
    parseDocument(
      artifact(
        "lenses/testing/spec-review.md",
        "context_lens",
        `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.missing
---
# Spec Review Lens
`,
      ),
    ),
  ]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes('"lens.testing.missing"'),
    ),
  );
  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes('"context.testing.missing"'),
    ),
  );
});

test("summarizeContextLensGovernance reports valid lens summary without errors", () => {
  const documents = [
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
---
# Boundary Value Analysis
`,
      ),
    ),
    parseDocument(
      artifact(
        "lenses/testing/spec-review.md",
        "context_lens",
        `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
focus:
  - ambiguity
expected_outputs:
  - unresolved questions
---
# Spec Review Lens

Review boundary context for ambiguity.
`,
      ),
    ),
  ];
  const { catalog } = buildCatalog(documents);
  const report = summarizeContextLensGovernance(documents, catalog);

  assert.equal(report.summary.totalLensCount, 1);
  assert.equal(report.summary.validLensCount, 1);
  assert.equal(report.summary.invalidLensCount, 0);
  assert.deepEqual(report.summary.diagnosticCounts, {
    error: 0,
    warning: 0,
    info: 0,
  });
  assert.deepEqual(report.summary.definitionPaths, [
    "lenses/testing/spec-review.md",
  ]);
  assert.deepEqual(report.summary.targetReferences, [
    "context.testing.boundary-value-analysis",
  ]);
  assert.deepEqual(report.summary.targetPaths, [
    "contexts/testing/boundary-value-analysis.md",
  ]);
  assert.deepEqual(report.diagnostics, []);
});

test("summarizeContextLensGovernance errors on missing required fields", () => {
  const documents = [
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
---
# Boundary Value Analysis
`,
      ),
    ),
    parseDocument(
      artifact(
        "lenses/testing/spec-review.md",
        "context_lens",
        `---
id: lens.testing.spec-review
owner: qa-platform
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Lens
`,
      ),
    ),
  ];
  const { catalog } = buildCatalog(documents);
  const report = summarizeContextLensGovernance(documents, catalog);

  assert.equal(report.summary.invalidLensCount, 1);
  assert.equal(report.summary.diagnosticCounts.error, 1);
  assert.equal(
    report.diagnostics[0]?.code,
    CONTEXT_LENS_DIAGNOSTIC_CODES.MISSING_REQUIRED_FIELD,
  );
  assert.match(report.diagnostics[0]?.message ?? "", /"purpose"/);
});

test("summarizeContextLensGovernance errors on duplicate lens ids", () => {
  const documents = [
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
---
# Boundary Value Analysis
`,
      ),
    ),
    parseDocument(validLensArtifact("lenses/a.md", "lens.testing.duplicate")),
    parseDocument(validLensArtifact("lenses/b.md", "lens.testing.duplicate")),
  ];
  const { catalog } = buildCatalog(documents);
  const report = summarizeContextLensGovernance(documents, catalog);

  assert.equal(report.summary.invalidLensCount, 2);
  assert.equal(
    report.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === CONTEXT_LENS_DIAGNOSTIC_CODES.DUPLICATE_ID,
    ).length,
    2,
  );
});

test("summarizeContextLensGovernance errors on missing target path", () => {
  const documents = [
    parseDocument(
      artifact(
        "lenses/testing/spec-review.md",
        "context_lens",
        `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - ./contexts/testing/missing.md
---
# Spec Review Lens
`,
      ),
    ),
  ];
  const { catalog } = buildCatalog(documents);
  const report = summarizeContextLensGovernance(documents, catalog);

  assert.deepEqual(report.summary.unresolvedTargetReferences, [
    "./contexts/testing/missing.md",
  ]);
  assert.ok(
    report.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === CONTEXT_LENS_DIAGNOSTIC_CODES.TARGET_NOT_FOUND &&
        diagnostic.severity === "error",
    ),
  );
  assert.ok(
    report.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
          CONTEXT_LENS_DIAGNOSTIC_CODES.PATH_NORMALIZATION_MISMATCH &&
        diagnostic.severity === "warning",
    ),
  );
});

test("summarizeContextLensGovernance reports unsupported kind scope and version", () => {
  const documents = [
    parseDocument(
      artifact(
        "contexts/testing/boundary-value-analysis.md",
        "context",
        `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
---
# Boundary Value Analysis
`,
      ),
    ),
    parseDocument(
      artifact(
        "skills/testing/spec-review/SKILL.md",
        "skill",
        `---
id: skill.testing.spec-review
type: context_lens
owner: qa-platform
---
# Spec Review Skill
`,
      ),
    ),
    parseDocument(
      artifact(
        "lenses/testing/spec-review.md",
        "context_lens",
        `---
id: lens.testing.spec-review
owner: qa-platform
scope: runtime
version: 2
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Lens
`,
      ),
    ),
  ];
  const { catalog } = buildCatalog(documents);
  const report = summarizeContextLensGovernance(documents, catalog);
  const codes = report.diagnostics.map((diagnostic) => diagnostic.code);

  assert.ok(codes.includes(CONTEXT_LENS_DIAGNOSTIC_CODES.UNSUPPORTED_KIND));
  assert.ok(codes.includes(CONTEXT_LENS_DIAGNOSTIC_CODES.UNSUPPORTED_SCOPE));
  assert.ok(codes.includes(CONTEXT_LENS_DIAGNOSTIC_CODES.UNSUPPORTED_VERSION));
  assert.equal(
    report.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === CONTEXT_LENS_DIAGNOSTIC_CODES.UNSUPPORTED_KIND,
    )?.severity,
    "warning",
  );
});

test("summarizeContextLensGovernance reports empty and meaningless definitions", () => {
  const documents = [
    parseDocument(artifact("lenses/empty.md", "context_lens", "")),
    parseDocument(
      artifact(
        "lenses/meaningless.md",
        "context_lens",
        `---
id: lens.testing.meaningless
owner: qa-platform
---
# Empty Heading Only
`,
      ),
    ),
  ];
  const { catalog } = buildCatalog(documents);
  const report = summarizeContextLensGovernance(documents, catalog);
  const codes = report.diagnostics.map((diagnostic) => diagnostic.code);

  assert.ok(codes.includes(CONTEXT_LENS_DIAGNOSTIC_CODES.EMPTY_DEFINITION));
  assert.ok(
    codes.includes(CONTEXT_LENS_DIAGNOSTIC_CODES.GOVERNANCE_MEANINGLESS),
  );
});

test("summarizeContextLensGovernance keeps output order stable", () => {
  const documents = [
    parseDocument(validLensArtifact("lenses/z.md", "lens.testing.z")),
    parseDocument(validLensArtifact("lenses/a.md", "lens.testing.a")),
  ];
  const { catalog } = buildCatalog(documents);
  const report = summarizeContextLensGovernance(documents, catalog);

  assert.deepEqual(report.summary.definitionPaths, [
    "lenses/a.md",
    "lenses/z.md",
  ]);
  assert.deepEqual(
    report.diagnostics.map((diagnostic) => diagnostic.path),
    ["lenses/a.md", "lenses/z.md"],
  );
});

test("scan uses generic missing id finding titles for contexts and lenses", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "testing", "missing.md"),
    "# Missing Context Metadata\n",
  );
  await writeFile(
    path.join(root, "lenses", "testing", "missing.md"),
    "# Missing Lens Metadata\n",
  );

  const result = await scan(root);
  const missingFindings = result.findings
    .filter((finding) => finding.id === "META-MISSING-ID")
    .map((finding) => ({
      path: finding.evidence.path,
      title: finding.title,
    }));

  assert.deepEqual(missingFindings, [
    {
      path: "contexts/testing/missing.md",
      title: "Asset is missing an id",
    },
    {
      path: "lenses/testing/missing.md",
      title: "Asset is missing an id",
    },
  ]);
  assert.equal(
    result.findings.some((finding) => finding.id === "META-MISSING-OWNER"),
    false,
  );
});

test("scan reports active context lenses that are not referenced by skills", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "testing", "boundary-value-analysis.md"),
    `---
id: context.testing.boundary-value-analysis
owner: qa-platform
status: stable
when_to_use:
  - Designing tests around numeric, date, quantity, or limit boundaries
when_not_to_use:
  - Exploratory notes unrelated to limits
---
# Boundary Value Analysis
`,
  );
  await writeFile(
    path.join(root, "lenses", "testing", "spec-review.md"),
    `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Lens
`,
  );

  const result = await scan(root);
  const finding = result.findings.find(
    (candidate) => candidate.id === "MAINT-ORPHANED-CONTEXT-LENS",
  );

  assert.equal(finding?.severity, "low");
  assert.equal(finding?.evidence.path, "lenses/testing/spec-review.md");
});

test("scan reports active lenses that apply to inactive context assets", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "contexts", "testing"), { recursive: true });
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await mkdir(path.join(root, "skills", "testing", "spec-review"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "contexts", "testing", "old-boundary-value-analysis.md"),
    `---
id: context.testing.old-boundary-value-analysis
owner: qa-platform
status: archived
---
# Old Boundary Value Analysis
`,
  );
  await writeFile(
    path.join(root, "lenses", "testing", "spec-review.md"),
    `---
id: lens.testing.spec-review
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.old-boundary-value-analysis
---
# Spec Review Lens
`,
  );
  await writeFile(
    path.join(root, "skills", "testing", "spec-review", "SKILL.md"),
    `---
id: skill.testing.spec-review
owner: qa-platform
status: experimental
requires_lens:
  - lens.testing.spec-review
---
# Spec Review
`,
  );

  const result = await scan(root);
  const finding = result.findings.find(
    (candidate) =>
      candidate.id === "MAINT-CONTEXT-LENS-APPLIES-TO-INACTIVE-CONTEXT",
  );
  const ids = result.findings.map((candidate) => candidate.id);

  assert.equal(finding?.severity, "low");
  assert.equal(finding?.evidence.path, "lenses/testing/spec-review.md");
  assert.ok(!ids.includes("MAINT-REFERENCE-DEPRECATED-ASSET"));
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-context-lens-"));
}

function validLensArtifact(path: string, id: string): Artifact {
  return artifact(
    path,
    "context_lens",
    `---
id: ${id}
owner: qa-platform
status: experimental
purpose: spec_review
applies_to:
  - context.testing.boundary-value-analysis
---
# Spec Review Lens

Review boundary context for ambiguity.
`,
  );
}

function artifact(path: string, kind: ArtifactKind, content: string): Artifact {
  return {
    path,
    absolutePath: `/tmp/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    content,
  };
}
