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
  layout: LayoutPolicyConfig;
  security: SecurityConfig;
  skillDiscovery: SkillDiscoveryConfig;
}

/** Loaded configuration plus the path it came from, when applicable. */
export interface LoadedConfig {
  config: ScanConfig;
  configPath?: string;
}
