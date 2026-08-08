import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

import { DEFAULT_CONFIG } from "../src/config.js";
import { parseDocument } from "../src/markdown.js";
import {
  DEFAULT_QUALITY_PROFILE,
  RENMA_QUALITY_PROFILE_VERSION,
} from "../src/quality-profile.js";
import { runRules } from "../src/rules.js";
import {
  estimateTokens,
  estimatedTokenUnits,
  markdownBody,
} from "../src/token-estimator.js";
import type { Artifact, ArtifactKind } from "../src/types.js";
import type { ScanConfig } from "../src/types/configuration.js";

test("quality profile pins every package-version default", () => {
  const expectedProfileVersion = `renma-quality@${packageJson.version}`;
  assert.equal(RENMA_QUALITY_PROFILE_VERSION, expectedProfileVersion);
  assert.deepEqual(DEFAULT_QUALITY_PROFILE, {
    profile: expectedProfileVersion,
    descriptionMinChars: 0,
    skillTokenWarning: 5000,
    skillTokenHigh: 8000,
    contentTokenWarning: {
      context: 4000,
      reference: 5000,
      profile: 2000,
      example: 2500,
    },
    contentTokenHigh: {
      context: 8000,
      reference: 10000,
      profile: 4000,
      example: 5000,
    },
    frontmatterMaxLines: 48,
    frontmatterMaxChars: 4096,
    metadataListItemMaxChars: 256,
    lowHeadingDensityMinTokens: 400,
    lowHeadingDensityMinHeadings: 2,
    reusableContextCandidate: {
      minLines: 60,
      minTokens: 800,
      minSignals: 4,
    },
    sharedSupportCandidate: {
      minLines: 80,
      minTokens: 1200,
      minHeadings: 3,
      minPhrases: 4,
    },
    repeatedContext: {
      exactSectionMinTokens: 40,
      exactSectionMinChars: 240,
      exactSectionMinFiles: 2,
      exactCodeMinChars: 80,
      exactCodeMinTokens: 10,
      exactCodeMinFiles: 2,
      headingMinChars: 24,
      headingMinTokens: 3,
      headingMinFiles: 3,
      tokenShingleTokens: 40,
      tokenShingleMinFiles: 3,
      tokenShingleNearbyLineWindow: 8,
      tokenShingleMinUniqueTokens: 12,
      tokenShingleMinUsefulTokens: 14,
      tokenShingleMinChars: 140,
      findingCap: 10,
    },
    readiness: {
      blockingDiagnosticPenalty: 40,
      unresolvedRequiredGraphPenalty: 30,
      ownershipMaximumPenalty: 20,
      emptyInventoryPenalty: 10,
      workflowClarityPenalty: 10,
      workflowOptionalContextPenalty: 5,
      workflowRequiredInputsPenalty: 5,
      workflowCompletionCriteriaPenalty: 10,
      layoutWarningPenalty: 5,
      layoutFailurePenalty: 15,
      readyMinimumScore: 90,
      needsAttentionMinimumScore: 70,
    },
    agentSkills: {
      nameMaxChars: 64,
      descriptionMinChars: 1,
      descriptionMaxChars: 1024,
      compatibilityMaxChars: 500,
      skillBodyRecommendedMaxTokens: 5000,
      skillRecommendedMaxLines: 500,
      recommendedReferenceDepth: 1,
    },
    scan: {
      defaultMaxFileSizeBytes: 524288,
      defaultMaxDepth: 16,
      defaultConcurrency: 16,
    },
    presentation: {
      markdownReadinessFindingCap: 50,
      topSummaryItemCap: 10,
    },
    security: {
      precedingLineFastPath: 2,
    },
  });
});

test("quality-profile documentation uses the stable family name", async () => {
  const paths = [
    "docs/quality-profile.md",
    "README.md",
    "docs/README.md",
    "docs/diagnostics.md",
    "docs/user-manual.md",
    "CHANGELOG.md",
  ];
  for (const path of paths) {
    const content = await readFile(path, "utf8");
    assert.doesNotMatch(content, /renma-quality@\d+\.\d+\.\d+/);
    assert.doesNotMatch(content, /Renma \d+\.\d+\.\d+ Quality Profile/);
  }
  const canonical = await readFile("docs/quality-profile.md", "utf8");
  assert.match(
    canonical,
    /`renma-quality` is Renma's internal quality-profile family/,
  );
  assert.match(canonical, /renma-quality@<Renma package version>/);
});

test("token estimator is deterministic and Unicode-aware across repository text", () => {
  const cases = {
    english: "Review the requested files before applying changes.",
    japanese:
      "これは空白のない日本語の段落です。安全性と境界条件を確認します。",
    mixed: "Review 日本語の仕様 and verify boundary conditions.",
    code: "const result = await runTask({ dryRun: true });",
    path: "skills/testing/spec-review/references/boundaries.md",
    yaml: "---\nname: spec-review\ntags: [testing, review]\n---",
    punctuation: "... !!! ??? ———",
  };

  for (const value of Object.values(cases)) {
    const first = estimateTokens(value);
    assert(first > 0);
    assert.equal(estimateTokens(value), first);
    assert.equal(estimatedTokenUnits(value).length, first);
  }
  assert.equal(estimateTokens("one two three"), 3);
  assert.equal(estimateTokens(cases.path), 1);
  assert(estimateTokens(cases.japanese) > 10);
  assert(estimateTokens(cases.japanese) < [...cases.japanese].length);
});

test("Skill budgets measure body after frontmatter at exact boundaries", () => {
  const atWarning = findingsFor("skill", skillWithBodyTokens(5000));
  assert.equal(findBudget(atWarning, "QUAL-SKILL-TOKEN-BUDGET"), undefined);

  const aboveWarning = findBudget(
    findingsFor("skill", skillWithBodyTokens(5001)),
    "QUAL-SKILL-TOKEN-BUDGET",
  );
  assert.equal(aboveWarning?.severity, "medium");
  assert.deepEqual(aboveWarning?.details, {
    measured: 5001,
    warningThreshold: 5000,
    highThreshold: 8000,
    triggeredThreshold: 5000,
    effectiveSeverity: "medium",
    overBy: 1,
    overPercent: 0,
    unit: "estimated_tokens",
    profile: RENMA_QUALITY_PROFILE_VERSION,
    measurement: "markdown_body_after_frontmatter",
    sectionMeasurement: "markdown_body_sections",
    sectionCandidates: [],
    policySource: "renma_defaults",
    thresholdSources: {
      warning: "renma_default",
      high: "renma_default",
    },
  });

  const atHigh = findBudget(
    findingsFor("skill", skillWithBodyTokens(8000)),
    "QUAL-SKILL-TOKEN-BUDGET",
  );
  assert.equal(atHigh?.severity, "medium");
  assert.equal(atHigh?.details?.triggeredThreshold, 5000);
  assert.equal(atHigh?.details?.measured, 8000);

  const aboveHigh = findBudget(
    findingsFor("skill", skillWithBodyTokens(8001)),
    "QUAL-SKILL-TOKEN-BUDGET",
  );
  assert.equal(aboveHigh?.severity, "high");
  assert.equal(aboveHigh?.details?.triggeredThreshold, 8000);
  assert.equal(aboveHigh?.details?.overBy, 1);
  assert.equal(aboveHigh?.details?.overPercent, 0);
  assert.equal("limit" in (aboveHigh?.details ?? {}), false);
  assert.equal(estimateTokens(markdownBody(skillWithBodyTokens(8001))), 8001);
});

test("Skill budgets use custom effective thresholds without changing defaults", () => {
  const config = qualityConfig(3000, 6000);
  const atWarning = findingsFor("skill", skillWithBodyTokens(3000), config);
  const aboveWarning = findBudget(
    findingsFor("skill", skillWithBodyTokens(3001), config),
    "QUAL-SKILL-TOKEN-BUDGET",
  );
  const atHigh = findBudget(
    findingsFor("skill", skillWithBodyTokens(6000), config),
    "QUAL-SKILL-TOKEN-BUDGET",
  );
  const aboveHigh = findBudget(
    findingsFor("skill", skillWithBodyTokens(6001), config),
    "QUAL-SKILL-TOKEN-BUDGET",
  );

  assert.equal(findBudget(atWarning, "QUAL-SKILL-TOKEN-BUDGET"), undefined);
  assert.equal(aboveWarning?.severity, "medium");
  assert.equal(atHigh?.severity, "medium");
  assert.equal(aboveHigh?.severity, "high");
  assert.deepEqual(aboveHigh?.details?.thresholdSources, {
    warning: "repository_configuration",
    high: "repository_configuration",
  });
  assert.equal(aboveHigh?.details?.policySource, "repository_configuration");
  assert.equal(DEFAULT_QUALITY_PROFILE.skillTokenWarning, 5000);
  assert.equal(DEFAULT_QUALITY_PROFILE.skillTokenHigh, 8000);
});

test("Skill budget details identify independently defaulted threshold policy", () => {
  const config: ScanConfig = {
    ...DEFAULT_CONFIG,
    quality: {
      ...DEFAULT_CONFIG.quality,
      skillTokenWarning: 4000,
      skillTokenHigh: 8000,
      skillTokenWarningSource: "repository_configuration",
      skillTokenHighSource: "renma_default",
    },
  };
  const finding = findBudget(
    findingsFor("skill", skillWithBodyTokens(4001), config),
    "QUAL-SKILL-TOKEN-BUDGET",
  );

  assert.equal(finding?.details?.warningThreshold, 4000);
  assert.equal(finding?.details?.highThreshold, 8000);
  assert.equal(finding?.details?.policySource, "mixed");
  assert.deepEqual(finding?.details?.thresholdSources, {
    warning: "repository_configuration",
    high: "renma_default",
  });
});

test("content budgets use the shared estimator at each exact boundary", () => {
  for (const [kind, warning] of Object.entries(
    DEFAULT_QUALITY_PROFILE.contentTokenWarning,
  ) as Array<["context" | "reference" | "profile" | "example", number]>) {
    const high = DEFAULT_QUALITY_PROFILE.contentTokenHigh[kind];
    assert.equal(
      findBudget(
        findingsFor(kind, fillerTokens(warning)),
        "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
      ),
      undefined,
    );
    const aboveWarning = findBudget(
      findingsFor(kind, fillerTokens(warning + 1)),
      "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
    );
    assert.equal(aboveWarning?.severity, "medium");
    assert.equal(aboveWarning?.details?.measured, warning + 1);
    assert.equal(aboveWarning?.details?.effectiveWarningThreshold, warning);
    assert.equal(aboveWarning?.details?.effectiveHighThreshold, high);
    assert.equal(aboveWarning?.details?.triggeredThreshold, warning);
    assert.equal(aboveWarning?.details?.effectiveSeverity, "medium");
    assert.equal(aboveWarning?.details?.limit, warning);
    assert.equal(aboveWarning?.details?.overBy, 1);
    assert.equal(aboveWarning?.details?.overPercent, 0);
    assert.equal(aboveWarning?.details?.unit, "estimated_tokens");
    assert.equal(aboveWarning?.details?.profile, RENMA_QUALITY_PROFILE_VERSION);
    assert.equal(aboveWarning?.details?.measurement, "full_file");
    assert.equal(
      aboveWarning?.details?.sectionMeasurement,
      "markdown_body_sections",
    );
    assert.deepEqual(aboveWarning?.details?.sectionCandidates, []);
    const atHigh = findBudget(
      findingsFor(kind, fillerTokens(high)),
      "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
    );
    const aboveHigh = findBudget(
      findingsFor(kind, fillerTokens(high + 1)),
      "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
    );
    assert.equal(atHigh?.severity, "medium");
    assert.equal(aboveHigh?.severity, "high");
    assert.equal(aboveHigh?.details?.triggeredThreshold, high);
    assert.equal(aboveHigh?.details?.limit, high);
    assert.equal(aboveHigh?.details?.overBy, 1);
  }
});

test("custom Skill thresholds do not change Context or support-asset budgets", () => {
  const config = qualityConfig(1000, 2000);
  for (const [kind, limit] of Object.entries(
    DEFAULT_QUALITY_PROFILE.contentTokenWarning,
  ) as Array<["context" | "reference" | "profile" | "example", number]>) {
    const finding = findBudget(
      findingsFor(kind, fillerTokens(limit + 1), config),
      "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
    );
    assert.equal(finding?.details?.defaultLimit, limit, kind);
    assert.equal(finding?.details?.effectiveLimit, limit, kind);
    assert.equal(finding?.details?.limit, limit, kind);
  }
});

test("content budgets use custom Medium and High thresholds independently", () => {
  for (const kind of ["context", "reference", "profile", "example"] as const) {
    const config = contentQualityConfig(kind, 100, 200);
    assert.equal(
      findBudget(
        findingsFor(kind, fillerTokens(100), config),
        "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
      ),
      undefined,
    );
    const medium = findBudget(
      findingsFor(kind, fillerTokens(101), config),
      "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
    );
    const high = findBudget(
      findingsFor(kind, fillerTokens(201), config),
      "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
    );
    assert.equal(medium?.severity, "medium", kind);
    assert.equal(high?.severity, "high", kind);
    assert.equal(high?.details?.repositoryWarningThreshold, 100, kind);
    assert.equal(high?.details?.repositoryHighThreshold, 200, kind);
    assert.equal(high?.details?.policySource, "repository_configuration", kind);
  }
});

function skillWithBodyTokens(count: number): string {
  return `---\nname: demo\ndescription: Review files. Use when a repository needs review.\n---\n${fillerTokens(count)}`;
}

function fillerTokens(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

function findingsFor(
  kind: ArtifactKind,
  content: string,
  config: ScanConfig = DEFAULT_CONFIG,
) {
  const path = kind === "skill" ? "skills/demo/SKILL.md" : artifactPath(kind);
  const artifact: Artifact = {
    path,
    absolutePath: `/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
  return runRules([parseDocument(artifact)], config);
}

function qualityConfig(warning: number, high: number): ScanConfig {
  return {
    ...DEFAULT_CONFIG,
    quality: {
      ...DEFAULT_CONFIG.quality,
      skillTokenWarning: warning,
      skillTokenHigh: high,
      skillTokenWarningSource: "repository_configuration",
      skillTokenHighSource: "repository_configuration",
    },
  };
}

function contentQualityConfig(
  kind: "context" | "reference" | "profile" | "example",
  warning: number,
  high: number,
): ScanConfig {
  return {
    ...DEFAULT_CONFIG,
    quality: {
      ...DEFAULT_CONFIG.quality,
      contentTokenBudgets: {
        ...DEFAULT_CONFIG.quality.contentTokenBudgets,
        [kind]: {
          warning,
          high,
          warningSource: "repository_configuration",
          highSource: "repository_configuration",
        },
      },
    },
  };
}

function artifactPath(kind: ArtifactKind): string {
  if (kind === "context") return "contexts/demo.md";
  return `skills/demo/${kind}s/demo.md`;
}

function findBudget(findings: ReturnType<typeof findingsFor>, id: string) {
  return findings.find((finding) => finding.id === id);
}
