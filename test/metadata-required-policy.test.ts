import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateAgentSkill } from "../src/agent-skills.js";
import { buildCatalog } from "../src/catalog.js";
import { catalogDiagnosticFindings } from "../src/catalog-findings.js";
import { ConfigError, DEFAULT_CONFIG, loadConfig } from "../src/config.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { parseDocument } from "../src/markdown.js";
import { scan } from "../src/scanner.js";
import type { MetadataConfig } from "../src/types/configuration.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

const REQUIRED_ID = "META-POLICY-REQUIRED-FIELD-MISSING";

test("required metadata keeps its exact public identifier in the registry", () => {
  assert.equal(DIAGNOSTIC_IDS.META_POLICY_REQUIRED_FIELD_MISSING, REQUIRED_ID);
});

test("no required metadata configuration produces no policy findings", () => {
  const built = buildCatalog([
    document("skills/demo/SKILL.md", "skill", canonicalSkill("", "# Demo\n")),
  ]);
  assert.equal(policyDiagnostics(built.diagnostics).length, 0);
});

test("canonical Skill owner satisfies policy and missing owner reports exact spelling", () => {
  const missing = buildCatalogWithPolicy(
    [
      document(
        "skills/missing/SKILL.md",
        "skill",
        canonicalSkill("", "# Missing\n"),
      ),
    ],
    ["owner"],
  );
  const diagnostic = policyDiagnostics(missing.diagnostics)[0];
  assert.equal(diagnostic?.severity, "error");
  assert.deepEqual(diagnostic?.details, {
    requiredField: "owner",
    assetPath: "skills/missing/SKILL.md",
    assetKind: "skill",
    expectedSerializedKey: "metadata.renma.owner",
    presenceState: "absent",
    policySource: "repository_configuration",
    configurationKey: "metadata.required",
    configurationPath: "renma.config.jsonc",
    declarationRequirement: "explicit",
  });

  const present = buildCatalogWithPolicy(
    [
      document(
        "skills/demo/SKILL.md",
        "skill",
        canonicalSkill("  renma.owner: platform\n", "# Present\n"),
      ),
    ],
    ["owner"],
  );
  assert.equal(policyDiagnostics(present.diagnostics).length, 0);
});

test("unrelated Skill identity errors do not invalidate a correct required owner", () => {
  const skill = document(
    "skills/different-directory/SKILL.md",
    "skill",
    canonicalSkill("  renma.owner: platform\n", "# Present\n"),
  );
  const validation = validateAgentSkill(skill);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "AS-SKILL-NAME-DIRECTORY-MISMATCH",
    ),
  );

  const built = buildCatalogWithPolicy([skill], ["owner"]);
  assert.equal(policyDiagnostics(built.diagnostics).length, 0);
});

test("unrelated invalid Skill metadata does not become operational or invalidate a correct required owner", () => {
  const skill = document(
    "skills/demo/SKILL.md",
    "skill",
    canonicalSkill(
      "  renma.owner: platform\n  renma.tags:\n    - invalid-native-list\n",
      "# Present\n",
    ),
  );
  const validation = validateAgentSkill(skill);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "AS-SKILL-INVALID-METADATA",
    ),
  );

  const built = buildCatalogWithPolicy([skill], ["owner"]);
  assert.equal(policyDiagnostics(built.diagnostics).length, 0);
  assert.equal(built.catalog.entries[0]?.metadata.owner, undefined);
  assert.equal(built.catalog.entries[0]?.ownership.effectiveOwner, null);
});

test("invalid and duplicate required Skill fields still fail closed as High findings", () => {
  const invalid = document(
    "skills/invalid/SKILL.md",
    "skill",
    canonicalSkill("  renma.owner: 42\n", "# Invalid\n"),
  );
  const duplicate = document(
    "skills/duplicate/SKILL.md",
    "skill",
    canonicalSkill(
      "  renma.owner: first\n  renma.owner: second\n",
      "# Duplicate\n",
    ),
  );
  const built = buildCatalogWithPolicy([invalid, duplicate], ["owner"]);

  assert.deepEqual(
    policyDiagnostics(built.diagnostics).map(
      (diagnostic) => diagnostic.details?.presenceState,
    ),
    ["invalid", "ambiguous"],
  );
  assert.deepEqual(
    catalogDiagnosticFindings(built.diagnostics)
      .filter((finding) => finding.id === REQUIRED_ID)
      .map((finding) => finding.severity),
    ["high", "high"],
  );
});

test("legacy and ignored hybrid Skill owner declarations do not satisfy policy", () => {
  const legacy = document(
    "skills/legacy/SKILL.md",
    "skill",
    `---
name: legacy
description: Review legacy evidence when requested and report results.
owner: legacy-team
---
# Legacy
`,
  );
  const hybrid = document(
    "skills/hybrid/SKILL.md",
    "skill",
    `---
name: hybrid
description: Review hybrid evidence when requested and report results.
owner: legacy-team
metadata:
  renma.owner: canonical-team
---
# Hybrid
`,
  );
  const built = buildCatalogWithPolicy([legacy, hybrid], ["owner"]);
  const diagnostics = policyDiagnostics(built.diagnostics);
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.details?.presenceState),
    ["absent", "invalid"],
  );
});

test("non-Skill owner uses the registered top-level key", () => {
  const present = buildCatalogWithPolicy(
    [
      document(
        "contexts/present.md",
        "context",
        "---\nid: context.present\nowner: platform\n---\n# Present\n",
      ),
    ],
    ["owner"],
  );
  assert.equal(policyDiagnostics(present.diagnostics).length, 0);

  const missing = buildCatalogWithPolicy(
    [
      document(
        "contexts/missing.md",
        "context",
        "---\nid: context.missing\n---\n# Missing\n",
      ),
    ],
    ["owner"],
  );
  assert.equal(
    policyDiagnostics(missing.diagnostics)[0]?.details?.expectedSerializedKey,
    "owner",
  );
});

test("required non-Skill owner uses the same inline-comment YAML value as the catalog", () => {
  const built = buildCatalogWithPolicy(
    [
      document(
        "contexts/commented-owner.md",
        "context",
        `---
id: context.commented-owner
owner: "qa-platform" # reviewed owner
---
# Present
`,
      ),
    ],
    ["owner"],
  );

  assert.equal(built.catalog.entries[0]?.metadata.owner, "qa-platform");
  assert.equal(policyDiagnostics(built.diagnostics).length, 0);
});

test("inherited effective owner does not satisfy an explicit declaration", () => {
  const built = buildCatalogWithPolicy(
    [
      document(
        "skills/demo/SKILL.md",
        "skill",
        canonicalSkill("  renma.owner: platform\n", "# Demo\n"),
      ),
      document(
        "skills/demo/references/local.md",
        "reference",
        "---\nid: reference.local\n---\n# Local\n",
      ),
    ],
    ["owner"],
  );
  const reference = built.catalog.entries.find(
    (entry) => entry.sourcePath === "skills/demo/references/local.md",
  );
  assert.equal(reference?.ownership.source, "inherited");
  assert.equal(reference?.ownership.effectiveOwner, "platform");
  assert.equal(policyDiagnostics(built.diagnostics).length, 1);
  assert.equal(
    policyDiagnostics(built.diagnostics)[0]?.details?.assetPath,
    "skills/demo/references/local.md",
  );
});

test("text, scalar, and list fields use non-empty normalized presence", () => {
  const valid = buildCatalogWithPolicy(
    [
      document(
        "contexts/valid.md",
        "context",
        `---
id: context.valid
purpose: Reviewed purpose
version: 1
tags:
  - governance
---
# Valid
`,
      ),
    ],
    ["version", "purpose", "tags"],
  );
  assert.equal(policyDiagnostics(valid.diagnostics).length, 0);

  const empty = buildCatalogWithPolicy(
    [
      document(
        "contexts/empty.md",
        "context",
        `---
id: context.empty
purpose: ""
tags: []
---
# Empty
`,
      ),
    ],
    ["purpose", "tags"],
  );
  assert.deepEqual(
    policyDiagnostics(empty.diagnostics).map((diagnostic) => [
      diagnostic.details?.requiredField,
      diagnostic.details?.presenceState,
    ]),
    [
      ["purpose", "empty"],
      ["tags", "empty"],
    ],
  );
});

test("malformed, duplicate, and semantically invalid metadata fail closed", () => {
  const duplicate = buildCatalogWithPolicy(
    [
      document(
        "contexts/duplicate.md",
        "context",
        "---\nid: context.duplicate\nowner: first\nowner: second\n---\n# Duplicate\n",
      ),
    ],
    ["owner"],
  );
  assert.equal(
    policyDiagnostics(duplicate.diagnostics)[0]?.details?.presenceState,
    "ambiguous",
  );

  const malformed = buildCatalogWithPolicy(
    [
      document(
        "contexts/malformed.md",
        "context",
        "---\nid: context.malformed\nowner: [broken\n---\n# Malformed\n",
      ),
    ],
    ["owner"],
  );
  assert.equal(
    policyDiagnostics(malformed.diagnostics)[0]?.details?.presenceState,
    "invalid",
  );

  const invalidStatus = buildCatalogWithPolicy(
    [
      document(
        "contexts/status.md",
        "context",
        "---\nid: context.status\nstatus: active\n---\n# Status\n",
      ),
    ],
    ["status"],
  );
  assert.equal(
    policyDiagnostics(invalidStatus.diagnostics)[0]?.details?.presenceState,
    "invalid",
  );
});

test("multiple required fields follow registry order independent of config order", () => {
  const built = buildCatalogWithPolicy(
    [
      document(
        "contexts/order.md",
        "context",
        "---\nid: context.order\n---\n# Order\n",
      ),
    ],
    ["tags", "owner", "purpose"],
  );
  assert.deepEqual(
    policyDiagnostics(built.diagnostics).map(
      (diagnostic) => diagnostic.details?.requiredField,
    ),
    ["owner", "purpose", "tags"],
  );
});

test("binary and non-metadata-capable assets receive no impossible requirement", () => {
  const binary = parseDocument({
    ...artifact("contexts/image.md", "context", ""),
    contentClassification: "binary",
    markdownParserEligible: false,
  });
  const script = parseDocument({
    ...artifact("skills/demo/scripts/run.sh", "script", "echo ok\n"),
    markdownParserEligible: false,
  });
  const built = buildCatalogWithPolicy([binary, script], ["owner"]);
  assert.equal(policyDiagnostics(built.diagnostics).length, 0);
});

test("metadata configuration validates vocabulary, duplicates, values, and keys", async (t) => {
  const cases = [
    [{ metadata: { required: "owner" } }, /array of strings/],
    [{ metadata: { required: [1] } }, /supported field name string/],
    [{ metadata: { required: ["id"] } }, /Unsupported.*"id"/],
    [{ metadata: { required: ["network_allowed"] } }, /Unsupported/],
    [{ metadata: { required: ["owner", "owner"] } }, /duplicate field/],
    [{ metadata: { unknown: true } }, /Unknown metadata config key/],
    [{ metadata: { ci_policy: "ignore" } }, /must be one of: off, warn, fail/],
  ] as const;
  for (const [index, [config, expected]] of cases.entries()) {
    await t.test(String(index), async (caseContext) => {
      const root = await temporaryDirectory(caseContext);
      await writeFile(
        path.join(root, "renma.config.json"),
        JSON.stringify(config),
      );
      await assert.rejects(
        loadConfig(root, {}),
        (error: unknown) =>
          error instanceof ConfigError && expected.test(error.message),
      );
    });
  }
});

test("metadata configuration is request-local, sorted, and deterministic", async (t) => {
  const configuredRoot = await temporaryDirectory(t);
  const defaultRoot = await temporaryDirectory(t);
  await writeFile(
    path.join(configuredRoot, "renma.config.json"),
    JSON.stringify({
      metadata: { ci_policy: "warn", required: ["tags", "owner"] },
    }),
  );

  const first = await loadConfig(configuredRoot, {});
  const second = await loadConfig(configuredRoot, {});
  assert.deepEqual(first.config.metadata, {
    ciPolicy: "warn",
    required: ["owner", "tags"],
    requiredSource: "repository_configuration",
  });
  assert.deepEqual(first.config.metadata, second.config.metadata);
  first.config.metadata.required.push("purpose");

  assert.deepEqual(DEFAULT_CONFIG.metadata, {
    ciPolicy: "fail",
    required: [],
    requiredSource: "renma_default",
  });
  assert.deepEqual((await loadConfig(defaultRoot, {})).config.metadata, {
    ciPolicy: "fail",
    required: [],
    requiredSource: "renma_default",
  });
});

test("repository scanning never rewrites metadata", async (t) => {
  const root = await temporaryDirectory(t);
  const skillPath = path.join(root, "skills", "demo", "SKILL.md");
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      globs: ["skills/**/SKILL.md"],
      metadata: { required: ["owner"] },
    }),
  );
  await mkdir(path.dirname(skillPath), { recursive: true });
  const original = canonicalSkill("", "# Demo\n");
  await writeFile(skillPath, original);
  const result = await scan(root);
  assert.ok(result.findings.some((finding) => finding.id === REQUIRED_ID));
  assert.equal(await readFile(skillPath, "utf8"), original);
});

function buildCatalogWithPolicy(
  documents: ReturnType<typeof parseDocument>[],
  required: MetadataConfig["required"],
) {
  return buildCatalog(documents, undefined, undefined, {
    policy: {
      ciPolicy: "fail",
      required,
      requiredSource: "repository_configuration",
    },
    configPath: "renma.config.jsonc",
  });
}

function policyDiagnostics(
  diagnostics: ReturnType<typeof buildCatalog>["diagnostics"],
) {
  return diagnostics.filter((diagnostic) => diagnostic.code === REQUIRED_ID);
}

function canonicalSkill(metadata: string, body: string): string {
  return `---
name: demo
description: Review demo evidence when requested and report deterministic results.
metadata:
  renma.id: skill.demo
${metadata}---
${body}`;
}

function document(relativePath: string, kind: ArtifactKind, content: string) {
  return parseDocument(artifact(relativePath, kind, content));
}

function artifact(
  relativePath: string,
  kind: ArtifactKind,
  content: string,
): Artifact {
  return {
    path: relativePath,
    absolutePath: `/repo/${relativePath}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

async function temporaryDirectory(context: {
  after(callback: () => Promise<void>): void;
}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "renma-metadata-policy-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
