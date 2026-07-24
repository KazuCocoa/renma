import type { Severity, SuppressionConfig } from "./diagnostics.js";

/** Compatibility-only layout input retained without forcing local migration. */
export interface LayoutPolicyConfig {
  toolNamespace?: string;
  workflowAliases: Record<string, string>;
}

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
}

export type SkillDiscoveryCiPolicyMode = "off" | "warn";

export interface SkillDiscoveryConfig {
  adopted: boolean;
  ciPolicy: SkillDiscoveryCiPolicyMode;
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
  layout: LayoutPolicyConfig;
  security: SecurityConfig;
  skillDiscovery: SkillDiscoveryConfig;
}

/** Loaded configuration plus the path it came from, when applicable. */
export interface LoadedConfig {
  config: ScanConfig;
  configPath?: string;
}
