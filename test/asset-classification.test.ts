import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { main } from "../src/cli.js";
import { buildInspectOutline } from "../src/commands/inspect.js";
import {
  buildMetadataSuggestion,
  renderMetadataPrompt,
} from "../src/commands/suggest-metadata.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  classifyAssetPath,
  discoverArtifacts,
  normalizeAssetRepositoryRelativePath,
} from "../src/discovery.js";
import { scan } from "../src/scanner.js";

test("shared asset classifier locks documented precedence and boundaries", () => {
  const cases = [
    [
      "contexts/foo/references/policy.md",
      "context",
      "independent",
      "context-root",
      "contexts",
      undefined,
    ],
    [
      "context/foo/references/policy.md",
      "context",
      "independent",
      "context-root-legacy",
      "context",
      undefined,
    ],
    [
      "contexts/foo/examples/case.md",
      "context",
      "independent",
      "context-root",
      "contexts",
      undefined,
    ],
    [
      "contexts/foo/profiles/strict.md",
      "context",
      "independent",
      "context-root",
      "contexts",
      undefined,
    ],
    [
      "contexts/foo/scripts/helper.md",
      "context",
      "independent",
      "context-root",
      "contexts",
      undefined,
    ],
    [
      "skills/foo/references/policy.md",
      "reference",
      "skill-local",
      "skill-local-support",
      "skills",
      "skills/foo/SKILL.md",
    ],
    [
      "skills/foo/scripts/helper.mjs",
      "script",
      "skill-local",
      "skill-local-support",
      "skills",
      "skills/foo/SKILL.md",
    ],
    [
      "skills/foo/assets/image.png",
      "asset",
      "skill-local",
      "skill-local-support",
      "skills",
      "skills/foo/SKILL.md",
    ],
    [
      "skills/foo/profiles/strict.md",
      "profile",
      "skill-local",
      "skill-local-support",
      "skills",
      "skills/foo/SKILL.md",
    ],
    [
      "skills/foo/examples/case.md",
      "example",
      "skill-local",
      "skill-local-support",
      "skills",
      "skills/foo/SKILL.md",
    ],
    [
      ".agents/skills/foo/references/policy.md",
      "reference",
      "skill-local",
      "skill-local-support",
      ".agents/skills",
      ".agents/skills/foo/SKILL.md",
    ],
    [
      "references/policy.md",
      "unknown",
      "unknown",
      "unknown",
      undefined,
      undefined,
    ],
    [
      "tools/helper.mjs",
      "unknown",
      "repository-support",
      "repository-tool",
      "tools",
      undefined,
    ],
    [
      "skills/foo/tools/helper.mjs",
      "unknown",
      "repository-support",
      "unknown",
      "skills",
      undefined,
    ],
  ] as const;

  for (const [
    input,
    kind,
    scope,
    matchedRule,
    recognizedRoot,
    parentAssetPath,
  ] of cases) {
    const result = classifyAssetPath(input);
    assert.equal(result.kind, kind, input);
    assert.equal(result.scope, scope, input);
    assert.equal(result.matchedRule, matchedRule, input);
    assert.equal(result.recognizedRoot, recognizedRoot, input);
    assert.equal(result.parentAssetPath, parentAssetPath, input);
  }

  assert.deepEqual(
    classifyAssetPath("contexts/foo/references/policy.md")
      .ignoredNestedSegments,
    ["references"],
  );
  assert.equal(
    classifyAssetPath("skills/foo/tools/helper.mjs").reasonCode,
    "unsupported-skill-local-directory",
  );
});

test("classification normalization is stable and rejects traversal", () => {
  assert.equal(
    normalizeAssetRepositoryRelativePath(
      ".\\contexts\\foo\\references\\policy.md",
    ),
    "contexts/foo/references/policy.md",
  );
  assert.deepEqual(
    classifyAssetPath(".\\contexts\\foo\\references\\policy.md"),
    classifyAssetPath("contexts/foo/references/policy.md"),
  );
  assert.equal(
    classifyAssetPath("contexts/foo/../references/policy.md").reasonCode,
    "outside-recognized-asset-boundary",
  );
  assert.equal(
    classifyAssetPath("/tmp/repository/contexts/foo/policy.md").kind,
    "unknown",
  );
  assert.equal(
    classifyAssetPath("contexts/foo/lens.md", {
      metadataType: "context_lens",
    }).kind,
    "context_lens",
  );
});

test("discovery and the shared classifier agree on Context-root precedence", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-classify-discovery-"),
  );
  const fixtures = [
    "contexts/foo/references/policy.md",
    "contexts/foo/examples/case.md",
    "contexts/foo/profiles/strict.md",
    "contexts/foo/scripts/helper.md",
    "skills/foo/tools/helper.mjs",
    "tools/helper.mjs",
  ];
  for (const fixture of fixtures) {
    const target = path.join(root, ...fixture.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "# Fixture\n");
  }
  const { artifacts } = await discoverArtifacts(root, {
    ...DEFAULT_CONFIG,
    globs: ["**/*"],
  });
  for (const artifact of artifacts) {
    assert.equal(
      artifact.kind,
      classifyAssetPath(artifact.path).kind,
      artifact.path,
    );
  }
});

test("suggest-metadata returns no-proposal for ordinary Skill-local support", async () => {
  const root = await governedSkillFixture();
  const target = path.join(root, "skills", "foo", "references", "policy.md");
  const suggestion = await buildMetadataSuggestion(target);

  assert.equal(suggestion.kind, "reference");
  assert.equal(suggestion.suggestedMode, "no-proposal");
  assert.equal(suggestion.decisionStatus, "no-change-recommended");
  assert.equal(
    suggestion.decision.reasonCode,
    "skill-local-governance-inherited",
  );
  assert.deepEqual(suggestion.candidateMetadata, {});
  assert.equal(
    suggestion.classification.parentAssetPath,
    "skills/foo/SKILL.md",
  );
  const prompt = renderMetadataPrompt(suggestion);
  assert.match(prompt, /No independent metadata retrofit is required/);
  assert.match(prompt, /skills\/foo\/SKILL\.md/);
  assert.match(prompt, /Stop without manufacturing work/);
  assert.doesNotMatch(prompt, /Return a small reviewed patch/);
});

test("suggest-metadata preserves explicit Skill-local overrides", async () => {
  const root = await governedSkillFixture();
  const target = path.join(root, "skills", "foo", "references", "policy.md");
  const suggestion = await buildMetadataSuggestion(target, {
    owner: "local-maintainer",
  });

  assert.equal(suggestion.suggestedMode, "metadata-retrofit");
  assert.equal(suggestion.decisionStatus, "deterministic");
  assert.equal(
    suggestion.decision.reasonCode,
    "explicit-human-provided-override",
  );
  assert.deepEqual(suggestion.candidateMetadata, {
    owner: "local-maintainer",
  });
  assert.match(
    renderMetadataPrompt(suggestion),
    /explicit human-provided Skill-local metadata override/,
  );
});

test("suggest-metadata and inspect expose the same Context classification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-classify-command-"));
  const target = path.join(root, "contexts", "foo", "references", "policy.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Policy\n\nReusable policy.\n");

  const suggestion = await buildMetadataSuggestion(target);
  const inspect = await buildInspectOutline(target);
  assert.deepEqual(suggestion.classification, inspect.classification);
  assert.equal(suggestion.classification.matchedRule, "context-root");
  assert.equal(suggestion.classification.kind, "context");
  assert.equal(suggestion.decisionStatus, "human-confirmation-required");
});

test("inspect separates Skill-local classification from inherited governance", async () => {
  const root = await governedSkillFixture();
  const target = path.join(root, "skills", "foo", "references", "policy.md");
  const outline = await buildInspectOutline(target);

  assert.equal(outline.classification.kind, "reference");
  assert.equal(outline.classification.scope, "skill-local");
  assert.equal(outline.governance?.ownership.source, "inherited");
  assert.equal(outline.governance?.ownership.effectiveOwner, "qa-platform");
  assert.equal(
    outline.governance?.ownership.inheritedFrom?.sourcePath,
    "skills/foo/SKILL.md",
  );
  assert.equal(outline.governance?.metadataState, "not-required");

  const text = await captureStdout(() =>
    main(["inspect", target, "--format", "text"]),
  );
  assert.match(text, /Classification:/);
  assert.match(text, /Matched rule: skill-local-support/);
  assert.match(text, /Governance:/);
  assert.match(text, /Ownership source: inherited/);
});

test("repository tools receive classification but no fabricated governance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-classify-tool-"));
  const target = path.join(root, "tools", "helper.mjs");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "export const helper = true;\n");

  const inspect = await buildInspectOutline(target);
  const suggestion = await buildMetadataSuggestion(target);
  assert.equal(inspect.classification.matchedRule, "repository-tool");
  assert.equal(inspect.governance, null);
  assert.equal(suggestion.suggestedMode, "no-proposal");
  assert.deepEqual(suggestion.candidateMetadata, {});
});

test("metadata diagnostics add classification without changing severity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-classify-diag-"));
  const target = path.join(root, "contexts", "foo", "references", "policy.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Policy\n");

  const result = await scan(root);
  const finding = result.findings.find(
    (candidate) =>
      candidate.id === "META-MISSING-ID" &&
      candidate.evidence.path === "contexts/foo/references/policy.md",
  );
  assert.equal(finding?.severity, "medium");
  assert.equal(
    (finding?.details?.classification as { matchedRule?: string } | undefined)
      ?.matchedRule,
    "context-root",
  );
  assert.equal(
    result.diagnostics.some((diagnostic) =>
      diagnostic.code?.startsWith("CLASSIFICATION-"),
    ),
    false,
  );
});

async function governedSkillFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-classify-skill-"));
  const skillDirectory = path.join(root, "skills", "foo");
  await mkdir(path.join(skillDirectory, "references"), { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    [
      "---",
      "name: foo",
      "description: Review foo policy. Use when foo evidence needs deterministic review.",
      "metadata:",
      "  renma.id: skill.foo",
      "  renma.owner: qa-platform",
      "---",
      "# Foo",
      "",
      "Read references/policy.md.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(skillDirectory, "references", "policy.md"),
    "# Policy\n\nLocal support.\n",
  );
  return root;
}

async function captureStdout(action: () => Promise<number>): Promise<string> {
  let stdout = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
  } finally {
    process.stdout.write = originalWrite;
  }
  return stdout;
}
