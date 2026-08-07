import type { ConfigOverrides } from "../config.js";
import { formatJson, formatText } from "../report.js";
import { scan } from "../scanner.js";
import { severityMeets } from "../rules.js";
import { evaluateStrictScan } from "../strict-scan.js";
import { CLI_EXIT } from "../cli-errors.js";

/** Execute the scan command, write its report to stdout, and return an exit code. */
export async function runScanCommand(
  target: string,
  overrides: ConfigOverrides,
  options: { strict?: boolean } = {},
): Promise<number> {
  const result = await scan(target, overrides);
  process.stdout.write(
    result.format === "json" ? formatJson(result) : formatText(result),
  );

  if (options.strict) {
    return evaluateStrictScan(result).outcome === "fail"
      ? CLI_EXIT.policyFailure
      : CLI_EXIT.success;
  }

  return result.findings.some((finding) =>
    severityMeets(finding.severity, result.exitThreshold),
  )
    ? CLI_EXIT.policyFailure
    : CLI_EXIT.success;
}
