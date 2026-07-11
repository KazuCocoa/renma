import { parseDocument } from "./markdown.js";
import {
  metadataValueAsList,
  metadataValueAsText,
  readCanonicalRenmaMetadataField,
  readCanonicalRenmaMetadataValue,
  readLegacyRenmaMetadataField,
  readLegacyRenmaMetadataValue,
  type LegacyRenmaMetadataKey,
} from "./renma-metadata.js";
import type { Artifact, ArtifactKind, SecurityConfig } from "./types.js";

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

export function parseSecurityPolicy(
  content: string,
  artifactKind: ArtifactKind = "unknown",
): SecurityPolicy {
  const policy: SecurityPolicy = {
    allowedData: [],
    forbiddenInputs: [],
    approvedNetworkDestinations: [],
    approvedUploadDestinations: [],
    disallowedCommands: [],
    declared: new Set(),
    lineByField: new Map(),
  };

  const normalizedContent = securityFrontmatterContent(content);
  const document = parseDocument({
    path: "<security-policy>",
    absolutePath: "<security-policy>",
    kind: artifactKind,
    sizeBytes: Buffer.byteLength(normalizedContent),
    content: normalizedContent,
  } satisfies Artifact);

  for (const [key, booleanField] of BOOLEAN_POLICY_FIELDS) {
    const legacyKey = key as LegacyRenmaMetadataKey;
    const value = metadataValueAsText(
      readPolicyMetadataValue(document, legacyKey),
    );
    const parsed = value === undefined ? undefined : parseBoolean(value);
    if (parsed === undefined) continue;
    (policy[booleanField] as boolean | undefined) = parsed;
    declarePolicyField(document, policy, legacyKey, booleanField);
  }

  assignPolicyList(
    document,
    policy,
    "approved_network_destinations",
    "approvedNetworkDestinations",
  );
  assignPolicyList(
    document,
    policy,
    "approved_upload_destinations",
    "approvedUploadDestinations",
  );
  assignPolicyList(document, policy, "allowed_data", "allowedData");
  assignPolicyList(document, policy, "forbidden_inputs", "forbiddenInputs");

  const securityProfile = metadataValueAsText(
    readPolicyMetadataValue(document, "security_profile"),
  );
  if (securityProfile !== undefined) {
    policy.securityProfile = securityProfile;
    declarePolicyField(document, policy, "security_profile", "securityProfile");
  }

  return policy;
}

function securityFrontmatterContent(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() === "---") return content;
  const start = lines.findIndex(
    (line, index) => index < 80 && line.trim() === "---",
  );
  if (start < 0) return content;
  const end = lines.findIndex(
    (line, index) => index > start && line.trim() === "---",
  );
  return end > start ? lines.slice(start).join("\n") : content;
}

function assignPolicyList(
  document: ReturnType<typeof parseDocument>,
  policy: SecurityPolicy,
  metadataKey: LegacyRenmaMetadataKey,
  policyKey:
    | "approvedNetworkDestinations"
    | "approvedUploadDestinations"
    | "allowedData"
    | "forbiddenInputs",
): void {
  const value = readPolicyMetadataValue(document, metadataKey);
  if (value === undefined) return;
  policy[policyKey] = metadataValueAsList(value);
  declarePolicyField(document, policy, metadataKey, policyKey);
}

function declarePolicyField(
  document: ReturnType<typeof parseDocument>,
  policy: SecurityPolicy,
  metadataKey: LegacyRenmaMetadataKey,
  policyKey: keyof SecurityPolicy,
): void {
  policy.declared.add(policyKey);
  const line = readPolicyMetadataField(document, metadataKey)?.startLine;
  if (line !== undefined) policy.lineByField.set(policyKey, line);
}

function readPolicyMetadataValue(
  document: ReturnType<typeof parseDocument>,
  key: LegacyRenmaMetadataKey,
) {
  return document.artifact.kind === "skill"
    ? readCanonicalRenmaMetadataValue(document, key)
    : readLegacyRenmaMetadataValue(document, key);
}

function readPolicyMetadataField(
  document: ReturnType<typeof parseDocument>,
  key: LegacyRenmaMetadataKey,
) {
  return document.artifact.kind === "skill"
    ? readCanonicalRenmaMetadataField(document, key)
    : readLegacyRenmaMetadataField(document, key);
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
