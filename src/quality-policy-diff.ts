import type {
  ContentTokenBudgetKind,
  QualityConfig,
  QualityThresholdSource,
} from "./types/configuration.js";

export const QUALITY_POLICY_DIFF_SCHEMA_VERSION =
  "renma.quality-policy-diff.v1" as const;

export type QualityPolicyAssetKind = "skill" | ContentTokenBudgetKind;
export type QualityPolicyThresholdType = "warning" | "high";
export type QualityPolicyChangeDirection = "weakening" | "tightening";

export interface QualityPolicyThresholdEndpoint {
  value: number;
  source: QualityThresholdSource;
}

export interface QualityPolicyThresholdChange {
  assetKind: QualityPolicyAssetKind;
  thresholdType: QualityPolicyThresholdType;
  configKey: string;
  direction: QualityPolicyChangeDirection;
  from: QualityPolicyThresholdEndpoint;
  to: QualityPolicyThresholdEndpoint;
}

export interface QualityPolicyDiff {
  schemaVersion: typeof QUALITY_POLICY_DIFF_SCHEMA_VERSION;
  changes: QualityPolicyThresholdChange[];
}

interface ThresholdDefinition {
  assetKind: QualityPolicyAssetKind;
  thresholdType: QualityPolicyThresholdType;
  configKey: string;
  endpoint: (quality: QualityConfig) => QualityPolicyThresholdEndpoint;
}

const CONTENT_KINDS = [
  "context",
  "reference",
  "profile",
  "example",
] as const satisfies readonly ContentTokenBudgetKind[];

const THRESHOLDS: readonly ThresholdDefinition[] = [
  {
    assetKind: "skill",
    thresholdType: "warning",
    configKey: "quality.skill_token_warning",
    endpoint: (quality) => ({
      value: quality.skillTokenWarning,
      source: quality.skillTokenWarningSource,
    }),
  },
  {
    assetKind: "skill",
    thresholdType: "high",
    configKey: "quality.skill_token_high",
    endpoint: (quality) => ({
      value: quality.skillTokenHigh,
      source: quality.skillTokenHighSource,
    }),
  },
  ...CONTENT_KINDS.flatMap((assetKind): ThresholdDefinition[] => [
    {
      assetKind,
      thresholdType: "warning",
      configKey: `quality.${assetKind}_token_warning`,
      endpoint: (quality) => ({
        value: quality.contentTokenBudgets[assetKind].warning,
        source: quality.contentTokenBudgets[assetKind].warningSource,
      }),
    },
    {
      assetKind,
      thresholdType: "high",
      configKey: `quality.${assetKind}_token_high`,
      endpoint: (quality) => ({
        value: quality.contentTokenBudgets[assetKind].high,
        source: quality.contentTokenBudgets[assetKind].highSource,
      }),
    },
  ]),
];

/** Compare all configurable token thresholds in stable policy order. */
export function buildQualityPolicyDiff(
  from: QualityConfig,
  to: QualityConfig,
): QualityPolicyDiff {
  const changes = THRESHOLDS.flatMap((threshold) => {
    const fromEndpoint = threshold.endpoint(from);
    const toEndpoint = threshold.endpoint(to);
    if (fromEndpoint.value === toEndpoint.value) return [];
    return [
      {
        assetKind: threshold.assetKind,
        thresholdType: threshold.thresholdType,
        configKey: threshold.configKey,
        direction:
          toEndpoint.value > fromEndpoint.value
            ? ("weakening" as const)
            : ("tightening" as const),
        from: fromEndpoint,
        to: toEndpoint,
      },
    ];
  });

  return {
    schemaVersion: QUALITY_POLICY_DIFF_SCHEMA_VERSION,
    changes,
  };
}
