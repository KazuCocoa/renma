import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildCatalog } from "../src/catalog.js";
import { zeroContextLensSummary } from "../src/context-lens.js";
import { resolveDeclaredComposition } from "../src/declared-composition.js";
import { bom, formatBomMarkdown } from "../src/commands/bom.js";
import { formatCatalogMarkdown } from "../src/commands/catalog.js";
import { buildInspectOutline } from "../src/commands/inspect.js";
import { readiness } from "../src/commands/readiness.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import {
  isDeclaredActiveLifecycleStatus,
  isInactiveLifecycleStatus,
  isLifecycleUsable,
} from "../src/lifecycle.js";
import { parseDocument } from "../src/markdown.js";
import { parseAssetMetadata } from "../src/metadata.js";
import { scan } from "../src/scanner.js";
import { prepareSkillDiscoveryIndex } from "../src/skill-discovery.js";
import type { Artifact, ArtifactKind, ParsedDocument } from "../src/types.js";
import { RepositoryFixture } from "./repository-fixture.js";

const SUSPENSION_REASON =
  "Temporarily disabled while issue QE-1234 is corrected.";
const SUSPENSION_DATE = "2026-08-03";

test("canonical Skill and non-Skill lifecycle fields normalize through the shared registry", () => {
  const skillResult = parseAssetMetadata(
    skill("skills/review/SKILL.md", {
      id: "skill.review",
      status: "suspended",
      reason: SUSPENSION_REASON,
      changedAt: SUSPENSION_DATE,
    }),
  );
  const contextResult = parseAssetMetadata(
    context("contexts/review.md", "context.review", {
      status: "suspended",
      reason: SUSPENSION_REASON,
      changedAt: SUSPENSION_DATE,
    }),
  );

  for (const result of [skillResult, contextResult]) {
    assert.equal(result.metadata.status, "suspended");
    assert.equal(result.metadata.statusReason, SUSPENSION_REASON);
    assert.equal(result.metadata.statusChangedAt, SUSPENSION_DATE);
    assert.deepEqual(result.diagnostics, []);
  }
  assert.equal(
    skillResult.metadataFields.status_reason?.key,
    "renma.status-reason",
  );
  assert.equal(
    skillResult.metadataFields.status_changed_at?.key,
    "renma.status-changed-at",
  );
  assert.equal(
    contextResult.metadataFields.status_reason?.key,
    "status_reason",
  );
});

test("suspended lifecycle validation distinguishes missing, blank, invalid, and non-suspended evidence", () => {
  const incompleteCases = [
    {
      label: "missing reason",
      reason: undefined,
      changedAt: SUSPENSION_DATE,
      missing: ["status_reason"],
    },
    {
      label: "blank reason",
      reason: "   ",
      changedAt: SUSPENSION_DATE,
      missing: ["status_reason"],
    },
    {
      label: "missing date",
      reason: SUSPENSION_REASON,
      changedAt: undefined,
      missing: ["status_changed_at"],
    },
  ];
  for (const fixture of incompleteCases) {
    const result = parseAssetMetadata(
      context("contexts/incomplete.md", "context.incomplete", {
        status: "suspended",
        ...(fixture.reason !== undefined ? { reason: fixture.reason } : {}),
        ...(fixture.changedAt !== undefined
          ? { changedAt: fixture.changedAt }
          : {}),
      }),
    );
    const diagnostic = result.diagnostics.find(
      (candidate) =>
        candidate.code ===
        DIAGNOSTIC_IDS.META_SUSPENDED_STATUS_METADATA_INCOMPLETE,
    );
    assert.equal(diagnostic?.severity, "error", fixture.label);
    assert.deepEqual(diagnostic?.details?.missingFields, fixture.missing);
  }

  for (const changedAt of ["not-a-date", "2026-02-30"]) {
    const result = parseAssetMetadata(
      context("contexts/invalid-date.md", "context.invalid-date", {
        status: "suspended",
        reason: SUSPENSION_REASON,
        changedAt,
      }),
    );
    assert.equal(result.metadata.statusChangedAt, changedAt);
    assert.equal(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === DIAGNOSTIC_IDS.META_INVALID_STATUS_CHANGED_AT,
      )[0]?.severity,
      "error",
    );
    assert.equal(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code ===
          DIAGNOSTIC_IDS.META_SUSPENDED_STATUS_METADATA_INCOMPLETE,
      ),
      false,
    );
  }

  for (const status of [
    "experimental",
    "stable",
    "deprecated",
    "archived",
  ] as const) {
    const valid = parseAssetMetadata(
      context(`contexts/${status}.md`, `context.${status}`, {
        status,
        reason: `Reviewed ${status} transition.`,
        changedAt: SUSPENSION_DATE,
      }),
    );
    assert.deepEqual(valid.diagnostics, [], status);
    assert.equal(valid.metadata.statusReason, `Reviewed ${status} transition.`);
    assert.equal(valid.metadata.statusChangedAt, SUSPENSION_DATE);
  }

  const stableInvalid = parseAssetMetadata(
    context("contexts/stable-invalid.md", "context.stable-invalid", {
      status: "stable",
      changedAt: "2026-02-30",
    }),
  );
  assert.equal(stableInvalid.diagnostics[0]?.severity, "warning");

  const invalidStatus = parseAssetMetadata(
    context("contexts/suspicious.md", "context.suspicious", {
      status: "suspicious",
    }),
  );
  assert.equal(invalidStatus.metadata.status, undefined);
  assert.deepEqual(
    invalidStatus.diagnostics.map((diagnostic) => diagnostic.code),
    [DIAGNOSTIC_IDS.META_INVALID_STATUS],
  );
});

test("lifecycle predicates keep omitted status usable and separate declared active from inactive", () => {
  assert.equal(isDeclaredActiveLifecycleStatus("experimental"), true);
  assert.equal(isDeclaredActiveLifecycleStatus("stable"), true);
  assert.equal(isDeclaredActiveLifecycleStatus(undefined), false);
  assert.equal(isInactiveLifecycleStatus("suspended"), true);
  assert.equal(isInactiveLifecycleStatus("deprecated"), true);
  assert.equal(isInactiveLifecycleStatus("archived"), true);
  assert.equal(isLifecycleUsable(undefined), true);
  assert.equal(isLifecycleUsable("suspended"), false);
});

test("active required and optional declarations to a unique suspended target have distinct severity", () => {
  const documents = [
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      requiredContext: ["context.suspended"],
      optionalContext: ["contexts/suspended.md"],
    }),
    context("contexts/suspended.md", "context.suspended", {
      status: "suspended",
      reason: SUSPENSION_REASON,
      changedAt: SUSPENSION_DATE,
    }),
    contextLens("lenses/source.md", "lens.source", ["context.suspended"]),
  ];
  const { diagnostics } = buildCatalog(documents);
  const required = diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === DIAGNOSTIC_IDS.META_REQUIRED_SUSPENDED_DEPENDENCY,
  );
  const optional = diagnostics.find(
    (diagnostic) =>
      diagnostic.code === DIAGNOSTIC_IDS.META_OPTIONAL_SUSPENDED_DEPENDENCY,
  );

  assert.equal(required.length, 2);
  assert.deepEqual(
    required.map((diagnostic) => diagnostic.details?.relationship).sort(),
    ["applies_to", "requires_context"],
  );
  assert.ok(required.every((diagnostic) => diagnostic.severity === "error"));
  assert.ok(
    required.every(
      (diagnostic) =>
        diagnostic.details?.targetStatusReason === SUSPENSION_REASON &&
        diagnostic.details?.membership === "required",
    ),
  );
  assert.equal(optional?.severity, "warning");
  assert.equal(optional?.details?.membership, "optional");
});

test("declared composition excludes suspended members from required completeness without promoting optional closure", () => {
  const requiredDocuments = [
    skill("skills/root/SKILL.md", {
      id: "skill.root",
      requiredContext: ["context.middle"],
    }),
    context("contexts/middle.md", "context.middle", {
      requiredContext: ["context.suspended"],
    }),
    context("contexts/suspended.md", "context.suspended", {
      status: "suspended",
      reason: SUSPENSION_REASON,
      changedAt: SUSPENSION_DATE,
    }),
  ];
  const requiredCatalog = buildCatalog(requiredDocuments).catalog;
  const required = resolveDeclaredComposition(requiredCatalog, "skill.root");
  assert.equal(required.requiredComplete, false);
  assert.equal(
    required.lifecycleFindings.find(
      (item) => item.assetId === "context.suspended",
    )?.membership,
    "required",
  );

  const optionalDocuments = [
    skill("skills/root/SKILL.md", {
      id: "skill.root",
      optionalContext: ["context.middle"],
    }),
    context("contexts/middle.md", "context.middle", {
      requiredContext: ["context.suspended"],
    }),
    context("contexts/suspended.md", "context.suspended", {
      status: "suspended",
      reason: SUSPENSION_REASON,
      changedAt: SUSPENSION_DATE,
    }),
  ];
  const optionalCatalog = buildCatalog(optionalDocuments).catalog;
  const optional = resolveDeclaredComposition(optionalCatalog, "skill.root");
  assert.equal(optional.requiredComplete, true);
  assert.equal(
    optional.lifecycleFindings.find(
      (item) => item.assetId === "context.suspended",
    )?.membership,
    "optional",
  );
});

test("inactive sources and ambiguous targets do not produce cascading suspension dependency diagnostics", () => {
  const inactiveSource = buildCatalog([
    context("contexts/source.md", "context.source", {
      status: "suspended",
      reason: "Source is temporarily disabled.",
      changedAt: SUSPENSION_DATE,
      requiredContext: ["context.target"],
    }),
    context("contexts/target.md", "context.target", {
      status: "suspended",
      reason: "Target is temporarily disabled.",
      changedAt: SUSPENSION_DATE,
    }),
  ]);
  assert.equal(
    inactiveSource.diagnostics.some((diagnostic) =>
      diagnostic.code?.includes("SUSPENDED-DEPENDENCY"),
    ),
    false,
  );

  const ambiguous = buildCatalog([
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      requiredContext: ["context.duplicate"],
    }),
    context("contexts/one.md", "context.duplicate", {
      status: "suspended",
      reason: "First candidate.",
      changedAt: SUSPENSION_DATE,
    }),
    context("contexts/two.md", "context.duplicate", {
      status: "suspended",
      reason: "Second candidate.",
      changedAt: SUSPENSION_DATE,
    }),
  ]);
  assert.equal(
    ambiguous.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.META_REQUIRED_SUSPENDED_DEPENDENCY,
    ),
    false,
  );
});

test("Discovery retains suspended Skill evidence while excluding publication, route use, reachability, and cycles", () => {
  const documents = [
    skill("skills/source/SKILL.md", {
      id: "skill.source",
      published: true,
      routes: ["skill.suspended"],
    }),
    skill("skills/suspended/SKILL.md", {
      id: "skill.suspended",
      status: "suspended",
      reason: SUSPENSION_REASON,
      changedAt: SUSPENSION_DATE,
      published: true,
      routes: ["skill.source"],
    }),
  ];
  const built = buildCatalog(documents);
  const discovery = prepareSkillDiscoveryIndex(documents, built.catalog);
  const suspended = discovery.skills.find(
    (candidate) => candidate.id === "skill.suspended",
  );
  const route = discovery.routes.find(
    (candidate) => candidate.sourceId === "skill.source",
  );

  assert.equal(suspended?.lifecycle, "suspended");
  assert.equal(suspended?.lifecycleReason, SUSPENSION_REASON);
  assert.equal(suspended?.lifecycleChangedAt, SUSPENSION_DATE);
  assert.equal(suspended?.publication.requested, true);
  assert.equal(suspended?.publication.accepted, false);
  assert.deepEqual(discovery.publishedEntrypointIds, ["skill.source"]);
  assert.equal(route?.resolution, "resolved");
  assert.equal(route?.usable, false);
  assert.deepEqual(route?.usabilityReasons, ["inactive-target"]);
  assert.equal(route?.resolvedTarget?.lifecycleReason, SUSPENSION_REASON);
  assert.ok(
    discovery.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
          DIAGNOSTIC_IDS.DISCOVERY_SUSPENDED_PUBLISHED_ENTRYPOINT &&
        diagnostic.severity === "error",
    ),
  );
  assert.ok(
    discovery.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_SUSPENDED_ROUTE_TARGET &&
        diagnostic.severity === "error",
    ),
  );
  assert.equal(
    discovery.diagnostics.some(
      (diagnostic) => diagnostic.code === DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
    ),
    false,
  );
  assert.equal(
    discovery.reachableDiscoveryEligibleSkillIds.includes("skill.suspended"),
    false,
  );

  const isolatedDocuments = [
    skill("skills/isolated/SKILL.md", {
      id: "skill.isolated",
      status: "suspended",
      reason: SUSPENSION_REASON,
      changedAt: SUSPENSION_DATE,
    }),
  ];
  const isolated = prepareSkillDiscoveryIndex(
    isolatedDocuments,
    buildCatalog(isolatedDocuments).catalog,
  );
  assert.equal(isolated.skills.length, 1);
  assert.equal(isolated.diagnostics.length, 0);
});

test("isolated, required, and optional suspension states project through Readiness and public evidence", async (t) => {
  const isolated = await RepositoryFixture.create({
    prefix: "renma-suspended-isolated-",
    testContext: t,
  });
  const isolatedPath = await isolated.context("contexts/suspended.md", {
    id: "context.suspended",
    owner: "qa-platform",
    status: "suspended",
    statusReason: SUSPENSION_REASON,
    statusChangedAt: SUSPENSION_DATE,
    whenToUse: ["historical review"],
    whenNotToUse: ["active composition"],
  });

  const isolatedReadiness = await readiness(isolated.root);
  assert.equal(
    isolatedReadiness.checks.find((check) => check.id === "assets.lifecycle")
      ?.status,
    "pass",
  );
  assert.equal(isolatedReadiness.summary.diagnosticCounts.error, 0);

  const isolatedBom = await bom(isolated.root, {}, { omitGeneratedAt: true });
  const bomAsset = isolatedBom.assets[0];
  assert.equal(bomAsset?.statusReason, SUSPENSION_REASON);
  assert.equal(bomAsset?.lifecycle?.statusChangedAt, SUSPENSION_DATE);
  assert.match(formatBomMarkdown(isolatedBom), /Status reason/);

  const scanResult = await scan(isolated.root);
  assert.equal(
    scanResult.findings.some(
      (finding) => finding.id === DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_ASSET,
    ),
    false,
  );
  const assetNode = scanResult.trustGraph?.nodes.find(
    (node) => node.id === "asset:context.suspended",
  );
  const lifecycleEdge = scanResult.trustGraph?.edges.find(
    (edge) => edge.type === "has_lifecycle_status",
  );
  assert.equal(assetNode?.properties?.statusReason, SUSPENSION_REASON);
  assert.equal(lifecycleEdge?.properties?.statusChangedAt, SUSPENSION_DATE);
  assert.ok(
    lifecycleEdge?.evidence?.some((evidence) =>
      evidence.snippet.includes("status_reason"),
    ),
  );

  const inspect = await buildInspectOutline(isolatedPath);
  assert.equal(inspect.asset?.statusReason, SUSPENSION_REASON);
  const catalogResult = {
    root: isolated.root,
    scannedFileCount: 1,
    catalog: scanResult.trustGraph
      ? buildCatalog([
          context("contexts/suspended.md", "context.suspended", {
            status: "suspended",
            reason: SUSPENSION_REASON,
            changedAt: SUSPENSION_DATE,
          }),
        ]).catalog
      : buildCatalog([]).catalog,
    contextLens: scanResult.contextLens ?? zeroContextLensSummary(),
    diagnostics: [],
  };
  assert.match(formatCatalogMarkdown(catalogResult), /Status changed at/);

  const required = await RepositoryFixture.create({
    prefix: "renma-suspended-required-",
    testContext: t,
  });
  await required.skill("source", {
    id: "skill.source",
    owner: "qa-platform",
    status: "stable",
    metadata: {
      "requires-context": JSON.stringify(["context.suspended"]),
    },
  });
  await required.context("contexts/suspended.md", {
    id: "context.suspended",
    owner: "qa-platform",
    status: "suspended",
    statusReason: SUSPENSION_REASON,
    statusChangedAt: SUSPENSION_DATE,
  });
  const requiredReadiness = await readiness(required.root);
  assert.equal(requiredReadiness.level, "not_ready");
  assert.ok(
    requiredReadiness.diagnostics?.some(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.META_REQUIRED_SUSPENDED_DEPENDENCY,
    ),
  );
  const requiredScan = await scan(required.root);
  const requiredDiagnosticV2 = requiredScan.diagnosticsV2.find(
    (diagnostic) =>
      diagnostic.code === DIAGNOSTIC_IDS.META_REQUIRED_SUSPENDED_DEPENDENCY,
  );
  assert.equal(requiredDiagnosticV2?.severity, "error");
  assert.ok((requiredDiagnosticV2?.repairConstraints?.length ?? 0) > 0);
  assert.ok((requiredDiagnosticV2?.verificationSteps?.length ?? 0) > 0);
  assert.equal(
    requiredScan.findings.find(
      (finding) =>
        finding.id === DIAGNOSTIC_IDS.META_REQUIRED_SUSPENDED_DEPENDENCY,
    )?.severity,
    "high",
  );

  const optional = await RepositoryFixture.create({
    prefix: "renma-suspended-optional-",
    testContext: t,
  });
  await optional.skill("source", {
    id: "skill.source",
    owner: "qa-platform",
    status: "stable",
    metadata: {
      "optional-context": JSON.stringify(["context.suspended"]),
    },
  });
  await optional.context("contexts/suspended.md", {
    id: "context.suspended",
    owner: "qa-platform",
    status: "suspended",
    statusReason: SUSPENSION_REASON,
    statusChangedAt: SUSPENSION_DATE,
  });
  const optionalReadiness = await readiness(optional.root);
  assert.equal(
    optionalReadiness.checks.some((check) => check.status === "fail"),
    false,
  );
  assert.equal(
    optionalReadiness.checks.find(
      (check) => check.id === "workflow.optional_context",
    )?.status,
    "warn",
  );
  assert.ok(
    optionalReadiness.diagnostics?.some(
      (diagnostic) =>
        diagnostic.code === DIAGNOSTIC_IDS.META_OPTIONAL_SUSPENDED_DEPENDENCY,
    ),
  );
});

interface SkillOptions {
  id: string;
  status?: string;
  reason?: string;
  changedAt?: string;
  requiredContext?: string[];
  optionalContext?: string[];
  routes?: string[];
  published?: boolean;
}

function skill(sourcePath: string, options: SkillOptions): ParsedDocument {
  const name = path.posix.basename(path.posix.dirname(sourcePath));
  return document(
    sourcePath,
    "skill",
    [
      "---",
      `name: ${name}`,
      `description: Review ${name} repository evidence and produce deterministic results. Use when ${name} workflow validation is requested; do not use for runtime selection or command execution.`,
      "metadata:",
      `  renma.id: ${JSON.stringify(options.id)}`,
      ...(options.status
        ? [`  renma.status: ${JSON.stringify(options.status)}`]
        : []),
      ...(options.reason !== undefined
        ? [`  renma.status-reason: ${JSON.stringify(options.reason)}`]
        : []),
      ...(options.changedAt
        ? [`  renma.status-changed-at: ${JSON.stringify(options.changedAt)}`]
        : []),
      ...(options.requiredContext
        ? [
            `  renma.requires-context: '${JSON.stringify(options.requiredContext)}'`,
          ]
        : []),
      ...(options.optionalContext
        ? [
            `  renma.optional-context: '${JSON.stringify(options.optionalContext)}'`,
          ]
        : []),
      ...(options.routes
        ? [`  renma.continues-with: '${JSON.stringify(options.routes)}'`]
        : []),
      ...(options.published ? ['  renma.published-entrypoint: "true"'] : []),
      "---",
      `# ${name}`,
      "",
    ].join("\n"),
  );
}

interface ContextOptions {
  status?: string;
  reason?: string;
  changedAt?: string;
  requiredContext?: string[];
  optionalContext?: string[];
}

function context(
  sourcePath: string,
  id: string,
  options: ContextOptions = {},
): ParsedDocument {
  return document(
    sourcePath,
    "context",
    [
      "---",
      `id: ${id}`,
      "owner: qa-platform",
      ...(options.status ? [`status: ${options.status}`] : []),
      ...(options.reason !== undefined
        ? [`status_reason: ${options.reason}`]
        : []),
      ...(options.changedAt ? [`status_changed_at: ${options.changedAt}`] : []),
      ...(options.requiredContext
        ? [
            "requires_context:",
            ...options.requiredContext.map((v) => `  - ${v}`),
          ]
        : []),
      ...(options.optionalContext
        ? [
            "optional_context:",
            ...options.optionalContext.map((v) => `  - ${v}`),
          ]
        : []),
      "when_to_use: repository validation",
      "when_not_to_use: runtime selection",
      "---",
      `# ${id}`,
      "",
    ].join("\n"),
  );
}

function contextLens(
  sourcePath: string,
  id: string,
  appliesTo: string[],
): ParsedDocument {
  return document(
    sourcePath,
    "context_lens",
    [
      "---",
      `id: ${id}`,
      "type: context_lens",
      "owner: qa-platform",
      "status: stable",
      "purpose: Interpret context for review.",
      "applies_to:",
      ...appliesTo.map((value) => `  - ${value}`),
      "---",
      `# ${id}`,
      "",
    ].join("\n"),
  );
}

function document(
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
