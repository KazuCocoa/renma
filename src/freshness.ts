const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_DURATION_PATTERN = /^P([1-9]\d*)D$/;
const MAX_REVIEW_CYCLE_DAYS =
  (Date.parse("9999-12-31T00:00:00.000Z") -
    Date.parse("0000-01-01T00:00:00.000Z")) /
  86_400_000;

export interface FreshnessMetadata {
  lastReviewedAt?: string;
  reviewCycle?: string;
  expiresAt?: string;
}

export interface AssetFreshnessEvaluation {
  expired: boolean;
  reviewOverdue: boolean;
  expiresAt?: string;
  reviewDueAt?: string;
}

/** Return today's date as a UTC ISO date string for deterministic comparisons. */
export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Validate strict YYYY-MM-DD dates, rejecting impossible calendar dates. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Parse the initially supported ISO 8601 day duration subset, such as P90D. */
export function parseDayDuration(value: string): number | undefined {
  const match = value.match(DAY_DURATION_PATTERN);
  if (!match) return undefined;
  const days = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(days) && days <= MAX_REVIEW_CYCLE_DAYS
    ? days
    : undefined;
}

/** Add whole UTC days to a strict ISO date and return an ISO date string. */
function addDaysIsoDate(value: string, days: number): string | undefined {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.getTime())) return undefined;
  const result = date.toISOString().split("T")[0]!;
  return isIsoDate(result) ? result : undefined;
}

/** Evaluate supported explicit freshness metadata against one ISO date. */
export function evaluateAssetFreshness(
  metadata: FreshnessMetadata,
  today: string,
): AssetFreshnessEvaluation {
  const expiresAt =
    metadata.expiresAt && isIsoDate(metadata.expiresAt)
      ? metadata.expiresAt
      : undefined;
  const cycleDays = metadata.reviewCycle
    ? parseDayDuration(metadata.reviewCycle)
    : undefined;
  const reviewDueAt =
    metadata.lastReviewedAt &&
    isIsoDate(metadata.lastReviewedAt) &&
    cycleDays !== undefined
      ? addDaysIsoDate(metadata.lastReviewedAt, cycleDays)
      : undefined;

  return {
    expired: expiresAt !== undefined && expiresAt < today,
    reviewOverdue: reviewDueAt !== undefined && reviewDueAt < today,
    ...(expiresAt ? { expiresAt } : {}),
    ...(reviewDueAt ? { reviewDueAt } : {}),
  };
}
