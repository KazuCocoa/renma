import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { ConfigError } from "./config.js";
import { formatJson, formatText } from "./report.js";
import { scan } from "./scanner.js";
import { severityMeets } from "./rules.js";
import type { Severity } from "./types.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c" },
        "fail-on": { type: "string" },
        format: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (parsed.values.help) {
    console.log(helpText());
    return 0;
  }
  if (parsed.values.version) {
    console.log(packageJson.version ?? "unknown");
    return 0;
  }

  const [command, target = "."] = parsed.positionals;
  if (command !== "scan") {
    console.error(
      command ? `Unknown command "${command}".` : "Missing command.",
    );
    console.error("Run renma --help for usage.");
    return 2;
  }

  const failOn = parseSeverity(parsed.values["fail-on"]);
  if (parsed.values["fail-on"] && !failOn) {
    console.error("--fail-on must be one of: low, medium, high, critical.");
    return 2;
  }

  const format = parsed.values.json ? "json" : parsed.values.format;
  if (format !== undefined && format !== "text" && format !== "json") {
    console.error("--format must be either text or json.");
    return 2;
  }

  try {
    const result = await scan(target, {
      ...(parsed.values.config ? { configPath: parsed.values.config } : {}),
      ...(failOn ? { failOn } : {}),
      ...(format ? { format } : {}),
    });
    const output =
      result.format === "json" ? formatJson(result) : formatText(result);
    process.stdout.write(output);
    return result.findings.some((finding) =>
      severityMeets(finding.severity, result.exitThreshold),
    )
      ? 1
      : 0;
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

function parseSeverity(value: string | undefined): Severity | undefined {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  )
    return value;
  return undefined;
}

function helpText(): string {
  return [
    "Usage: renma scan [path] [options]",
    "",
    "Options:",
    "  -c, --config <path>      Read JSON config from path",
    "      --fail-on <level>    Exit 1 when findings meet severity: low, medium, high, critical",
    "      --format <format>    Output format: text or json",
    "      --json               Shortcut for --format json",
    "  -h, --help               Show help",
    "  -v, --version            Show version",
  ].join("\n");
}
