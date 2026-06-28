import type { Diagnostic, Finding, SuppressionConfig } from "./types.js";

/** Apply active config suppressions to findings without removing them. */
export function applySuppressions(
  findings: Finding[],
  suppressions: SuppressionConfig[],
  today = new Date(),
): { findings: Finding[]; diagnostics: Diagnostic[] } {
  if (suppressions.length === 0) {
    return { findings, diagnostics: [] };
  }

  const todayKey = today.toISOString().slice(0, 10);
  const diagnostics = expiredSuppressionDiagnostics(suppressions, todayKey);
  const activeSuppressions = suppressions.filter(
    (suppression) => !isExpired(suppression, todayKey),
  );

  return {
    findings: findings.map((finding) => {
      const suppression = activeSuppressions.find((candidate) =>
        matchesSuppression(finding, candidate),
      );
      if (!suppression) return finding;
      return {
        ...finding,
        suppression: {
          reason: suppression.reason,
          paths: suppression.paths,
          ...(suppression.expires === undefined
            ? {}
            : { expires: suppression.expires }),
        },
      };
    }),
    diagnostics,
  };
}

/** Return true when a finding is active for CI/status decisions. */
export function isActiveFinding(finding: Finding): boolean {
  return finding.suppression === undefined;
}

function matchesSuppression(
  finding: Finding,
  suppression: SuppressionConfig,
): boolean {
  return (
    finding.id === suppression.id &&
    suppression.paths.some((pattern) =>
      pathPatternMatches(pattern, finding.evidence.path),
    )
  );
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
