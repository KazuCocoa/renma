import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildCatalog } from "../src/catalog.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { parseDocument } from "../src/markdown.js";
import {
  parseAssetMetadata,
  parseCanonicalSkillContinuationField,
  parseCanonicalSkillPublicationField,
} from "../src/metadata.js";
import {
  focusSkillDiscoveryIndex,
  prepareSkillDiscoveryIndex,
} from "../src/skill-discovery.js";
import type { Artifact, ArtifactKind, ParsedDocument } from "../src/types.js";

test("Skill Discovery resolves exact IDs and repository-relative paths", () => {
  const documents = [
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: [
        "skill.target",
        "skills/other/SKILL.md",
        "./skills/third/SKILL.md",
        "skills\\fourth\\SKILL.md",
      ],
    }),
    skill("skills/target/SKILL.md", { id: "skill.target" }),
    skill("skills/other/SKILL.md", { id: "skill.other" }),
    skill("skills/third/SKILL.md", { id: "skill.third" }),
    skill("skills/fourth/SKILL.md", { id: "skill.fourth" }),
  ];

  const discovery = prepare(documents);

  assert.deepEqual(
    discovery.routes.map((route) => [
      route.declarationIndex,
      route.normalizedTarget,
      route.resolution,
      route.resolvedTarget?.id,
      route.usable,
    ]),
    [
      [0, "skill.target", "resolved", "skill.target", true],
      [1, "skills/other/SKILL.md", "resolved", "skill.other", true],
      [2, "skills/third/SKILL.md", "resolved", "skill.third", true],
      [3, "skills/fourth/SKILL.md", "resolved", "skill.fourth", true],
    ],
  );
  assert.deepEqual(discovery.structuralRootIds, ["skill.source"]);
  assert.equal(discovery.summary.usableRouteCount, 4);
});

test("Skill Discovery rejects absolute paths and repository escapes", () => {
  const discovery = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: [
        "/skills/target/SKILL.md",
        "C:\\skills\\target\\SKILL.md",
        "../skills/target/SKILL.md",
        "skills/../../target/SKILL.md",
      ],
    }),
    skill("skills/target/SKILL.md", { id: "skill.target" }),
  ]);

  assert.deepEqual(
    discovery.routes.map((route) => [
      route.resolution,
      route.normalizationRejection,
      route.usabilityReasons,
    ]),
    [
      ["unresolved", "absolute-path", ["unresolved-target"]],
      ["unresolved", "absolute-path", ["unresolved-target"]],
      ["unresolved", "repository-escape", ["unresolved-target"]],
      ["unresolved", "repository-escape", ["unresolved-target"]],
    ],
  );
  assert.equal(
    discovery.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
    ).length,
    4,
  );
});

test("Skill Discovery distinguishes unresolved IDs and unresolved paths", () => {
  const discovery = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skill.missing", "skills/missing/SKILL.md"],
    }),
  ]);

  assert.deepEqual(
    discovery.routes.map((route) => [route.normalizedTarget, route.resolution]),
    [
      ["skill.missing", "unresolved"],
      ["skills/missing/SKILL.md", "unresolved"],
    ],
  );
  assert.deepEqual(discovery.structuralRootIds, ["skill.source"]);
  assert.deepEqual(discovery.standaloneSkillIds, ["skill.source"]);
});

test("duplicate effective IDs make exact ID resolution ambiguous", () => {
  const discovery = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skill.duplicate"],
    }),
    skill("skills/alpha/SKILL.md", { id: "skill.duplicate" }),
    skill("skills/beta/SKILL.md", { id: "skill.duplicate" }),
  ]);
  const route = discovery.routes[0]!;

  assert.equal(route.resolution, "ambiguous");
  assert.deepEqual(
    route.candidates.map((candidate) => candidate.sourcePath),
    ["skills/alpha/SKILL.md", "skills/beta/SKILL.md"],
  );
  assert.deepEqual(route.usabilityReasons, ["ambiguous-target"]);
});

test("one spelling matching a different asset ID and path is ambiguous", () => {
  const discovery = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skills/target/SKILL.md"],
    }),
    skill("skills/id-owner/SKILL.md", {
      id: "skills/target/SKILL.md",
    }),
    skill("skills/target/SKILL.md", { id: "skill.path-owner" }),
  ]);
  const route = discovery.routes[0]!;

  assert.equal(route.resolution, "ambiguous");
  assert.deepEqual(
    route.candidates.map((candidate) => [candidate.id, candidate.sourcePath]),
    [
      ["skills/target/SKILL.md", "skills/id-owner/SKILL.md"],
      ["skill.path-owner", "skills/target/SKILL.md"],
    ],
  );
});

test("exact path resolution to a duplicate-ID Skill stays resolved but unusable", () => {
  const discovery = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skills/alpha/SKILL.md"],
    }),
    skill("skills/alpha/SKILL.md", { id: "skill.duplicate" }),
    skill("skills/beta/SKILL.md", { id: "skill.duplicate" }),
  ]);
  const route = discovery.routes[0]!;

  assert.equal(route.resolution, "resolved");
  assert.equal(route.resolvedTarget?.sourcePath, "skills/alpha/SKILL.md");
  assert.equal(route.resolvedTarget?.effectiveIdUnique, false);
  assert.equal(route.usable, false);
  assert.deepEqual(route.usabilityReasons, ["duplicate-target-id"]);
  assert.ok(
    route.linkedDiagnostics.some(
      (link) => link.code === DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID,
    ),
  );
});

test("resolved non-Skill targets are wrong-kind instead of missing", () => {
  const discovery = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["context.target"],
    }),
    context("contexts/target.md", "context.target"),
  ]);
  const route = discovery.routes[0]!;

  assert.equal(route.resolution, "wrong-kind");
  assert.equal(route.resolvedTarget?.kind, "context");
  assert.deepEqual(route.usabilityReasons, ["wrong-kind"]);
  assert.ok(
    discovery.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_TARGET_NOT_SKILL,
    ),
  );
});

test("invalid, deprecated, and archived Skill targets remain resolved and unusable", () => {
  const documents = [
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skills/invalid/SKILL.md", "skill.deprecated", "skill.archived"],
    }),
    rawDocument(
      "skills/invalid/SKILL.md",
      "skill",
      "---\nname: invalid\nmetadata:\n  renma.id: skill.invalid\n---\n# Invalid\n",
    ),
    skill("skills/deprecated/SKILL.md", {
      id: "skill.deprecated",
      status: "deprecated",
    }),
    skill("skills/archived/SKILL.md", {
      id: "skill.archived",
      status: "archived",
    }),
  ];
  const discovery = prepare(documents);

  assert.deepEqual(
    discovery.routes.map((route) => [
      route.resolution,
      route.resolvedTarget?.sourcePath,
      route.usabilityReasons,
    ]),
    [
      ["resolved", "skills/invalid/SKILL.md", ["invalid-target"]],
      ["resolved", "skills/deprecated/SKILL.md", ["inactive-target"]],
      ["resolved", "skills/archived/SKILL.md", ["inactive-target"]],
    ],
  );
  assert.equal(
    discovery.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_INACTIVE_ROUTE_TARGET,
    ).length,
    2,
  );
});

test("inactive source Skills retain declarations but cannot create usable routes", () => {
  const discovery = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      status: "archived",
      routes: ["skill.target"],
    }),
    skill("skills/target/SKILL.md", { id: "skill.target" }),
  ]);

  assert.equal(discovery.routes[0]?.resolution, "resolved");
  assert.deepEqual(discovery.routes[0]?.usabilityReasons, ["inactive-source"]);
  assert.deepEqual(discovery.structuralRootIds, ["skill.target"]);
  assert.equal(
    discovery.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_INACTIVE_ROUTE_TARGET,
    ),
    false,
  );
});

test("a duplicate-ID source retains declarations but cannot create a usable route", () => {
  const discovery = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skill.target"],
    }),
    skill("skills/source-copy/SKILL.md", { id: "skill.source" }),
    skill("skills/target/SKILL.md", { id: "skill.target" }),
  ]);
  const route = discovery.routes.find(
    (candidate) => candidate.sourcePath === "skills/source/SKILL.md",
  )!;

  assert.equal(route.resolution, "resolved");
  assert.deepEqual(route.usabilityReasons, ["duplicate-source-id"]);
  assert.equal(route.usable, false);
  assert.deepEqual(discovery.structuralRootIds, ["skill.target"]);
});

test("an invalid canonical source retains declaration evidence but fails closed", () => {
  const invalidSource = rawDocument(
    "skills/source/SKILL.md",
    "skill",
    [
      "---",
      "name: source",
      "description: Review source inputs. Use when source decisions need review.",
      "unexpected: value",
      "metadata:",
      "  renma.id: skill.source",
      `  renma.continues-with: '["skill.target"]'`,
      "---",
      "# Source",
      "",
    ].join("\n"),
  );
  const discovery = prepare([
    invalidSource,
    skill("skills/target/SKILL.md", { id: "skill.target" }),
  ]);
  const route = discovery.routes[0]!;

  assert.equal(route.sourceId, "skills/source/SKILL.md");
  assert.equal(route.resolution, "resolved");
  assert.deepEqual(route.usabilityReasons, ["invalid-source"]);
  assert.equal(route.evidence.startLine, 7);
  assert.ok(
    route.linkedDiagnostics.some(
      (link) => link.code === "AS-SKILL-UNEXPECTED-TOP-LEVEL-FIELD",
    ),
  );
});

test("canonical continuation parsing accepts only a JSON-array string of non-empty strings", () => {
  const cases = [
    ["not-json", "testing,review", /valid JSON/],
    ["not-array", `'{}'`, /JSON array/],
    ["non-string", `'["skill.target",1]'`, /member 1 must be a string/],
    ["empty", `'["skill.target","  "]'`, /non-empty after trimming/],
    ["yaml-array", "[skill.target]", /must be a string/],
    ["object", "{target: skill.target}", /must be a string/],
    ["number", "1", /must be a string/],
    ["boolean", "true", /must be a string/],
    ["null", "null", /must be a string/],
  ] as const;

  for (const [label, value, reason] of cases) {
    const document = skillWithRawContinuation(value);
    const parsed = parseCanonicalSkillContinuationField(document);
    const discovery = prepare([document]);
    assert.equal(parsed.state, "invalid", label);
    assert.match(parsed.reason ?? "", reason, label);
    assert.equal(discovery.routes.length, 0, label);
    assert.equal(
      discovery.diagnostics[0]?.code,
      DIAGNOSTIC_IDS.DISCOVERY_INVALID_CONTINUATION_DECLARATION,
      label,
    );
    assert.equal(discovery.diagnostics[0]?.evidence?.startLine, 6, label);
  }
});

test("a valid empty continuation array is operational and creates no routes", () => {
  const document = skillWithRawContinuation("'[]'");
  const parsed = parseCanonicalSkillContinuationField(document);
  const metadata = parseAssetMetadata(document);
  const discovery = prepare([document]);

  assert.equal(parsed.state, "valid");
  assert.deepEqual(parsed.items, []);
  assert.deepEqual(metadata.metadata.continuesWith, []);
  assert.equal(
    metadata.metadataFields.continues_with?.key,
    "renma.continues-with",
  );
  assert.deepEqual(metadata.metadataListItems.continues_with, []);
  assert.deepEqual(discovery.routes, []);
  assert.deepEqual(discovery.diagnostics, []);
});

test("declaration-index evidence is retained for every canonical route item", () => {
  const document = skill("skills/source/SKILL.md", {
    id: "skill.source",
    routes: [" skill.one ", "skill.two"],
  });
  const parsed = parseCanonicalSkillContinuationField(document);

  assert.equal(parsed.state, "valid");
  assert.deepEqual(
    parsed.items.map((item) => [
      item.declarationIndex,
      item.rawTarget,
      item.target,
      item.evidence.key,
      item.evidence.startLine,
    ]),
    [
      [0, " skill.one ", "skill.one", "renma.continues-with", 6],
      [1, "skill.two", "skill.two", "renma.continues-with", 6],
    ],
  );
});

test("continuation metadata retains one field record without synthetic item copies", () => {
  const routes = Array.from(
    { length: 12 },
    (_, index) => `skill.short-target-${index.toString().padStart(2, "0")}`,
  );
  const document = skill("skills/source/SKILL.md", {
    id: "skill.source",
    routes,
  });
  const built = buildCatalog([document]);
  const asset = built.catalog.assets[0]!;
  const discovery = prepareSkillDiscoveryIndex([document], built.catalog);
  const field = asset.metadataFields.continues_with!;

  assert.ok(field.raw.length > 256);
  assert.deepEqual(asset.metadata.continuesWith, routes);
  assert.deepEqual(asset.metadataListItems.continues_with, []);
  assert.equal(
    JSON.stringify(built.catalog).split(JSON.stringify(field.raw)).length - 1,
    2,
  );
  assert.equal(
    built.diagnostics.filter(
      (diagnostic) => diagnostic.details?.field === "continues_with",
    ).length,
    0,
  );
  assert.deepEqual(
    discovery.routes.map((route) => [
      route.declarationIndex,
      route.evidence.startLine,
      route.evidence.snippet,
    ]),
    routes.map((_, index) => [index, 6, field.raw]),
  );
});

test("duplicate normalized and duplicate resolved-target declarations retain all evidence", () => {
  const normalized = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["./skills/missing/SKILL.md", "skills\\missing\\SKILL.md"],
    }),
  ]);
  const resolved = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skill.target", "skills/target/SKILL.md"],
    }),
    skill("skills/target/SKILL.md", { id: "skill.target" }),
  ]);

  for (const discovery of [normalized, resolved]) {
    assert.deepEqual(
      discovery.routes.map((route) => [
        route.declarationIndex,
        route.representative,
        route.duplicateDeclarationIndices,
      ]),
      [
        [0, true, [0, 1]],
        [1, false, [0, 1]],
      ],
    );
    const duplicate = discovery.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_DUPLICATE_DECLARED_ROUTE,
    );
    assert.deepEqual(duplicate?.details?.declarationIndices, [0, 1]);
    assert.equal(
      (duplicate?.details?.declarations as unknown[] | undefined)?.length,
      2,
    );
  }
  assert.equal(resolved.summary.usableRouteCount, 1);
});

test("duplicate detection does not broaden to ambiguous or wrong-kind routes", () => {
  const wrongKind = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["context.target", "context.target"],
    }),
    context("contexts/target.md", "context.target"),
  ]);
  const ambiguous = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skill.duplicate", "skill.duplicate"],
    }),
    skill("skills/alpha/SKILL.md", { id: "skill.duplicate" }),
    skill("skills/beta/SKILL.md", { id: "skill.duplicate" }),
  ]);

  for (const discovery of [wrongKind, ambiguous]) {
    assert.equal(
      discovery.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_DUPLICATE_DECLARED_ROUTE,
      ),
      false,
    );
    assert.ok(discovery.routes.every((route) => route.representative));
  }
});

test("structural roots and standalone Skills use only usable routes", () => {
  const discovery = prepare([
    skill("skills/root/SKILL.md", {
      id: "skill.root",
      routes: ["skill.child", "skill.missing"],
    }),
    skill("skills/child/SKILL.md", { id: "skill.child" }),
    skill("skills/standalone/SKILL.md", { id: "skill.standalone" }),
  ]);

  assert.deepEqual(discovery.structuralRootIds, [
    "skill.root",
    "skill.standalone",
  ]);
  assert.deepEqual(discovery.standaloneSkillIds, ["skill.standalone"]);
});

test("route output ordering is independent of file discovery order", () => {
  const documents = [
    skill("skills/zeta/SKILL.md", {
      id: "skill.zeta",
      routes: ["skill.target"],
    }),
    skill("skills/alpha/SKILL.md", {
      id: "skill.alpha",
      routes: ["skill.target"],
    }),
    skill("skills/target/SKILL.md", { id: "skill.target" }),
  ];

  assert.deepEqual(prepare(documents), prepare([...documents].reverse()));
});

test("Markdown links, aliases, and noncanonical Skill files create no routes", () => {
  const canonical = skill("skills/source/SKILL.md", {
    id: "skill.source",
    body: "Continue with [target](../target/SKILL.md).",
    extraMetadata: [
      `  renma.routes-to: '["skill.target"]'`,
      `  renma.hands-off-to: '["skill.target"]'`,
      `  renma.delegates-to: '["skill.target"]'`,
    ],
  });
  const noncanonical = rawDocument(
    "skills/lower/skill.md",
    "skill",
    canonical.artifact.content.replace("name: source", "name: lower"),
  );
  const flat = rawDocument(
    "skills/flat.skill.md",
    "skill",
    canonical.artifact.content.replace("name: source", "name: flat"),
  );
  const target = skill("skills/target/SKILL.md", { id: "skill.target" });

  const canonicalDiscovery = prepare([canonical, target]);
  const noncanonicalDiscovery = prepare([noncanonical, target]);
  const flatDiscovery = prepare([flat, target]);
  assert.deepEqual(canonicalDiscovery.routes, []);
  assert.deepEqual(noncanonicalDiscovery.routes, []);
  assert.deepEqual(flatDiscovery.routes, []);
});

test("continuations never enter catalog dependencies", () => {
  const documents = [
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skill.target"],
    }),
    skill("skills/target/SKILL.md", { id: "skill.target" }),
  ];
  const catalog = buildCatalog(documents).catalog;

  assert.deepEqual(catalog.dependencies, []);
  assert.deepEqual(catalog.assets[0]?.metadata.continuesWith, ["skill.target"]);
});

test("non-Skill metadata cannot become an operational Skill continuation", () => {
  const document = rawDocument(
    "contexts/source.md",
    "context",
    [
      "---",
      "id: context.source",
      `continues_with: '["skill.target"]'`,
      "---",
      "# Context",
      "",
    ].join("\n"),
  );
  const catalog = buildCatalog([document]).catalog;

  assert.equal(catalog.assets[0]?.metadata.continuesWith, undefined);
  assert.deepEqual(prepareSkillDiscoveryIndex([document], catalog).routes, []);
});

test("canonical publication parsing accepts only the exact YAML string true", () => {
  const cases = [
    ['"true"', "valid"],
    ["true", "invalid"],
    ['"false"', "invalid"],
    ["false", "invalid"],
    ['""', "invalid"],
    ['"TRUE"', "invalid"],
    ['" true "', "invalid"],
    ["1", "invalid"],
    ["[]", "invalid"],
    ["{}", "invalid"],
    ["null", "invalid"],
  ] as const;

  for (const [value, state] of cases) {
    const parsed = parseCanonicalSkillPublicationField(
      skillWithRawPublication(value),
    );
    assert.equal(parsed.state, state, value);
    assert.equal(parsed.fieldEvidence?.key, "renma.published-entrypoint");
    assert.match(parsed.fieldEvidence?.raw ?? "", /published-entrypoint/);
  }
});

test("publication parsing fails closed on duplicate declarations and ignores aliases", () => {
  const duplicateMarker = rawDocument(
    "skills/source/SKILL.md",
    "skill",
    [
      "---",
      "name: source",
      "description: Review source inputs. Use when source review is needed; do not use for execution.",
      "metadata:",
      "  renma.id: skill.source",
      '  renma.published-entrypoint: "true"',
      '  renma.published-entrypoint: "true"',
      "---",
      "# Source",
    ].join("\n"),
  );
  const duplicateMetadata = rawDocument(
    "skills/source/SKILL.md",
    "skill",
    [
      "---",
      "name: source",
      "description: Review source inputs. Use when source review is needed; do not use for execution.",
      "metadata:",
      "  renma.id: skill.source",
      "metadata:",
      '  renma.published-entrypoint: "true"',
      "---",
      "# Source",
    ].join("\n"),
  );
  const aliases = skill("skills/source/SKILL.md", {
    id: "skill.source",
    extraMetadata: [
      '  published_entrypoint: "true"',
      '  discovery_entrypoint: "true"',
      '  entrypoint: "true"',
      '  renma.entrypoint: "true"',
    ],
  });
  const noncanonical = rawDocument(
    "skills/source/skill.md",
    "skill",
    skillWithRawPublication('"true"').artifact.content,
  );

  assert.equal(
    parseCanonicalSkillPublicationField(duplicateMarker).state,
    "ambiguous",
  );
  const duplicateMapping =
    parseCanonicalSkillPublicationField(duplicateMetadata);
  assert.equal(duplicateMapping.state, "ambiguous");
  assert.equal(duplicateMapping.fieldEvidence?.startLine, 7);
  assert.equal(parseCanonicalSkillPublicationField(aliases).state, "absent");
  assert.equal(
    parseCanonicalSkillPublicationField(noncanonical).state,
    "unsupported",
  );
  const ambiguousDiagnostic = prepare([duplicateMarker]).diagnostics.find(
    (item) =>
      item.code === DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT,
  );
  assert.equal(ambiguousDiagnostic?.details?.markerState, "ambiguous");
  assert.ok(
    ambiguousDiagnostic?.repairConstraints?.some(
      (constraint) => constraint.kind === "requires_human_decision",
    ),
  );
});

test("explicit publication is independent from structural roots and incoming routes", () => {
  const discovery = prepare([
    skill("skills/root/SKILL.md", {
      id: "skill.root",
      routes: ["skill.target"],
    }),
    skill("skills/target/SKILL.md", {
      id: "skill.target",
      published: true,
    }),
    skill("skills/solo/SKILL.md", {
      id: "skill.solo",
      published: true,
    }),
  ]);
  const byId = new Map(discovery.skills.map((item) => [item.id, item]));

  assert.equal(byId.get("skill.root")?.structuralRoot, true);
  assert.equal(byId.get("skill.root")?.publication.accepted, false);
  assert.equal(byId.get("skill.target")?.structuralRoot, false);
  assert.equal(byId.get("skill.target")?.publication.accepted, true);
  assert.equal(byId.get("skill.solo")?.standalone, true);
  assert.equal(byId.get("skill.solo")?.publication.accepted, true);
  assert.deepEqual(discovery.publishedEntrypointIds, [
    "skill.solo",
    "skill.target",
  ]);
  assert.equal(discovery.adoption.state, "partial");
});

test("publication rejection preserves invalid, inactive, and duplicate identity evidence", () => {
  const invalid = rawDocument(
    "skills/invalid/SKILL.md",
    "skill",
    [
      "---",
      "name: invalid",
      "metadata:",
      "  renma.id: skill.invalid",
      '  renma.published-entrypoint: "true"',
      "---",
      "# Invalid",
    ].join("\n"),
  );
  const discovery = prepare([
    invalid,
    skill("skills/deprecated/SKILL.md", {
      id: "skill.deprecated",
      status: "deprecated",
      published: true,
    }),
    skill("skills/archived/SKILL.md", {
      id: "skill.archived",
      status: "archived",
      published: true,
    }),
    skill("skills/alpha/SKILL.md", {
      id: "skill.duplicate",
      published: true,
    }),
    skill("skills/beta/SKILL.md", {
      id: "skill.duplicate",
      published: true,
    }),
  ]);
  const byPath = new Map(
    discovery.skills.map((item) => [item.sourcePath, item]),
  );

  assert.deepEqual(
    byPath.get("skills/invalid/SKILL.md")?.publication.rejectionReasons,
    ["invalid-skill"],
  );
  assert.ok(
    byPath
      .get("skills/invalid/SKILL.md")
      ?.publication.linkedDiagnostics.some((item) =>
        item.code.startsWith("AS-SKILL-"),
      ),
  );
  assert.deepEqual(
    byPath.get("skills/deprecated/SKILL.md")?.publication.rejectionReasons,
    ["inactive-skill"],
  );
  assert.deepEqual(
    byPath.get("skills/alpha/SKILL.md")?.publication.rejectionReasons,
    ["duplicate-skill-id"],
  );
  assert.ok(
    byPath
      .get("skills/alpha/SKILL.md")
      ?.publication.linkedDiagnostics.some(
        (item) => item.code === DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID,
      ),
  );
  assert.deepEqual(discovery.publishedEntrypointIds, []);
  assert.equal(
    discovery.diagnostics.filter(
      (item) =>
        item.code === DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT,
    ).length,
    2,
  );
});

test("invalid publication markers and deterministic boundary gaps emit publication warnings", () => {
  const invalidMarker = skillWithRawPublication("true");
  const weakBoundary = rawDocument(
    "skills/weak/SKILL.md",
    "skill",
    [
      "---",
      "name: weak",
      "description: Use this skill when needed.",
      "metadata:",
      "  renma.id: skill.weak",
      '  renma.published-entrypoint: "true"',
      "---",
      "# Weak",
      "",
      "Review evidence and report completion.",
    ].join("\n"),
  );
  const discovery = prepare([invalidMarker, weakBoundary]);
  const invalidDiagnostic = discovery.diagnostics.find(
    (item) =>
      item.code === DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT,
  );
  const boundaryDiagnostic = discovery.diagnostics.find(
    (item) =>
      item.code ===
      DIAGNOSTIC_IDS.DISCOVERY_ENTRYPOINT_WITHOUT_USABLE_BOUNDARIES,
  );

  assert.equal(invalidDiagnostic?.details?.markerState, "invalid");
  assert.equal(invalidDiagnostic?.details?.rawMarkerValue, true);
  assert.match(invalidDiagnostic?.evidence?.snippet ?? "", /true/);
  const invalidVerification = JSON.stringify(
    invalidDiagnostic?.verificationSteps,
  );
  assert.match(invalidVerification, /publication\.accepted/);
  assert.match(invalidVerification, /publishedEntrypointIds/);
  assert.match(
    invalidVerification,
    /Agent Skills, lifecycle, and duplicate-ID/,
  );
  assert.doesNotMatch(
    invalidVerification,
    /route resolution|route usability|relationship evidence/i,
  );
  assert.equal(
    discovery.skills.find(
      (item) => item.sourcePath === "skills/source/SKILL.md",
    )?.publication.requested,
    false,
  );
  assert.ok(boundaryDiagnostic);
  assert.deepEqual(boundaryDiagnostic.details?.missingBoundaries, [
    "capability",
  ]);
  assert.equal(boundaryDiagnostic.evidence?.startLine, 3);
  assert.notEqual(
    boundaryDiagnostic.evidence?.startLine,
    boundaryDiagnostic.details?.publicationMarkerEvidence &&
      (
        boundaryDiagnostic.details.publicationMarkerEvidence as {
          startLine: number;
        }
      ).startLine,
  );
  assert.deepEqual(boundaryDiagnostic.details?.publicationMarkerEvidence, {
    path: "skills/weak/SKILL.md",
    startLine: 6,
    endLine: 6,
    snippet: '  renma.published-entrypoint: "true"',
  });
  assert.ok(
    (
      boundaryDiagnostic.details?.linkedDiagnostics as Array<{ code: string }>
    ).some((item) => item.code === "RN-SKILL-DESCRIPTION-MISSING-CAPABILITY"),
  );
  const boundaryVerification = JSON.stringify(
    boundaryDiagnostic.verificationSteps,
  );
  assert.match(boundaryVerification, /Preserve the valid publication marker/);
  assert.match(boundaryVerification, /canonical Agent Skills description/);
  assert.match(boundaryVerification, /effective published entrypoint/);
  assert.match(boundaryVerification, /originating RN-SKILL-\*/);
  assert.match(boundaryVerification, /publication was not removed merely/);
  assert.doesNotMatch(
    boundaryVerification,
    /route resolution|route usability/i,
  );
  assert.equal(
    boundaryDiagnostic.repairConstraints?.some(
      (constraint) =>
        constraint.kind === "allowed_change" &&
        /remove publication|omit.*marker/i.test(constraint.text),
    ),
    false,
  );
  assert.equal(
    discovery.skills.find((item) => item.id === "skill.weak")?.publication
      .accepted,
    true,
  );
});

test("published boundary diagnostics preserve deterministic RN evidence order and marker traceability", () => {
  const cases = [
    {
      name: "capability",
      description: "Use this skill when source evidence is available.",
      body: "Review the source evidence.",
      expectedBoundary: "capability",
      expectedCode: "RN-SKILL-DESCRIPTION-MISSING-CAPABILITY",
      expectedLine: 3,
    },
    {
      name: "usage",
      description: "Review source evidence.",
      body: "Review the source evidence.",
      expectedBoundary: "positive usage boundary",
      expectedCode: "RN-SKILL-DESCRIPTION-MISSING-USAGE-BOUNDARY",
      expectedLine: 3,
    },
    {
      name: "selection",
      description:
        "Review source evidence. Use when source evidence needs review.",
      body: [
        "## Do not use this skill when",
        "",
        "- Do not use this skill for runtime execution.",
      ].join("\n"),
      expectedBoundary: "negative selection/routing boundary",
      expectedCode: "RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY",
      expectedLine: 12,
    },
  ] as const;

  for (const item of cases) {
    const discovery = prepare([
      publishedSkillWithDescription(
        `skills/${item.name}/SKILL.md`,
        `skill.${item.name}`,
        item.description,
        item.body,
      ),
    ]);
    const diagnostic = discovery.diagnostics.find(
      (candidate) =>
        candidate.code ===
        DIAGNOSTIC_IDS.DISCOVERY_ENTRYPOINT_WITHOUT_USABLE_BOUNDARIES,
    );
    const linked = diagnostic?.details?.linkedDiagnostics as
      | Array<{ code: string; evidence?: { startLine: number } }>
      | undefined;

    assert.ok(diagnostic, item.name);
    assert.deepEqual(
      diagnostic.details?.missingBoundaries,
      [item.expectedBoundary],
      item.name,
    );
    assert.deepEqual(
      linked?.map((candidate) => candidate.code),
      [item.expectedCode],
      item.name,
    );
    assert.equal(diagnostic.evidence?.startLine, item.expectedLine, item.name);
    assert.equal(
      diagnostic.evidence?.startLine,
      linked?.[0]?.evidence?.startLine,
      item.name,
    );
    assert.equal(
      (
        diagnostic.details?.publicationMarkerEvidence as {
          startLine: number;
        }
      ).startLine,
      6,
      item.name,
    );
  }

  const combined = prepare([
    publishedSkillWithDescription(
      "skills/combined/SKILL.md",
      "skill.combined",
      "Use this skill.",
      [
        "## Do not use this skill when",
        "",
        "- Do not use this skill for runtime execution.",
      ].join("\n"),
    ),
  ]).diagnostics.find(
    (candidate) =>
      candidate.code ===
      DIAGNOSTIC_IDS.DISCOVERY_ENTRYPOINT_WITHOUT_USABLE_BOUNDARIES,
  );

  assert.deepEqual(combined?.details?.missingBoundaries, [
    "capability",
    "positive usage boundary",
    "negative selection/routing boundary",
  ]);
  assert.deepEqual(
    (combined?.details?.linkedDiagnostics as Array<{ code: string }>).map(
      (candidate) => candidate.code,
    ),
    [
      "RN-SKILL-DESCRIPTION-MISSING-CAPABILITY",
      "RN-SKILL-DESCRIPTION-MISSING-USAGE-BOUNDARY",
      "RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY",
    ],
  );
  assert.equal(combined?.evidence?.startLine, 3);
});

test("route diagnostics retain route-specific verification wording", () => {
  const diagnostic = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: ["skill.missing"],
    }),
  ]).diagnostics.find(
    (candidate) =>
      candidate.code === DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
  );
  const verification = JSON.stringify(diagnostic?.verificationSteps);

  assert.match(verification, /declaration resolves/);
  assert.match(verification, /usability state/);
  assert.match(verification, /repaired relationship evidence/);
});

test("Discovery derives not-evaluated, descriptive, and authoritative coverage modes", () => {
  const none = prepare([]);
  const continuation = prepare([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      routes: [],
    }),
  ]);
  const publication = prepare([
    skill("skills/published/SKILL.md", {
      id: "skill.published",
      published: true,
    }),
  ]);
  const incomplete = prepare([], { repositoryWideAdopted: true });
  const adopted = prepare(
    [
      skill("skills/published/SKILL.md", {
        id: "skill.published",
        published: true,
      }),
    ],
    { repositoryWideAdopted: true, configPath: "renma.config.json" },
  );

  assert.equal(none.adoption.state, "not-adopted");
  assert.equal(continuation.adoption.state, "partial");
  assert.equal(publication.adoption.state, "partial");
  assert.equal(incomplete.adoption.state, "incomplete");
  assert.equal(adopted.adoption.state, "adopted");
  assert.equal(adopted.adoption.configPath, "renma.config.json");
  assert.deepEqual(none.coverage, {
    scope: "repository",
    mode: "not-evaluated",
    reason: "discovery-not-adopted",
    sourceEntrypointIds: [],
    eligibleSkillCount: 0,
    reachableSkillCount: 0,
    notReachedSkillCount: 0,
    complete: null,
  });
  assert.equal(continuation.coverage.mode, "not-evaluated");
  assert.equal(
    continuation.coverage.reason,
    "no-effective-published-entrypoint",
  );
  assert.equal(publication.coverage.mode, "descriptive");
  assert.equal(publication.coverage.complete, null);
  assert.deepEqual(publication.reachableDiscoveryEligibleSkillIds, [
    "skill.published",
  ]);
  assert.equal(incomplete.coverage.mode, "not-evaluated");
  assert.equal(incomplete.coverage.reason, "no-effective-published-entrypoint");
  assert.deepEqual(adopted.coverage, {
    scope: "repository",
    mode: "authoritative",
    reason: "repository-wide-discovery-adopted",
    sourceEntrypointIds: ["skill.published"],
    eligibleSkillCount: 1,
    reachableSkillCount: 1,
    notReachedSkillCount: 0,
    complete: true,
  });
});

test("reachability records every source entrypoint and true minimum depth deterministically", () => {
  const documents = [
    skill("skills/alpha/SKILL.md", {
      id: "skill.alpha",
      published: true,
      routes: ["skill.long-one", "skill.shared"],
    }),
    skill("skills/beta/SKILL.md", {
      id: "skill.beta",
      published: true,
      routes: ["skill.shared"],
    }),
    skill("skills/long-one/SKILL.md", {
      id: "skill.long-one",
      routes: ["skill.long-two"],
    }),
    skill("skills/long-two/SKILL.md", {
      id: "skill.long-two",
      routes: ["skill.shared"],
    }),
    skill("skills/shared/SKILL.md", {
      id: "skill.shared",
      routes: ["skill.leaf"],
    }),
    skill("skills/leaf/SKILL.md", { id: "skill.leaf" }),
    skill("skills/unreached/SKILL.md", { id: "skill.unreached" }),
  ];
  const first = prepare(documents);
  const second = prepare([...documents].reverse());
  const byId = new Map(first.skills.map((item) => [item.id, item]));

  assert.deepEqual(first, second);
  assert.deepEqual(byId.get("skill.alpha")?.reachability, {
    state: "reachable",
    reason: "published-entrypoint",
    sourceEntrypointIds: ["skill.alpha"],
    minimumDepth: 0,
  });
  assert.deepEqual(byId.get("skill.shared")?.reachability, {
    state: "reachable",
    reason: "reachable-through-usable-route",
    sourceEntrypointIds: ["skill.alpha", "skill.beta"],
    minimumDepth: 1,
  });
  assert.equal(byId.get("skill.leaf")?.reachability.minimumDepth, 2);
  assert.deepEqual(byId.get("skill.unreached")?.reachability, {
    state: "not-reached",
    reason: "no-usable-path-from-published-entrypoint",
    sourceEntrypointIds: [],
  });
  assert.deepEqual(first.reachableDiscoveryEligibleSkillIds, [
    "skill.alpha",
    "skill.beta",
    "skill.leaf",
    "skill.long-one",
    "skill.long-two",
    "skill.shared",
  ]);
  assert.deepEqual(first.notReachedDiscoveryEligibleSkillIds, [
    "skill.unreached",
  ]);
});

test("reachability output is independent of route declaration order", () => {
  const prepareOrder = (routes: string[]) =>
    prepare([
      skill("skills/root/SKILL.md", {
        id: "skill.root",
        published: true,
        routes,
      }),
      skill("skills/long/SKILL.md", {
        id: "skill.long",
        routes: ["skill.target"],
      }),
      skill("skills/target/SKILL.md", { id: "skill.target" }),
    ]);
  const first = prepareOrder(["skill.long", "skill.target"]);
  const second = prepareOrder(["skill.target", "skill.long"]);
  const reachabilityProjection = (discovery: ReturnType<typeof prepare>) => ({
    coverage: discovery.coverage,
    reachableDiscoveryEligibleSkillIds:
      discovery.reachableDiscoveryEligibleSkillIds,
    notReachedDiscoveryEligibleSkillIds:
      discovery.notReachedDiscoveryEligibleSkillIds,
    skills: discovery.skills.map((item) => [item.id, item.reachability]),
  });

  assert.deepEqual(
    reachabilityProjection(first),
    reachabilityProjection(second),
  );
  assert.equal(
    first.skills.find((item) => item.id === "skill.target")?.reachability
      .minimumDepth,
    1,
  );
});

test("reachability terminates through self-loops and connected or disconnected cycles", () => {
  const discovery = prepare([
    skill("skills/root/SKILL.md", {
      id: "skill.root",
      published: true,
      routes: ["skill.root", "skill.alpha"],
    }),
    skill("skills/alpha/SKILL.md", {
      id: "skill.alpha",
      routes: ["skill.beta"],
    }),
    skill("skills/beta/SKILL.md", {
      id: "skill.beta",
      routes: ["skill.gamma"],
    }),
    skill("skills/gamma/SKILL.md", {
      id: "skill.gamma",
      routes: ["skill.alpha"],
    }),
    skill("skills/delta/SKILL.md", {
      id: "skill.delta",
      routes: ["skill.epsilon"],
    }),
    skill("skills/epsilon/SKILL.md", {
      id: "skill.epsilon",
      routes: ["skill.delta"],
    }),
  ]);
  const byId = new Map(discovery.skills.map((item) => [item.id, item]));

  assert.equal(byId.get("skill.root")?.reachability.minimumDepth, 0);
  assert.equal(byId.get("skill.alpha")?.reachability.minimumDepth, 1);
  assert.equal(byId.get("skill.beta")?.reachability.minimumDepth, 2);
  assert.equal(byId.get("skill.gamma")?.reachability.minimumDepth, 3);
  assert.equal(byId.get("skill.delta")?.reachability.state, "not-reached");
  assert.equal(byId.get("skill.epsilon")?.reachability.state, "not-reached");
  assert.equal(
    discovery.diagnostics.some((item) => item.code === "DISCOVERY-ROUTE-CYCLE"),
    false,
  );
});

test("reachability traverses only usable representative resolved Skill routes", () => {
  const discovery = prepare([
    skill("skills/root/SKILL.md", {
      id: "skill.root",
      published: true,
      routes: [
        "skill.valid",
        "skill.valid",
        "skill.missing",
        "context.target",
        "skill.inactive",
        "skills/duplicate/SKILL.md",
      ],
    }),
    skill("skills/valid/SKILL.md", { id: "skill.valid" }),
    skill("skills/inactive/SKILL.md", {
      id: "skill.inactive",
      status: "archived",
    }),
    skill("skills/duplicate/SKILL.md", { id: "skill.duplicate" }),
    skill("skills/duplicate-copy/SKILL.md", { id: "skill.duplicate" }),
    context("contexts/target.md", "context.target"),
  ]);
  const byPath = new Map(
    discovery.skills.map((item) => [item.sourcePath, item]),
  );

  assert.deepEqual(discovery.reachableDiscoveryEligibleSkillIds, [
    "skill.root",
    "skill.valid",
  ]);
  assert.deepEqual(discovery.notReachedDiscoveryEligibleSkillIds, []);
  assert.equal(
    byPath.get("skills/inactive/SKILL.md")?.reachability.reason,
    "skill-not-discovery-eligible",
  );
  assert.equal(
    byPath.get("skills/duplicate/SKILL.md")?.reachability.reason,
    "skill-not-discovery-eligible",
  );
});

test("unrouted is structural roots minus effective published entrypoints", () => {
  const discovery = prepare([
    skill("skills/published/SKILL.md", {
      id: "skill.published",
      published: true,
      routes: ["skill.child"],
    }),
    skill("skills/child/SKILL.md", { id: "skill.child" }),
    skill("skills/disconnected-root/SKILL.md", {
      id: "skill.disconnected-root",
      routes: ["skill.disconnected-child"],
    }),
    skill("skills/disconnected-child/SKILL.md", {
      id: "skill.disconnected-child",
    }),
    skill("skills/standalone/SKILL.md", { id: "skill.standalone" }),
  ]);
  const byId = new Map(discovery.skills.map((item) => [item.id, item]));

  assert.deepEqual(discovery.unroutedSkillIds, [
    "skill.disconnected-root",
    "skill.standalone",
  ]);
  assert.equal(byId.get("skill.published")?.unrouted, false);
  assert.equal(byId.get("skill.disconnected-root")?.unrouted, true);
  assert.equal(byId.get("skill.standalone")?.unrouted, true);
  assert.equal(byId.get("skill.disconnected-child")?.unrouted, false);
  assert.equal(
    byId.get("skill.disconnected-child")?.reachability.state,
    "not-reached",
  );
});

test("authoritative coverage emits exact unreachable diagnostics and descriptive coverage does not", () => {
  const documents = [
    skill("skills/published/SKILL.md", {
      id: "skill.published",
      published: true,
    }),
    skill("skills/unreached/SKILL.md", { id: "skill.unreached" }),
  ];
  const descriptive = prepare(documents);
  const authoritative = prepare(documents, {
    repositoryWideAdopted: true,
    configPath: "renma.config.json",
  });
  const diagnostic = authoritative.diagnostics.find(
    (item) => item.code === DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
  );

  assert.equal(
    descriptive.diagnostics.some(
      (item) =>
        item.code === DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
    ),
    false,
  );
  assert.equal(diagnostic?.severity, "warning");
  assert.equal(diagnostic?.evidence?.path, "skills/unreached/SKILL.md");
  assert.match(
    diagnostic?.message ?? "",
    /No usable declared continuation path reaches this eligible Skill from any effective published entrypoint/,
  );
  assert.deepEqual(diagnostic?.details, {
    sourceId: "skill.unreached",
    sourcePath: "skills/unreached/SKILL.md",
    coverageMode: "authoritative",
    adoptionState: "adopted",
    publishedEntrypointIds: ["skill.published"],
    structuralRoot: true,
    standalone: true,
    unrouted: true,
    configPath: "renma.config.json",
  });
  assert.deepEqual(
    diagnostic?.repairConstraints?.map((item) => item.kind),
    [
      "must_preserve",
      "must_not_change",
      "allowed_change",
      "requires_human_decision",
    ],
  );
  assert.match(
    JSON.stringify(diagnostic?.repairConstraints),
    /fake continuation/,
  );
  assert.match(
    JSON.stringify(diagnostic?.repairConstraints),
    /publish every Skill/,
  );
  assert.deepEqual(
    diagnostic?.verificationSteps?.map((item) => item.command),
    [
      "renma graph . --view discovery --format json",
      "renma scan . --format json",
    ],
  );
});

test("exact focus keeps direct incoming and outgoing declared routes", () => {
  const discovery = prepare([
    skill("skills/root/SKILL.md", {
      id: "skill.root",
      routes: ["skill.middle"],
    }),
    skill("skills/middle/SKILL.md", {
      id: "skill.middle",
      routes: ["skill.leaf", "skill.missing"],
    }),
    skill("skills/leaf/SKILL.md", { id: "skill.leaf" }),
    skill("skills/unrelated/SKILL.md", { id: "skill.unrelated" }),
  ]);
  const focused = focusSkillDiscoveryIndex(
    discovery,
    "./skills/middle/SKILL.md",
  );

  assert.deepEqual(
    focused.skills.map((item) => item.id),
    ["skill.leaf", "skill.middle", "skill.root"],
  );
  assert.deepEqual(
    focused.routes.map((route) => [route.sourceId, route.normalizedTarget]),
    [
      ["skill.middle", "skill.leaf"],
      ["skill.middle", "skill.missing"],
      ["skill.root", "skill.middle"],
    ],
  );
  assert.deepEqual(focused.focus, {
    id: "skill.middle",
    sourcePath: "skills/middle/SKILL.md",
  });
  assert.equal(focused.coverage, discovery.coverage);
  assert.deepEqual(focused.reachableDiscoveryEligibleSkillIds, []);
  assert.deepEqual(focused.notReachedDiscoveryEligibleSkillIds, []);
  assert.deepEqual(focused.unroutedSkillIds, ["skill.root"]);
  assert.throws(
    () => focusSkillDiscoveryIndex(discovery, "skill.unknown"),
    /did not match any Skill id or source path/,
  );
});

function prepare(
  documents: ParsedDocument[],
  options: {
    repositoryWideAdopted?: boolean;
    configPath?: string;
  } = {},
) {
  return prepareSkillDiscoveryIndex(
    documents,
    buildCatalog(documents).catalog,
    undefined,
    options,
  );
}

function skill(
  sourcePath: string,
  options: {
    id: string;
    routes?: string[];
    status?: "experimental" | "stable" | "deprecated" | "archived";
    body?: string;
    extraMetadata?: string[];
    published?: boolean;
  },
): ParsedDocument {
  const name = path.posix.basename(path.posix.dirname(sourcePath));
  const metadata = [
    `  renma.id: ${JSON.stringify(options.id)}`,
    ...(options.status
      ? [`  renma.status: ${JSON.stringify(options.status)}`]
      : []),
    ...(options.routes
      ? [`  renma.continues-with: '${JSON.stringify(options.routes)}'`]
      : []),
    ...(options.published ? ['  renma.published-entrypoint: "true"'] : []),
    ...(options.extraMetadata ?? []),
  ];
  return rawDocument(
    sourcePath,
    "skill",
    [
      "---",
      `name: ${name}`,
      `description: Review ${name} inputs and produce deterministic evidence. Use when ${name} workflow decisions need review; do not use for runtime selection or execution.`,
      "metadata:",
      ...metadata,
      "---",
      `# ${name}`,
      "",
      options.body ?? "Review the declared evidence and report completion.",
      "",
    ].join("\n"),
  );
}

function skillWithRawPublication(value: string): ParsedDocument {
  return rawDocument(
    "skills/source/SKILL.md",
    "skill",
    [
      "---",
      "name: source",
      "description: Review source inputs and produce deterministic evidence. Use when source workflow decisions need review; do not use for runtime selection or execution.",
      "metadata:",
      "  renma.id: skill.source",
      `  renma.published-entrypoint: ${value}`,
      "---",
      "# Source",
      "",
    ].join("\n"),
  );
}

function publishedSkillWithDescription(
  sourcePath: string,
  id: string,
  description: string,
  body: string,
): ParsedDocument {
  const name = path.posix.basename(path.posix.dirname(sourcePath));
  return rawDocument(
    sourcePath,
    "skill",
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "metadata:",
      `  renma.id: ${id}`,
      '  renma.published-entrypoint: "true"',
      "---",
      `# ${name}`,
      "",
      body,
      "",
    ].join("\n"),
  );
}

function skillWithRawContinuation(value: string): ParsedDocument {
  return rawDocument(
    "skills/source/SKILL.md",
    "skill",
    [
      "---",
      "name: source",
      "description: Review source inputs and produce deterministic evidence. Use when source workflow decisions need review.",
      "metadata:",
      "  renma.id: skill.source",
      `  renma.continues-with: ${value}`,
      "---",
      "# Source",
      "",
    ].join("\n"),
  );
}

function context(sourcePath: string, id: string): ParsedDocument {
  return rawDocument(
    sourcePath,
    "context",
    [
      "---",
      `id: ${id}`,
      "owner: platform",
      "status: stable",
      "when_to_use: Skill Discovery tests",
      "when_not_to_use: Runtime selection",
      "---",
      "# Context",
      "",
    ].join("\n"),
  );
}

function rawDocument(
  sourcePath: string,
  kind: ArtifactKind,
  content: string,
): ParsedDocument {
  const artifact: Artifact = {
    path: sourcePath,
    absolutePath: `/repo/${sourcePath}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
  return parseDocument(artifact);
}
