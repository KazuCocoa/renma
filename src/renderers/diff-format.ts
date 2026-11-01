import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";

export const DIFF_DETAIL_LIMIT =
  DEFAULT_QUALITY_PROFILE.presentation.topSummaryItemCap;

export function formatPolicyOverflow(total: number, indent: number): string[] {
  if (total <= DIFF_DETAIL_LIMIT) return [];
  return [
    `${" ".repeat(indent)}- ${total - DIFF_DETAIL_LIMIT} more not shown; see JSON for the full list.`,
  ];
}

export function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}
