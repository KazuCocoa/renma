import type { ConfigOverrides } from "../config.js";
import { formatJson, formatText } from "../report.js";
import { scan } from "../scanner.js";
import { severityMeets } from "../rules.js";

/** Execute the scan command, write its report to stdout, and return an exit code. */
export async function runScanCommand(
  target: string,
  overrides: ConfigOverrides,
): Promise<number> {
  const result = await scan(target, overrides);
  process.stdout.write(
    result.format === "json" ? formatJson(result) : formatText(result),
  );

  return result.findings.some((finding) =>
    severityMeets(finding.severity, result.exitThreshold),
  )
    ? 1
    : 0;
}
