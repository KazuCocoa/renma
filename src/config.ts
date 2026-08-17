import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import type {
  ContentTokenBudgetKind,
  LoadedConfig,
  ScanConfig,
} from "./types/configuration.js";
import type {
  Severity,
  SuppressionConfig,
  SuppressionExpiration,
} from "./types/diagnostics.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import {
  DEFAULT_SKILL_ENTRYPOINT_GLOBS,
  DEFAULT_SKILL_SUPPORT_GLOBS,
} from "./skill-path-contract.js";
import {
  REQUIRED_METADATA_POLICY_FIELDS,
  type RequiredMetadataPolicyField,
} from "./metadata-definitions.js";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const FORMATS = ["text", "json"] as const;
const SKILL_DISCOVERY_CI_POLICY_MODES = ["off", "warn"] as const;
const SECURITY_CI_POLICY_MODES = ["off", "warn", "fail"] as const;
const SCAN_BOUNDARY_CI_POLICY_MODES = ["off", "warn", "fail"] as const;
const EXECUTABLE_SURFACE_CI_POLICY_MODES = ["off", "warn", "fail"] as const;
const QUALITY_CI_POLICY_MODES = ["off", "warn", "fail"] as const;
const METADATA_CI_POLICY_MODES = ["off", "warn", "fail"] as const;
const CONTENT_TOKEN_BUDGET_KINDS = [
  "context",
  "reference",
  "profile",
  "example",
] as const satisfies readonly ContentTokenBudgetKind[];
const QUALITY_CONFIG_KEYS = [
  "ci_policy",
  "skill_token_warning",
  "skill_token_high",
  ...CONTENT_TOKEN_BUDGET_KINDS.flatMap((kind) => [
    `${kind}_token_warning`,
    `${kind}_token_high`,
  ]),
] as const;
const SECURITY_PROFILE_ALIAS_GROUPS = {
  allowedDataClass: ["allowedDataClass", "allowed_data_class"],
  networkAllowed: ["networkAllowed", "network_allowed"],
  externalUploadAllowed: ["externalUploadAllowed", "external_upload_allowed"],
  secretsAllowed: ["secretsAllowed", "secrets_allowed"],
  humanApprovalRequired: [
    "humanApprovalRequired",
    "human_approval_required",
    "requiresHumanApproval",
    "requires_human_approval",
  ],
  securityProfile: ["securityProfile", "security_profile"],
  allowedData: ["allowedData", "allowed_data"],
  forbiddenInputs: ["forbiddenInputs", "forbidden_inputs"],
} as const;

/** Conventional repository configuration filenames in loading precedence. */
export const CONFIG_FILENAMES = [
  "renma.config.jsonc",
  "renma.config.json",
  ".renma.json",
] as const;

/** Default scan configuration used when no config file or CLI overrides apply. */
export const DEFAULT_CONFIG: ScanConfig = {
  failOn: "high",
  format: "text",
  globs: [
    ...DEFAULT_SKILL_ENTRYPOINT_GLOBS,
    ".agents/**/*.md",
    "AGENTS.md",
    "README.md",
    "context/**/*.md",
    "contexts/**/*.md",
    "lenses/**/*.md",
    ...DEFAULT_SKILL_SUPPORT_GLOBS,
    "tools/**/*",
  ],
  exclude: ["node_modules", "dist", ".git"],
  maxFileSizeBytes: DEFAULT_QUALITY_PROFILE.scan.defaultMaxFileSizeBytes,
  maxDepth: DEFAULT_QUALITY_PROFILE.scan.defaultMaxDepth,
  concurrency: DEFAULT_QUALITY_PROFILE.scan.defaultConcurrency,
  suppressions: [],
  scanBoundary: {
    ciPolicy: "fail",
  },
  executableSurface: {
    ciPolicy: "off",
  },
  quality: {
    ciPolicy: "fail",
    skillTokenWarning: DEFAULT_QUALITY_PROFILE.skillTokenWarning,
    skillTokenHigh: DEFAULT_QUALITY_PROFILE.skillTokenHigh,
    skillTokenWarningSource: "renma_default",
    skillTokenHighSource: "renma_default",
    contentTokenBudgets: {
      context: defaultContentTokenBudget("context"),
      reference: defaultContentTokenBudget("reference"),
      profile: defaultContentTokenBudget("profile"),
      example: defaultContentTokenBudget("example"),
    },
  },
  metadata: {
    ciPolicy: "fail",
    required: [],
    requiredSource: "renma_default",
  },
  layout: {
    workflowAliases: {},
  },
  security: {
    approvedDomains: [],
    approvedUploadDomains: [],
    disallowedCommands: [],
    profiles: {},
    ciPolicy: "fail",
  },
  skillDiscovery: {
    adopted: false,
    ciPolicy: "off",
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
      quality: config.quality ?? cloneDefaultQualityConfig(),
      metadata: config.metadata ?? cloneDefaultMetadataConfig(),
      failOn: overrides.failOn ?? config.failOn ?? DEFAULT_CONFIG.failOn,
      format: overrides.format ?? config.format ?? DEFAULT_CONFIG.format,
    },
    ...(discoveredPath
      ? { configPath: toPosix(path.relative(root, discoveredPath)) }
      : {}),
  };
}

async function findDefaultConfig(root: string): Promise<string | undefined> {
  const candidates = CONFIG_FILENAMES.map((name) => path.join(root, name));
  const existing = (
    await Promise.all(
      candidates.map(async (candidate) =>
        (await pathExists(candidate)) ? candidate : undefined,
      ),
    )
  ).filter((candidate) => candidate !== undefined);

  if (existing.length > 1) {
    throw new ConfigError(
      `Multiple Renma configuration files found in ${root}: ${existing
        .map((candidate) => path.basename(candidate))
        .join(
          ", ",
        )}. Renma requires one unambiguous repository configuration and does not parse or merge multiple files. Keep renma.config.jsonc when comments are desired and remove the other supported configuration files.`,
    );
  }
  return existing[0];
}

async function readConfigFile(configPath: string): Promise<unknown> {
  const format = configFormat(configPath);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigError(
      `Could not read config file ${configPath}: ${errorMessage(error)}`,
    );
  }

  const errors: ParseError[] = [];
  const tree = parseTree(raw, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: format === "JSON",
  });
  const firstError = errors[0];
  if (firstError) {
    const location = sourceLocation(raw, firstError.offset);
    throw new ConfigError(
      `Config file ${configPath} is not valid ${format} at line ${location.line}, column ${location.column}: ${printParseErrorCode(firstError.error)}.`,
    );
  }
  const duplicate = tree ? findDuplicateProperty(tree) : undefined;
  if (duplicate) {
    const location = sourceLocation(raw, duplicate.offset);
    const firstLocation = sourceLocation(raw, duplicate.firstOffset);
    throw new ConfigError(
      `Config file ${configPath} contains duplicate property ${JSON.stringify(duplicate.key)} at ${duplicate.path} on line ${location.line}, column ${location.column}; it was first declared on line ${firstLocation.line}, column ${firstLocation.column}.`,
    );
  }
  return tree ? (getNodeValue(tree) as unknown) : undefined;
}

interface DuplicateProperty {
  key: string;
  path: string;
  offset: number;
  firstOffset: number;
}

/** Find the first duplicate property while preserving JSON syntax-tree scope. */
function findDuplicateProperty(
  node: JsonNode,
  pathSegments: Array<string | number> = [],
): DuplicateProperty | undefined {
  if (node.type === "object") {
    const firstOffsets = new Map<string, number>();
    for (const property of node.children ?? []) {
      const [keyNode, valueNode] = property.children ?? [];
      if (property.type !== "property" || typeof keyNode?.value !== "string") {
        continue;
      }
      const key = keyNode.value;
      const firstOffset = firstOffsets.get(key);
      if (firstOffset !== undefined) {
        return {
          key,
          path: formatJsonPath([...pathSegments, key]),
          offset: keyNode.offset,
          firstOffset,
        };
      }
      firstOffsets.set(key, keyNode.offset);
      if (valueNode) {
        const nested = findDuplicateProperty(valueNode, [...pathSegments, key]);
        if (nested) return nested;
      }
    }
  } else if (node.type === "array") {
    for (const [index, child] of (node.children ?? []).entries()) {
      const nested = findDuplicateProperty(child, [...pathSegments, index]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function formatJsonPath(segments: Array<string | number>): string {
  return segments.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment)
          ? result
            ? `${result}.${segment}`
            : segment
          : `${result}[${JSON.stringify(segment)}]`,
    "",
  );
}

function configFormat(configPath: string): "JSON" | "JSONC" {
  const extension = path.extname(configPath);
  if (extension === ".json") return "JSON";
  if (extension === ".jsonc") return "JSONC";
  throw new ConfigError(
    `Unsupported config file extension for ${configPath}. Renma configuration files must use .json or .jsonc; executable .js, .mjs, and .ts configuration is not supported.`,
  );
}

function sourceLocation(
  source: string,
  offset: number,
): { line: number; column: number } {
  const prefix = source.slice(0, offset);
  const lastLineBreak = prefix.lastIndexOf("\n");
  return {
    line: prefix.split("\n").length,
    column: offset - lastLineBreak,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
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
    "scan_boundary",
    "executable_surface",
    "quality",
    "metadata",
    "layout",
    "security",
    "skill_discovery",
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
  if (value.suppressions !== undefined)
    config.suppressions = suppressionArray(value.suppressions);
  if (value.scan_boundary !== undefined)
    config.scanBoundary = scanBoundaryPolicy(value.scan_boundary);
  if (value.executable_surface !== undefined)
    config.executableSurface = executableSurfacePolicy(
      value.executable_surface,
    );
  if (value.quality !== undefined)
    config.quality = qualityPolicy(value.quality);
  if (value.metadata !== undefined)
    config.metadata = metadataPolicy(value.metadata);

  if (value.layout !== undefined) config.layout = layoutPolicy(value.layout);
  if (value.security !== undefined)
    config.security = securityPolicy(value.security);
  if (value.skill_discovery !== undefined)
    config.skillDiscovery = skillDiscoveryPolicy(value.skill_discovery);
  return config;
}

function metadataPolicy(value: unknown): ScanConfig["metadata"] {
  if (!isRecord(value)) {
    throw new ConfigError("metadata must be an object.");
  }
  const allowed = new Set(["ci_policy", "required"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown metadata config key "${key}". Allowed keys: ci_policy, required.`,
      );
    }
  }

  const required =
    value.required === undefined ? [] : requiredMetadataFields(value.required);
  return {
    ciPolicy:
      value.ci_policy === undefined
        ? "fail"
        : enumValue(
            "metadata.ci_policy",
            value.ci_policy,
            METADATA_CI_POLICY_MODES,
          ),
    required,
    requiredSource:
      value.required === undefined
        ? "renma_default"
        : "repository_configuration",
  };
}

function requiredMetadataFields(value: unknown): RequiredMetadataPolicyField[] {
  if (!Array.isArray(value)) {
    throw new ConfigError("metadata.required must be an array of strings.");
  }
  const supported = new Set<string>(REQUIRED_METADATA_POLICY_FIELDS);
  const seen = new Set<string>();
  for (const [index, field] of value.entries()) {
    if (typeof field !== "string") {
      throw new ConfigError(
        `metadata.required[${index}] must be a supported field name string.`,
      );
    }
    if (!supported.has(field)) {
      throw new ConfigError(
        `Unsupported metadata.required field "${field}". Supported fields: ${REQUIRED_METADATA_POLICY_FIELDS.join(", ")}.`,
      );
    }
    if (seen.has(field)) {
      throw new ConfigError(
        `metadata.required contains duplicate field "${field}".`,
      );
    }
    seen.add(field);
  }
  return REQUIRED_METADATA_POLICY_FIELDS.filter((field) => seen.has(field));
}

function qualityPolicy(value: unknown): ScanConfig["quality"] {
  if (!isRecord(value)) {
    throw new ConfigError("quality must be an object.");
  }
  const allowed = new Set<string>(QUALITY_CONFIG_KEYS);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown quality config key "${key}". Allowed keys: ${QUALITY_CONFIG_KEYS.join(", ")}.`,
      );
    }
  }

  const hasWarning = value.skill_token_warning !== undefined;
  const hasHigh = value.skill_token_high !== undefined;
  const skillTokenWarning = hasWarning
    ? positiveSafeInteger(
        "quality.skill_token_warning",
        value.skill_token_warning,
      )
    : DEFAULT_QUALITY_PROFILE.skillTokenWarning;
  const skillTokenHigh = hasHigh
    ? positiveSafeInteger("quality.skill_token_high", value.skill_token_high)
    : DEFAULT_QUALITY_PROFILE.skillTokenHigh;
  if (skillTokenWarning >= skillTokenHigh) {
    throw new ConfigError(
      `quality.skill_token_warning (${skillTokenWarning}) must be strictly lower than quality.skill_token_high (${skillTokenHigh}).`,
    );
  }

  return {
    ciPolicy:
      value.ci_policy === undefined
        ? "fail"
        : enumValue(
            "quality.ci_policy",
            value.ci_policy,
            QUALITY_CI_POLICY_MODES,
          ),
    skillTokenWarning,
    skillTokenHigh,
    skillTokenWarningSource: hasWarning
      ? "repository_configuration"
      : "renma_default",
    skillTokenHighSource: hasHigh
      ? "repository_configuration"
      : "renma_default",
    contentTokenBudgets: {
      context: configuredContentTokenBudget(value, "context"),
      reference: configuredContentTokenBudget(value, "reference"),
      profile: configuredContentTokenBudget(value, "profile"),
      example: configuredContentTokenBudget(value, "example"),
    },
  };
}

function configuredContentTokenBudget(
  value: Record<string, unknown>,
  kind: ContentTokenBudgetKind,
): ScanConfig["quality"]["contentTokenBudgets"][ContentTokenBudgetKind] {
  const warningKey = `${kind}_token_warning`;
  const highKey = `${kind}_token_high`;
  const hasWarning = value[warningKey] !== undefined;
  const hasHigh = value[highKey] !== undefined;
  const warning = hasWarning
    ? positiveSafeInteger(`quality.${warningKey}`, value[warningKey])
    : DEFAULT_QUALITY_PROFILE.contentTokenWarning[kind];
  const high = hasHigh
    ? positiveSafeInteger(`quality.${highKey}`, value[highKey])
    : DEFAULT_QUALITY_PROFILE.contentTokenHigh[kind];
  if (warning >= high) {
    throw new ConfigError(
      `quality.${warningKey} (${warning}) must be strictly lower than quality.${highKey} (${high}).`,
    );
  }
  return {
    warning,
    high,
    warningSource: hasWarning ? "repository_configuration" : "renma_default",
    highSource: hasHigh ? "repository_configuration" : "renma_default",
  };
}

function defaultContentTokenBudget(
  kind: ContentTokenBudgetKind,
): ScanConfig["quality"]["contentTokenBudgets"][ContentTokenBudgetKind] {
  return {
    warning: DEFAULT_QUALITY_PROFILE.contentTokenWarning[kind],
    high: DEFAULT_QUALITY_PROFILE.contentTokenHigh[kind],
    warningSource: "renma_default",
    highSource: "renma_default",
  };
}

function cloneDefaultQualityConfig(): ScanConfig["quality"] {
  return {
    ...DEFAULT_CONFIG.quality,
    contentTokenBudgets: {
      context: { ...DEFAULT_CONFIG.quality.contentTokenBudgets.context },
      reference: { ...DEFAULT_CONFIG.quality.contentTokenBudgets.reference },
      profile: { ...DEFAULT_CONFIG.quality.contentTokenBudgets.profile },
      example: { ...DEFAULT_CONFIG.quality.contentTokenBudgets.example },
    },
  };
}

function cloneDefaultMetadataConfig(): ScanConfig["metadata"] {
  return {
    ...DEFAULT_CONFIG.metadata,
    required: [...DEFAULT_CONFIG.metadata.required],
  };
}

function executableSurfacePolicy(
  value: unknown,
): ScanConfig["executableSurface"] {
  if (!isRecord(value)) {
    throw new ConfigError("executable_surface must be an object.");
  }
  const allowed = new Set(["ci_policy"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown executable_surface config key "${key}". Allowed keys: ci_policy.`,
      );
    }
  }
  return {
    ciPolicy:
      value.ci_policy === undefined
        ? "off"
        : enumValue(
            "executable_surface.ci_policy",
            value.ci_policy,
            EXECUTABLE_SURFACE_CI_POLICY_MODES,
          ),
  };
}

function scanBoundaryPolicy(value: unknown): ScanConfig["scanBoundary"] {
  if (!isRecord(value)) {
    throw new ConfigError("scan_boundary must be an object.");
  }
  const allowed = new Set(["ci_policy"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown scan_boundary config key "${key}". Allowed keys: ci_policy.`,
      );
    }
  }
  return {
    ciPolicy:
      value.ci_policy === undefined
        ? "fail"
        : enumValue(
            "scan_boundary.ci_policy",
            value.ci_policy,
            SCAN_BOUNDARY_CI_POLICY_MODES,
          ),
  };
}

function skillDiscoveryPolicy(value: unknown): ScanConfig["skillDiscovery"] {
  if (!isRecord(value)) {
    throw new ConfigError("skill_discovery must be an object.");
  }
  const allowed = new Set(["adopted", "ci_policy"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `Unknown skill_discovery config key "${key}". Allowed keys: adopted, ci_policy.`,
      );
    }
  }
  if (value.adopted !== undefined && typeof value.adopted !== "boolean") {
    throw new ConfigError("skill_discovery.adopted must be a boolean.");
  }
  const adopted = value.adopted ?? false;
  const ciPolicy =
    value.ci_policy === undefined
      ? "off"
      : enumValue(
          "skill_discovery.ci_policy",
          value.ci_policy,
          SKILL_DISCOVERY_CI_POLICY_MODES,
        );
  if (ciPolicy === "warn" && adopted !== true) {
    throw new ConfigError(
      'skill_discovery.ci_policy "warn" requires skill_discovery.adopted to be true.',
    );
  }
  return { adopted, ciPolicy };
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

function stringList(field: string, value: unknown): string[] {
  if (typeof value === "string") return [value];
  return stringArray(field, value);
}

function positiveInteger(field: string, value: unknown): number {
  if (Number.isInteger(value) && typeof value === "number" && value > 0)
    return value;
  throw new ConfigError(`${field} must be a positive integer.`);
}

function positiveSafeInteger(field: string, value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  throw new ConfigError(`${field} must be a positive safe integer.`);
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
    throw new ConfigError("layout must be an object.");
  const layout = value as Record<string, unknown>;
  const allowed = new Set(["tool_namespace", "workflow_aliases"]);
  for (const key of Object.keys(layout)) {
    if (!allowed.has(key))
      throw new ConfigError(
        `Unknown layout config key "${key}". Allowed keys: ${[...allowed].join(
          ", ",
        )}.`,
      );
  }

  const toolNamespace =
    layout.tool_namespace === undefined
      ? undefined
      : stringValue("layout.tool_namespace", layout.tool_namespace);
  const workflowAliases =
    layout.workflow_aliases === undefined
      ? DEFAULT_CONFIG.layout.workflowAliases
      : stringRecord("layout.workflow_aliases", layout.workflow_aliases);

  return {
    ...(toolNamespace === undefined ? {} : { toolNamespace }),
    workflowAliases: {
      ...DEFAULT_CONFIG.layout.workflowAliases,
      ...workflowAliases,
    },
  };
}

function securityPolicy(value: unknown): ScanConfig["security"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("security must be an object.");
  }
  const security = value as Record<string, unknown>;
  const allowed = new Set([
    "approvedDomains",
    "approvedUploadDomains",
    "disallowedCommands",
    "profiles",
    "ci_policy",
  ]);
  for (const key of Object.keys(security)) {
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
      security.approvedDomains === undefined
        ? DEFAULT_CONFIG.security.approvedDomains
        : stringArray("security.approvedDomains", security.approvedDomains),
    approvedUploadDomains:
      security.approvedUploadDomains === undefined
        ? DEFAULT_CONFIG.security.approvedUploadDomains
        : stringArray(
            "security.approvedUploadDomains",
            security.approvedUploadDomains,
          ),
    disallowedCommands:
      security.disallowedCommands === undefined
        ? DEFAULT_CONFIG.security.disallowedCommands
        : stringArray(
            "security.disallowedCommands",
            security.disallowedCommands,
          ),
    profiles:
      security.profiles === undefined
        ? DEFAULT_CONFIG.security.profiles
        : securityProfiles(security.profiles),
    ciPolicy:
      security.ci_policy === undefined
        ? "fail"
        : enumValue(
            "security.ci_policy",
            security.ci_policy,
            SECURITY_CI_POLICY_MODES,
          ),
  };
}

function securityProfiles(
  value: unknown,
): NonNullable<ScanConfig["security"]["profiles"]> {
  const profiles = objectRecord("security.profiles", value);
  const normalized: NonNullable<ScanConfig["security"]["profiles"]> = {};
  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      throw new ConfigError(`security.profiles.${name} must be an object.`);
    }
    const source = profile as Record<string, unknown>;
    const allowed = new Set([
      ...Object.values(SECURITY_PROFILE_ALIAS_GROUPS).flat(),
      "approvedDomains",
      "approvedUploadDomains",
      "disallowedCommands",
    ]);
    for (const key of Object.keys(source)) {
      if (!allowed.has(key)) {
        throw new ConfigError(
          `Unknown security profile key "${key}" in security.profiles.${name}.`,
        );
      }
    }
    const profilePath = `security.profiles.${name}`;
    normalized[name] = {
      allowedDataClass: resolveAliasedValue({
        profilePath,
        field: "allowedDataClass",
        aliases: SECURITY_PROFILE_ALIAS_GROUPS.allowedDataClass,
        source,
        parse: optionalString,
      }),
      networkAllowed: resolveAliasedValue({
        profilePath,
        field: "networkAllowed",
        aliases: SECURITY_PROFILE_ALIAS_GROUPS.networkAllowed,
        source,
        parse: optionalBoolean,
      }),
      externalUploadAllowed: resolveAliasedValue({
        profilePath,
        field: "externalUploadAllowed",
        aliases: SECURITY_PROFILE_ALIAS_GROUPS.externalUploadAllowed,
        source,
        parse: optionalBoolean,
      }),
      secretsAllowed: resolveAliasedValue({
        profilePath,
        field: "secretsAllowed",
        aliases: SECURITY_PROFILE_ALIAS_GROUPS.secretsAllowed,
        source,
        parse: optionalBoolean,
      }),
      humanApprovalRequired: resolveAliasedValue({
        profilePath,
        field: "humanApprovalRequired",
        aliases: SECURITY_PROFILE_ALIAS_GROUPS.humanApprovalRequired,
        source,
        parse: optionalBoolean,
      }),
      securityProfile: resolveAliasedValue({
        profilePath,
        field: "securityProfile",
        aliases: SECURITY_PROFILE_ALIAS_GROUPS.securityProfile,
        source,
        parse: optionalString,
      }),
      allowedData:
        resolveAliasedValue({
          profilePath,
          field: "allowedData",
          aliases: SECURITY_PROFILE_ALIAS_GROUPS.allowedData,
          source,
          parse: stringList,
          // The first allowed-data value remains a compatibility class fallback.
          equals: sameOrderedStringListSemantics,
        }) ?? [],
      forbiddenInputs:
        resolveAliasedValue({
          profilePath,
          field: "forbiddenInputs",
          aliases: SECURITY_PROFILE_ALIAS_GROUPS.forbiddenInputs,
          source,
          parse: stringList,
          // Forbidden-input evaluation and normalized evidence are set-like.
          equals: sameStringSetSemantics,
        }) ?? [],
      approvedDomains: stringList(
        `security.profiles.${name}.approvedDomains`,
        source.approvedDomains ?? [],
      ),
      approvedUploadDomains: stringList(
        `security.profiles.${name}.approvedUploadDomains`,
        source.approvedUploadDomains ?? [],
      ),
      disallowedCommands: stringList(
        `security.profiles.${name}.disallowedCommands`,
        source.disallowedCommands ?? [],
      ),
    };
  }
  return normalized;
}

function resolveAliasedValue<T>(options: {
  profilePath: string;
  field: string;
  aliases: readonly string[];
  source: Record<string, unknown>;
  parse: (name: string, value: unknown) => T;
  equals?: (left: T, right: T) => boolean;
}): T | undefined {
  const present = options.aliases.filter((alias) =>
    Object.prototype.hasOwnProperty.call(options.source, alias),
  );
  if (present.length === 0) return undefined;

  const parsed = present.map((alias) =>
    options.parse(`${options.profilePath}.${alias}`, options.source[alias]),
  );
  const first = parsed[0]!;
  const equals = options.equals ?? Object.is;
  if (parsed.some((value) => !equals(first, value))) {
    const supplied = present
      .map((alias) => `${alias}=${describeConfigValue(options.source[alias])}`)
      .join(", ");
    throw new ConfigError(
      `${options.profilePath} has conflicting aliases for ${options.field}: ${supplied}. Use only one spelling or make all aliases equivalent.`,
    );
  }
  return first;
}

function sameOrderedStringListSemantics(
  left: string[],
  right: string[],
): boolean {
  const normalizedLeft = [...new Set(left)];
  const normalizedRight = [...new Set(right)];
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function sameStringSetSemantics(left: string[], right: string[]): boolean {
  const leftValues = new Set(left);
  const rightValues = new Set(right);
  return (
    leftValues.size === rightValues.size &&
    [...leftValues].every((value) => rightValues.has(value))
  );
}

function describeConfigValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringRecord(name: string, value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ConfigError(`${name} must be an object of string values.`);
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string")
      throw new ConfigError(`${name}.${key} must be a string.`);
  }
  return record as Record<string, string>;
}

function stringValue(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new ConfigError(`${name} must be a non-empty string.`);
  return value;
}

function suppressionArray(value: unknown): SuppressionConfig[] {
  if (!Array.isArray(value)) {
    throw new ConfigError("suppressions must be an array.");
  }

  return value.map((item, index) => {
    const name = `suppressions[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ConfigError(`${name} must be an object.`);
    }
    const source = item as Record<string, unknown>;
    const allowed = new Set(["id", "paths", "reason", "expires"]);
    for (const key of Object.keys(source)) {
      if (!allowed.has(key)) {
        throw new ConfigError(
          `Unknown suppression config key "${key}" in ${name}.`,
        );
      }
    }

    const id = stringValue(`${name}.id`, source.id);
    const paths = stringArray(`${name}.paths`, source.paths);
    if (paths.length === 0) {
      throw new ConfigError(`${name}.paths must include at least one path.`);
    }
    const reason = stringValue(`${name}.reason`, source.reason);
    const expires =
      source.expires === undefined
        ? undefined
        : suppressionExpiration(`${name}.expires`, source.expires);

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
