import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { runBomCommand, type BomFormat } from "./commands/bom.js";
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
import {
  runScaffoldCommand,
  type ScaffoldFormat,
  type ScaffoldKind,
  type ScaffoldOptions,
} from "./commands/scaffold.js";
import { runScanCommand } from "./commands/scan.js";
import {
  runSuggestMetadataCommand,
  SuggestMetadataTargetError,
  type SuggestMetadataFormat,
} from "./commands/suggest-metadata.js";
import {
  runSuggestSemanticSplitCommand,
  type SuggestSemanticSplitFormat,
} from "./commands/suggest-semantic-split.js";
import {
  runTrustGraphCommand,
  type TrustGraphFormat,
} from "./commands/trust-graph.js";
import {
  isCommandName,
  renderCommandHelp,
  renderGlobalHelp,
  type CommandName,
} from "./cli-help.js";
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
        focus: { type: "string" },
        format: { type: "string" },
        from: { type: "string" },
        "include-owned": { type: "boolean" },
        id: { type: "string" },
        json: { type: "boolean" },
        lines: { type: "string" },
        "omit-generated-at": { type: "boolean" },
        owner: { type: "string" },
        tags: { type: "string", multiple: true },
        title: { type: "string" },
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

  const [command = "scan", target = "."] = parsed.positionals;

  if (parsed.values.help) {
    if (parsed.positionals.length === 0) {
      console.log(renderGlobalHelp(packageJson.version));
      return 0;
    }

    if (isCommandName(command)) {
      console.log(renderCommandHelp(command, packageJson.version));
      return 0;
    }
  }

  if (parsed.values.version) {
    console.log(packageJson.version);
    return 0;
  }

  if (!isCommandName(command)) {
    console.error(
      command ? `Unknown command "${command}".` : "Missing command.",
    );
    console.error("Run renma --help for usage.");
    return 2;
  }

  if (command === "suggest-semantic-split") {
    return runSuggestSemanticSplit(parsed.values, target);
  }

  if (command === "suggest-metadata") {
    return runSuggestMetadata(
      parsed.values,
      target,
      parsed.positionals.length > 1,
    );
  }

  if (command === "scaffold") {
    return runScaffold(parsed.values, target, parsed.positionals[2]);
  }

  if (command === "inspect") {
    return runInspect(parsed.values, target);
  }

  if (command === "catalog") {
    return runCatalog(parsed.values, target);
  }

  if (command === "bom") {
    return runBom(parsed.values, target);
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

  if (command === "trust-graph") {
    return runTrustGraph(parsed.values, target);
  }

  if (command === "ownership") {
    return runOwnership(parsed.values, target);
  }

  if (command === "readiness") {
    return runReadiness(parsed.values, target);
  }

  return runScan(parsed.values, target);
}

async function runScaffold(
  values: CliValues,
  kindValue: string,
  targetPath?: string,
): Promise<number> {
  if (
    kindValue !== "skill" &&
    kindValue !== "context" &&
    kindValue !== "context_lens"
  ) {
    return usageError(
      "scaffold",
      "scaffold requires kind skill, context, or context_lens.",
    );
  }

  if (!targetPath) {
    return usageError("scaffold", "scaffold requires a target path.");
  }

  const format = stringValue(values.format) ?? "file";
  if (format !== "file" && format !== "prompt" && format !== "json") {
    return usageError(
      "scaffold",
      "--format must be one of file, prompt, or json.",
    );
  }

  const owner = stringValue(values.owner);
  if (format === "file" && !owner) {
    return usageError(
      "scaffold",
      "scaffold --format file requires --owner <owner>.",
    );
  }

  try {
    const scaffoldOptions: ScaffoldOptions = {
      kind: kindValue as ScaffoldKind,
      targetPath,
      format: format as ScaffoldFormat,
    };
    const id = stringValue(values.id);
    const title = stringValue(values.title);
    const tags = stringListValue(values.tags);
    if (id) scaffoldOptions.id = id;
    if (title) scaffoldOptions.title = title;
    if (owner) scaffoldOptions.owner = owner;
    if (tags.length > 0) scaffoldOptions.tags = tags;
    return await runScaffoldCommand(scaffoldOptions);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

async function runScan(values: CliValues, target: string): Promise<number> {
  const failOnValue = stringValue(values["fail-on"]);
  const failOn = parseSeverity(failOnValue);
  if (failOnValue && !failOn) {
    return usageError(
      "scan",
      "--fail-on must be one of: low, medium, high, critical.",
    );
  }

  const format = values.json ? "json" : stringValue(values.format);
  if (format !== undefined && format !== "text" && format !== "json") {
    return usageError("scan", "--format must be either text or json.");
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
    return usageError("catalog", "--format must be either json or markdown.");
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

async function runBom(values: CliValues, target: string): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown") {
    return usageError("bom", "--format must be either json or markdown.");
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runBomCommand(target, {
      format: format as BomFormat,
      overrides,
      omitGeneratedAt: values["omit-generated-at"] === true,
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
    return usageError("diff", "diff requires --from <ref> and --to <ref>.");
  }

  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown") {
    return usageError("diff", "--format must be either json or markdown.");
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
    return usageError(
      "ci-report",
      "ci-report requires --from <ref> and --to <ref>.",
    );
  }

  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? "markdown");
  if (format !== "json" && format !== "markdown") {
    return usageError("ci-report", "--format must be either json or markdown.");
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
    return usageError(
      "graph",
      "--format must be one of: json, markdown, mermaid.",
    );
  }
  const viewValue =
    stringValue(values.view) ?? (format === "json" ? "full" : "summary");
  const view = normalizeGraphView(viewValue);
  if (!view) {
    return usageError(
      "graph",
      "--view must be one of: summary, workflow, full, layered, lens.",
    );
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    const graphOptions: {
      format: GraphFormat;
      view: GraphView;
      focus?: string;
      overrides: ConfigOverrides;
    } = {
      format: format as GraphFormat,
      view: view as GraphView,
      overrides,
    };
    const focus = stringValue(values.focus);
    if (focus) {
      graphOptions.focus = focus;
    }
    return await runGraphCommand(target, graphOptions);
  } catch (error) {
    console.error(
      error instanceof ConfigError || error instanceof Error
        ? error.message
        : String(error),
    );
    return 2;
  }
}

async function runTrustGraph(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown") {
    return usageError(
      "trust-graph",
      "--format must be either json or markdown.",
    );
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    return await runTrustGraphCommand(target, {
      format: format as TrustGraphFormat,
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

function normalizeGraphView(value: string): GraphView | undefined {
  if (value === "lens") return "layered";
  if (
    value === "summary" ||
    value === "workflow" ||
    value === "full" ||
    value === "layered"
  ) {
    return value;
  }
  return undefined;
}

async function runOwnership(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "json" && format !== "markdown") {
    return usageError("ownership", "--format must be either json or markdown.");
  }

  const configPath = stringValue(values.config);
  const overrides: ConfigOverrides = {
    ...(configPath ? { configPath } : {}),
  };

  try {
    const owner = stringValue(values.owner)?.trim();
    return await runOwnershipCommand(target, {
      format: format as OwnershipFormat,
      includeOwned: values["include-owned"] === true,
      ...(owner ? { owner } : {}),
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
    return usageError("readiness", "--format must be either json or markdown.");
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
    return Promise.resolve(
      usageError(
        "suggest-semantic-split",
        "--format must be either prompt or json.",
      ),
    );
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
    return Promise.resolve(
      usageError(
        "suggest-semantic-split",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  return runSuggestSemanticSplitCommand(target, {
    format: format as SuggestSemanticSplitFormat,
    ...(maxContextBytes ? { maxContextBytes } : {}),
    ...(maxSourceBytes ? { maxSourceBytes } : {}),
  });
}

function runSuggestMetadata(
  values: CliValues,
  target: string,
  targetProvided: boolean,
): Promise<number> {
  if (!targetProvided) {
    return Promise.resolve(
      usageError(
        "suggest-metadata",
        "suggest-metadata requires a target file.",
      ),
    );
  }

  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? "prompt");
  if (format !== "prompt" && format !== "json") {
    return Promise.resolve(
      usageError("suggest-metadata", "--format must be either prompt or json."),
    );
  }

  const owner = stringValue(values.owner)?.trim();
  return runSuggestMetadataCommand(target, {
    format: format as SuggestMetadataFormat,
    ...(owner ? { owner } : {}),
  }).catch((error: unknown) => {
    if (error instanceof SuggestMetadataTargetError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  });
}

function runInspect(values: CliValues, target: string): Promise<number> {
  const format = values.json ? "json" : (stringValue(values.format) ?? "json");
  if (format !== "text" && format !== "json") {
    return Promise.resolve(
      usageError("inspect", "--format must be either text or json."),
    );
  }
  const lines = stringValue(values.lines);

  return runInspectCommand(target, {
    format: format as InspectFormat,
    ...(lines ? { lines } : {}),
  });
}

function usageError(command: CommandName, message: string): 2 {
  console.error(message);
  console.error(`Run \`renma ${command} --help\` for usage.`);
  return 2;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringListValue(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
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
