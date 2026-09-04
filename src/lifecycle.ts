import type { AssetStatus } from "./model.js";

export type InactiveLifecycleStatus = Extract<
  AssetStatus,
  "suspended" | "revoked" | "deprecated" | "archived"
>;

const DECLARED_ACTIVE_LIFECYCLE_STATUSES = new Set<AssetStatus>([
  "experimental",
  "stable",
]);
const INACTIVE_LIFECYCLE_STATUSES = new Set<InactiveLifecycleStatus>([
  "suspended",
  "revoked",
  "deprecated",
  "archived",
]);

/** Whether an explicitly declared lifecycle status represents active use. */
export function isDeclaredActiveLifecycleStatus(
  status: AssetStatus | undefined,
): boolean {
  return status !== undefined && DECLARED_ACTIVE_LIFECYCLE_STATUSES.has(status);
}

/** Whether an explicitly declared lifecycle status is inactive for use. */
export function isInactiveLifecycleStatus(
  status: AssetStatus | undefined,
): status is InactiveLifecycleStatus {
  return (
    status !== undefined &&
    INACTIVE_LIFECYCLE_STATUSES.has(status as InactiveLifecycleStatus)
  );
}

/** Whether trust or authorization for use was explicitly withdrawn. */
export function isRevokedLifecycleStatus(
  status: AssetStatus | undefined,
): status is "revoked" {
  return status === "revoked";
}

/**
 * Whether an asset remains use-eligible under the established lifecycle
 * contract. An omitted status remains usable for backward compatibility.
 */
export function isLifecycleUsable(status: AssetStatus | undefined): boolean {
  return !isInactiveLifecycleStatus(status);
}
