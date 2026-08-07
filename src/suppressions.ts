import type {
  Diagnostic,
  Finding,
  SuppressionConfig,
  SuppressedFindingEvidence,
} from "./types/diagnostics.js";

/** Apply active suppressions while retaining an auditable ledger of every match. */
export function applySuppressions(
  findings: Finding[],
  suppressions: SuppressionConfig[],
  today = new Date(),
): {
  findings: Finding[];
  suppressedFindings: SuppressedFindingEvidence[];
  diagnostics: Diagnostic[];
} {
  if (suppressions.length === 0) {
    return { findings, suppressedFindings: [], diagnostics: [] };
  }

  const todayKey = today.toISOString().slice(0, 10);
  const diagnostics = expiredSuppressionDiagnostics(suppressions, todayKey);
  const activeSuppressions = suppressions
    .filter((suppression) => !isExpired(suppression, todayKey))
    .sort(compareSuppressions);
  const retained: Finding[] = [];
  const suppressedFindings: SuppressedFindingEvidence[] = [];
  for (const finding of findings) {
    const match = firstSuppressionMatch(finding, activeSuppressions);
    if (!match) {
      retained.push(finding);
      continue;
    }
    suppressedFindings.push({
      suppression: {
        id: match.suppression.id,
        matchedPath: match.matchedPath,
        reason: match.suppression.reason,
        expires: match.suppression.expires ?? "never",
      },
      finding,
    });
  }

  return {
    findings: retained,
    suppressedFindings,
    diagnostics,
  };
}

function firstSuppressionMatch(
  finding: Finding,
  suppressions: readonly SuppressionConfig[],
): { suppression: SuppressionConfig; matchedPath: string } | undefined {
  for (const suppression of suppressions) {
    if (finding.id !== suppression.id) continue;
    const matchedPath = [...suppression.paths]
      .map(normalizePath)
      .sort((left, right) => left.localeCompare(right))
      .find((pattern) => pathPatternMatches(pattern, finding.evidence.path));
    if (matchedPath !== undefined) return { suppression, matchedPath };
  }
  return undefined;
}

function expiredSuppressionDiagnostics(
  suppressions: SuppressionConfig[],
  todayKey: string,
): Diagnostic[] {
  return suppressions
    .filter((suppression) => isExpired(suppression, todayKey))
    .map((suppression) => ({
      severity: "warning",
      message: `Suppression for ${suppression.id} expired on ${suppression.expires}. Matching findings are active.`,
    }));
}

function isExpired(suppression: SuppressionConfig, todayKey: string): boolean {
  return (
    suppression.expires !== undefined &&
    suppression.expires !== "never" &&
    suppression.expires < todayKey
  );
}

/** Match suppression path patterns against normalized repository paths. */
export function pathPatternMatches(
  pattern: string,
  relativePath: string,
): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(relativePath);
  if (normalizedPattern === normalizedPath) return true;
  if (!hasGlob(normalizedPattern)) {
    return normalizedPath.startsWith(`${normalizedPattern}/`);
  }
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] as string;
    const next = pattern[index + 1];
    if (character === "*" && next === "*") {
      const previous = pattern[index - 1];
      const after = pattern[index + 2];
      if (previous === "/" && after === "/") {
        source += "(?:[^/]+/)*";
        index += 2;
      } else if (previous === "/" && after === undefined) {
        source += ".*";
        index += 1;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(character);
    }
  }
  return new RegExp(`^${source}$`);
}

function hasGlob(pattern: string): boolean {
  return pattern.includes("*");
}

function normalizePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function compareSuppressions(
  left: SuppressionConfig,
  right: SuppressionConfig,
): number {
  return (
    left.id.localeCompare(right.id) ||
    [...left.paths]
      .sort()
      .join("\0")
      .localeCompare([...right.paths].sort().join("\0")) ||
    (left.expires ?? "never").localeCompare(right.expires ?? "never") ||
    left.reason.localeCompare(right.reason)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
