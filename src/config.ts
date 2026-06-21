import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { LoadedConfig, ScanConfig, Severity } from "./types.js";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const FORMATS = ["text", "json"] as const;

/** Default scan configuration used when no config file or CLI overrides apply. */
export const DEFAULT_CONFIG: ScanConfig = {
  failOn: "high",
  format: "text",
  globs: [
    "skills/**/SKILL.md",
    ".agents/**/*.md",
    "AGENTS.md",
    "README.md",
    "context/**/*.md",
    "contexts/**/*.md",
    "skills/**/profiles/**/*.md",
    "skills/**/references/**/*.md",
    "skills/**/examples/**/*.md",
    "skills/**/scripts/**/*",
    "tools/**/*",
  ],
  exclude: ["node_modules", "dist", ".git"],
  maxFileSizeBytes: 512 * 1024,
  maxDepth: 16,
  concurrency: 16,
  layout: {
    toolNamespace: "appium",
    workflowAliases: {
      "appium-troubleshooting": "troubleshooting",
      "xcuitest-real-device-config": "real-device",
    },
  },
};

/** Error raised for invalid Renma configuration or CLI configuration input. */
export class ConfigError extends Error {}

/** CLI-level overrides merged on top of discovered configuration. */
export interface ConfigOverrides {
  configPath?: string;
  failOn?: Severity;
  format?: "text" | "json";
}

/** Load, validate, and merge scan configuration for a repository root. */
export async function loadConfig(
  root: string,
  overrides: ConfigOverrides,
): Promise<LoadedConfig> {
  const discoveredPath =
    overrides.configPath ?? (await findDefaultConfig(root));
  const fileConfig = discoveredPath ? await readConfigFile(discoveredPath) : {};
  const config = normalizeConfig(fileConfig, discoveredPath);

  return {
    config: {
      ...DEFAULT_CONFIG,
      ...config,
      failOn: overrides.failOn ?? config.failOn ?? DEFAULT_CONFIG.failOn,
      format: overrides.format ?? config.format ?? DEFAULT_CONFIG.format,
    },
    ...(discoveredPath
      ? { configPath: toPosix(path.relative(root, discoveredPath)) }
      : {}),
  };
}

async function findDefaultConfig(root: string): Promise<string | undefined> {
  for (const name of ["renma.config.json", ".renma.json"]) {
    const candidate = path.join(root, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next conventional name.
    }
  }
  return undefined;
}

async function readConfigFile(configPath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigError(
      `Could not read config file ${configPath}: ${errorMessage(error)}`,
    );
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ConfigError(
      `Config file ${configPath} is not valid JSON: ${errorMessage(error)}`,
    );
  }
}

function normalizeConfig(
  value: unknown,
  configPath?: string,
): Partial<ScanConfig> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new ConfigError(`Config${label(configPath)} must be a JSON object.`);
  }

  const allowed = new Set([
    "fail_on",
    "format",
    "globs",
    "exclude",
    "max_file_size_bytes",
    "max_depth",
    "concurrency",
    "layout",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown config field "${key}"${label(configPath)}.`,
      );
    }
  }

  const config: Partial<ScanConfig> = {};
  if (value.fail_on !== undefined)
    config.failOn = enumValue("fail_on", value.fail_on, SEVERITIES);
  if (value.format !== undefined)
    config.format = enumValue("format", value.format, FORMATS);
  if (value.globs !== undefined)
    config.globs = stringArray("globs", value.globs);
  if (value.exclude !== undefined)
    config.exclude = stringArray("exclude", value.exclude);
  if (value.max_file_size_bytes !== undefined) {
    config.maxFileSizeBytes = positiveInteger(
      "max_file_size_bytes",
      value.max_file_size_bytes,
    );
  }
  if (value.max_depth !== undefined)
    config.maxDepth = positiveInteger("max_depth", value.max_depth);
  if (value.concurrency !== undefined)
    config.concurrency = positiveInteger("concurrency", value.concurrency);

  if (value.layout !== undefined) config.layout = layoutPolicy(value.layout);
  return config;
}

function enumValue<const T extends readonly string[]>(
  field: string,
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value === "string" && allowed.includes(value)) return value;
  throw new ConfigError(`${field} must be one of: ${allowed.join(", ")}.`);
}

function stringArray(field: string, value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value;
  throw new ConfigError(`${field} must be an array of strings.`);
}

function positiveInteger(field: string, value: unknown): number {
  if (Number.isInteger(value) && typeof value === "number" && value > 0)
    return value;
  throw new ConfigError(`${field} must be a positive integer.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function label(configPath?: string): string {
  return configPath ? ` in ${configPath}` : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
function layoutPolicy(value: unknown): ScanConfig["layout"] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("layout must be an object.");
  const layout = value as Record<string, unknown>;
  const allowed = new Set(["tool_namespace", "workflow_aliases"]);
  for (const key of Object.keys(layout)) {
    if (!allowed.has(key))
      throw new Error(
        `Unknown layout config key "${key}". Allowed keys: ${[...allowed].join(
          ", ",
        )}.`,
      );
  }

  const toolNamespace =
    layout.tool_namespace === undefined
      ? DEFAULT_CONFIG.layout.toolNamespace
      : stringValue("layout.tool_namespace", layout.tool_namespace);
  const workflowAliases =
    layout.workflow_aliases === undefined
      ? DEFAULT_CONFIG.layout.workflowAliases
      : stringRecord("layout.workflow_aliases", layout.workflow_aliases);

  return {
    toolNamespace,
    workflowAliases: {
      ...DEFAULT_CONFIG.layout.workflowAliases,
      ...workflowAliases,
    },
  };
}

function stringRecord(name: string, value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object of string values.`);
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string")
      throw new Error(`${name}.${key} must be a string.`);
  }
  return record as Record<string, string>;
}

function stringValue(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${name} must be a non-empty string.`);
  return value;
}
