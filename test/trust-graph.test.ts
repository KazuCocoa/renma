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
    "security_profile: strict-local",
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
      (evidence) => evidence.snippet === "security_profile: strict-local",
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
  assert.equal(diagnosticEdge.evidence?.[0]?.snippet, "status: active");
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
  assert.equal(parsed.schemaVersion, "renma.trustGraph.v1");
  assert.equal(parsed.summary.assetCount, 1);

  const markdown = await withCapturedConsole(() =>
    main(["trust-graph", root, "--format", "markdown"]),
  );
  assert.equal(markdown.code, 0);
  assert.match(markdown.stdout, /^# Renma Trust Graph/);
  assert.match(markdown.stdout, /## Trust Evidence Highlights/);
  assert.match(markdown.stdout, /Owned assets: 1\/1/);
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
  id: string;
  owner?: string;
  status?: string;
  requiresContext?: string[];
  securityProfile?: string;
  whenToUse?: string[];
  whenNotToUse?: string[];
  title: string;
  body: string;
}): string {
  return [
    "---",
    `id: ${metadata.id}`,
    ...(metadata.owner ? [`owner: ${metadata.owner}`] : []),
    ...(metadata.status ? [`status: ${metadata.status}`] : []),
    ...(metadata.requiresContext
      ? [`requires_context: ${metadata.requiresContext.join(", ")}`]
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
