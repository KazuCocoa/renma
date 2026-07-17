import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prepareDeclaredCompositionIndex,
  type CompositionRelationship,
} from "../src/declared-composition.js";
import {
  resolveDeclaredImpact,
  resolveDeclaredImpactFromIndex,
} from "../src/declared-impact.js";
import type { Asset, AssetKind, Catalog, Dependency } from "../src/model.js";

test("declared impact propagates reverse required and optional membership with Skill summaries", () => {
  const catalog = makeCatalog(
    [
      asset("context.focus", "context"),
      asset("context.required", "context"),
      asset("context.optional", "context"),
      asset("lens.review", "context_lens"),
      asset("skill.required", "skill"),
      asset("skill.optional", "skill"),
      asset("skill.both", "skill"),
    ],
    [
      dependency("context.required", "context.focus", "requires_context", 1),
      dependency("context.optional", "context.focus", "optional_context", 2),
      dependency("lens.review", "context.focus", "applies_to", 3),
      dependency("skill.required", "context.required", "requires_context", 4),
      dependency("skill.optional", "context.required", "optional_context", 5),
      dependency("skill.both", "lens.review", "requires_lens", 6),
      dependency("skill.both", "context.optional", "requires_context", 7),
    ],
  );

  const report = resolveDeclaredImpact(catalog, "context.focus");

  assert.deepEqual(
    report.requiredDependents.map((dependent) => [
      dependent.id,
      dependent.direct,
    ]),
    [
      ["context.required", true],
      ["lens.review", true],
      ["skill.both", false],
      ["skill.required", false],
    ],
  );
  assert.deepEqual(
    report.optionalDependents.map((dependent) => [
      dependent.id,
      dependent.direct,
    ]),
    [
      ["context.optional", true],
      ["skill.optional", false],
    ],
  );
  assert.deepEqual(
    report.requiredSkills.map((skill) => skill.id),
    ["skill.both", "skill.required"],
  );
  assert.deepEqual(
    report.optionalSkills.map((skill) => skill.id),
    ["skill.optional"],
  );
  assert.deepEqual(
    report.provenanceEdges
      .filter((edge) => edge.from === "skill.both")
      .map((edge) => [
        edge.to,
        edge.dependentMembership,
        edge.declarationIndex,
      ]),
    [
      ["context.optional", "optional", 7],
      ["lens.review", "required", 6],
    ],
  );
  assert.equal(
    report.provenanceEdges.find(
      (edge) => edge.from === "context.required" && edge.to === "context.focus",
    )?.direct,
    true,
  );
  assert.ok(
    report.provenanceEdges.every(
      (edge) => edge.evidence?.snippet && edge.evidence.startLine > 0,
    ),
  );
  assert.equal(
    report.requiredDependents.some(
      (dependent) => dependent.id === report.focus.id,
    ),
    false,
  );
});

test("direct Skill impact works for required and optional Context and Lens focus", () => {
  const catalog = makeCatalog(
    [
      asset("context.focus", "context"),
      asset("lens.focus", "context_lens"),
      asset("skill.context-required", "skill"),
      asset("skill.context-optional", "skill"),
      asset("skill.lens-required", "skill"),
      asset("skill.lens-optional", "skill"),
    ],
    [
      dependency(
        "skill.context-required",
        "context.focus",
        "requires_context",
        1,
      ),
      dependency(
        "skill.context-optional",
        "context.focus",
        "optional_context",
        2,
      ),
      dependency("skill.lens-required", "lens.focus", "requires_lens", 3),
      dependency("skill.lens-optional", "lens.focus", "optional_lens", 4),
    ],
  );

  const context = resolveDeclaredImpact(catalog, "context.focus");
  const lens = resolveDeclaredImpact(catalog, "lens.focus");

  assert.deepEqual(
    context.requiredSkills.map((skill) => [skill.id, skill.direct]),
    [["skill.context-required", true]],
  );
  assert.deepEqual(
    context.optionalSkills.map((skill) => [skill.id, skill.direct]),
    [["skill.context-optional", true]],
  );
  assert.deepEqual(
    lens.requiredSkills.map((skill) => [skill.id, skill.direct]),
    [["skill.lens-required", true]],
  );
  assert.deepEqual(
    lens.optionalSkills.map((skill) => [skill.id, skill.direct]),
    [["skill.lens-optional", true]],
  );
});

test("required impact dominates classification while both route classes retain declaration provenance", () => {
  const report = resolveDeclaredImpact(
    makeCatalog(
      [
        asset("context.focus", "context"),
        asset("context.middle", "context"),
        asset("skill.root", "skill"),
      ],
      [
        dependency("context.middle", "context.focus", "requires_context", 1),
        dependency("context.middle", "context.focus", "optional_context", 2),
        dependency("skill.root", "context.middle", "requires_context", 3),
        dependency("skill.root", "context.middle", "requires_context", 4),
      ],
    ),
    "contexts/context.focus.md",
  );

  assert.deepEqual(
    report.requiredDependents.map((dependent) => dependent.id),
    ["context.middle", "skill.root"],
  );
  assert.deepEqual(report.optionalDependents, []);
  assert.deepEqual(
    report.provenanceEdges
      .filter((edge) => edge.from === "skill.root")
      .map((edge) => [edge.dependentMembership, edge.declarationIndex]),
    [
      ["optional", 3],
      ["optional", 4],
      ["required", 3],
      ["required", 4],
    ],
  );
});

test("incoming index retains invalid resolved declarations without traversing them", () => {
  const catalog = makeCatalog(
    [
      asset("context.focus", "context"),
      asset("context.valid", "context"),
      asset("context.invalid-lens", "context"),
      asset("lens.focus", "context_lens"),
      asset("context.both-invalid", "context"),
      asset("skill.valid", "skill"),
      asset("skill.wrong-lens", "skill"),
      asset("skill.wrong-context", "skill"),
      asset("skill.reference-only", "skill"),
    ],
    [
      dependency("context.valid", "context.focus", "requires_context", 1),
      dependency("skill.valid", "context.valid", "requires_context", 2),
      dependency("context.invalid-lens", "context.focus", "applies_to", 3),
      dependency("skill.wrong-lens", "context.focus", "requires_lens", 4),
      dependency("context.both-invalid", "lens.focus", "applies_to", 8),
      dependency("skill.wrong-context", "lens.focus", "requires_context", 9),
      rawDependency("skill.reference-only", "context.focus", "references", 5),
      rawDependency("skill.reference-only", "context.focus", "conflicts", 6),
      rawDependency("skill.reference-only", "context.focus", "extends", 10),
      rawDependency(
        "skill.reference-only",
        "context.focus",
        "statically_references",
        11,
      ),
      rawDependency(
        "skill.reference-only",
        "context.focus",
        "inherits_owner",
        12,
      ),
      rawDependency(
        "skill.reference-only",
        "context.focus",
        "inherits_policy",
        13,
      ),
      dependency(
        "skill.reference-only",
        "missing.context.focus",
        "requires_context",
        7,
      ),
    ],
  );
  const index = prepareDeclaredCompositionIndex(catalog);

  assert.equal(index.incomingByTargetId.get("context.focus")?.length, 3);
  assert.equal(
    index.incomingByTargetId
      .get("context.focus")
      ?.filter((declaration) => declaration.kindMismatch).length,
    2,
  );

  const report = resolveDeclaredImpactFromIndex(index, "context.focus");
  assert.deepEqual(
    report.requiredDependents.map((dependent) => dependent.id),
    ["context.valid", "skill.valid"],
  );
  assert.deepEqual(
    report.invalidIncomingDeclarations.map((mismatch) => [
      mismatch.sourceId,
      mismatch.expectedSourceKind,
      mismatch.expectedTargetKind,
      mismatch.actualTargetKind,
    ]),
    [
      ["context.invalid-lens", "context_lens", undefined, undefined],
      ["skill.wrong-lens", undefined, "context_lens", "context"],
    ],
  );
  assert.equal(
    report.requiredDependents.some(
      (dependent) => dependent.id === "skill.reference-only",
    ),
    false,
  );

  const lensReport = resolveDeclaredImpactFromIndex(index, "lens.focus");
  assert.deepEqual(lensReport.requiredDependents, []);
  assert.deepEqual(
    lensReport.invalidIncomingDeclarations.map((mismatch) => [
      mismatch.sourceId,
      mismatch.expectedSourceKind,
      mismatch.expectedTargetKind,
      mismatch.actualTargetKind,
    ]),
    [
      ["context.both-invalid", "context_lens", "context", "context_lens"],
      ["skill.wrong-context", undefined, "context", "context_lens"],
    ],
  );
});

test("impact focus may be empty and unknown focus remains an error", () => {
  const catalog = makeCatalog([asset("skill.root", "skill")], []);
  const report = resolveDeclaredImpact(catalog, "skill.root");

  assert.deepEqual(report.requiredDependents, []);
  assert.deepEqual(report.optionalDependents, []);
  assert.deepEqual(report.requiredSkills, []);
  assert.deepEqual(report.provenanceEdges, []);
  assert.throws(
    () => resolveDeclaredImpact(catalog, "missing.asset"),
    /Declared impact focus did not match any asset id or source path: missing\.asset/,
  );
});

test("reverse composition cycles terminate and retain actual cycle-forming declarations", () => {
  const report = resolveDeclaredImpact(
    makeCatalog(
      [
        asset("context.a", "context"),
        asset("context.b", "context"),
        asset("context.c", "context"),
        asset("skill.upstream", "skill"),
      ],
      [
        dependency("context.a", "context.b", "requires_context", 1),
        dependency("context.b", "context.c", "optional_context", 2),
        dependency("context.c", "context.a", "requires_context", 3),
        dependency("skill.upstream", "context.b", "requires_context", 4),
      ],
    ),
    "context.a",
  );

  assert.deepEqual(
    report.requiredDependents.map((dependent) => dependent.id),
    ["context.c"],
  );
  assert.deepEqual(
    report.optionalDependents.map((dependent) => dependent.id),
    ["context.b", "skill.upstream"],
  );
  assert.ok(
    report.provenanceEdges.some(
      (edge) => edge.from === "context.a" && edge.to === "context.b",
    ),
  );
  assert.ok(report.provenanceEdges.length <= 8);
});

test("reverse high-path-count DAG stores declaration edges instead of complete paths", () => {
  const assets = [asset("context.focus", "context")];
  const dependencies: Dependency[] = [];
  let downstream = ["context.focus"];
  let line = 1;
  for (let layer = 0; layer < 10; layer += 1) {
    const upstream = [`context.${layer}.a`, `context.${layer}.b`];
    assets.push(...upstream.map((id) => asset(id, "context")));
    for (const from of upstream) {
      for (const to of downstream) {
        dependencies.push(dependency(from, to, "requires_context", line++));
      }
    }
    downstream = upstream;
  }

  const report = resolveDeclaredImpact(
    makeCatalog(assets, dependencies),
    "context.focus",
  );

  assert.equal(report.requiredDependents.length, 20);
  assert.equal(report.provenanceEdges.length, dependencies.length);
  assert.ok(report.provenanceEdges.length < 50);
});

test("declared impact output is deterministic across catalog input order", () => {
  const assets = [
    asset("context.focus", "context"),
    asset("context.a", "context"),
    asset("context.b", "context"),
    asset("skill.root", "skill"),
  ];
  const dependencies = [
    dependency("context.b", "context.focus", "optional_context", 30),
    dependency("skill.root", "context.a", "requires_context", 10),
    dependency("context.a", "context.focus", "requires_context", 20),
    dependency("skill.root", "context.b", "requires_context", 40),
  ];

  const forward = resolveDeclaredImpact(
    makeCatalog(assets, dependencies),
    "context.focus",
  );
  const reversed = resolveDeclaredImpact(
    makeCatalog([...assets].reverse(), [...dependencies].reverse()),
    "context.focus",
  );

  assert.deepEqual(forward, reversed);
});

function makeCatalog(assets: Asset[], dependencies: Dependency[]): Catalog {
  return { entries: assets, assets, dependencies } as Catalog;
}

function asset(id: string, kind: AssetKind): Asset {
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
    },
    metadataFields: {},
    metadataListItems: {},
  };
}

function dependency(
  from: string,
  to: string,
  declaration: CompositionRelationship,
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

function rawDependency(
  from: string,
  to: string,
  kind: Dependency["kind"],
  line: number,
): Dependency {
  return {
    from,
    to,
    kind,
    sourcePath: `source/${from}.md`,
    evidence: {
      path: `source/${from}.md`,
      startLine: line,
      endLine: line,
      snippet: `${kind}: ${to}`,
    },
  };
}
