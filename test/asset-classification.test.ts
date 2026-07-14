import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { main } from "../src/cli.js";
import { renmaCommand } from "../src/command-invocation.js";
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
  repositoryClassificationPath,
} from "../src/discovery.js";
import { scan } from "../src/scanner.js";
import type { MetadataSuggestion } from "../src/commands/suggest-metadata.js";

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
    parentAssetCandidatePath,
  ] of cases) {
    const result = classifyAssetPath(input);
    assert.equal(result.kind, kind, input);
    assert.equal(result.scope, scope, input);
    assert.equal(result.matchedRule, matchedRule, input);
    assert.equal(result.recognizedRoot, recognizedRoot, input);
    assert.equal(
      result.parentAssetCandidatePath,
      parentAssetCandidatePath,
      input,
    );
    if (parentAssetCandidatePath) {
      assert.equal(result.parentAssetPath, undefined, input);
      assert.equal(result.parentResolution, "structural-candidate", input);
    }
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

test("repository boundaries prefer a nested repository marker over cwd containment", async () => {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), "renma-classify-workspace-"),
  );
  const repository = path.join(workspace, "repo");
  const target = path.join(repository, "contexts", "foo", "policy.md");
  await mkdir(path.join(repository, ".git"), { recursive: true });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Policy\n");

  const resolution = repositoryClassificationPath(
    "repo/contexts/foo/policy.md",
    { cwd: workspace },
  );
  assert.equal(resolution.state, "resolved");
  if (resolution.state !== "resolved") return;
  assert.equal(resolution.source, "marker");
  assert.equal(resolution.root, repository);
  assert.equal(resolution.relativePath, "contexts/foo/policy.md");

  const originalCwd = process.cwd();
  try {
    process.chdir(workspace);
    const suggestion = await buildMetadataSuggestion(
      "repo/contexts/foo/policy.md",
    );
    const inspect = await buildInspectOutline("repo/contexts/foo/policy.md");
    assert.equal(suggestion.classification.matchedRule, "context-root");
    assert.equal(inspect.classification.matchedRule, "context-root");
  } finally {
    process.chdir(originalCwd);
  }
});

test("an explicit caller root resolves unstructured paths while target-only evidence fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-explicit-root-"));
  const target = path.join(root, "docs", "note.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Note\n");

  const unresolved = repositoryClassificationPath(target);
  assert.equal(unresolved.state, "unresolved");
  if (unresolved.state !== "unresolved") return;
  assert.deepEqual(unresolved.candidateRoots, []);
  const explicit = repositoryClassificationPath(target, {
    repositoryRoot: root,
  });
  assert.equal(explicit.state, "resolved");
  if (explicit.state !== "resolved") return;
  assert.equal(explicit.source, "explicit");
  assert.equal(explicit.relativePath, "docs/note.md");

  const suggestion = await buildMetadataSuggestion(target);
  const inspect = await buildInspectOutline(target);
  assert.equal(suggestion.decisionStatus, "blocked");
  assert.equal(
    suggestion.decision.reasonCode,
    "repository-boundary-unresolved",
  );
  assert.equal(suggestion.classification.kind, "unknown");
  assert.deepEqual(suggestion.nextActions, []);
  assert.equal(inspect.repositoryBoundary.state, "unresolved");
  if (inspect.repositoryBoundary.state === "unresolved") {
    assert.equal(
      inspect.repositoryBoundary.reasonCode,
      "repository-boundary-unresolved",
    );
    assert.deepEqual(inspect.repositoryBoundary.candidateRoots, []);
  }
  assert.equal(
    JSON.stringify(suggestion.nextActions).includes("scan ."),
    false,
  );
});

test("absolute targets outside cwd retain deterministic structural boundaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-external-assets-"));
  const fixtures = [
    ["AGENTS.md", "agent-root", "agent"],
    ["renma.config.json", "config-file", "config"],
    [".agents/provider.md", "agent-root", "agent"],
    ["contexts/foo/references/tools/helper.md", "context-root", "context"],
    ["tools/helper.md", "repository-tool", "unknown"],
  ] as const;

  for (const [relative, rule, kind] of fixtures) {
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      relative.endsWith(".json") ? "{}\n" : "# Fixture\n",
    );
    const resolution = repositoryClassificationPath(target);
    assert.equal(resolution.state, "resolved", relative);
    if (resolution.state !== "resolved") continue;
    assert.equal(resolution.root, root, relative);
    assert.equal(resolution.relativePath, relative, relative);
    const classification = classifyAssetPath(resolution.relativePath);
    assert.equal(classification.matchedRule, rule, relative);
    assert.equal(classification.kind, kind, relative);
    const suggestion = await buildMetadataSuggestion(target);
    const inspect = await buildInspectOutline(target);
    assert.equal(suggestion.classification.matchedRule, rule, relative);
    assert.equal(inspect.classification.matchedRule, rule, relative);
  }

  const contextTarget = path.join(
    root,
    "contexts",
    "foo",
    "references",
    "tools",
    "helper.md",
  );
  assert.equal(
    (await buildMetadataSuggestion(contextTarget)).classification.matchedRule,
    "context-root",
  );
  assert.equal(
    (await buildInspectOutline(contextTarget)).classification.matchedRule,
    "context-root",
  );
});

test("structural fallback ignores nested boundary-like names after the outer boundary", () => {
  const root = path.join(os.tmpdir(), "renma-structural-boundary");
  const cases = [
    ["contexts/foo/tools/helper.md", "context-root"],
    ["contexts/foo/references/context.md", "context-root"],
    ["skills/foo/references/contexts.md", "skill-local-support"],
    [".agents/skills/foo/references/tools.md", "skill-local-support"],
  ] as const;
  for (const [relative, expectedRule] of cases) {
    const resolution = repositoryClassificationPath(path.join(root, relative));
    assert.equal(resolution.state, "resolved", relative);
    if (resolution.state !== "resolved") continue;
    assert.equal(resolution.root, root, relative);
    assert.equal(resolution.relativePath, relative, relative);
    assert.equal(
      classifyAssetPath(resolution.relativePath).matchedRule,
      expectedRule,
      relative,
    );
  }
});

test("guard directories never establish a structural repository boundary", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "renma-guard-structure-"));
  const cases = [
    ["references/policy.md", "repository-boundary-unresolved", []],
    [
      "references/context/policy.md",
      "repository-boundary-ambiguous",
      [base, path.join(base, "references")],
    ],
    [
      "examples/skills/foo/SKILL.md",
      "repository-boundary-ambiguous",
      [base, path.join(base, "examples")],
    ],
    [
      "assets/project/tools/helper.mjs",
      "repository-boundary-ambiguous",
      [base, path.join(base, "assets", "project")],
    ],
    [
      "scripts/contexts/foo/policy.md",
      "repository-boundary-ambiguous",
      [base, path.join(base, "scripts")],
    ],
    [
      "profiles/lenses/foo.md",
      "repository-boundary-ambiguous",
      [base, path.join(base, "profiles")],
    ],
  ] as const;

  for (const [relative, reasonCode, candidateRoots] of cases) {
    const target = path.join(base, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "# Guard fixture\n");
    const resolution = repositoryClassificationPath(target);
    assert.equal(resolution.state, "unresolved", relative);
    if (resolution.state !== "unresolved") continue;
    assert.equal(resolution.reasonCode, reasonCode, relative);
    assert.deepEqual(resolution.candidateRoots, candidateRoots, relative);
    const suggestion = await buildMetadataSuggestion(target);
    const inspect = await buildInspectOutline(target);
    assert.equal(suggestion.kind, "unknown", relative);
    assert.equal(suggestion.classification.matchedRule, "unknown", relative);
    assert.equal(suggestion.decisionStatus, "blocked", relative);
    assert.equal(suggestion.decision.reasonCode, reasonCode, relative);
    assert.deepEqual(suggestion.nextActions, [], relative);
    assert.equal(inspect.classification.kind, "unknown", relative);
    assert.equal(inspect.classification.matchedRule, "unknown", relative);
    assert.equal(inspect.repositoryBoundary.state, "unresolved", relative);
    if (inspect.repositoryBoundary.state === "unresolved") {
      assert.equal(inspect.repositoryBoundary.reasonCode, reasonCode, relative);
      assert.deepEqual(
        inspect.repositoryBoundary.candidateRoots,
        candidateRoots,
        relative,
      );
    }
    assert.equal(
      JSON.stringify(suggestion.nextActions).includes("scan"),
      false,
      relative,
    );
  }
});

test("competing strong structural roots remain ambiguous", () => {
  const base = path.join(os.tmpdir(), "renma-competing-strong-boundaries");
  const target = path.join(
    base,
    "skills",
    "project",
    "contexts",
    "foo",
    "policy.md",
  );
  const resolution = repositoryClassificationPath(target);
  assert.equal(resolution.state, "unresolved");
  if (resolution.state !== "unresolved") return;
  assert.equal(resolution.reasonCode, "repository-boundary-ambiguous");
  assert.deepEqual(resolution.candidateRoots, [
    base,
    path.join(base, "skills", "project"),
  ]);
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
  assert.deepEqual(suggestion.nextActions[0]?.invocation.args, [
    "inspect",
    path.join(root, "skills", "foo", "SKILL.md"),
    "--format",
    "json",
  ]);
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

test("missing Skill parent blocks inheritance and metadata suggestions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-missing-parent-"));
  const target = path.join(root, "skills", "foo", "references", "policy.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Policy\n");

  const suggestion = await buildMetadataSuggestion(target, {
    owner: "local-owner",
  });
  const inspect = await buildInspectOutline(target);
  assert.equal(suggestion.decisionStatus, "blocked");
  assert.equal(suggestion.decision.reasonCode, "skill-local-parent-unresolved");
  assert.equal(suggestion.classification.parentResolution, "missing");
  assert.deepEqual(suggestion.candidateMetadata, {});
  assert.equal(suggestion.nextActions[0]?.kind, "review-layout");
  assert.equal(inspect.classification.parentResolution, "missing");
  assert.equal(inspect.governance?.ownership.source, "unowned");
  assert.doesNotMatch(renderMetadataPrompt(suggestion), /governed by:/);
});

test("ambiguous Skill parents fail closed in inspect and suggest-metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-ambiguous-parent-"));
  const skillDirectory = path.join(root, "skills", "foo");
  const target = path.join(skillDirectory, "references", "policy.md");
  await mkdir(path.dirname(target), { recursive: true });
  const skill = [
    "---",
    "name: foo",
    "description: Review policy. Use when policy evidence needs review.",
    "metadata:",
    "  renma.owner: qa-platform",
    "---",
    "# Foo",
    "",
  ].join("\n");
  await writeFile(path.join(skillDirectory, "SKILL.md"), skill);
  await writeFile(path.join(root, "skills", "foo.skill.md"), skill);
  await writeFile(target, "# Policy\n");

  const suggestion = await buildMetadataSuggestion(target);
  const inspect = await buildInspectOutline(target);
  assert.equal(suggestion.decisionStatus, "blocked");
  assert.equal(suggestion.classification.parentResolution, "ambiguous");
  assert.deepEqual(suggestion.classification.parentAssetCandidates, [
    "skills/foo.skill.md",
    "skills/foo/SKILL.md",
  ]);
  assert.equal(inspect.classification.parentResolution, "ambiguous");
  assert.equal(inspect.governance?.ownership.source, "unowned");
});

test("explicit local governance is preserved without an inheritance claim", async () => {
  const root = await governedSkillFixture();
  const target = path.join(root, "skills", "foo", "references", "policy.md");
  await writeFile(
    target,
    "---\nowner: local-docs\n---\n# Policy\n\nLocal support.\n",
  );
  const suggestion = await buildMetadataSuggestion(target);
  const inspect = await buildInspectOutline(target);

  assert.equal(
    suggestion.decision.reasonCode,
    "skill-local-existing-metadata-preserved",
  );
  assert.equal(inspect.governance?.ownership.source, "declared");
  assert.equal(inspect.governance?.ownership.effectiveOwner, "local-docs");
});

test("resolved Skill-local support remains explicitly unowned when its parent has no owner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-unowned-parent-"));
  const skillDirectory = path.join(root, "skills", "foo");
  const target = path.join(skillDirectory, "references", "policy.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    [
      "---",
      "name: foo",
      "description: Review policy. Use when policy evidence needs review.",
      "---",
      "# Foo",
      "",
    ].join("\n"),
  );
  await writeFile(target, "# Policy\n");

  const suggestion = await buildMetadataSuggestion(target);
  assert.equal(suggestion.classification.parentResolution, "resolved");
  assert.equal(suggestion.decision.reasonCode, "skill-local-unowned");
  assert.equal(suggestion.decisionStatus, "no-change-recommended");
});

test("blocked independent ownership conflicts never produce patch guidance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-owner-conflict-"));
  const target = path.join(root, "contexts", "policy.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    "---\nid: context.policy\ntitle: Policy\nowner: docs\n---\n# Policy\n",
  );
  const suggestion = await buildMetadataSuggestion(target, { owner: "qa" });
  const prompt = renderMetadataPrompt(suggestion);
  assert.equal(suggestion.decisionStatus, "blocked");
  assert.deepEqual(suggestion.candidateMetadata, {});
  assert.match(prompt, /Do not return or apply a patch/);
  assert.doesNotMatch(prompt, /Return a small reviewed patch/);
  assert.doesNotMatch(prompt, /Candidate Metadata:\n- id:/);
});

test("decisionStatus is authoritative across prompt outcomes", () => {
  const base = {
    path: "contexts/policy.md",
    kind: "context",
    suggestedMode: "metadata-retrofit",
    decision: {
      reasonCode: "deterministic-metadata-candidate",
      summary: "Fixture decision.",
    },
    classification: classifyAssetPath("contexts/policy.md"),
    ownerProvided: false,
    instructions: [],
    candidateMetadata: { id: "context.policy" },
    blockedMetadata: [],
    nextActions: [],
  } satisfies Omit<MetadataSuggestion, "decisionStatus">;

  const blocked = renderMetadataPrompt({
    ...base,
    decisionStatus: "blocked",
  });
  assert.match(blocked, /suppressed because the decision is blocked/);
  assert.match(blocked, /Do not return or apply a patch/);
  const noChange = renderMetadataPrompt({
    ...base,
    decisionStatus: "no-change-recommended",
  });
  assert.match(noChange, /Stop without manufacturing work/);
  const deterministic = renderMetadataPrompt({
    ...base,
    decisionStatus: "deterministic",
  });
  assert.match(deterministic, /deterministic candidate/);
  const human = renderMetadataPrompt({
    ...base,
    decisionStatus: "human-confirmation-required",
  });
  assert.match(human, /After confirming the stated human decision/);
  assert.match(human, /Do not invent unresolved owner/);
});

test("structured command invocations preserve POSIX and Windows argv", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma action's space-"));
  const target = path.join(root, "contexts", "policy's file.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "# Policy\n");
  const suggestion = await buildMetadataSuggestion(target);
  const inspectAction = suggestion.nextActions.find(
    (action) => action.kind === "inspect-target",
  );
  assert.deepEqual(inspectAction?.invocation.args, [
    "inspect",
    target,
    "--format",
    "json",
  ]);
  assert.match(inspectAction?.invocation.display ?? "", /'"'"'/);

  const windowsPath = "C:\\Repo Name\\owner's file.md";
  const windows = renmaCommand(["inspect", windowsPath, "--format", "json"]);
  assert.deepEqual(windows.args, ["inspect", windowsPath, "--format", "json"]);
  assert.equal(windows.command, "renma");
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
