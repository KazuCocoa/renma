import type { CommandInvocation } from "./types/decision.js";

/** Build machine-executable argv separately from the human shell display. */
export function renmaCommand<const Args extends string[]>(
  args: Args,
): CommandInvocation<Args> {
  return {
    command: "renma",
    args,
    display: ["renma", ...args].map(shellDisplayArgument).join(" "),
  };
}

function shellDisplayArgument(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
