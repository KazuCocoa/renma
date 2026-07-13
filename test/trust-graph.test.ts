import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import {
  formatTrustGraphMarkdown,
  trustGraph,
} from "../src/commands/trust-graph.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import {
  buildTrustGraph as buildTrustGraphContract,
  type TrustGraph,
} from "../src/trust-graph.js";
import type { Catalog } from "../src/model.js";

test("Trust Graph v2 complete JSON contract is frozen", () => {
  const catalog = {
    entries: [],
    assets: [
      {
        id: "context.demo",
        kind: "context",
        sourcePath: "contexts/demo.md",
        contentHash: "sha256:demo",
        sizeBytes: 12,
        contentClassification: "text",
        markdownParserEligible: true,
        ownership: {
          declaredOwner: null,
          effectiveOwner: null,
          source: "unowned",
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
      },
    ],
    dependencies: [],
  } satisfies Catalog;

  assert.deepEqual(buildTrustGraphContract({ catalog }), {
    schemaVersion: "renma.trustGraph.v2",
    summary: {
      assetCount: 1,
      nodeCount: 1,
      edgeCount: 0,
      findingCount: 0,
      nodeTypeCounts: {
        asset: 1,
        owner: 0,
        lifecycle_status: 0,
        security_profile: 0,
        effective_policy: 0,
        diagnostic: 0,
      },
      edgeTypeCounts: {
        owned_by: 0,
        has_lifecycle_status: 0,
        declares_dependency: 0,
        references: 0,
        owns_local_resource: 0,
        statically_references: 0,
        inherits_owner: 0,
        selects_security_profile: 0,
        inherits_policy: 0,
        has_effective_policy: 0,
        has_diagnostic: 0,
      },
      findingSeverityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        error: 0,
        warning: 0,
        info: 0,
      },
      riskClassCounts: {
        violation: 0,
        suspicious: 0,
        advisory: 0,
        unclassified: 0,
      },
    },
    nodes: [
      {
        id: "asset:context.demo",
        type: "asset",
        label: "context.demo",
        properties: {
          assetId: "context.demo",
          kind: "context",
          sourcePath: "contexts/demo.md",
          contentHash: "sha256:demo",
          sizeBytes: 12,
          contentClassification: "text",
          markdownParserEligible: true,
          tags: [],
          ownership: {
            declaredOwner: null,
            effectiveOwner: null,
            source: "unowned",
          },
        },
        evidence: [
          {
            path: "contexts/demo.md",
            startLine: 1,
            endLine: 1,
            snippet: "context.demo",
          },
        ],
      },
    ],
    edges: [],
    findings: [],
  } satisfies TrustGraph);
});

test("Trust Graph JSON is deterministic and sorted", async () => {
  const root = await fixture();
  await writeContext(root, "testing", "zeta", {
    id: "context.testing.zeta",
    owner: "qa",
  });
  await writeContext(root, "testing", "alpha", {
    id: "context.testing.alpha",
    owner: "qa",
  });
  await writeSkill(root, "zeta", {
    id: "skill.zeta",
    owner: "platform",
    requiresContext: ["context.testing.zeta"],
  });
  await writeSkill(root, "alpha", {
    id: "skill.alpha",
    owner: "platform",
    requiresContext: ["context.testing.alpha"],
  });

  const first = await trustGraph(root);
  const second = await trustGraph(root);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(
    first.nodes.filter((node) => node.type === "asset").map((node) => node.id),
    [
      "asset:context.testing.alpha",
      "asset:context.testing.zeta",
      "asset:skill.alpha",
      "asset:skill.zeta",
    ],
  );
  assert.deepEqual(
    first.edges
      .filter((edge) => edge.type === "declares_dependency")
      .map((edge) => [edge.from, edge.to, edge.properties?.dependencyKind]),
    [
      ["asset:skill.alpha", "asset:context.testing.alpha", "requires"],
      ["asset:skill.zeta", "asset:context.testing.zeta", "requires"],
    ],
  );
});

test("Trust Graph includes owner and lifecycle evidence", async () => {
  const root = await fixture();
  await writeContext(root, "testing", "boundary", {
    id: "context.testing.boundary",
    owner: "qa-platform",
    status: "stable",
  });

  const graph = await trustGraph(root);
  const ownerEdge = graph.edges.find(
    (edge) =>
      edge.type === "owned_by" &&
      edge.from === "asset:context.testing.boundary",
  );
  const statusEdge = graph.edges.find(
    (edge) =>
      edge.type === "has_lifecycle_status" &&
      edge.from === "asset:context.testing.boundary",
  );

  assert.equal(ownerEdge?.to, "owner:qa-platform");
  assert.equal(ownerEdge?.properties?.ownershipSource, "declared");
  assert.equal(ownerEdge?.evidence?.[0]?.snippet, "owner: qa-platform");
  assert.equal(statusEdge?.to, "lifecycle_status:stable");
  assert.equal(statusEdge?.evidence?.[0]?.snippet, "status: stable");
});

test("Trust Graph links selected security profiles and effective policy evidence", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      security: {
        approvedDomains: ["b.example.com", "a.example.com"],
        approvedUploadDomains: ["uploads.example.com"],
        disallowedCommands: ["curl"],
        profiles: {
          "strict-local": {
            allowedData: ["sanitized diagnostics", "public"],
            forbiddenInputs: ["tokens", "secrets"],
            networkAllowed: true,
            externalUploadAllowed: false,
            secretsAllowed: false,
            humanApprovalRequired: true,
            approvedDomains: ["docs.example.com"],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
        },
      },
    }),
  );
  await writeSkill(root, "demo", {
    id: "skill.demo",
    owner: "platform",
    securityProfile: "strict-local",
  });

  const graph = await trustGraph(root);
  const profileEdge = graph.edges.find(
    (edge) => edge.type === "selects_security_profile",
  );
  const policyEdge = graph.edges.find(
    (edge) => edge.type === "has_effective_policy",
  );
  const policyNode = graph.nodes.find(
    (node) => node.id === policyEdge?.to && node.type === "effective_policy",
  );

  assert.equal(profileEdge?.from, "asset:skill.demo");
  assert.equal(profileEdge?.to, "security_profile:strict-local");
  assert.equal(
    profileEdge?.evidence?.[0]?.snippet,
    "  renma.security-profile: strict-local",
  );
  assert.equal(policyEdge?.from, "asset:skill.demo");
  assert.match(policyNode?.id ?? "", /^effective_policy:sha256:/);
  assert.deepEqual(policyNode?.properties?.allowedData, [
    "public",
    "sanitized diagnostics",
  ]);
  assert.deepEqual(policyNode?.properties?.forbiddenInputs, [
    "secrets",
    "tokens",
  ]);
  assert.deepEqual(policyNode?.properties?.approvedNetworkDestinations, [
    "a.example.com",
    "b.example.com",
    "docs.example.com",
  ]);
  assert.equal(policyNode?.properties?.humanApprovalRequired, true);
  assert.ok(
    policyEdge?.evidence?.some(
      (evidence) =>
        evidence.snippet === "  renma.security-profile: strict-local",
    ),
  );
});

test("Trust Graph links context lens security profiles and effective policy evidence", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      security: {
        approvedDomains: [],
        approvedUploadDomains: [],
        disallowedCommands: [],
        profiles: {
          "lens-local": {
            allowedData: ["public"],
            forbiddenInputs: ["credentials"],
            networkAllowed: false,
            externalUploadAllowed: false,
            secretsAllowed: false,
            humanApprovalRequired: true,
            approvedDomains: [],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
        },
      },
    }),
  );
  await writeContext(root, "testing", "boundary", {
    id: "context.testing.boundary",
    owner: "qa-platform",
    status: "stable",
  });
  await writeContextLens(root, "boundary", {
    id: "lens.testing.boundary",
    owner: "qa-platform",
    status: "stable",
    appliesTo: ["context.testing.boundary"],
    securityProfile: "lens-local",
  });

  const graph = await trustGraph(root);
  const assetNode = graph.nodes.find(
    (node) => node.id === "asset:lens.testing.boundary",
  );
  const profileEdge = graph.edges.find(
    (edge) =>
      edge.type === "selects_security_profile" &&
      edge.from === "asset:lens.testing.boundary",
  );
  const policyEdge = graph.edges.find(
    (edge) =>
      edge.type === "has_effective_policy" &&
      edge.from === "asset:lens.testing.boundary",
  );

  assert.equal(assetNode?.type, "asset");
  assert.equal(assetNode?.properties?.kind, "context_lens");
  assert.equal(profileEdge?.to, "security_profile:lens-local");
  assert.equal(
    profileEdge?.evidence?.[0]?.snippet,
    "security_profile: lens-local",
  );
  assert.match(policyEdge?.to ?? "", /^effective_policy:sha256:/);
  assert.ok(
    policyEdge?.evidence?.some(
      (evidence) => evidence.snippet === "security_profile: lens-local",
    ),
  );
});

test("Trust Graph links diagnostics to related assets", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    id: "skill.demo",
    owner: "platform",
    status: "active",
  });

  const graph = await trustGraph(root);
  const invalidStatusNode = graph.nodes.find(
    (node) =>
      node.type === "diagnostic" &&
      node.properties?.id === "META-INVALID-STATUS",
  );
  const diagnosticEdge = graph.edges.find(
    (edge) =>
      edge.type === "has_diagnostic" &&
      edge.from === "asset:skill.demo" &&
      edge.to === invalidStatusNode?.id,
  );

  assert.ok(invalidStatusNode);
  assert.ok(diagnosticEdge);
  assert.equal(diagnosticEdge.evidence?.[0]?.snippet, "  renma.status: active");
});

test("Trust Graph preserves duplicate asset id evidence as findings and diagnostic nodes", async () => {
  const root = await fixture();
  await writeContext(root, "alpha", "shared", {
    id: "context.testing.duplicate",
    owner: "qa-platform",
    status: "stable",
  });
  await writeContext(root, "beta", "shared", {
    id: "context.testing.duplicate",
    owner: "qa-platform",
    status: "stable",
  });

  const graph = await trustGraph(root);
  const duplicateFindings = graph.findings.filter(
    (finding) => finding.id === DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID,
  );
  const duplicateDiagnosticNodes = graph.nodes.filter(
    (node) =>
      node.type === "diagnostic" &&
      node.properties?.id === DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID,
  );

  assert.deepEqual(duplicateFindings.map((finding) => finding.path).sort(), [
    "contexts/alpha/shared.md",
    "contexts/beta/shared.md",
  ]);
  assert.deepEqual(
    duplicateDiagnosticNodes.map((node) => node.properties?.path).sort(),
    ["contexts/alpha/shared.md", "contexts/beta/shared.md"],
  );
  assert.equal(
    graph.nodes.filter((node) => node.id === "asset:context.testing.duplicate")
      .length,
    1,
  );
});

test("Trust Graph command prints JSON and compact markdown", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    id: "skill.demo",
    owner: "platform",
    status: "stable",
  });

  const json = await withCapturedConsole(() =>
    main(["trust-graph", root, "--json"]),
  );
  const parsed = JSON.parse(json.stdout) as {
    schemaVersion: string;
    summary: { assetCount: number };
  };
  assert.equal(json.code, 0);
  assert.equal(parsed.schemaVersion, "renma.trustGraph.v2");
  assert.equal(parsed.summary.assetCount, 1);

  const markdown = await withCapturedConsole(() =>
    main(["trust-graph", root, "--format", "markdown"]),
  );
  assert.equal(markdown.code, 0);
  assert.match(markdown.stdout, /^# Renma Trust Graph/);
  assert.match(markdown.stdout, /## Trust Evidence Highlights/);
  assert.match(markdown.stdout, /Owned assets: 1\/1/);
});

test("Trust Graph v2 includes support nodes and static inheritance edges", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    id: "skill.demo",
    owner: "platform",
    status: "stable",
  });
  await mkdir(path.join(root, "skills", "demo", "scripts"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "demo", "scripts", "run.mjs"),
    "console.log('ok');\n",
  );

  const v2 = await trustGraph(root);
  assert.equal(v2.schemaVersion, "renma.trustGraph.v2");
  assert.ok(v2.nodes.some((node) => node.properties?.kind === "script"));
  assert.ok(v2.edges.some((edge) => edge.type === "inherits_owner"));
});

test("Trust Graph command exits 0 when generated graph includes diagnostic errors", async () => {
  const root = await fixture();
  await writeContext(root, "testing", "boundary", {
    id: "context.testing.boundary",
    owner: "qa-platform",
    status: "stable",
  });
  await writeInvalidContextLens(root);

  const json = await withCapturedConsole(() =>
    main(["trust-graph", root, "--json"]),
  );
  const parsed = JSON.parse(json.stdout) as {
    summary: { findingSeverityCounts: { error: number } };
  };

  assert.equal(json.code, 0);
  assert.equal(parsed.summary.findingSeverityCounts.error, 1);
});

test("Trust Graph markdown formatter separates severity and risk counts", async () => {
  const root = await fixture();
  await writeSkill(root, "demo", {
    id: "skill.demo",
    owner: "platform",
    status: "active",
  });

  const markdown = formatTrustGraphMarkdown(await trustGraph(root));

  assert.doesNotMatch(markdown, /## Finding Counts/);
  assert.match(markdown, /## Finding Severity Counts/);
  assert.match(markdown, /## Finding Risk Class Counts/);
  assert.match(markdown, /\| medium \| [1-9]/);
  assert.match(markdown, /\| unclassified \| [1-9]/);
  assert.match(markdown, /META-INVALID-STATUS/);
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-trust-graph-"));
}

async function writeSkill(
  root: string,
  name: string,
  metadata: {
    id: string;
    owner?: string;
    status?: string;
    requiresContext?: string[];
    securityProfile?: string;
  },
): Promise<void> {
  await mkdir(path.join(root, "skills", name), { recursive: true });
  await writeFile(
    path.join(root, "skills", name, "SKILL.md"),
    markdown({
      skillName: name,
      ...metadata,
      title: `# ${metadata.id}`,
      body: [
        "Use this workflow for trust graph fixture checks with deterministic routing, security policy evidence, reviewable outputs, and verification expectations.",
        "",
        "## Do Not Use For",
        "Do not use for production release decisions.",
        "",
        "## Required Inputs",
        "- A small fixture repository.",
        "",
        "## Instructions",
        "1. Inspect the fixture evidence.",
        "2. Report the deterministic result.",
        "",
        "## Examples",
        "Input: fixture. Output: trust graph evidence.",
        "",
        "## Completion Criteria",
        "The graph contains stable nodes, edges, and findings.",
        "",
        "## Verification",
        "Run the trust-graph command and inspect JSON or Markdown output.",
      ].join("\n"),
    }),
  );
}

async function writeContext(
  root: string,
  group: string,
  name: string,
  metadata: {
    id: string;
    owner?: string;
    status?: string;
  },
): Promise<void> {
  await mkdir(path.join(root, "contexts", group), { recursive: true });
  await writeFile(
    path.join(root, "contexts", group, `${name}.md`),
    markdown({
      ...metadata,
      whenToUse: ["Reviewing trust graph fixture context."],
      whenNotToUse: ["Runtime context selection."],
      title: `# ${metadata.id}`,
      body: "This context asset exists to make Trust Graph tests deterministic.",
    }),
  );
}

async function writeContextLens(
  root: string,
  name: string,
  metadata: {
    id: string;
    owner?: string;
    status?: string;
    appliesTo?: string[];
    securityProfile?: string;
  },
): Promise<void> {
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "lenses", "testing", `${name}.md`),
    markdown({
      ...metadata,
      type: "context_lens",
      purpose: "Interpret boundary value analysis for review.",
      title: `# ${metadata.id}`,
      body: "Use this lens to interpret reusable context without runtime selection.",
    }),
  );
}

async function writeInvalidContextLens(root: string): Promise<void> {
  await mkdir(path.join(root, "lenses", "testing"), { recursive: true });
  await writeFile(
    path.join(root, "lenses", "testing", "spec-review.md"),
    [
      "---",
      "id: lens.testing.spec-review",
      "owner: qa-platform",
      "status: experimental",
      "applies_to:",
      "  - context.testing.boundary",
      "---",
      "# Spec Review Lens",
      "",
      "Review boundary context for ambiguity.",
      "",
    ].join("\n"),
  );
}

function markdown(metadata: {
  skillName?: string;
  id: string;
  type?: string;
  owner?: string;
  status?: string;
  requiresContext?: string[];
  appliesTo?: string[];
  securityProfile?: string;
  purpose?: string;
  whenToUse?: string[];
  whenNotToUse?: string[];
  title: string;
  body: string;
}): string {
  if (metadata.skillName) {
    return [
      "---",
      `name: ${metadata.skillName}`,
      "description: Use this skill for deterministic trust graph fixture checks. Use when ownership, lifecycle, dependencies, and policy evidence need review.",
      "metadata:",
      `  renma.id: ${metadata.id}`,
      ...(metadata.owner ? [`  renma.owner: ${metadata.owner}`] : []),
      ...(metadata.status ? [`  renma.status: ${metadata.status}`] : []),
      ...(metadata.requiresContext
        ? [
            `  renma.requires-context: '${JSON.stringify(metadata.requiresContext)}'`,
          ]
        : []),
      ...(metadata.securityProfile
        ? [`  renma.security-profile: ${metadata.securityProfile}`]
        : []),
      "---",
      metadata.title,
      "",
      metadata.body,
      "",
    ].join("\n");
  }
  return [
    "---",
    `id: ${metadata.id}`,
    ...(metadata.type ? [`type: ${metadata.type}`] : []),
    ...(metadata.owner ? [`owner: ${metadata.owner}`] : []),
    ...(metadata.status ? [`status: ${metadata.status}`] : []),
    ...(metadata.purpose ? [`purpose: ${metadata.purpose}`] : []),
    ...(metadata.requiresContext
      ? [`requires_context: ${metadata.requiresContext.join(", ")}`]
      : []),
    ...(metadata.appliesTo
      ? [`applies_to: ${metadata.appliesTo.join(", ")}`]
      : []),
    ...(metadata.securityProfile
      ? [`security_profile: ${metadata.securityProfile}`]
      : []),
    ...(metadata.whenToUse
      ? ["when_to_use:", ...metadata.whenToUse.map((item) => `  - ${item}`)]
      : []),
    ...(metadata.whenNotToUse
      ? [
          "when_not_to_use:",
          ...metadata.whenNotToUse.map((item) => `  - ${item}`),
        ]
      : []),
    "---",
    metadata.title,
    "",
    metadata.body,
    "",
  ].join("\n");
}

async function withCapturedConsole(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    return { code: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
