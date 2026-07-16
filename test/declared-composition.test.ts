import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDeclaredComposition } from "../src/declared-composition.js";
import type { Asset, AssetKind, Catalog, Dependency } from "../src/model.js";

test("declared composition propagates required and optional membership through lenses and contexts", () => {
  const catalog = makeCatalog(
    [
      asset("skill.root", "skill"),
      asset("lens.required", "context_lens"),
      asset("lens.optional", "context_lens"),
      asset("context.shared", "context"),
      asset("context.required-child", "context"),
      asset("context.optional-child", "context"),
    ],
    [
      dependency("skill.root", "lens.required", "requires_lens", 1),
      dependency("skill.root", "lens.optional", "optional_lens", 2),
      dependency("lens.required", "context.shared", "applies_to", 3),
      dependency("lens.optional", "context.shared", "applies_to", 4),
      dependency(
        "context.shared",
        "context.required-child",
        "requires_context",
        5,
      ),
      dependency("lens.optional", "context.optional-child", "applies_to", 6),
    ],
  );

  const report = resolveDeclaredComposition(catalog, "skill.root", {
    evaluationDate: "2026-07-15",
  });

  assert.deepEqual(
    report.requiredAssets.map((member) => member.id),
    ["context.required-child", "context.shared", "lens.required"],
  );
  assert.deepEqual(
    report.optionalAssets.map((member) => member.id),
    ["context.optional-child", "lens.optional"],
  );
  assert.equal(
    report.requiredAssets.find((member) => member.id === "context.shared")
      ?.direct,
    false,
  );
  assert.deepEqual(
    report.provenanceEdges
      .filter((edge) => edge.to === "context.shared")
      .map((edge) => [edge.from, edge.membership]),
    [
      ["lens.optional", "optional"],
      ["lens.required", "required"],
    ],
  );
  assert.deepEqual(
    report.provenanceEdges
      .filter((edge) => edge.to === "context.required-child")
      .map((edge) => edge.membership),
    ["optional", "required"],
  );
  assert.equal(report.requiredComplete, true);
  assert.equal(report.optionalComplete, true);
  assert.equal(report.cycleFree, true);
});

test("declared composition separates unknown and wrong-kind required and optional declarations", () => {
  const catalog = makeCatalog(
    [
      asset("skill.root", "skill"),
      asset("lens.actual", "context_lens"),
      asset("context.actual", "context"),
    ],
    [
      dependency("skill.root", "missing.required", "requires_context", 1),
      dependency("skill.root", "missing.optional", "optional_context", 2),
      dependency("skill.root", "lens.actual", "requires_context", 3),
      dependency("skill.root", "context.actual", "optional_lens", 4),
    ],
  );

  const report = resolveDeclaredComposition(catalog, "skills/skill.root.md", {
    evaluationDate: "2026-07-15",
  });

  assert.deepEqual(
    report.unresolvedRequired.map((issue) => issue.declaredTarget),
    ["missing.required"],
  );
  assert.deepEqual(
    report.unresolvedOptional.map((issue) => issue.declaredTarget),
    ["missing.optional"],
  );
  assert.deepEqual(
    report.kindMismatches.map((issue) => [
      issue.declaredTarget,
      issue.expectedTargetKind,
      issue.actualTargetKind,
      issue.membership,
    ]),
    [
      ["context.actual", "context_lens", "context", "optional"],
      ["lens.actual", "context", "context_lens", "required"],
    ],
  );
  assert.equal(report.requiredComplete, false);
  assert.equal(report.optionalComplete, false);
});

test("complete required cycles terminate, retain cycle-forming evidence, and keep completeness separate", () => {
  const catalog = makeCatalog(
    [asset("context.a", "context"), asset("context.b", "context")],
    [
      dependency("context.a", "context.b", "requires_context", 10),
      dependency("context.b", "context.a", "requires_context", 20),
    ],
  );

  const report = resolveDeclaredComposition(catalog, "context.a", {
    evaluationDate: "2026-07-15",
  });

  assert.deepEqual(
    report.requiredAssets.map((member) => member.id),
    ["context.b"],
  );
  assert.equal(report.requiredComplete, true);
  assert.equal(report.cycleFree, false);
  assert.deepEqual(
    report.requiredCycles.map((cycle) => cycle.assetIds),
    [["context.a", "context.b"]],
  );
  assert.deepEqual(
    report.requiredCycles[0]?.edges.map((edge) => edge.evidence?.startLine),
    [10, 20],
  );
});

test("optional cycles remain optional after the first optional edge", () => {
  const catalog = makeCatalog(
    [
      asset("skill.root", "skill"),
      asset("context.a", "context"),
      asset("context.b", "context"),
    ],
    [
      dependency("skill.root", "context.a", "optional_context", 1),
      dependency("context.a", "context.b", "requires_context", 2),
      dependency("context.b", "context.a", "requires_context", 3),
    ],
  );

  const report = resolveDeclaredComposition(catalog, "skill.root", {
    evaluationDate: "2026-07-15",
  });

  assert.deepEqual(
    report.optionalAssets.map((member) => member.id),
    ["context.a", "context.b"],
  );
  assert.equal(report.requiredCycles.length, 0);
  assert.deepEqual(
    report.optionalCycles.map((cycle) => cycle.assetIds),
    [["context.a", "context.b"]],
  );
});

test("declared conflicts are transitive, normalized, deduplicated, and never select a winner", () => {
  const catalog = makeCatalog(
    [
      asset("skill.root", "skill"),
      asset("lens.review", "context_lens"),
      asset("context.a", "context"),
      asset("context.b", "context"),
      asset("context.optional", "context"),
    ],
    [
      dependency("skill.root", "lens.review", "requires_lens", 1),
      dependency("skill.root", "context.b", "requires_context", 2),
      dependency("skill.root", "context.optional", "optional_context", 3),
      dependency("lens.review", "context.a", "applies_to", 4),
      dependency("context.a", "context.b", "conflicts", 5),
      dependency("context.b", "context.a", "conflicts", 6),
      dependency("context.a", "context.optional", "conflicts", 7),
    ],
  );

  const report = resolveDeclaredComposition(catalog, "skill.root", {
    evaluationDate: "2026-07-15",
  });

  assert.deepEqual(
    report.requiredConflicts.map((conflict) => [
      conflict.left,
      conflict.right,
      conflict.declarations.length,
    ]),
    [["context.a", "context.b", 2]],
  );
  assert.deepEqual(
    report.optionalConflictCandidates.map((conflict) => [
      conflict.left,
      conflict.right,
    ]),
    [["context.a", "context.optional"]],
  );
  assert.equal("winner" in report.requiredConflicts[0]!, false);
});

test("provenance storage stays proportional to declarations in a high-path-count DAG", () => {
  const assets = [asset("skill.root", "skill")];
  const dependencies: Dependency[] = [];
  let previous = ["skill.root"];
  let line = 1;
  for (let layer = 0; layer < 10; layer += 1) {
    const current = [`context.${layer}.a`, `context.${layer}.b`];
    assets.push(...current.map((id) => asset(id, "context")));
    for (const from of previous) {
      for (const to of current) {
        dependencies.push(dependency(from, to, "requires_context", line++));
      }
    }
    previous = current;
  }
  const catalog = makeCatalog(assets, dependencies);

  const report = resolveDeclaredComposition(catalog, "skill.root", {
    evaluationDate: "2026-07-15",
  });

  assert.equal(report.requiredAssets.length, 20);
  assert.equal(report.provenanceEdges.length, dependencies.length);
  assert.ok(report.provenanceEdges.length < 50);
});

test("composition summarizes Context Lens freshness with deterministic dates", () => {
  const lens = asset("lens.stale", "context_lens", {
    lastReviewedAt: "2026-01-01",
    reviewCycle: "P30D",
    expiresAt: "2026-06-01",
  });
  lens.metadataFields.last_reviewed_at = metadataEvidence(
    8,
    "last_reviewed_at",
  );
  lens.metadataFields.expires_at = metadataEvidence(10, "expires_at");
  const report = resolveDeclaredComposition(
    makeCatalog(
      [asset("skill.root", "skill"), lens],
      [dependency("skill.root", "lens.stale", "requires_lens", 1)],
    ),
    "skill.root",
    { evaluationDate: "2026-07-15" },
  );

  assert.deepEqual(
    report.freshnessFindings.map((finding) => [
      finding.assetId,
      finding.kind,
      finding.date,
      finding.evidence?.startLine,
    ]),
    [
      ["lens.stale", "expired", "2026-06-01", 10],
      ["lens.stale", "review_overdue", "2026-01-31", 8],
    ],
  );
});

function makeCatalog(assets: Asset[], dependencies: Dependency[]): Catalog {
  return { entries: assets, assets, dependencies } as Catalog;
}

function asset(
  id: string,
  kind: AssetKind,
  freshness: {
    lastReviewedAt?: string;
    reviewCycle?: string;
    expiresAt?: string;
  } = {},
): Asset {
  return {
    id,
    kind,
    sourcePath: kind === "skill" ? `skills/${id}.md` : `${kind}s/${id}.md`,
    contentHash: `sha256:${id}`,
    sizeBytes: 1,
    contentClassification: "text",
    markdownParserEligible: true,
    ownership: {
      declaredOwner: "maintainers",
      effectiveOwner: "maintainers",
      source: "declared",
    },
    metadata: {
      tags: [],
      whenToUse: [],
      whenNotToUse: [],
      requiresContext: [],
      optionalContext: [],
      conflicts: [],
      supersededBy: [],
      ...freshness,
    },
    metadataFields: {},
    metadataListItems: {},
  };
}

function dependency(
  from: string,
  to: string,
  declaration:
    | "requires_context"
    | "optional_context"
    | "requires_lens"
    | "optional_lens"
    | "applies_to"
    | "conflicts",
  line: number,
): Dependency {
  return {
    from,
    to,
    kind:
      declaration === "requires_context" || declaration === "requires_lens"
        ? "requires"
        : declaration === "optional_context" || declaration === "optional_lens"
          ? "optional"
          : declaration,
    declaration,
    declarationIndex: line,
    sourcePath: `source/${from}.md`,
    evidence: {
      path: `source/${from}.md`,
      startLine: line,
      endLine: line,
      snippet: `${declaration}: ${to}`,
    },
  };
}

function metadataEvidence(line: number, key: string) {
  return {
    path: "lenses/lens.stale.md",
    key,
    startLine: line,
    endLine: line,
    raw: `${key}: value`,
  };
}
