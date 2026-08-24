import type { SecurityGuardEvidence } from "../markdown-security-view.js";
import type {
  DependencyEcosystem,
  DependencySelectorKind,
  FloatingDependencyAllowance,
} from "../dependency-selectors.js";
import type {
  DestinationAnalysis,
  SourceSpan,
} from "../security-destination/types.js";

export type SecuritySourceEvidence = {
  text: string;
  startLine: number;
  endLine: number;
  lines: readonly string[];
  language?: string;
};

export type DependencyPinningKind =
  | "pinned-literal"
  | "floating-literal"
  | "pinned-variable-guarded"
  | "variable-unverified"
  | "unpinned";

export type DependencyInstallAnalysis = {
  ecosystem: DependencyEcosystem;
  packageManager: "npm" | "pnpm" | "yarn" | "pip" | "uv";
  packageName?: string;
  normalizedPackageName?: string;
  reference: string;
  selector: string;
  selectorKind: DependencySelectorKind;
  pinning: DependencyPinningKind;
  variableNames: readonly string[];
  floatingAllowed: boolean;
  allowance?: Readonly<FloatingDependencyAllowance>;
  sourceSpan: SourceSpan;
};

export type SensitiveSourceKind =
  | "environment-file"
  | "private-key-file"
  | "certificate-or-signing-file"
  | "credential-store"
  | "cloud-credential-file"
  | "other-sensitive-file"
  | "environment-variable-api";

export type SensitiveSourceAnalysis = {
  kind: SensitiveSourceKind;
  raw: string;
  sourceSpan: SourceSpan;
};

export type SensitiveSinkKind =
  | "local-file"
  | "stdout-or-log"
  | "prompt-or-context"
  | "network"
  | "external-upload"
  | "unknown";

export type SensitiveSinkAnalysis = {
  kind: SensitiveSinkKind;
  raw: string;
  sourceSpan?: SourceSpan;
};

export type SecurityCommandSupport = "supported" | "fallback-required";

export type SecurityCommandAnalysis = {
  source: Readonly<SecuritySourceEvidence>;
  language?: string;
  guards: readonly Readonly<SecurityGuardEvidence>[];
  dependencyInstalls: readonly Readonly<DependencyInstallAnalysis>[];
  sensitiveSources: readonly Readonly<SensitiveSourceAnalysis>[];
  sinks: readonly Readonly<SensitiveSinkAnalysis>[];
  destinationAnalysis: DestinationAnalysis;
  dependencyInstallCommand: boolean;
  npmStyleInstallCommand: boolean;
  noDisclosureGuards: readonly Readonly<SecurityGuardEvidence>[];
  localOnlySensitiveOperation: boolean;
  support: SecurityCommandSupport;
  fallbackReasons: readonly string[];
};

export type SecurityCommandInput = {
  source: SecuritySourceEvidence;
  guards?: readonly SecurityGuardEvidence[];
  destinationAnalysis?: DestinationAnalysis;
  allowedFloatingDependencies?: readonly FloatingDependencyAllowance[];
};
