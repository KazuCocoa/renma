import packageJson from "../package.json" with { type: "json" };

/**
 * Renma's versioned deterministic quality policy.
 *
 * These values are Renma advisories unless a field is explicitly grouped
 * under `agentSkills`. They are deliberately internal in 0.18.0: repositories
 * cannot override them through renma.config.json yet.
 */
export const RENMA_QUALITY_PROFILE_VERSION =
  `renma-quality@${packageJson.version}` as const;

export const DEFAULT_QUALITY_PROFILE = {
  profile: RENMA_QUALITY_PROFILE_VERSION,
  descriptionMinChars: 0,
  skillTokenWarn: 2_000,
  skillTokenStrongWarn: 5_000,
  contentTokenWarn: {
    context: 4_000,
    reference: 5_000,
    profile: 2_000,
    example: 2_500,
  },
  frontmatterMaxLines: 48,
  frontmatterMaxChars: 4_096,
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
    minTokens: 1_200,
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
    descriptionMaxChars: 1_024,
    compatibilityMaxChars: 500,
    skillBodyRecommendedMaxTokens: 5_000,
    skillRecommendedMaxLines: 500,
    recommendedReferenceDepth: 1,
  },
  scan: {
    defaultMaxFileSizeBytes: 512 * 1_024,
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
} as const;

export type QualityProfile = typeof DEFAULT_QUALITY_PROFILE;
