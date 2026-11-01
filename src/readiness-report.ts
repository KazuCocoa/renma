import type { ContextLensSummary } from "./context-lens.js";
import type { SecurityPostureSummary } from "./security-posture.js";
import type { SecurityPolicyInventorySummary } from "./security-policy-inventory.js";
import type { SkillDiscoveryAdoptionState } from "./skill-discovery.js";
import type { Diagnostic, Finding } from "./types/diagnostics.js";

export const READINESS_JSON_SCHEMA_VERSION = "renma.readiness.v2" as const;

export type ReadinessLevel = "ready" | "needs_attention" | "not_ready";
export type ReadinessCheckStatus = "pass" | "warn" | "fail";
type ReadinessCheckSeverity = "info" | "warning" | "error";

export interface WorkflowReadinessSummary {
  skillEntrypoints: number;
  checks: number;
  pass: number;
  warn: number;
  fail: number;
  readinessPercent: number;
}

/** Compact repository-wide projection over one prepared Skill Discovery index. */
export interface SkillDiscoveryReadinessSummary {
  adoptionState: SkillDiscoveryAdoptionState;
  publishedEntrypointCount: number;
  routeEligibleSkillCount: number;
  reachableSkillCount: number;
  notReachedSkillCount: number;
  unroutedSkillCount: number;
  usableRouteCount: number;
  unusableRouteCount: number;
  unresolvedRouteCount: number;
  cycleComponentCount: number;
}

export interface ReadinessReport {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  score: number;
  level: ReadinessLevel;
  summary: {
    totalAssets: number;
    ownedAssets: number;
    unownedAssets: number;
    ownershipCoveragePercent: number;
    nodeCount: number;
    edgeCount: number;
    resolvedEdges: number;
    unresolvedEdges: number;
    graphResolutionPercent: number;
    diagnosticCounts: {
      error: number;
      warning: number;
      info: number;
    };
    workflow: WorkflowReadinessSummary;
    contextLens: ContextLensSummary;
    securityPosture: SecurityPostureSummary;
    securityPolicyInventory: SecurityPolicyInventorySummary;
    skillDiscovery: SkillDiscoveryReadinessSummary;
  };
  checks: ReadinessCheck[];
  diagnostics?: Diagnostic[];
  findings?: Finding[];
}

export interface ReadinessCheck {
  id: string;
  title: string;
  status: ReadinessCheckStatus;
  severity: ReadinessCheckSeverity;
  summary: string;
  evidence?: Array<{
    id?: string;
    path?: string;
    message?: string;
  }>;
}
