import type {
  CanonicalSuppressionEvidence,
  ScanBoundaryEvidence,
} from "./scan-boundary.js";

export type ScanBoundaryChangeDirection = "weakening" | "tightening";

export type ScanBoundaryChange =
  | {
      kind: "glob";
      direction: ScanBoundaryChangeDirection;
      change: "added" | "removed";
      pattern: string;
    }
  | {
      kind: "exclusion";
      direction: ScanBoundaryChangeDirection;
      change: "added" | "removed";
      pattern: string;
    }
  | {
      kind: "limit";
      direction: ScanBoundaryChangeDirection;
      property: "maxFileSizeBytes" | "maxDepth";
      from: number;
      to: number;
    }
  | {
      kind: "suppression";
      direction: ScanBoundaryChangeDirection;
      change: "added" | "removed" | "lifetime_extended" | "lifetime_shortened";
      suppression: {
        id: string;
        path: string;
        reason: string;
        fromExpires: string | null;
        toExpires: string | null;
      };
    };

export interface ScanBoundaryDiff {
  schemaVersion: "renma.scan-boundary-diff.v1";
  from: ScanBoundaryEvidence;
  to: ScanBoundaryEvidence;
  changes: ScanBoundaryChange[];
}

export function buildScanBoundaryDiff(
  from: ScanBoundaryEvidence,
  to: ScanBoundaryEvidence,
): ScanBoundaryDiff {
  const changes: ScanBoundaryChange[] = [
    ...patternChanges(from.globs, to.globs, "glob"),
    ...patternChanges(from.exclude, to.exclude, "exclusion"),
    ...limitChanges(from, to),
    ...suppressionChanges(from.activeSuppressions, to.activeSuppressions),
  ].sort(compareChanges);
  return {
    schemaVersion: "renma.scan-boundary-diff.v1",
    from,
    to,
    changes,
  };
}

function patternChanges(
  from: readonly string[],
  to: readonly string[],
  kind: "glob" | "exclusion",
): ScanBoundaryChange[] {
  const fromSet = new Set(from);
  const toSet = new Set(to);
  return [
    ...from
      .filter((pattern) => !toSet.has(pattern))
      .map((pattern): ScanBoundaryChange => ({
        kind,
        direction: kind === "glob" ? "weakening" : "tightening",
        change: "removed",
        pattern,
      })),
    ...to
      .filter((pattern) => !fromSet.has(pattern))
      .map((pattern): ScanBoundaryChange => ({
        kind,
        direction: kind === "glob" ? "tightening" : "weakening",
        change: "added",
        pattern,
      })),
  ];
}

function limitChanges(
  from: ScanBoundaryEvidence,
  to: ScanBoundaryEvidence,
): ScanBoundaryChange[] {
  return (["maxDepth", "maxFileSizeBytes"] as const).flatMap((property) =>
    from[property] === to[property]
      ? []
      : [
          {
            kind: "limit" as const,
            direction:
              to[property] < from[property] ? "weakening" : "tightening",
            property,
            from: from[property],
            to: to[property],
          },
        ],
  );
}

interface SuppressionScope {
  id: string;
  path: string;
  reason: string;
  expires: string;
}

function suppressionChanges(
  from: readonly CanonicalSuppressionEvidence[],
  to: readonly CanonicalSuppressionEvidence[],
): ScanBoundaryChange[] {
  const fromScopes = suppressionScopes(from);
  const toScopes = suppressionScopes(to);
  const keys = [...new Set([...fromScopes.keys(), ...toScopes.keys()])].sort(
    (left, right) => left.localeCompare(right),
  );
  return keys.flatMap((key): ScanBoundaryChange[] => {
    const previous = fromScopes.get(key);
    const next = toScopes.get(key);
    if (!previous && next) {
      return [suppressionChange("weakening", "added", null, next)];
    }
    if (previous && !next) {
      return [suppressionChange("tightening", "removed", previous, null)];
    }
    if (!previous || !next || previous.expires === next.expires) return [];
    const extended =
      expirationRank(next.expires) > expirationRank(previous.expires);
    return [
      suppressionChange(
        extended ? "weakening" : "tightening",
        extended ? "lifetime_extended" : "lifetime_shortened",
        previous,
        next,
      ),
    ];
  });
}

function suppressionScopes(
  suppressions: readonly CanonicalSuppressionEvidence[],
): Map<string, SuppressionScope> {
  const scopes = new Map<string, SuppressionScope>();
  for (const suppression of suppressions) {
    for (const path of suppression.paths) {
      const scope = {
        id: suppression.id,
        path,
        reason: suppression.reason,
        expires: suppression.expires,
      };
      const key = `${scope.id}\0${scope.path}`;
      const existing = scopes.get(key);
      if (
        !existing ||
        expirationRank(scope.expires) > expirationRank(existing.expires)
      ) {
        scopes.set(key, scope);
      }
    }
  }
  return scopes;
}

function suppressionChange(
  direction: ScanBoundaryChangeDirection,
  change: Extract<ScanBoundaryChange, { kind: "suppression" }>["change"],
  from: SuppressionScope | null,
  to: SuppressionScope | null,
): ScanBoundaryChange {
  const evidence = to ?? from!;
  return {
    kind: "suppression",
    direction,
    change,
    suppression: {
      id: evidence.id,
      path: evidence.path,
      reason: evidence.reason,
      fromExpires: from?.expires ?? null,
      toExpires: to?.expires ?? null,
    },
  };
}

function expirationRank(expires: string): number {
  return expires === "never"
    ? Number.POSITIVE_INFINITY
    : Date.parse(`${expires}T00:00:00.000Z`);
}

function compareChanges(
  left: ScanBoundaryChange,
  right: ScanBoundaryChange,
): number {
  return changeKey(left).localeCompare(changeKey(right));
}

function changeKey(change: ScanBoundaryChange): string {
  if (change.kind === "glob" || change.kind === "exclusion") {
    return `${change.kind}\0${change.change}\0${change.pattern}`;
  }
  if (change.kind === "limit") {
    return `${change.kind}\0${change.property}\0${change.from}\0${change.to}`;
  }
  return `${change.kind}\0${change.change}\0${change.suppression.id}\0${change.suppression.path}\0${change.suppression.fromExpires}\0${change.suppression.toExpires}`;
}
