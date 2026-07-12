import assert from "node:assert/strict";
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

test("quality profile pins every package-version default", () => {
  const expectedProfileVersion = `renma-quality@${packageJson.version}`;
  assert.equal(RENMA_QUALITY_PROFILE_VERSION, expectedProfileVersion);
  assert.deepEqual(DEFAULT_QUALITY_PROFILE, {
    profile: expectedProfileVersion,
    descriptionMinChars: 0,
    skillTokenWarn: 2000,
    skillTokenStrongWarn: 5000,
    contentTokenWarn: {
      context: 4000,
      reference: 5000,
      profile: 2000,
      example: 2500,
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
  const atLow = findingsFor("skill", skillWithBodyTokens(2000));
  assert.equal(findBudget(atLow, "QUAL-SKILL-TOKEN-BUDGET"), undefined);

  const aboveLow = findBudget(
    findingsFor("skill", skillWithBodyTokens(2001)),
    "QUAL-SKILL-TOKEN-BUDGET",
  );
  assert.equal(aboveLow?.severity, "low");
  assert.deepEqual(aboveLow?.details, {
    measured: 2001,
    limit: 2000,
    unit: "estimated_tokens",
    profile: RENMA_QUALITY_PROFILE_VERSION,
    measurement: "markdown_body_after_frontmatter",
    source: "renma_quality_policy",
  });

  const aboveStrong = findBudget(
    findingsFor("skill", skillWithBodyTokens(5001)),
    "QUAL-SKILL-TOKEN-BUDGET",
  );
  assert.equal(aboveStrong?.severity, "medium");
  assert.equal(aboveStrong?.details?.limit, 5000);
  assert.equal(estimateTokens(markdownBody(skillWithBodyTokens(5001))), 5001);
});

test("content budgets use the shared estimator at each exact boundary", () => {
  for (const [kind, limit] of Object.entries(
    DEFAULT_QUALITY_PROFILE.contentTokenWarn,
  ) as Array<["context" | "reference" | "profile" | "example", number]>) {
    assert.equal(
      findBudget(
        findingsFor(kind, fillerTokens(limit)),
        "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
      ),
      undefined,
    );
    const finding = findBudget(
      findingsFor(kind, fillerTokens(limit + 1)),
      "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
    );
    assert.equal(finding?.severity, "low");
    assert.equal(finding?.details?.measured, limit + 1);
    assert.equal(finding?.details?.limit, limit);
    assert.equal(finding?.details?.unit, "estimated_tokens");
    assert.equal(finding?.details?.profile, RENMA_QUALITY_PROFILE_VERSION);
    assert.equal(finding?.details?.measurement, "full_file");
  }
});

function skillWithBodyTokens(count: number): string {
  return `---\nname: demo\ndescription: Review files. Use when a repository needs review.\n---\n${fillerTokens(count)}`;
}

function fillerTokens(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

function findingsFor(kind: ArtifactKind, content: string) {
  const path = kind === "skill" ? "skills/demo/SKILL.md" : artifactPath(kind);
  const artifact: Artifact = {
    path,
    absolutePath: `/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    content,
  };
  return runRules([parseDocument(artifact)], DEFAULT_CONFIG);
}

function artifactPath(kind: ArtifactKind): string {
  if (kind === "context") return "contexts/demo.md";
  return `skills/demo/${kind}s/demo.md`;
}

function findBudget(findings: ReturnType<typeof findingsFor>, id: string) {
  return findings.find((finding) => finding.id === id);
}
