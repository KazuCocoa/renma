import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import { compareUtf16CodeUnits } from "./canonical-json.js";
import {
  REQUIRED_METADATA_POLICY_FIELDS,
  type RequiredMetadataPolicyField,
} from "./metadata-definitions.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import { safeRepositoryPath } from "./repository-boundary.js";
import {
  DEFAULT_SKILL_ENTRYPOINT_GLOBS,
  DEFAULT_SKILL_SUPPORT_GLOBS,
} from "./skill-path-contract.js";
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
const METADATA_CONFIG_KEYS = ["ci_policy", "required"] as const;
const SUPPRESSION_CONFIG_KEYS = ["id", "paths", "reason", "expires"] as const;
const SCAN_BOUNDARY_CONFIG_KEYS = ["ci_policy"] as const;
const EXECUTABLE_SURFACE_CONFIG_KEYS = ["ci_policy"] as const;
const SKILL_DISCOVERY_CONFIG_KEYS = ["adopted", "ci_policy"] as const;
const TOP_LEVEL_CONFIG_KEYS = [
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
  "security",
  "skill_discovery",
] as const;
const SECURITY_CONFIG_KEYS = [
  "approvedDomains",
  "approvedUploadDomains",
  "disallowedCommands",
  "profiles",
  "ci_policy",
] as const;
const SECURITY_PROFILE_KEYS = {
  allowedDataClass: "allowed_data_class",
  networkAllowed: "network_allowed",
  externalUploadAllowed: "external_upload_allowed",
  secretsAllowed: "secrets_allowed",
  humanApprovalRequired: "requires_human_approval",
  securityProfile: "security_profile",
  allowedData: "allowed_data",
  forbiddenInputs: "forbidden_inputs",
  approvedDomains: "approvedDomains",
  approvedUploadDomains: "approvedUploadDomains",
  disallowedCommands: "disallowedCommands",
} as const;

const SECURITY_PROFILE_LEGACY_KEYS = new Map<string, string>([
  ["allowedDataClass", SECURITY_PROFILE_KEYS.allowedDataClass],
  ["networkAllowed", SECURITY_PROFILE_KEYS.networkAllowed],
  ["externalUploadAllowed", SECURITY_PROFILE_KEYS.externalUploadAllowed],
  ["secretsAllowed", SECURITY_PROFILE_KEYS.secretsAllowed],
  ["humanApprovalRequired", SECURITY_PROFILE_KEYS.humanApprovalRequired],
  ["human_approval_required", SECURITY_PROFILE_KEYS.humanApprovalRequired],
  ["requiresHumanApproval", SECURITY_PROFILE_KEYS.humanApprovalRequired],
  ["securityProfile", SECURITY_PROFILE_KEYS.securityProfile],
  ["allowedData", SECURITY_PROFILE_KEYS.allowedData],
  ["forbiddenInputs", SECURITY_PROFILE_KEYS.forbiddenInputs],
] as const);
const TOP_LEVEL_CONFIG_KEY_REGISTRY = configurationKeyRegistry(
  TOP_LEVEL_CONFIG_KEYS,
);
const QUALITY_CONFIG_KEY_REGISTRY =
  configurationKeyRegistry(QUALITY_CONFIG_KEYS);
const METADATA_CONFIG_KEY_REGISTRY =
  configurationKeyRegistry(METADATA_CONFIG_KEYS);
const SUPPRESSION_CONFIG_KEY_REGISTRY = configurationKeyRegistry(
  SUPPRESSION_CONFIG_KEYS,
);
const SCAN_BOUNDARY_CONFIG_KEY_REGISTRY = configurationKeyRegistry(
  SCAN_BOUNDARY_CONFIG_KEYS,
);
const EXECUTABLE_SURFACE_CONFIG_KEY_REGISTRY = configurationKeyRegistry(
  EXECUTABLE_SURFACE_CONFIG_KEYS,
);
const SECURITY_CONFIG_KEY_REGISTRY =
  configurationKeyRegistry(SECURITY_CONFIG_KEYS);
const SECURITY_PROFILE_CONFIG_KEY_REGISTRY = configurationKeyRegistry(
  Object.values(SECURITY_PROFILE_KEYS),
);
const SKILL_DISCOVERY_CONFIG_KEY_REGISTRY = configurationKeyRegistry(
  SKILL_DISCOVERY_CONFIG_KEYS,
);

/** Conventional repository configuration filenames in loading precedence. */
export const CONFIG_FILENAMES = [
  "renma.config.jsonc",
  "renma.config.json",
] as const;
export const LEGACY_CONFIG_FILENAME = ".renma.json" as const;

/** Default scan configuration used when no config file or CLI overrides apply. */
export const DEFAULT_CONFIG: ScanConfig = {
  failOn: "high",
  format: "text",
  globs: [
    ...DEFAULT_SKILL_ENTRYPOINT_GLOBS,
    ".agents/**/*.md",
    "AGENTS.md",
    "README.md",
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
  const explicitConfigPath = overrides.configPath;
  if (
    explicitConfigPath &&
    path.basename(explicitConfigPath) === LEGACY_CONFIG_FILENAME
  ) {
    throw legacyConfigError(explicitConfigPath);
  }
  const discoveredPath = explicitConfigPath
    ? await resolveExplicitConfig(root, explicitConfigPath)
    : await findDefaultConfig(root);
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
  const existing: string[] = [];
  for (const filename of CONFIG_FILENAMES) {
    const candidate = await resolveRepositoryConfig(root, filename, false);
    if (candidate) existing.push(candidate);
  }

  if (existing.length > 1) {
    throw new ConfigError(
      `Multiple Renma configuration files found in ${root}: ${existing
        .map((candidate) => path.basename(candidate))
        .join(
          ", ",
        )}. Renma requires one unambiguous repository configuration and does not parse or merge multiple files. Keep renma.config.jsonc when comments are desired and remove the other supported configuration file.`,
    );
  }
  const legacyPath = await resolveRepositoryConfig(
    root,
    LEGACY_CONFIG_FILENAME,
    false,
  );
  if (legacyPath) throw legacyConfigError(legacyPath);
  return existing[0];
}

async function resolveExplicitConfig(
  root: string,
  configPath: string,
): Promise<string> {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(configPath);
  const relativePath = toPosix(path.relative(absoluteRoot, absolutePath));
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  ) {
    throw new ConfigError(
      `Explicit config file ${configPath} must be a regular file inside repository root ${absoluteRoot}. External configuration is not repository policy authority.`,
    );
  }
  const resolved = await resolveRepositoryConfig(
    absoluteRoot,
    relativePath,
    true,
  );
  if (!resolved) {
    throw new ConfigError(`Config file ${configPath} does not exist.`);
  }
  return resolved;
}

async function resolveRepositoryConfig(
  root: string,
  relativePath: string,
  required: boolean,
): Promise<string | undefined> {
  const inspected = await safeRepositoryPath(root, relativePath);
  const displayPath = path.join(root, relativePath);
  switch (inspected.state) {
    case "absent":
      if (!required) return undefined;
      throw new ConfigError(`Config file ${displayPath} does not exist.`);
    case "outside":
      throw new ConfigError(
        `Config file ${displayPath} is outside the repository configuration boundary.`,
      );
    case "symlink":
      throw new ConfigError(
        `Config file ${displayPath} crosses symbolic link ${inspected.boundaryPath}. Renma configuration must be a non-symlink regular file inside the repository.`,
      );
    case "unreadable":
      throw new ConfigError(
        `Could not safely inspect config file ${displayPath}. Check its path and permissions.`,
      );
    case "present":
      if (!inspected.stats.isFile()) {
        throw new ConfigError(
          `Config path ${displayPath} must be a regular file inside the repository.`,
        );
      }
      return inspected.absolutePath;
  }
}

function legacyConfigError(configPath: string): ConfigError {
  return new ConfigError(
    `Legacy Renma configuration ${configPath} is not supported in v1. Rename it to renma.config.json for JSON or renma.config.jsonc when comments are needed.`,
  );
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

function normalizeConfig(
  value: unknown,
  configPath?: string,
): Partial<ScanConfig> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new ConfigError(`Config${label(configPath)} must be a JSON object.`);
  }
  validateConfigurationStructure(value);
  validateConfigurationKeys(value);

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
function securityPolicy(value: unknown): ScanConfig["security"] {
  if (!isRecord(value)) {
    throw new ConfigError("security must be an object.");
  }
  const security = value;

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
    if (!isRecord(profile)) {
      throw new ConfigError(`security.profiles.${name} must be an object.`);
    }
  }

  for (const [name, profile] of Object.entries(profiles)) {
    const source = profile as Record<string, unknown>;
    const profilePath = `security.profiles.${name}`;
    normalized[name] = {
      allowedDataClass: optionalString(
        `${profilePath}.${SECURITY_PROFILE_KEYS.allowedDataClass}`,
        source[SECURITY_PROFILE_KEYS.allowedDataClass],
      ),
      networkAllowed: optionalBoolean(
        `${profilePath}.${SECURITY_PROFILE_KEYS.networkAllowed}`,
        source[SECURITY_PROFILE_KEYS.networkAllowed],
      ),
      externalUploadAllowed: optionalBoolean(
        `${profilePath}.${SECURITY_PROFILE_KEYS.externalUploadAllowed}`,
        source[SECURITY_PROFILE_KEYS.externalUploadAllowed],
      ),
      secretsAllowed: optionalBoolean(
        `${profilePath}.${SECURITY_PROFILE_KEYS.secretsAllowed}`,
        source[SECURITY_PROFILE_KEYS.secretsAllowed],
      ),
      humanApprovalRequired: optionalBoolean(
        `${profilePath}.${SECURITY_PROFILE_KEYS.humanApprovalRequired}`,
        source[SECURITY_PROFILE_KEYS.humanApprovalRequired],
      ),
      securityProfile: optionalString(
        `${profilePath}.${SECURITY_PROFILE_KEYS.securityProfile}`,
        source[SECURITY_PROFILE_KEYS.securityProfile],
      ),
      allowedData: stringList(
        `${profilePath}.${SECURITY_PROFILE_KEYS.allowedData}`,
        source[SECURITY_PROFILE_KEYS.allowedData] ?? [],
      ),
      forbiddenInputs: stringList(
        `${profilePath}.${SECURITY_PROFILE_KEYS.forbiddenInputs}`,
        source[SECURITY_PROFILE_KEYS.forbiddenInputs] ?? [],
      ),
      approvedDomains: stringList(
        `${profilePath}.${SECURITY_PROFILE_KEYS.approvedDomains}`,
        source[SECURITY_PROFILE_KEYS.approvedDomains] ?? [],
      ),
      approvedUploadDomains: stringList(
        `${profilePath}.${SECURITY_PROFILE_KEYS.approvedUploadDomains}`,
        source[SECURITY_PROFILE_KEYS.approvedUploadDomains] ?? [],
      ),
      disallowedCommands: stringList(
        `${profilePath}.${SECURITY_PROFILE_KEYS.disallowedCommands}`,
        source[SECURITY_PROFILE_KEYS.disallowedCommands] ?? [],
      ),
    };
  }
  return normalized;
}

interface ConfigurationKeyRegistry {
  acceptedKeys: ReadonlySet<string>;
  sortedKeys: readonly string[];
}

function configurationKeyRegistry(
  keys: readonly string[],
): ConfigurationKeyRegistry {
  return {
    acceptedKeys: new Set(keys),
    sortedKeys: [...keys].sort(compareUtf16CodeUnits),
  };
}

type ConfigurationKeyScope =
  | "top-level"
  | "quality"
  | "metadata"
  | "suppression"
  | "scan-boundary"
  | "executable-surface"
  | "security"
  | "security-profile"
  | "skill-discovery";
type ConfigurationKeyIssueKind = "historical" | "removed" | "unknown";

interface ConfigurationKeyIssueBase {
  scope: ConfigurationKeyScope;
  key: string;
  profileName?: string;
  suppressionIndex?: number;
}

type ConfigurationKeyIssue = ConfigurationKeyIssueBase &
  (
    | { kind: "historical"; replacement: string }
    | { kind: "removed" | "unknown"; replacement?: never }
  );

const CONFIGURATION_KEY_SCOPE_ORDER: Record<ConfigurationKeyScope, number> = {
  "top-level": 0,
  quality: 1,
  metadata: 2,
  suppression: 3,
  "scan-boundary": 4,
  "executable-surface": 5,
  security: 6,
  "security-profile": 7,
  "skill-discovery": 8,
};
const CONFIGURATION_KEY_SCOPES_IN_ORDER = (
  Object.keys(CONFIGURATION_KEY_SCOPE_ORDER) as ConfigurationKeyScope[]
).sort(
  (left, right) =>
    CONFIGURATION_KEY_SCOPE_ORDER[left] - CONFIGURATION_KEY_SCOPE_ORDER[right],
);

function validateConfigurationStructure(config: Record<string, unknown>): void {
  if (config.quality !== undefined && !isRecord(config.quality)) {
    throw new ConfigError("quality must be an object.");
  }
  if (config.metadata !== undefined && !isRecord(config.metadata)) {
    throw new ConfigError("metadata must be an object.");
  }
  if (config.suppressions !== undefined) {
    if (!Array.isArray(config.suppressions)) {
      throw new ConfigError("suppressions must be an array.");
    }
    for (const [index, suppression] of config.suppressions.entries()) {
      if (!isRecord(suppression)) {
        throw new ConfigError(`suppressions[${index}] must be an object.`);
      }
    }
  }
  if (config.scan_boundary !== undefined && !isRecord(config.scan_boundary)) {
    throw new ConfigError("scan_boundary must be an object.");
  }
  if (
    config.executable_surface !== undefined &&
    !isRecord(config.executable_surface)
  ) {
    throw new ConfigError("executable_surface must be an object.");
  }
  if (config.security !== undefined && !isRecord(config.security)) {
    throw new ConfigError("security must be an object.");
  }
  if (isRecord(config.security) && config.security.profiles !== undefined) {
    if (!isRecord(config.security.profiles)) {
      throw new ConfigError("security.profiles must be an object.");
    }
    for (const profileName of Object.keys(config.security.profiles).sort(
      compareUtf16CodeUnits,
    )) {
      if (!isRecord(config.security.profiles[profileName])) {
        throw new ConfigError(
          `security.profiles.${profileName} must be an object.`,
        );
      }
    }
  }
  if (
    config.skill_discovery !== undefined &&
    !isRecord(config.skill_discovery)
  ) {
    throw new ConfigError("skill_discovery must be an object.");
  }
}

function validateConfigurationKeys(config: Record<string, unknown>): void {
  const issues: ConfigurationKeyIssue[] = [];
  for (const key of Object.keys(config)) {
    if (TOP_LEVEL_CONFIG_KEY_REGISTRY.acceptedKeys.has(key)) continue;
    issues.push({
      scope: "top-level",
      key,
      kind: key === "layout" ? "removed" : "unknown",
    });
  }

  if (isRecord(config.quality)) {
    collectUnknownConfigurationKeys(
      "quality",
      config.quality,
      QUALITY_CONFIG_KEY_REGISTRY,
      issues,
    );
  }
  if (isRecord(config.metadata)) {
    collectUnknownConfigurationKeys(
      "metadata",
      config.metadata,
      METADATA_CONFIG_KEY_REGISTRY,
      issues,
    );
  }
  if (Array.isArray(config.suppressions)) {
    for (const [
      suppressionIndex,
      suppression,
    ] of config.suppressions.entries()) {
      if (!isRecord(suppression)) continue;
      collectUnknownConfigurationKeys(
        "suppression",
        suppression,
        SUPPRESSION_CONFIG_KEY_REGISTRY,
        issues,
        { suppressionIndex },
      );
    }
  }
  if (isRecord(config.scan_boundary)) {
    collectUnknownConfigurationKeys(
      "scan-boundary",
      config.scan_boundary,
      SCAN_BOUNDARY_CONFIG_KEY_REGISTRY,
      issues,
    );
  }
  if (isRecord(config.executable_surface)) {
    collectUnknownConfigurationKeys(
      "executable-surface",
      config.executable_surface,
      EXECUTABLE_SURFACE_CONFIG_KEY_REGISTRY,
      issues,
    );
  }
  if (isRecord(config.security)) {
    collectUnknownConfigurationKeys(
      "security",
      config.security,
      SECURITY_CONFIG_KEY_REGISTRY,
      issues,
    );
    if (isRecord(config.security.profiles)) {
      collectSecurityProfileKeyIssues(config.security.profiles, issues);
    }
  }
  if (isRecord(config.skill_discovery)) {
    collectUnknownConfigurationKeys(
      "skill-discovery",
      config.skill_discovery,
      SKILL_DISCOVERY_CONFIG_KEY_REGISTRY,
      issues,
    );
  }
  if (issues.length === 0) return;

  issues.sort(compareConfigurationKeyIssues);
  throw new ConfigError(formatConfigurationKeyIssues(issues));
}

function collectUnknownConfigurationKeys(
  scope: ConfigurationKeyScope,
  config: Record<string, unknown>,
  registry: ConfigurationKeyRegistry,
  issues: ConfigurationKeyIssue[],
  context: Pick<
    ConfigurationKeyIssueBase,
    "profileName" | "suppressionIndex"
  > = {},
): void {
  for (const key of Object.keys(config)) {
    if (registry.acceptedKeys.has(key)) continue;
    issues.push({ scope, key, kind: "unknown", ...context });
  }
}

function collectSecurityProfileKeyIssues(
  profiles: Record<string, unknown>,
  issues: ConfigurationKeyIssue[],
): void {
  for (const [profileName, profile] of Object.entries(profiles)) {
    if (!isRecord(profile)) continue;
    for (const key of Object.keys(profile)) {
      if (SECURITY_PROFILE_CONFIG_KEY_REGISTRY.acceptedKeys.has(key)) continue;
      const replacement = SECURITY_PROFILE_LEGACY_KEYS.get(key);
      if (replacement) {
        issues.push({
          scope: "security-profile",
          profileName,
          key,
          kind: "historical",
          replacement,
        });
      } else {
        issues.push({
          scope: "security-profile",
          profileName,
          key,
          kind: "unknown",
        });
      }
    }
  }
}

function compareConfigurationKeyIssues(
  left: ConfigurationKeyIssue,
  right: ConfigurationKeyIssue,
): number {
  return (
    CONFIGURATION_KEY_SCOPE_ORDER[left.scope] -
      CONFIGURATION_KEY_SCOPE_ORDER[right.scope] ||
    (left.suppressionIndex ?? -1) - (right.suppressionIndex ?? -1) ||
    compareUtf16CodeUnits(left.profileName ?? "", right.profileName ?? "") ||
    compareUtf16CodeUnits(left.key, right.key)
  );
}

function formatConfigurationKeyIssues(
  issues: readonly ConfigurationKeyIssue[],
): string {
  const lines = ["Unsupported configuration keys found:"];
  let previousGroup: string | undefined;
  for (const issue of issues) {
    const group = configurationKeyIssueGroup(issue);
    if (group !== previousGroup) {
      lines.push("", `${group}:`);
      previousGroup = group;
    }
    lines.push(formatConfigurationKeyIssue(issue));
  }

  const unknownScopes = new Set(
    issues
      .filter((issue) => issue.kind === "unknown")
      .map((issue) => issue.scope),
  );
  for (const scope of CONFIGURATION_KEY_SCOPES_IN_ORDER) {
    if (!unknownScopes.has(scope)) continue;
    lines.push("", allowedConfigurationKeys(scope));
  }
  lines.push("", configurationKeyIssueAction(issues));
  return lines.join("\n");
}

function configurationKeyIssueGroup(issue: ConfigurationKeyIssue): string {
  switch (issue.scope) {
    case "top-level":
      return "Top-level configuration";
    case "quality":
      return "quality";
    case "metadata":
      return "metadata";
    case "suppression":
      return `suppressions[${issue.suppressionIndex}]`;
    case "scan-boundary":
      return "scan_boundary";
    case "executable-surface":
      return "executable_surface";
    case "security":
      return "security";
    case "security-profile":
      return `security.profiles.${issue.profileName}`;
    case "skill-discovery":
      return "skill_discovery";
  }
}

function formatConfigurationKeyIssue(issue: ConfigurationKeyIssue): string {
  switch (issue.kind) {
    case "historical":
      return `- ${JSON.stringify(issue.key)} -> use ${JSON.stringify(issue.replacement)} (historical)`;
    case "removed":
      return `- ${JSON.stringify(issue.key)} -> remove this field; there is no replacement (removed)`;
    case "unknown":
      return `- ${JSON.stringify(issue.key)} (unknown)`;
  }
}

function allowedConfigurationKeys(scope: ConfigurationKeyScope): string {
  switch (scope) {
    case "top-level":
      return allowedConfigurationKeysMessage(
        "top-level",
        TOP_LEVEL_CONFIG_KEY_REGISTRY,
      );
    case "quality":
      return allowedConfigurationKeysMessage(
        "quality",
        QUALITY_CONFIG_KEY_REGISTRY,
      );
    case "metadata":
      return allowedConfigurationKeysMessage(
        "metadata",
        METADATA_CONFIG_KEY_REGISTRY,
      );
    case "suppression":
      return allowedConfigurationKeysMessage(
        "suppression",
        SUPPRESSION_CONFIG_KEY_REGISTRY,
      );
    case "scan-boundary":
      return allowedConfigurationKeysMessage(
        "scan_boundary",
        SCAN_BOUNDARY_CONFIG_KEY_REGISTRY,
      );
    case "executable-surface":
      return allowedConfigurationKeysMessage(
        "executable_surface",
        EXECUTABLE_SURFACE_CONFIG_KEY_REGISTRY,
      );
    case "security":
      return allowedConfigurationKeysMessage(
        "security",
        SECURITY_CONFIG_KEY_REGISTRY,
      );
    case "security-profile":
      return allowedConfigurationKeysMessage(
        "security profile",
        SECURITY_PROFILE_CONFIG_KEY_REGISTRY,
      );
    case "skill-discovery":
      return allowedConfigurationKeysMessage(
        "skill_discovery",
        SKILL_DISCOVERY_CONFIG_KEY_REGISTRY,
      );
  }
}

function allowedConfigurationKeysMessage(
  label: string,
  registry: ConfigurationKeyRegistry,
): string {
  return `Allowed ${label} keys: ${registry.sortedKeys.join(", ")}.`;
}

function configurationKeyIssueAction(
  issues: readonly ConfigurationKeyIssue[],
): string {
  const kinds = new Set(issues.map((issue) => issue.kind));
  const descriptions = ["removed", "historical", "unknown"].filter((kind) =>
    kinds.has(kind as ConfigurationKeyIssueKind),
  );
  const action = kinds.has("historical")
    ? kinds.size === 1
      ? "Update every listed key"
      : "Apply every listed replacement and remove every listed key without one"
    : "Remove every listed key";
  return `Renma v1 does not interpret these ${joinWithOr(descriptions)} configuration keys. ${action} and rerun \`renma scan .\`.`;
}

function joinWithOr(values: readonly string[]): string {
  if (values.length === 1) return values[0] ?? "unsupported";
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
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
