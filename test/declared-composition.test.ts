import assert from "node:assert/strict";
import { test } from "node:test";
import {
  declaredCompositionFindings,
  resolveDeclaredComposition,
} from "../src/declared-composition.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
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

test("applies_to source validation is independent from target resolution", () => {
  const catalog = makeCatalog(
    [
      asset("skill.optional", "skill"),
      asset("context.valid", "context"),
      asset("context.wrong-valid", "context"),
      asset("context.wrong-missing", "context"),
      asset("context.wrong-target", "context"),
      asset("lens.correct-missing", "context_lens"),
      asset("lens.wrong-target", "context_lens"),
    ],
    [
      dependency("context.wrong-valid", "context.valid", "applies_to", 1),
      dependency("context.wrong-missing", "missing.context", "applies_to", 2),
      dependency("lens.correct-missing", "missing.context", "applies_to", 3),
      dependency("context.wrong-target", "lens.wrong-target", "applies_to", 4),
      dependency(
        "skill.optional",
        "context.wrong-missing",
        "optional_context",
        5,
      ),
    ],
  );

  const validTarget = resolveDeclaredComposition(
    catalog,
    "context.wrong-valid",
    {
      evaluationDate: "2026-07-15",
    },
  );
  assert.equal(validTarget.kindMismatches.length, 1);
  assert.deepEqual(
    {
      sourceId: validTarget.kindMismatches[0]?.sourceId,
      declaredTarget: validTarget.kindMismatches[0]?.declaredTarget,
      expectedSourceKind: validTarget.kindMismatches[0]?.expectedSourceKind,
      targetId: validTarget.kindMismatches[0]?.targetId,
    },
    {
      sourceId: "context.wrong-valid",
      declaredTarget: "context.valid",
      expectedSourceKind: "context_lens",
      targetId: undefined,
    },
  );
  assert.equal(validTarget.unresolvedRequired.length, 0);
  assert.equal(validTarget.requiredComplete, false);
  assert.equal(validTarget.optionalComplete, true);

  const unresolvedTarget = resolveDeclaredComposition(
    catalog,
    "context.wrong-missing",
    { evaluationDate: "2026-07-15" },
  );
  assert.equal(unresolvedTarget.kindMismatches.length, 1);
  assert.equal(
    unresolvedTarget.kindMismatches[0]?.expectedSourceKind,
    "context_lens",
  );
  assert.equal(unresolvedTarget.kindMismatches[0]?.targetId, undefined);
  assert.deepEqual(
    unresolvedTarget.unresolvedRequired.map((issue) => issue.declaredTarget),
    ["missing.context"],
  );
  assert.equal(unresolvedTarget.requiredComplete, false);
  assert.equal(unresolvedTarget.optionalComplete, true);

  const correctSource = resolveDeclaredComposition(
    catalog,
    "lens.correct-missing",
    { evaluationDate: "2026-07-15" },
  );
  assert.equal(correctSource.kindMismatches.length, 0);
  assert.equal(correctSource.unresolvedRequired.length, 1);
  assert.equal(correctSource.requiredComplete, false);
  assert.equal(correctSource.optionalComplete, true);

  const wrongSourceAndTarget = resolveDeclaredComposition(
    catalog,
    "context.wrong-target",
    { evaluationDate: "2026-07-15" },
  );
  assert.equal(wrongSourceAndTarget.kindMismatches.length, 1);
  assert.deepEqual(
    {
      expectedSourceKind:
        wrongSourceAndTarget.kindMismatches[0]?.expectedSourceKind,
      expectedTargetKind:
        wrongSourceAndTarget.kindMismatches[0]?.expectedTargetKind,
      actualTargetKind:
        wrongSourceAndTarget.kindMismatches[0]?.actualTargetKind,
      targetId: wrongSourceAndTarget.kindMismatches[0]?.targetId,
    },
    {
      expectedSourceKind: "context_lens",
      expectedTargetKind: "context",
      actualTargetKind: "context_lens",
      targetId: "lens.wrong-target",
    },
  );
  assert.equal(wrongSourceAndTarget.unresolvedRequired.length, 0);
  assert.equal(wrongSourceAndTarget.requiredComplete, false);

  const optionalRoute = resolveDeclaredComposition(catalog, "skill.optional", {
    evaluationDate: "2026-07-15",
  });
  assert.equal(optionalRoute.requiredComplete, true);
  assert.equal(optionalRoute.optionalComplete, false);
  assert.equal(optionalRoute.unresolvedOptional.length, 1);
  assert.equal(optionalRoute.kindMismatches[0]?.membership, "optional");
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

test("scan cycle aggregation preserves required and optional root classifications", () => {
  const assets = [
    asset("skill.optional", "skill"),
    asset("skill.required", "skill"),
    asset("context.a", "context"),
    asset("context.b", "context"),
    asset("context.x", "context"),
    asset("context.y", "context"),
  ];
  const dependencies = [
    dependency("skill.optional", "context.a", "optional_context", 1),
    dependency("skill.required", "context.a", "requires_context", 2),
    dependency("context.a", "context.b", "requires_context", 3),
    dependency("context.b", "context.a", "requires_context", 4),
    dependency("context.x", "context.y", "optional_context", 5),
    dependency("context.y", "context.x", "requires_context", 6),
  ];

  const findings = declaredCompositionFindings(
    makeCatalog(assets, dependencies),
    "2026-07-15",
  ).filter(
    (finding) =>
      finding.id === DIAGNOSTIC_IDS.COMPOSITION_REQUIRED_CYCLE ||
      finding.id === DIAGNOSTIC_IDS.COMPOSITION_OPTIONAL_CYCLE,
  );
  const repeated = declaredCompositionFindings(
    makeCatalog([...assets].reverse(), [...dependencies].reverse()),
    "2026-07-15",
  ).filter(
    (finding) =>
      finding.id === DIAGNOSTIC_IDS.COMPOSITION_REQUIRED_CYCLE ||
      finding.id === DIAGNOSTIC_IDS.COMPOSITION_OPTIONAL_CYCLE,
  );

  assert.deepEqual(findings, repeated);
  assert.equal(findings.length, 2);
  const required = findings.find(
    (finding) => finding.id === DIAGNOSTIC_IDS.COMPOSITION_REQUIRED_CYCLE,
  );
  assert.deepEqual(required?.details?.assetIds, ["context.a", "context.b"]);
  assert.deepEqual(required?.details?.requiredRoots, [
    "context.a",
    "context.b",
    "skill.required",
  ]);
  assert.deepEqual(required?.details?.optionalRoots, ["skill.optional"]);
  assert.deepEqual(required?.details?.rootMemberships, [
    { rootId: "context.a", membership: "required" },
    { rootId: "context.b", membership: "required" },
    { rootId: "skill.required", membership: "required" },
    { rootId: "skill.optional", membership: "optional" },
  ]);

  const optional = findings.find(
    (finding) => finding.id === DIAGNOSTIC_IDS.COMPOSITION_OPTIONAL_CYCLE,
  );
  assert.deepEqual(optional?.details?.assetIds, ["context.x", "context.y"]);
  assert.deepEqual(optional?.details?.requiredRoots, []);
  assert.deepEqual(optional?.details?.optionalRoots, [
    "context.x",
    "context.y",
  ]);
  assert.ok(
    (optional?.details?.edges as Array<{ relationship: string }>).some(
      (edge) => edge.relationship === "optional_context",
    ),
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

test("scan prepares repository composition indexes once for many disconnected assets", () => {
  const assets = Array.from({ length: 250 }, (_, index) =>
    asset(
      `context.disconnected-${index.toString().padStart(3, "0")}`,
      "context",
    ),
  );
  let fullAssetIterations = 0;
  const trackedAssets = new Proxy(assets, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        return function iterator() {
          fullAssetIterations += 1;
          return target[Symbol.iterator]();
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const findings = declaredCompositionFindings(
    makeCatalog(trackedAssets, []),
    "2026-07-15",
  );

  assert.deepEqual(findings, []);
  assert.equal(fullAssetIterations, 2);
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
