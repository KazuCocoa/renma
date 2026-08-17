import type { Severity, SuppressionConfig } from "./diagnostics.js";
import type { RequiredMetadataPolicyField } from "../metadata-definitions.js";

/** Compatibility-only layout input retained without forcing local migration. */
export interface LayoutPolicyConfig {
  toolNamespace?: string;
  workflowAliases: Record<string, string>;
}

/** Normalized runtime projection; authored config uses the exact v1 keys documented in the Security Policy Guide. */
export interface SecurityProfileConfig {
  allowedDataClass?: string | undefined;
  networkAllowed?: boolean | undefined;
  externalUploadAllowed?: boolean | undefined;
  secretsAllowed?: boolean | undefined;
  humanApprovalRequired?: boolean | undefined;
  securityProfile?: string | undefined;
  allowedData: string[];
  forbiddenInputs: string[];
  approvedDomains: string[];
  approvedUploadDomains: string[];
  disallowedCommands: string[];
}

export interface SecurityConfig {
  approvedDomains: string[];
  approvedUploadDomains: string[];
  disallowedCommands: string[];
  profiles?: Record<string, SecurityProfileConfig> | undefined;
  /** CI review mode for effective security-policy relaxations. Defaults to fail. */
  ciPolicy?: SecurityCiPolicyMode | undefined;
}

export type SecurityCiPolicyMode = "off" | "warn" | "fail";

export type ScanBoundaryCiPolicyMode = "off" | "warn" | "fail";

export interface ScanBoundaryConfig {
  /** CI review mode for evidence-boundary weakening. Defaults to fail. */
  ciPolicy: ScanBoundaryCiPolicyMode;
}

export type ExecutableSurfaceCiPolicyMode = "off" | "warn" | "fail";

export interface ExecutableSurfaceConfig {
  /** CI review mode for high-signal executable-surface changes. Defaults to off. */
  ciPolicy: ExecutableSurfaceCiPolicyMode;
}

export type SkillDiscoveryCiPolicyMode = "off" | "warn";

export interface SkillDiscoveryConfig {
  adopted: boolean;
  ciPolicy: SkillDiscoveryCiPolicyMode;
}

export type QualityThresholdSource =
  "renma_default" | "repository_configuration";

export type QualityCiPolicyMode = "off" | "warn" | "fail";

export type ContentTokenBudgetKind =
  "context" | "reference" | "profile" | "example";

export interface ContentTokenBudgetConfig {
  warning: number;
  high: number;
  warningSource: QualityThresholdSource;
  highSource: QualityThresholdSource;
}

/** Effective repository policy for governed Markdown token-budget diagnostics. */
export interface QualityConfig {
  /** CI review mode for token-budget threshold weakening. Defaults to fail. */
  ciPolicy: QualityCiPolicyMode;
  skillTokenWarning: number;
  skillTokenHigh: number;
  skillTokenWarningSource: QualityThresholdSource;
  skillTokenHighSource: QualityThresholdSource;
  contentTokenBudgets: Record<ContentTokenBudgetKind, ContentTokenBudgetConfig>;
}

export type MetadataCiPolicyMode = "off" | "warn" | "fail";
export type MetadataRequiredSource =
  "renma_default" | "repository_configuration";

/** Effective repository policy for explicitly declared catalog metadata. */
export interface MetadataConfig {
  /** CI review mode for required-field removal. Defaults to fail. */
  ciPolicy: MetadataCiPolicyMode;
  /** Registry-ordered fields that every applicable catalog asset must declare. */
  required: RequiredMetadataPolicyField[];
  /** Provenance of the required-field list, including an explicitly empty list. */
  requiredSource: MetadataRequiredSource;
}

/** Effective scan configuration after defaults, config files, and CLI overrides. */
export interface ScanConfig {
  failOn: Severity;
  format: "text" | "json";
  globs: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  maxDepth: number;
  concurrency: number;
  suppressions: SuppressionConfig[];
  scanBoundary: ScanBoundaryConfig;
  executableSurface: ExecutableSurfaceConfig;
  quality: QualityConfig;
  metadata: MetadataConfig;
  layout: LayoutPolicyConfig;
  security: SecurityConfig;
  skillDiscovery: SkillDiscoveryConfig;
}

/** Loaded configuration plus the path it came from, when applicable. */
export interface LoadedConfig {
  config: ScanConfig;
  configPath?: string;
}
