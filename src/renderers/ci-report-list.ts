import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";

export const MAX_LIST_ITEMS =
  DEFAULT_QUALITY_PROFILE.presentation.topSummaryItemCap;

export function formatOverflow(length: number): string[] {
  if (length <= MAX_LIST_ITEMS) return [];
  return [
    `- ${length - MAX_LIST_ITEMS} more not shown; see JSON for the full list.`,
  ];
}
