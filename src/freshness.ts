const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_DURATION_PATTERN = /^P([1-9]\d*)D$/;

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
  return Number.parseInt(match[1] ?? "", 10);
}

/** Add whole UTC days to a strict ISO date and return an ISO date string. */
export function addDaysIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
