type CiPolicyMode = "off" | "warn" | "fail";

const MODE_RANK: Record<CiPolicyMode, number> = {
  off: 0,
  warn: 1,
  fail: 2,
};

// Policy evaluators compose these operations independently. Matching evidence,
// reporting mode changes, and retaining disabled-policy evidence stay local.

/** Select the stricter archived endpoint so the target cannot disable review. */
export function stricterCiMode(
  from: CiPolicyMode,
  to: CiPolicyMode,
): CiPolicyMode {
  return MODE_RANK[from] >= MODE_RANK[to] ? from : to;
}

export function ciModeTransitionDirection(
  from: CiPolicyMode,
  to: CiPolicyMode,
): "unchanged" | "weakening" | "tightening" {
  if (from === to) return "unchanged";
  return MODE_RANK[from] > MODE_RANK[to] ? "weakening" : "tightening";
}

export function ciPolicyOutcome(
  effective: CiPolicyMode,
  matchCount: number,
): "pass" | "warn" | "fail" {
  return effective === "off" || matchCount === 0 ? "pass" : effective;
}
