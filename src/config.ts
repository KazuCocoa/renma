import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  LoadedConfig,
  ScanConfig,
  Severity,
  SuppressionConfig,
  SuppressionExpiration,
} from "./types.js";

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
    "lenses/**/*.md",
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
  suppressions: [],
  layout: {
    workflowAliases: {},
  },
  security: {
    approvedDomains: [],
    approvedUploadDomains: [],
    disallowedCommands: [],
    profiles: {},
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
    "suppressions",
    "layout",
    "security",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown config field "${key}"${label(configPath)}.`,
      );
    }
  }

  const config: Partial<ScanConfig> = {};
  if (value.fail_on !== undefined) {
    config.failOn = enumValue("fail_on", value.fail_on, SEVERITIES);
  }
  if (value.format !== undefined) {
    config.format = enumValue("format", value.format, FORMATS);
  }
  if (value.globs !== undefined) {
    config.globs = stringArray("globs", value.globs);
  }
  if (value.exclude !== undefined) {
    config.exclude = stringArray("exclude", value.exclude);
  }
  if (value.max_file_size_bytes !== undefined) {
    config.maxFileSizeBytes = positiveInteger(
      "max_file_size_bytes",
      value.max_file_size_bytes,
    );
  }
  if (value.max_depth !== undefined) {
    config.maxDepth = positiveInteger("max_depth", value.max_depth);
  }
  if (value.concurrency !== undefined) {
    config.concurrency = positiveInteger("concurrency", value.concurrency);
  }
  if (value.suppressions !== undefined) {
    config.suppressions = suppressionArray(value.suppressions);
  }
  if (value.layout !== undefined) {
    config.layout = layoutPolicy(value.layout);
  }
  if (value.security !== undefined) {
    config.security = securityPolicy(value.security);
  }
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
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new ConfigError(`${field} must be an array of strings.`);
}

function stringList(field: string, value: unknown): string[] {
  if (typeof value === "string") return [value];
  return stringArray(field, value);
}

function positiveInteger(field: string, value: unknown): number {
  if (Number.isInteger(value) && typeof value === "number" && value > 0) {
    return value;
  }
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
  if (!isRecord(value)) throw new ConfigError("layout must be an object.");
  const allowed = new Set(["tool_namespace", "workflow_aliases"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown layout config key "${key}". Allowed keys: ${[
          ...allowed,
        ].join(", ")}.`,
      );
    }
  }

  const toolNamespace =
    value.tool_namespace === undefined
      ? undefined
      : stringValue("layout.tool_namespace", value.tool_namespace);
  const workflowAliases =
    value.workflow_aliases === undefined
      ? DEFAULT_CONFIG.layout.workflowAliases
      : stringRecord("layout.workflow_aliases", value.workflow_aliases);

  return {
    ...(toolNamespace === undefined ? {} : { toolNamespace }),
    workflowAliases: {
      ...DEFAULT_CONFIG.layout.workflowAliases,
      ...workflowAliases,
    },
  };
}

function securityPolicy(value: unknown): ScanConfig["security"] {
  if (!isRecord(value)) {
    throw new ConfigError("security must be an object.");
  }
  const allowed = new Set([
    "approvedDomains",
    "approvedUploadDomains",
    "disallowedCommands",
    "profiles",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown security config key "${key}". Allowed keys: ${[
          ...allowed,
        ].join(", ")}.`,
      );
    }
  }

  return {
    approvedDomains:
      value.approvedDomains === undefined
        ? DEFAULT_CONFIG.security.approvedDomains
        : stringArray("security.approvedDomains", value.approvedDomains),
    approvedUploadDomains:
      value.approvedUploadDomains === undefined
        ? DEFAULT_CONFIG.security.approvedUploadDomains
        : stringArray(
            "security.approvedUploadDomains",
            value.approvedUploadDomains,
          ),
    disallowedCommands:
      value.disallowedCommands === undefined
        ? DEFAULT_CONFIG.security.disallowedCommands
        : stringArray("security.disallowedCommands", value.disallowedCommands),
    profiles:
      value.profiles === undefined
        ? DEFAULT_CONFIG.security.profiles
        : securityProfiles(value.profiles),
  };
}

function securityProfiles(
  value: unknown,
): NonNullable<ScanConfig["security"]["profiles"]> {
  const profiles = objectRecord("security.profiles", value);
  const normalized: NonNullable<ScanConfig["security"]["profiles"]> = {};
  for (const [name, profile] of Object.entries(profiles)) {
    if (!isRecord(profile)) {
      throw new ConfigError(`security.profiles.${name} must be an object.`);
    }
    const allowed = new Set([
      "allowedDataClass",
      "allowed_data_class",
      "networkAllowed",
      "network_allowed",
      "externalUploadAllowed",
      "external_upload_allowed",
      "secretsAllowed",
      "secrets_allowed",
      "humanApprovalRequired",
      "human_approval_required",
      "requiresHumanApproval",
      "requires_human_approval",
      "securityProfile",
      "security_profile",
      "allowedData",
      "allowed_data",
      "forbiddenInputs",
      "forbidden_inputs",
      "approvedDomains",
      "approvedUploadDomains",
      "disallowedCommands",
    ]);
    for (const key of Object.keys(profile)) {
      if (!allowed.has(key)) {
        throw new ConfigError(
          `Unknown security profile key "${key}" in security.profiles.${name}.`,
        );
      }
    }
    normalized[name] = {
      allowedDataClass: optionalString(
        `security.profiles.${name}.allowedDataClass`,
        profile.allowedDataClass ?? profile.allowed_data_class,
      ),
      networkAllowed: optionalBoolean(
        `security.profiles.${name}.networkAllowed`,
        profile.networkAllowed ?? profile.network_allowed,
      ),
      externalUploadAllowed: optionalBoolean(
        `security.profiles.${name}.externalUploadAllowed`,
        profile.externalUploadAllowed ?? profile.external_upload_allowed,
      ),
      secretsAllowed: optionalBoolean(
        `security.profiles.${name}.secretsAllowed`,
        profile.secretsAllowed ?? profile.secrets_allowed,
      ),
      humanApprovalRequired: optionalBoolean(
        `security.profiles.${name}.humanApprovalRequired`,
        profile.humanApprovalRequired ??
          profile.human_approval_required ??
          profile.requiresHumanApproval ??
          profile.requires_human_approval,
      ),
      securityProfile: optionalString(
        `security.profiles.${name}.securityProfile`,
        profile.securityProfile ?? profile.security_profile,
      ),
      allowedData: stringList(
        `security.profiles.${name}.allowedData`,
        profile.allowedData ?? profile.allowed_data ?? [],
      ),
      forbiddenInputs: stringList(
        `security.profiles.${name}.forbiddenInputs`,
        profile.forbiddenInputs ?? profile.forbidden_inputs ?? [],
      ),
      approvedDomains: stringList(
        `security.profiles.${name}.approvedDomains`,
        profile.approvedDomains ?? [],
      ),
      approvedUploadDomains: stringList(
        `security.profiles.${name}.approvedUploadDomains`,
        profile.approvedUploadDomains ?? [],
      ),
      disallowedCommands: stringList(
        `security.profiles.${name}.disallowedCommands`,
        profile.disallowedCommands ?? [],
      ),
    };
  }
  return normalized;
}

function optionalString(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ConfigError(`${name} must be a string.`);
  }
  return value;
}

function optionalBoolean(name: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ConfigError(`${name} must be a boolean.`);
  }
  return value;
}

function objectRecord(name: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ConfigError(`${name} must be an object.`);
  }
  return value;
}

function stringRecord(name: string, value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new ConfigError(`${name} must be an object of string values.`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new ConfigError(`${name}.${key} must be a string.`);
    }
  }
  return value as Record<string, string>;
}

function stringValue(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${name} must be a non-empty string.`);
  }
  return value;
}

function suppressionArray(value: unknown): SuppressionConfig[] {
  if (!Array.isArray(value)) {
    throw new ConfigError("suppressions must be an array.");
  }

  return value.map((item, index) => {
    const name = `suppressions[${index}]`;
    if (!isRecord(item)) {
      throw new ConfigError(`${name} must be an object.`);
    }
    const allowed = new Set(["id", "paths", "reason", "expires"]);
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) {
        throw new ConfigError(
          `Unknown suppression config key "${key}" in ${name}.`,
        );
      }
    }

    const id = stringValue(`${name}.id`, item.id);
    const paths = stringArray(`${name}.paths`, item.paths);
    if (paths.length === 0) {
      throw new ConfigError(`${name}.paths must include at least one path.`);
    }
    const reason = stringValue(`${name}.reason`, item.reason);
    const expires =
      item.expires === undefined
        ? undefined
        : suppressionExpiration(`${name}.expires`, item.expires);

    return {
      id,
      paths,
      reason,
      ...(expires === undefined ? {} : { expires }),
    };
  });
}

function suppressionExpiration(
  name: string,
  value: unknown,
): SuppressionExpiration {
  if (value === "never") return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConfigError(
      `${name} must be a date in YYYY-MM-DD format or "never".`,
    );
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) {
    throw new ConfigError(`${name} must be a valid date.`);
  }
  const normalized = new Date(timestamp).toISOString().slice(0, 10);
  if (normalized !== value) {
    throw new ConfigError(`${name} must be a valid date.`);
  }
  return value as SuppressionExpiration;
}
