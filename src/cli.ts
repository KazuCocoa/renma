import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { runBomCommand } from "./commands/bom.js";
import { runCatalogCommand } from "./commands/catalog.js";
import { runCiReportCommand } from "./commands/ci-report.js";
import { runDiffCommand } from "./commands/diff.js";
import {
  runGraphCommand,
  type GraphFormat,
  type GraphView,
} from "./commands/graph.js";
import { runGuideCommand } from "./commands/guide.js";
import { runInspectCommand } from "./commands/inspect.js";
import { runInitCommand } from "./commands/init.js";
import { runOwnershipCommand } from "./commands/ownership.js";
import { runReadinessCommand } from "./commands/readiness.js";
import {
  runScaffoldCommand,
  type ScaffoldOptions,
  type ScaffoldResource,
} from "./commands/scaffold.js";
import { runScanCommand } from "./commands/scan.js";
import { runSkillIndexCommand } from "./commands/skill-index.js";
import {
  runSuggestMetadataCommand,
  SuggestMetadataTargetError,
} from "./commands/suggest-metadata.js";
import { runSuggestSemanticSplitCommand } from "./commands/suggest-semantic-split.js";
import { runTrustGraphCommand } from "./commands/trust-graph.js";
import {
  commandHelpDefinition,
  commandOptionNames,
  isCommandName,
  renderCommandHelp,
  renderGlobalHelp,
  type CliOptionName,
  type CommandHelp,
  type CommandName,
} from "./cli-help.js";
import { ConfigError, type ConfigOverrides } from "./config.js";
import type { Severity } from "./types/diagnostics.js";

type CliValues = ReturnType<typeof parseArgs>["values"];

type CliOptionConfig = {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
};

const CLI_OPTIONS = {
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
  resources: { type: "string" },
  tags: { type: "string", multiple: true },
  title: { type: "string" },
  to: { type: "string" },
  view: { type: "string" },
  "max-context-bytes": { type: "string" },
  "max-source-bytes": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} satisfies Record<CliOptionName, CliOptionConfig>;

const COMMAND_DEFAULT_FORMATS = {
  scan: "text",
  catalog: "json",
  graph: "json",
  "skill-index": "markdown",
  "trust-graph": "json",
  readiness: "json",
  bom: "json",
  ownership: "json",
  diff: "json",
  "ci-report": "markdown",
  inspect: "json",
  guide: "prompt",
  scaffold: "file",
  "suggest-metadata": "prompt",
  "suggest-semantic-split": "prompt",
} as const satisfies Partial<Record<CommandName, string>>;

export interface CommandContract {
  minPositionals: number;
  maxPositionals: number;
  missingPositionalsMessage?: string;
}

interface CommandExecutionContext {
  values: CliValues;
  positionals: readonly string[];
  target: string;
}

interface CommandSpec {
  name: CommandName;
  positionals: CommandContract;
  optionNames: readonly CliOptionName[];
  help: CommandHelp;
  defaultFormat?: string;
  execute(context: CommandExecutionContext): Promise<number> | number;
  expectedError?(
    context: CommandExecutionContext,
    error: unknown,
  ): string | undefined;
}

function commandSpec(
  name: CommandName,
  positionals: CommandContract,
  defaultFormat: string | undefined,
  execute: CommandSpec["execute"],
  expectedError?: CommandSpec["expectedError"],
): CommandSpec {
  return {
    name,
    positionals,
    optionNames: commandOptionNames(name),
    help: commandHelpDefinition(name),
    ...(defaultFormat === undefined ? {} : { defaultFormat }),
    execute,
    ...(expectedError === undefined ? {} : { expectedError }),
  };
}

const OPTIONAL_ROOT: CommandContract = {
  minPositionals: 0,
  maxPositionals: 1,
};

export const COMMAND_REGISTRY = {
  init: commandSpec("init", OPTIONAL_ROOT, undefined, ({ target }) =>
    runInitCommand(target),
  ),
  scan: commandSpec(
    "scan",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS.scan,
    ({ values, target }) => runScan(values, target),
  ),
  catalog: commandSpec(
    "catalog",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS.catalog,
    ({ values, target }) => runCatalog(values, target),
  ),
  graph: commandSpec(
    "graph",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS.graph,
    ({ values, target }) => runGraph(values, target),
  ),
  "skill-index": commandSpec(
    "skill-index",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS["skill-index"],
    ({ values, target }) => runSkillIndex(values, target),
  ),
  "trust-graph": commandSpec(
    "trust-graph",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS["trust-graph"],
    ({ values, target }) => runTrustGraph(values, target),
  ),
  readiness: commandSpec(
    "readiness",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS.readiness,
    ({ values, target }) => runReadiness(values, target),
  ),
  bom: commandSpec(
    "bom",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS.bom,
    ({ values, target }) => runBom(values, target),
  ),
  ownership: commandSpec(
    "ownership",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS.ownership,
    ({ values, target }) => runOwnership(values, target),
  ),
  diff: commandSpec(
    "diff",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS.diff,
    ({ values, target }) => runDiff(values, target),
  ),
  "ci-report": commandSpec(
    "ci-report",
    OPTIONAL_ROOT,
    COMMAND_DEFAULT_FORMATS["ci-report"],
    ({ values, target }) => runCiReport(values, target),
  ),
  inspect: commandSpec(
    "inspect",
    {
      minPositionals: 1,
      maxPositionals: 1,
      missingPositionalsMessage: "inspect requires a target file.",
    },
    COMMAND_DEFAULT_FORMATS.inspect,
    ({ values, target }) => runInspect(values, target),
    expectedReadableTargetError("inspect", true),
  ),
  guide: commandSpec(
    "guide",
    {
      minPositionals: 1,
      maxPositionals: 1,
      missingPositionalsMessage:
        "guide requires a topic. The only supported topic is skill.",
    },
    COMMAND_DEFAULT_FORMATS.guide,
    ({ values, target }) => runGuide(values, target),
  ),
  scaffold: commandSpec(
    "scaffold",
    {
      minPositionals: 2,
      maxPositionals: 2,
      missingPositionalsMessage: "scaffold requires a kind and target path.",
    },
    COMMAND_DEFAULT_FORMATS.scaffold,
    ({ values, target, positionals }) =>
      runScaffold(values, target, positionals[2]),
  ),
  "suggest-metadata": commandSpec(
    "suggest-metadata",
    {
      minPositionals: 1,
      maxPositionals: 1,
      missingPositionalsMessage: "suggest-metadata requires a target file.",
    },
    COMMAND_DEFAULT_FORMATS["suggest-metadata"],
    ({ values, target, positionals }) =>
      runSuggestMetadata(values, target, positionals.length > 1),
  ),
  "suggest-semantic-split": commandSpec(
    "suggest-semantic-split",
    {
      minPositionals: 1,
      maxPositionals: 1,
      missingPositionalsMessage:
        "suggest-semantic-split requires a target file.",
    },
    COMMAND_DEFAULT_FORMATS["suggest-semantic-split"],
    ({ values, target }) => runSuggestSemanticSplit(values, target),
    expectedReadableTargetError("semantic split", false),
  ),
} satisfies Record<CommandName, CommandSpec>;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: CLI_OPTIONS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const requestedCommand = argv[0];
    return requestedCommand && isCommandName(requestedCommand)
      ? usageError(requestedCommand, message)
      : globalUsageError(message);
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

  const spec = COMMAND_REGISTRY[command];
  const context: CommandExecutionContext = {
    values: parsed.values,
    positionals: parsed.positionals,
    target,
  };
  const contractError = validateCommandInvocation(spec, context);
  if (contractError) return usageError(command, contractError);

  try {
    const result = spec.execute(context);
    return typeof result === "number" ? result : await result;
  } catch (error) {
    const message = spec.expectedError?.(context, error);
    if (message) return usageError(command, message);
    throw error;
  }
}

function runGuide(values: CliValues, topicValue: string): number {
  if (topicValue !== "skill") {
    return usageError(
      "guide",
      `Unknown guide topic "${topicValue}". The only supported topic is skill.`,
    );
  }

  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.guide);
  if (format !== "prompt" && format !== "json") {
    return usageError("guide", "--format must be either prompt or json.");
  }

  return runGuideCommand({
    topic: topicValue,
    format,
    renmaVersion: packageJson.version,
  });
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

  const format = stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.scaffold;
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
      kind: kindValue,
      targetPath,
      format,
    };
    const id = stringValue(values.id);
    const title = stringValue(values.title);
    const tags = stringListValue(values.tags);
    const resources = scaffoldResources(stringValue(values.resources));
    if (id) scaffoldOptions.id = id;
    if (title) scaffoldOptions.title = title;
    if (owner) scaffoldOptions.owner = owner;
    if (tags.length > 0) scaffoldOptions.tags = tags;
    if (resources.length > 0) scaffoldOptions.resources = resources;
    return await runScaffoldCommand(scaffoldOptions);
  } catch (error) {
    return reportCommandError(error);
  }
}

function scaffoldResources(value: string | undefined): ScaffoldResource[] {
  if (!value) return [];
  const resources = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed: ReadonlySet<string> = new Set([
    "references",
    "scripts",
    "assets",
  ]);
  for (const resource of resources) {
    if (!allowed.has(resource)) {
      throw new Error(
        "--resources must be a comma-separated list of references,scripts,assets.",
      );
    }
  }
  return resources.filter(isScaffoldResource);
}

function isScaffoldResource(value: string): value is ScaffoldResource {
  return value === "references" || value === "scripts" || value === "assets";
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

  const overrides: ConfigOverrides = {
    ...configOverrides(values),
    ...(failOn ? { failOn } : {}),
    ...(format ? { format } : {}),
  };
  try {
    return await runScanCommand(target, overrides);
  } catch (error) {
    return reportCommandError(error);
  }
}

async function runCatalog(values: CliValues, target: string): Promise<number> {
  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.catalog);
  if (format !== "json" && format !== "markdown") {
    return usageError("catalog", "--format must be either json or markdown.");
  }

  const overrides = configOverrides(values);

  try {
    return await runCatalogCommand(target, {
      format,
      overrides,
    });
  } catch (error) {
    return reportCommandError(error);
  }
}

async function runBom(values: CliValues, target: string): Promise<number> {
  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.bom);
  if (format !== "json" && format !== "markdown") {
    return usageError("bom", "--format must be either json or markdown.");
  }

  const overrides = configOverrides(values);

  try {
    return await runBomCommand(target, {
      format,
      overrides,
      omitGeneratedAt: values["omit-generated-at"] === true,
    });
  } catch (error) {
    return reportCommandError(error);
  }
}

async function runDiff(values: CliValues, target: string): Promise<number> {
  const fromRef = stringValue(values.from);
  const toRef = stringValue(values.to);
  if (!fromRef || !toRef) {
    return usageError("diff", "diff requires --from <ref> and --to <ref>.");
  }

  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.diff);
  if (format !== "json" && format !== "markdown") {
    return usageError("diff", "--format must be either json or markdown.");
  }

  const overrides = configOverrides(values);

  try {
    return await runDiffCommand(target, {
      fromRef,
      toRef,
      format,
      overrides,
    });
  } catch (error) {
    return reportCommandError(error);
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
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS["ci-report"]);
  if (format !== "json" && format !== "markdown") {
    return usageError("ci-report", "--format must be either json or markdown.");
  }

  const overrides = configOverrides(values);

  try {
    return await runCiReportCommand(target, {
      fromRef,
      toRef,
      format,
      overrides,
    });
  } catch (error) {
    return reportCommandError(error);
  }
}

async function runGraph(values: CliValues, target: string): Promise<number> {
  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.graph);
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
      "--view must be one of: summary, workflow, full, layered, lens, composition, impact, discovery.",
    );
  }

  const overrides = configOverrides(values);

  try {
    const graphOptions: {
      format: GraphFormat;
      view: GraphView;
      focus?: string;
      overrides: ConfigOverrides;
    } = {
      format,
      view,
      overrides,
    };
    const focus = stringValue(values.focus);
    if (focus) {
      graphOptions.focus = focus;
    }
    return await runGraphCommand(target, graphOptions);
  } catch (error) {
    return reportCommandError(error);
  }
}

async function runSkillIndex(
  values: CliValues,
  target: string,
): Promise<number> {
  const explicitFormat = stringValue(values.format);
  if (values.json && explicitFormat && explicitFormat !== "json") {
    return usageError(
      "skill-index",
      "--json conflicts with a non-JSON --format value.",
    );
  }
  const format = values.json
    ? "json"
    : (explicitFormat ?? COMMAND_DEFAULT_FORMATS["skill-index"]);
  if (format !== "json" && format !== "markdown") {
    return usageError(
      "skill-index",
      "--format must be either json or markdown.",
    );
  }

  const overrides = configOverrides(values);
  const focus = stringValue(values.focus);

  try {
    return await runSkillIndexCommand(target, {
      format,
      ...(focus !== undefined ? { focus } : {}),
      overrides,
    });
  } catch (error) {
    return reportCommandError(error);
  }
}

async function runTrustGraph(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS["trust-graph"]);
  if (format !== "json" && format !== "markdown") {
    return usageError(
      "trust-graph",
      "--format must be either json or markdown.",
    );
  }

  const overrides = configOverrides(values);

  try {
    return await runTrustGraphCommand(target, {
      format,
      overrides,
    });
  } catch (error) {
    return reportCommandError(error);
  }
}

function normalizeGraphView(value: string): GraphView | undefined {
  if (value === "lens") return "layered";
  if (
    value === "summary" ||
    value === "workflow" ||
    value === "full" ||
    value === "layered" ||
    value === "composition" ||
    value === "impact" ||
    value === "discovery"
  ) {
    return value;
  }
  return undefined;
}

async function runOwnership(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.ownership);
  if (format !== "json" && format !== "markdown") {
    return usageError("ownership", "--format must be either json or markdown.");
  }

  const overrides = configOverrides(values);

  try {
    const owner = stringValue(values.owner)?.trim();
    return await runOwnershipCommand(target, {
      format,
      includeOwned: values["include-owned"] === true,
      ...(owner ? { owner } : {}),
      overrides,
    });
  } catch (error) {
    return reportCommandError(error);
  }
}

async function runReadiness(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.readiness);
  if (format !== "json" && format !== "markdown") {
    return usageError("readiness", "--format must be either json or markdown.");
  }

  const overrides = configOverrides(values);

  try {
    return await runReadinessCommand(target, {
      format,
      overrides,
    });
  } catch (error) {
    return reportCommandError(error);
  }
}

function runSuggestSemanticSplit(
  values: CliValues,
  target: string,
): Promise<number> {
  const format = values.json
    ? "json"
    : (stringValue(values.format) ??
      COMMAND_DEFAULT_FORMATS["suggest-semantic-split"]);
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
    format,
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
    : (stringValue(values.format) ??
      COMMAND_DEFAULT_FORMATS["suggest-metadata"]);
  if (format !== "prompt" && format !== "json") {
    return Promise.resolve(
      usageError("suggest-metadata", "--format must be either prompt or json."),
    );
  }

  const owner = stringValue(values.owner)?.trim();
  return runSuggestMetadataCommand(target, {
    format,
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
  const format = values.json
    ? "json"
    : (stringValue(values.format) ?? COMMAND_DEFAULT_FORMATS.inspect);
  if (format !== "text" && format !== "json") {
    return Promise.resolve(
      usageError("inspect", "--format must be either text or json."),
    );
  }
  const lines = stringValue(values.lines);

  return runInspectCommand(target, {
    format,
    ...(lines ? { lines } : {}),
  });
}

function usageError(command: CommandName, message: string): 2 {
  console.error(message);
  console.error(`Run \`renma ${command} --help\` for usage.`);
  return 2;
}

function globalUsageError(message: string): 2 {
  console.error(message);
  console.error("Run `renma --help` for usage.");
  return 2;
}

function reportCommandError(error: unknown): 2 {
  console.error(error instanceof Error ? error.message : String(error));
  return 2;
}

function configOverrides(values: CliValues): ConfigOverrides {
  const configPath = stringValue(values.config);
  return configPath ? { configPath } : {};
}

function validateCommandInvocation(
  spec: CommandSpec,
  context: CommandExecutionContext,
): string | undefined {
  const allowedOptions = new Set<string>(spec.optionNames);
  for (const option of Object.keys(context.values)) {
    if (option === "version" || allowedOptions.has(option)) continue;
    return `${spec.name} does not support --${option}.`;
  }

  const positionalCount =
    context.positionals.length === 0 ? 0 : context.positionals.length - 1;
  const contract = spec.positionals;
  if (positionalCount < contract.minPositionals) {
    return (
      contract.missingPositionalsMessage ??
      `${spec.name} requires ${contract.minPositionals} positional argument(s).`
    );
  }
  if (positionalCount > contract.maxPositionals) {
    const unexpected = context.positionals[contract.maxPositionals + 1];
    return `${spec.name} received unexpected positional argument${
      unexpected ? ` "${unexpected}"` : ""
    }.`;
  }
  return undefined;
}

function expectedReadableTargetError(
  label: string,
  includeLineErrors: boolean,
): NonNullable<CommandSpec["expectedError"]> {
  return ({ target }, error): string | undefined => {
    if (
      includeLineErrors &&
      error instanceof Error &&
      error.message.startsWith("--lines ")
    ) {
      return error.message;
    }
    const code = nodeErrorCode(error);
    if (code === "ENOENT") {
      return `Could not read ${label} target ${target}: file does not exist.`;
    }
    if (code === "EISDIR") {
      return `Could not read ${label} target ${target}: target is a directory.`;
    }
    if (code === "EACCES" || code === "EPERM") {
      return `Could not read ${label} target ${target}: target is not readable.`;
    }
    return undefined;
  };
}

function nodeErrorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
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

  if (!/^[1-9]\d*$/.test(value)) {
    throw new ConfigError(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ConfigError(`${name} must be a positive integer.`);
  }
  return parsed;
}
