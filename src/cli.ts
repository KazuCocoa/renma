import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { runCatalogCommand, type CatalogFormat } from "./commands/catalog.js";
import {
  runCiReportCommand,
  type CiReportFormat,
} from "./commands/ci-report.js";
import { runDiffCommand, type DiffFormat } from "./commands/diff.js";
import {
  runGraphCommand,
  type GraphFormat,
  type GraphView,
} from "./commands/graph.js";
import { runInspectCommand, type InspectFormat } from "./commands/inspect.js";
import {
  runOwnershipCommand,
  type OwnershipFormat,
} from "./commands/ownership.js";
import {
  runReadinessCommand,
  type ReadinessFormat,
} from "./commands/readiness.js";
import { runScanCommand } from "./commands/scan.js";
import {
  runSuggestSemanticSplitCommand,
  type SuggestSemanticSplitFormat,
} from "./commands/suggest-semantic-split.js";
import { ConfigError, type ConfigOverrides } from "./config.js";
import type { Severity } from "./types.js";

type CliValues = ReturnType<typeof parseArgs>["values"];

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
        from: { type: "string" },
        "include-owned": { type: "boolean" },
        json: { type: "boolean" },
        lines: { type: "string" },
        to: { type: "string" },
        view: { type: "string" },
        "max-context-bytes": { type: "string" },
        "max-source-bytes": { type: "string" },
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
    console.log(packageJson.version);
    return 0;
  }

  const [command = "scan", target = "."] = parsed.positionals;
  if (
    command !== "scan" &&
    command !== "catalog" &&
    command !== "diff" &&
    command !== "ci-report" &&
    command !== "graph" &&
    command !== "ownership" &&
    command !== "readiness" &&
    command !== "suggest-semantic-split" &&
    command !== "inspect"
  ) {
    console.error(
      command ? `Unknown command "${command}".` : "Missing command.",
    );
    console.error("Run renma --help for usage.");
    return 2;
  }

  if (command === "suggest-semantic-split") {
    return runSuggestSemanticSplit(parsed.values, target);
  }

  if (command === "inspect") {
    return runInspect(parsed.values, target);
  }

  if (command === "catalog") {
    return runCatalog(parsed.values, target);
  }

  if (command === "diff") {
    return runDiff(parsed.values, target);
  }

  if (command === "ci-report") {
    return runCiReport(parsed.values, target);
  }

  if (command === "graph") {
    return runGraph(parsed.values, target);
  }

  if (command === "ownership") {
    return runOwnership(parsed.values, target);
  }

  if (command === "readiness") {
    return runReadiness(parsed.values, target);
  }

  return runScan(parsed.values, target);
}

async function runScan(values: CliValues, target: string): Promise<number> {
  const failOnValue = stringValue(values["fail-on"]);
  const failOn = parseSeverity(failOnValue);
  if (failOnValue && !failOn) {
    console.error("--fail-on must be one of: low, medium, high, critical.");
    return 2;
  }

  const format = values.json ? "json" : stringValue(values.format);
  if (format !== undefined && format !== "text" && format !== "json") {
    console.error("--format must be either text or json.");
    return 2;
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
    ...(failOn ? { failOn } : {}),
    ...(format ? { format } : {}),
  };
  try {
    return await runScanCommand(target, overrides);
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

async function runCatalog(values: CliValues, target: string): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown") {
    console.error("--format must be either json or markdown.");
    return 2;
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runCatalogCommand(target, {
      format: format as CatalogFormat,
      overrides,
    });
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

async function runDiff(values: CliValues, target: string): Promise<number> {
  const fromRef = stringValue(values.from);
  const toRef = stringValue(values.to);
  if (!fromRef || !toRef) {
    console.error("diff requires --from <ref> and --to <ref>.");
    return 2;
  }

  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown") {
    console.error("--format must be either json or markdown.");
    return 2;
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runDiffCommand(target, {
      fromRef,
      toRef,
      format: format as DiffFormat,
      overrides,
    });
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

async function runCiReport(values: CliValues, target: string): Promise<number> {
  const fromRef = stringValue(values.from);
  const toRef = stringValue(values.to);
  if (!fromRef || !toRef) {
    console.error("ci-report requires --from <ref> and --to <ref>.");
    return 2;
  }

  const format = values.json ? "json" : (stringValue(values.format) ?? "markdown");
  if (format !== "json" && format !== "markdown") {
    console.error("--format must be either json or markdown.");
    return 2;
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runCiReportCommand(target, {
      fromRef,
      toRef,
      format: format as CiReportFormat,
      overrides,
    });
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

async function runGraph(values: CliValues, target: string): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown" && format !== "mermaid") {
    console.error("--format must be one of: json, markdown, mermaid.");
    return 2;
  }
  const view =
    stringValue(values.view) ?? (format === "json" ? "full" : "summary");
  if (view !== "summary" && view !== "workflow" && view !== "full") {
    console.error("--view must be one of: summary, workflow, full.");
    return 2;
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runGraphCommand(target, {
      format: format as GraphFormat,
      view: view as GraphView,
      overrides,
    });
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

async function runOwnership(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown") {
    console.error("--format must be either json or markdown.");
    return 2;
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runOwnershipCommand(target, {
      format: format as OwnershipFormat,
      includeOwned: values["include-owned"] === true,
      overrides,
    });
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

async function runReadiness(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown") {
    console.error("--format must be either json or markdown.");
    return 2;
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runReadinessCommand(target, {
      format: format as ReadinessFormat,
      overrides,
    });
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

function runSuggestSemanticSplit(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? "prompt");
  if (format !== "prompt" && format !== "json") {
    console.error("--format must be either prompt or json.");
    return Promise.resolve(2);
  }

  let maxContextBytes: number | undefined;
  let maxSourceBytes: number | undefined;
  try {
    maxContextBytes = parseOptionalPositiveInt(
      stringValue(values["max-context-bytes"]),
      "--max-context-bytes",
    );
    maxSourceBytes = parseOptionalPositiveInt(
      stringValue(values["max-source-bytes"]),
      "--max-source-bytes",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return Promise.resolve(2);
  }

  return runSuggestSemanticSplitCommand(target, {
    format: format as SuggestSemanticSplitFormat,
    ...(maxContextBytes ? { maxContextBytes } : {}),
    ...(maxSourceBytes ? { maxSourceBytes } : {}),
  });
}

function runInspect(values: CliValues, target: string): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "text" && format !== "json") {
    console.error("--format must be either text or json.");
    return Promise.resolve(2);
  }
  const lines = stringValue(values.lines);

  return runInspectCommand(target, {
    format: format as InspectFormat,
    ...(lines ? { lines } : {}),
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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

function parseOptionalPositiveInt(
  value: string | undefined,
  name: string,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function helpText(): string {
  return [
    `renma ${packageJson.version}`,
    "",
    "Usage: renma scan [path] [options]",
    "",
    "Additional usage:",
    "  renma scan [path] [options]",
    "  renma catalog [path] [options]",
    "  renma diff [path] --from <ref> --to <ref> [options]",
    "  renma ci-report [path] --from <ref> --to <ref> [options]",
    "  renma graph [path] [options]",
    "  renma ownership [path] [options]",
    "  renma readiness [path] [options]",
    "  renma inspect <file> [options]",
    "  renma suggest-semantic-split <file> [options]",
    "",
    "Commands:",
    "  scan                       Scan a repository or skill directory",
    "  catalog                    Print deterministic normalized asset catalog",
    "  diff                       Compare deterministic readiness snapshots",
    "  ci-report                  Print deterministic CI / PR review report",
    "  graph                      Print deterministic repository graph snapshot",
    "  ownership                  Print deterministic ownership coverage report",
    "  readiness                  Print deterministic agent readiness report",
    "  inspect                    Inspect repository files/assets by outline or exact line slice",
    "  suggest-semantic-split     Print a Codex-ready semantic split prompt",
    "",
    "The inspect command is an inspection helper; it does not choose task context or assemble prompts.",
    "",
    "Options:",
    "  -c, --config <path>        scan: read JSON config from path",
    "      --fail-on <level>      scan: exit 1 when findings meet severity: low, medium, high, critical",
    "      --format <format>      scan: text or json; catalog/ownership/readiness/ci-report: json or markdown; graph: json, markdown, or mermaid; suggest-semantic-split: prompt or json",
    "      --include-owned        ownership: include owned asset details",
    "      --json                 Shortcut for --format json",
    "      --view <view>          graph: summary, workflow, or full",
    "      --lines <range>        inspect: exact line range, e.g. L10-L42",
    "      --max-source-bytes <n> suggest-semantic-split: source file byte budget",
    "      --max-context-bytes <n>",
    "                             suggest-semantic-split: nearby context byte budget",
    "  -h, --help                 Show help",
    "  -v, --version              Show version",
  ].join("\n");
}
