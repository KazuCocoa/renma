import type { RiskClass, Severity } from "./types.js";

const RISK_CLASS_ORDER: Record<RiskClass, number> = {
  advisory: 1,
  suspicious: 2,
  violation: 3,
};

const SEVERITY_ORDER: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface SecurityPostureSummary {
  totalSecurityFindings: number;
  riskClasses: {
    violation: number;
    suspicious: number;
    advisory: number;
    unclassified: number;
  };
  severities: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  highOrCritical: number;
  topFindingIds: Array<{
    id: string;
    count: number;
    riskClass?: RiskClass | undefined;
    maxSeverity: Severity;
  }>;
}

export interface SecurityPostureFindingLike {
  id: string;
  severity: string;
  riskClass?: string | undefined;
}

interface TopFindingAccumulator {
  id: string;
  count: number;
  riskClass?: RiskClass | undefined;
  maxSeverity?: Severity | undefined;
}

export function summarizeSecurityPosture(
  findings: SecurityPostureFindingLike[],
): SecurityPostureSummary {
  const summary = zeroSecurityPostureSummary();
  const topFindings = new Map<string, TopFindingAccumulator>();

  for (const finding of findings) {
    if (!isSecurityFinding(finding)) continue;

    const riskClass = normalizeRiskClass(finding.riskClass);
    const severity = normalizeSeverity(finding.severity);

    summary.totalSecurityFindings += 1;
    if (riskClass === undefined) {
      summary.riskClasses.unclassified += 1;
    } else {
      summary.riskClasses[riskClass] += 1;
    }

    if (severity !== undefined) {
      summary.severities[severity] += 1;
    }

    const topFinding = topFindings.get(finding.id) ?? {
      id: finding.id,
      count: 0,
    };
    topFinding.count += 1;
    if (
      riskClass !== undefined &&
      (topFinding.riskClass === undefined ||
        RISK_CLASS_ORDER[riskClass] > RISK_CLASS_ORDER[topFinding.riskClass])
    ) {
      topFinding.riskClass = riskClass;
    }
    if (
      severity !== undefined &&
      (topFinding.maxSeverity === undefined ||
        compareSeverity(severity, topFinding.maxSeverity) > 0)
    ) {
      topFinding.maxSeverity = severity;
    }
    topFindings.set(finding.id, topFinding);
  }

  summary.highOrCritical =
    summary.severities.high + summary.severities.critical;
  summary.topFindingIds = [...topFindings.values()]
    .map((finding) => ({
      id: finding.id,
      count: finding.count,
      ...(finding.riskClass ? { riskClass: finding.riskClass } : {}),
      maxSeverity: finding.maxSeverity ?? "low",
    }))
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      const severityComparison = compareSeverity(
        right.maxSeverity,
        left.maxSeverity,
      );
      if (severityComparison !== 0) return severityComparison;
      return left.id.localeCompare(right.id);
    })
    .slice(0, 10);

  return summary;
}

export function isSecurityFinding(
  finding: SecurityPostureFindingLike,
): boolean {
  return (
    finding.id.startsWith("SEC-") ||
    normalizeRiskClass(finding.riskClass) !== undefined
  );
}

export function normalizeRiskClass(
  value: string | undefined,
): RiskClass | undefined {
  if (value === "violation" || value === "suspicious" || value === "advisory") {
    return value;
  }
  return undefined;
}

export function normalizeSeverity(
  value: string | undefined,
): Severity | undefined {
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  ) {
    return value;
  }
  return undefined;
}

export function compareSeverity(left: Severity, right: Severity): number {
  return SEVERITY_ORDER[left] - SEVERITY_ORDER[right];
}

export function zeroSecurityPostureSummary(): SecurityPostureSummary {
  return {
    totalSecurityFindings: 0,
    riskClasses: {
      violation: 0,
      suspicious: 0,
      advisory: 0,
      unclassified: 0,
    },
    severities: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    highOrCritical: 0,
    topFindingIds: [],
  };
}
