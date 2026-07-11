import type { SecurityConfig } from "./types.js";

export interface SecurityPolicy {
  networkAllowed?: boolean;
  externalUploadAllowed?: boolean;
  secretsAllowed?: boolean;
  humanApprovalRequired?: boolean;
  securityProfile?: string;
  allowedDataClass?: string;
  allowedData: string[];
  forbiddenInputs: string[];
  approvedNetworkDestinations: string[];
  approvedUploadDestinations: string[];
  disallowedCommands: string[];
  declared: Set<string>;
  lineByField: Map<string, number>;
}

export interface SecurityProfileChainItem {
  name: string;
  profile: NonNullable<SecurityConfig["profiles"]>[string];
}

export interface SecurityProfileChain {
  profiles: SecurityProfileChainItem[];
  missingProfile?: string;
  cycle?: string[];
}

const BOOLEAN_POLICY_FIELDS = new Map<string, keyof SecurityPolicy>([
  ["network_allowed", "networkAllowed"],
  ["external_upload_allowed", "externalUploadAllowed"],
  ["secrets_allowed", "secretsAllowed"],
  ["requires_human_approval", "humanApprovalRequired"],
]);

const DESTINATION_POLICY_FIELDS = new Set(["approved_network_destinations"]);
const UPLOAD_DESTINATION_POLICY_FIELDS = new Set([
  "approved_upload_destinations",
]);
const ALLOWED_DATA_POLICY_FIELDS = new Set(["allowed_data"]);
const FORBIDDEN_INPUT_POLICY_FIELDS = new Set(["forbidden_inputs"]);
const SECURITY_PROFILE_POLICY_FIELDS = new Set(["security_profile"]);

const CANONICAL_SECURITY_KEYS = new Map<string, string>([
  ["network-allowed", "network_allowed"],
  ["external-upload-allowed", "external_upload_allowed"],
  ["secrets-allowed", "secrets_allowed"],
  ["requires-human-approval", "requires_human_approval"],
  ["approved-network-destinations", "approved_network_destinations"],
  ["approved-upload-destinations", "approved_upload_destinations"],
  ["allowed-data", "allowed_data"],
  ["forbidden-inputs", "forbidden_inputs"],
  ["security-profile", "security_profile"],
]);

type ParsedBlockList = {
  values: string[];
  nextIndex: number;
};

export function parseSecurityPolicy(content: string): SecurityPolicy {
  const policy: SecurityPolicy = {
    allowedData: [],
    forbiddenInputs: [],
    approvedNetworkDestinations: [],
    approvedUploadDestinations: [],
    disallowedCommands: [],
    declared: new Set(),
    lineByField: new Map(),
  };

  const lines = content.split(/\r?\n/);
  const frontmatterEnd =
    lines[0]?.trim() === "---"
      ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
      : -1;
  const scanEnd =
    frontmatterEnd > 0 ? frontmatterEnd : Math.min(lines.length, 80);
  let insideMetadata = false;

  for (let index = 0; index < scanEnd; index += 1) {
    const line = lines[index] ?? "";
    const topLevel = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (topLevel) {
      insideMetadata = (topLevel[1] ?? "") === "metadata";
    }

    const canonical = insideMetadata
      ? line.match(/^\s{2,}renma\.([A-Za-z0-9-]+):\s*(.*?)\s*$/)
      : undefined;
    const legacy = topLevel;
    const rawKey = canonical
      ? CANONICAL_SECURITY_KEYS.get(canonical[1] ?? "")
      : legacy?.[1];
    if (!rawKey) {
      if (insideMetadata && line.trim().length > 0 && !/^\s+/.test(line)) {
        insideMetadata = false;
      }
      continue;
    }

    const rawValue = canonical ? (canonical[2] ?? "") : (legacy?.[2] ?? "");
    const key = rawKey.trim();
    const value = decodeScalar(rawValue.trim());
    const blockList =
      value.length === 0 && !canonical
        ? parseBlockList(lines, index, scanEnd)
        : { values: [], nextIndex: index + 1 };

    const booleanField = BOOLEAN_POLICY_FIELDS.get(key);
    if (booleanField !== undefined) {
      const parsed = parseBoolean(value);
      if (parsed !== undefined) {
        (policy[booleanField] as boolean | undefined) = parsed;
        policy.declared.add(booleanField);
        policy.lineByField.set(booleanField, index + 1);
      }
      continue;
    }

    if (DESTINATION_POLICY_FIELDS.has(key)) {
      const destinations = policyListValues(value, blockList);
      policy.approvedNetworkDestinations.push(...destinations);
      policy.declared.add("approvedNetworkDestinations");
      policy.lineByField.set("approvedNetworkDestinations", index + 1);
      if (consumesBlockList(value, blockList)) index = blockList.nextIndex - 1;
      continue;
    }

    if (UPLOAD_DESTINATION_POLICY_FIELDS.has(key)) {
      const destinations = policyListValues(value, blockList);
      policy.approvedUploadDestinations.push(...destinations);
      policy.declared.add("approvedUploadDestinations");
      policy.lineByField.set("approvedUploadDestinations", index + 1);
      if (consumesBlockList(value, blockList)) index = blockList.nextIndex - 1;
      continue;
    }

    if (ALLOWED_DATA_POLICY_FIELDS.has(key)) {
      const values = policyListValues(value, blockList);
      policy.allowedData.push(...values);
      policy.declared.add("allowedData");
      policy.lineByField.set("allowedData", index + 1);
      if (consumesBlockList(value, blockList)) index = blockList.nextIndex - 1;
      continue;
    }

    if (FORBIDDEN_INPUT_POLICY_FIELDS.has(key)) {
      policy.forbiddenInputs.push(...policyListValues(value, blockList));
      policy.declared.add("forbiddenInputs");
      policy.lineByField.set("forbiddenInputs", index + 1);
      if (consumesBlockList(value, blockList)) index = blockList.nextIndex - 1;
      continue;
    }

    if (SECURITY_PROFILE_POLICY_FIELDS.has(key)) {
      policy.securityProfile = value;
      policy.declared.add("securityProfile");
      policy.lineByField.set("securityProfile", index + 1);
    }
  }

  return policy;
}

export function applySecurityConfig(
  policy: SecurityPolicy,
  config?: SecurityConfig,
): SecurityPolicy {
  if (config === undefined) return policy;

  const declared = new Set(policy.declared);
  const lineByField = new Map(policy.lineByField);
  const resolved: SecurityPolicy = {
    ...policy,
    allowedData: [...policy.allowedData],
    forbiddenInputs: [...policy.forbiddenInputs],
    approvedNetworkDestinations: [...policy.approvedNetworkDestinations],
    approvedUploadDestinations: [...policy.approvedUploadDestinations],
    disallowedCommands: [...policy.disallowedCommands],
    declared,
    lineByField,
  };

  const chain = securityProfileChain(policy.securityProfile, config);
  for (const item of chain.profiles) {
    const profile = item.profile;
    if (
      !declared.has("networkAllowed") &&
      profile.networkAllowed !== undefined
    ) {
      resolved.networkAllowed = profile.networkAllowed;
    }
    if (
      !declared.has("externalUploadAllowed") &&
      profile.externalUploadAllowed !== undefined
    ) {
      resolved.externalUploadAllowed = profile.externalUploadAllowed;
    }
    if (
      !declared.has("secretsAllowed") &&
      profile.secretsAllowed !== undefined
    ) {
      resolved.secretsAllowed = profile.secretsAllowed;
    }
    if (
      !declared.has("humanApprovalRequired") &&
      profile.humanApprovalRequired !== undefined
    ) {
      resolved.humanApprovalRequired = profile.humanApprovalRequired;
    }
    if (
      !declared.has("allowedData") &&
      profile.allowedDataClass !== undefined
    ) {
      resolved.allowedDataClass = profile.allowedDataClass;
    }
    if (!declared.has("allowedData")) {
      resolved.allowedData.push(...profile.allowedData);
    }
    if (!declared.has("forbiddenInputs")) {
      resolved.forbiddenInputs.push(...profile.forbiddenInputs);
    }
    resolved.approvedNetworkDestinations.push(...profile.approvedDomains);
    resolved.approvedUploadDestinations.push(...profile.approvedUploadDomains);
    resolved.disallowedCommands.push(...profile.disallowedCommands);
  }

  resolved.approvedNetworkDestinations.push(...config.approvedDomains);
  resolved.approvedUploadDestinations.push(...config.approvedUploadDomains);
  resolved.disallowedCommands.push(...config.disallowedCommands);
  resolved.allowedData = uniqueStrings(resolved.allowedData);
  resolved.forbiddenInputs = uniqueStrings(resolved.forbiddenInputs);
  resolved.approvedNetworkDestinations = uniqueStrings(
    resolved.approvedNetworkDestinations,
  );
  resolved.approvedUploadDestinations = uniqueStrings(
    resolved.approvedUploadDestinations,
  );
  resolved.disallowedCommands = uniqueStrings(resolved.disallowedCommands);

  return resolved;
}

export function securityProfileChain(
  name: string | undefined,
  config: SecurityConfig | undefined,
): SecurityProfileChain {
  if (name === undefined) return { profiles: [] };
  if (config === undefined) return { profiles: [], missingProfile: name };

  const profiles: SecurityProfileChainItem[] = [];
  const seen = new Set<string>();
  const path: string[] = [];
  let current: string | undefined = name;

  while (current !== undefined) {
    if (seen.has(current)) {
      return {
        profiles: [],
        cycle: [...path.slice(path.indexOf(current)), current],
      };
    }
    seen.add(current);
    path.push(current);

    const profile: NonNullable<SecurityConfig["profiles"]>[string] | undefined =
      config.profiles?.[current];
    if (profile === undefined) {
      return { profiles: [], missingProfile: current };
    }
    profiles.push({ name: current, profile });
    current = profile.securityProfile;
  }

  return { profiles: profiles.reverse() };
}

export function effectiveAllowedDataClass(
  policy: SecurityPolicy,
): string | undefined {
  return policy.allowedDataClass ?? policy.allowedData[0];
}

export function effectiveAllowedDataList(policy: SecurityPolicy): string[] {
  return policy.allowedData;
}

export function isSecurityPolicyLine(line: string): boolean {
  const legacyKey = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):/)?.[1];
  const canonicalKey = line.match(/^\s*renma\.([A-Za-z0-9-]+):/)?.[1];
  const key =
    legacyKey ??
    (canonicalKey ? CANONICAL_SECURITY_KEYS.get(canonicalKey) : undefined);
  return (
    key !== undefined &&
    (BOOLEAN_POLICY_FIELDS.has(key) ||
      DESTINATION_POLICY_FIELDS.has(key) ||
      UPLOAD_DESTINATION_POLICY_FIELDS.has(key) ||
      ALLOWED_DATA_POLICY_FIELDS.has(key) ||
      FORBIDDEN_INPUT_POLICY_FIELDS.has(key) ||
      SECURITY_PROFILE_POLICY_FIELDS.has(key))
  );
}

function parseBlockList(
  lines: string[],
  startIndex: number,
  scanEnd: number,
): ParsedBlockList {
  const values: string[] = [];
  let index = startIndex + 1;
  for (; index < scanEnd; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) break;

    const match = line.match(/^\s*-\s*(.*?)\s*$/);
    if (!match) break;

    values.push(...parseList(match[1] ?? ""));
  }

  return { values, nextIndex: index };
}

function policyListValues(value: string, blockList: ParsedBlockList): string[] {
  return value.length > 0 ? parseList(value) : blockList.values;
}

function consumesBlockList(value: string, blockList: ParsedBlockList): boolean {
  return value.length === 0 && blockList.values.length > 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = decodeScalar(value).toLowerCase();
  if (["true", "yes", "allowed", "allow", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "denied", "deny", "0"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseList(value: string): string[] {
  const decoded = decodeScalar(value).trim();
  if (decoded.startsWith("[") && decoded.endsWith("]")) {
    try {
      const parsed = JSON.parse(decoded) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every((item): item is string => typeof item === "string")
      ) {
        return parsed.map((item) => item.trim()).filter(Boolean);
      }
    } catch {
      // Fall through to the legacy comma-separated representation.
    }
  }
  return decoded
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => decodeScalar(item.trim()))
    .filter((item) => item.length > 0);
}

function decodeScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}
