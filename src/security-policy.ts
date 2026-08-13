import { inspectAgentSkill } from "./agent-skills.js";
import {
  parseFloatingDependencyAllowance,
  type FloatingDependencyAllowance,
} from "./dependency-selectors.js";
import { parseDocument } from "./markdown.js";
import type { Artifact } from "./types/artifact.js";
import type { ParsedDocument } from "./types/metadata.js";
import type { SecurityConfig } from "./types/configuration.js";
import type { YamlFrontmatterField } from "./yaml-frontmatter.js";
import {
  SECURITY_METADATA_FIELD_DEFINITIONS,
  type CanonicalSecurityOperationalField,
  type SecurityMetadataFieldDefinition,
} from "./metadata-definitions.js";

export type { CanonicalSecurityOperationalField } from "./metadata-definitions.js";

export interface SecurityPolicyFieldEvidence {
  startLine: number;
  endLine: number;
  snippet: string;
}

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
  allowedFloatingDependencies: FloatingDependencyAllowance[];
  disallowedCommands: string[];
  declared: Set<string>;
  invalidDeclared: Set<string>;
  lineByField: Map<string, number>;
  evidenceByField: Map<string, SecurityPolicyFieldEvidence>;
}

export type EffectivePolicySource =
  "local" | "security_profile" | "repository_config";

export interface ResolvedSecurityPolicy {
  policy: SecurityPolicy;
  policySources: EffectivePolicySource[];
}

export interface CanonicalSecurityMetadataIssue {
  key: string;
  operationalField: CanonicalSecurityOperationalField;
  reason: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface CanonicalSecurityMetadataResult {
  policy: SecurityPolicy;
  issues: CanonicalSecurityMetadataIssue[];
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

const BOOLEAN_POLICY_FIELDS = new Map<string, keyof SecurityPolicy>(
  SECURITY_METADATA_FIELD_DEFINITIONS.filter(
    (definition) => definition.encoding === "boolean",
  ).map((definition) => [definition.nonSkillKey, definition.operationalField]),
);

const DESTINATION_POLICY_FIELDS = nonSkillSecurityFields(
  "approvedNetworkDestinations",
);
const UPLOAD_DESTINATION_POLICY_FIELDS = nonSkillSecurityFields(
  "approvedUploadDestinations",
);
const ALLOWED_DATA_POLICY_FIELDS = nonSkillSecurityFields("allowedData");
const FORBIDDEN_INPUT_POLICY_FIELDS = nonSkillSecurityFields("forbiddenInputs");
const ALLOWED_FLOATING_DEPENDENCY_POLICY_FIELDS = nonSkillSecurityFields(
  "allowedFloatingDependencies",
);
const SECURITY_PROFILE_POLICY_FIELDS =
  nonSkillSecurityFields("securityProfile");

const CANONICAL_SECURITY_FIELDS: ReadonlyMap<
  string,
  SecurityMetadataFieldDefinition
> = new Map(
  SECURITY_METADATA_FIELD_DEFINITIONS.map((definition) => [
    definition.skillKey,
    definition,
  ]),
);

function nonSkillSecurityFields(
  operationalField: CanonicalSecurityOperationalField,
): Set<string> {
  return new Set(
    SECURITY_METADATA_FIELD_DEFINITIONS.filter(
      (definition) => definition.operationalField === operationalField,
    ).map((definition) => definition.nonSkillKey),
  );
}

type ParsedBlockList = {
  values: string[];
  nextIndex: number;
};

export function parseSecurityPolicy(content: string): SecurityPolicy {
  const policy = emptySecurityPolicy();

  const lines = content.split(/\r?\n/);
  const frontmatterEnd =
    lines[0]?.trim() === "---"
      ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
      : -1;
  const scanEnd =
    frontmatterEnd > 0 ? frontmatterEnd : Math.min(lines.length, 80);

  for (let index = 0; index < scanEnd; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }

    const rawKey = match[1] ?? "";
    const rawValue = match[2] ?? "";
    const key = rawKey.trim();
    const value = rawValue.trim();
    const blockList =
      value.length === 0
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

    if (ALLOWED_FLOATING_DEPENDENCY_POLICY_FIELDS.has(key)) {
      const rawValues =
        value.length === 0
          ? parseRawBlockList(lines, index, scanEnd)
          : {
              values: parseRawList(value),
              nextIndex: index + 1,
            };
      policy.allowedFloatingDependencies.push(
        ...rawValues.values.flatMap((raw) => {
          const allowance = parseFloatingDependencyAllowance(raw);
          return allowance === undefined ? [] : [allowance];
        }),
      );
      policy.declared.add("allowedFloatingDependencies");
      policy.lineByField.set("allowedFloatingDependencies", index + 1);
      if (value.length === 0 && rawValues.values.length > 0) {
        index = rawValues.nextIndex - 1;
      }
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

/** Resolve the operational security source for one repository artifact. */
export function parseOperationalSecurityPolicy(
  input: Artifact | ParsedDocument,
): SecurityPolicy {
  return resolveOperationalSecurityPolicy(input).policy;
}

/** Resolve operational policy together with canonical semantic issues. */
export function resolveOperationalSecurityPolicy(
  input: Artifact | ParsedDocument,
): CanonicalSecurityMetadataResult {
  const document = isParsedDocument(input) ? input : parseDocument(input);
  if (document.artifact.kind !== "skill") {
    return {
      policy: parseSecurityPolicy(document.artifact.content),
      issues: [],
    };
  }

  const inspection = inspectAgentSkill(document);
  const semantic = validateCanonicalSecurityMetadata(document);
  if (inspection.validation.valid) return semantic;

  const policy = emptySecurityPolicy();
  for (const issue of semantic.issues) {
    recordInvalidCanonicalPolicyField(policy, issue.operationalField, issue);
  }
  return { policy, issues: semantic.issues };
}

/** Parse and validate every recognized metadata.renma.* security field. */
export function validateCanonicalSecurityMetadata(
  document: ParsedDocument,
): CanonicalSecurityMetadataResult {
  const inspection = inspectAgentSkill(document);
  const policy = emptySecurityPolicy();
  const issues: CanonicalSecurityMetadataIssue[] = [];
  for (const field of inspection.frontmatter.metadataFields) {
    const definition = CANONICAL_SECURITY_FIELDS.get(field.key);
    if (definition === undefined) continue;

    if (definition.encoding === "boolean") {
      if (field.value === "true" || field.value === "false") {
        policy[definition.operationalField] = field.value === "true";
        recordCanonicalPolicyField(
          document,
          policy,
          definition.operationalField,
          field,
        );
      } else {
        recordCanonicalSecurityIssue(
          document,
          policy,
          issues,
          definition,
          field,
          'expected the exact string "true" or "false"',
        );
      }
    } else if (definition.encoding === "list") {
      const values = canonicalStringArray(field.value);
      const floatingAllowances =
        definition.operationalField === "allowedFloatingDependencies"
          ? canonicalFloatingDependencyAllowances(field.value)
          : undefined;
      if (
        values === undefined ||
        (definition.operationalField === "allowedFloatingDependencies" &&
          floatingAllowances === undefined)
      ) {
        recordCanonicalSecurityIssue(
          document,
          policy,
          issues,
          definition,
          field,
          definition.operationalField === "allowedFloatingDependencies"
            ? 'expected a JSON-array string of selector-specific "npm:" or "pypi:" floating dependency entries'
            : "expected a JSON-array string containing strings only",
        );
      } else {
        if (definition.operationalField === "allowedFloatingDependencies") {
          policy.allowedFloatingDependencies.push(
            ...(floatingAllowances ?? []),
          );
        } else {
          policy[definition.operationalField].push(...values);
        }
        recordCanonicalPolicyField(
          document,
          policy,
          definition.operationalField,
          field,
        );
      }
    } else if (typeof field.value !== "string" || !field.value.trim()) {
      recordCanonicalSecurityIssue(
        document,
        policy,
        issues,
        definition,
        field,
        "expected a trimmed non-empty string",
      );
    } else {
      policy.securityProfile = field.value.trim();
      recordCanonicalPolicyField(
        document,
        policy,
        definition.operationalField,
        field,
      );
    }
  }

  return { policy, issues };
}

export function applySecurityConfig(
  policy: SecurityPolicy,
  config?: SecurityConfig,
): SecurityPolicy {
  return resolveSecurityConfig(policy, config).policy;
}

/** Resolve effective policy and deterministic provenance with one merge pass. */
export function resolveSecurityConfig(
  policy: SecurityPolicy,
  config?: SecurityConfig,
): ResolvedSecurityPolicy {
  const sources = new Set<EffectivePolicySource>();
  recordLocalPolicyContributions(policy, sources);
  if (config === undefined) {
    return { policy, policySources: orderedPolicySources(sources) };
  }

  const declared = new Set(policy.declared);
  const invalidDeclared = new Set(policy.invalidDeclared);
  const lineByField = new Map(policy.lineByField);
  const evidenceByField = new Map(policy.evidenceByField);
  const resolved: SecurityPolicy = {
    ...policy,
    allowedData: [...policy.allowedData],
    forbiddenInputs: [...policy.forbiddenInputs],
    approvedNetworkDestinations: [...policy.approvedNetworkDestinations],
    approvedUploadDestinations: [...policy.approvedUploadDestinations],
    allowedFloatingDependencies: [...policy.allowedFloatingDependencies],
    disallowedCommands: [...policy.disallowedCommands],
    declared,
    invalidDeclared,
    lineByField,
    evidenceByField,
  };

  const chain = securityProfileChain(policy.securityProfile, config);
  const inheritedNetwork = inheritedProfileBoolean(chain, "networkAllowed");
  const inheritedUpload = inheritedProfileBoolean(
    chain,
    "externalUploadAllowed",
  );
  const inheritedSecrets = inheritedProfileBoolean(chain, "secretsAllowed");
  const inheritedApproval = inheritedProfileBoolean(
    chain,
    "humanApprovalRequired",
  );
  setResolvedBoolean(
    resolved,
    "networkAllowed",
    resolvePermissionBoolean(
      policy.networkAllowed,
      inheritedNetwork,
      policy.invalidDeclared.has("networkAllowed"),
    ),
  );
  setResolvedBoolean(
    resolved,
    "externalUploadAllowed",
    resolvePermissionBoolean(
      policy.externalUploadAllowed,
      inheritedUpload,
      policy.invalidDeclared.has("externalUploadAllowed"),
    ),
  );
  setResolvedBoolean(
    resolved,
    "secretsAllowed",
    resolvePermissionBoolean(
      policy.secretsAllowed,
      inheritedSecrets,
      policy.invalidDeclared.has("secretsAllowed"),
    ),
  );
  setResolvedBoolean(
    resolved,
    "humanApprovalRequired",
    resolveRequiredBoolean(
      policy.humanApprovalRequired,
      inheritedApproval,
      policy.invalidDeclared.has("humanApprovalRequired"),
    ),
  );
  if (
    (policy.networkAllowed === undefined &&
      resolved.networkAllowed !== undefined &&
      inheritedNetwork !== undefined) ||
    (policy.externalUploadAllowed === undefined &&
      resolved.externalUploadAllowed !== undefined &&
      inheritedUpload !== undefined) ||
    (policy.secretsAllowed === undefined &&
      resolved.secretsAllowed !== undefined &&
      inheritedSecrets !== undefined) ||
    (policy.humanApprovalRequired === undefined &&
      resolved.humanApprovalRequired !== undefined &&
      inheritedApproval !== undefined)
  ) {
    sources.add("security_profile");
  }

  for (const item of chain.profiles) {
    const profile = item.profile;
    if (
      mayInheritAllowedData(policy) &&
      profile.allowedDataClass !== undefined
    ) {
      resolved.allowedDataClass = profile.allowedDataClass;
      sources.add("security_profile");
    }
    if (mayInheritAllowedData(policy)) {
      resolved.allowedData.push(...profile.allowedData);
      if (profile.allowedData.length > 0) sources.add("security_profile");
    }
    if (mayInheritForbiddenInputs(policy)) {
      resolved.forbiddenInputs.push(...profile.forbiddenInputs);
      if (profile.forbiddenInputs.length > 0) sources.add("security_profile");
    }
    if (mayAccumulate(policy, "approvedNetworkDestinations")) {
      resolved.approvedNetworkDestinations.push(...profile.approvedDomains);
      if (profile.approvedDomains.length > 0) sources.add("security_profile");
    }
    if (mayAccumulate(policy, "approvedUploadDestinations")) {
      resolved.approvedUploadDestinations.push(
        ...profile.approvedUploadDomains,
      );
      if (profile.approvedUploadDomains.length > 0)
        sources.add("security_profile");
    }
    resolved.disallowedCommands.push(...profile.disallowedCommands);
    if (profile.disallowedCommands.length > 0) sources.add("security_profile");
  }

  if (mayAccumulate(policy, "approvedNetworkDestinations")) {
    resolved.approvedNetworkDestinations.push(...config.approvedDomains);
    if (config.approvedDomains.length > 0) sources.add("repository_config");
  }
  if (mayAccumulate(policy, "approvedUploadDestinations")) {
    resolved.approvedUploadDestinations.push(...config.approvedUploadDomains);
    if (config.approvedUploadDomains.length > 0)
      sources.add("repository_config");
  }
  resolved.disallowedCommands.push(...config.disallowedCommands);
  if (config.disallowedCommands.length > 0) sources.add("repository_config");
  resolved.allowedData = uniqueStrings(resolved.allowedData);
  resolved.forbiddenInputs = uniqueStrings(resolved.forbiddenInputs);
  resolved.approvedNetworkDestinations = uniqueStrings(
    resolved.approvedNetworkDestinations,
  );
  resolved.approvedUploadDestinations = uniqueStrings(
    resolved.approvedUploadDestinations,
  );
  resolved.disallowedCommands = uniqueStrings(resolved.disallowedCommands);

  return { policy: resolved, policySources: orderedPolicySources(sources) };
}

function recordLocalPolicyContributions(
  policy: SecurityPolicy,
  sources: Set<EffectivePolicySource>,
): void {
  const hasLocalScalar =
    policy.networkAllowed !== undefined ||
    policy.externalUploadAllowed !== undefined ||
    policy.secretsAllowed !== undefined ||
    policy.humanApprovalRequired !== undefined ||
    policy.allowedDataClass !== undefined;
  const hasLocalReplacedList =
    policy.declared.has("allowedData") ||
    policy.declared.has("forbiddenInputs");
  const hasLocalAccumulatedValue =
    policy.approvedNetworkDestinations.length > 0 ||
    policy.approvedUploadDestinations.length > 0 ||
    policy.disallowedCommands.length > 0;
  if (
    hasLocalScalar ||
    hasLocalReplacedList ||
    hasLocalAccumulatedValue ||
    policy.invalidDeclared.size > 0
  ) {
    sources.add("local");
  }
}

function orderedPolicySources(
  sources: ReadonlySet<EffectivePolicySource>,
): EffectivePolicySource[] {
  return (["local", "security_profile", "repository_config"] as const).filter(
    (source) => sources.has(source),
  );
}

export function emptySecurityPolicy(): SecurityPolicy {
  return {
    allowedData: [],
    forbiddenInputs: [],
    approvedNetworkDestinations: [],
    approvedUploadDestinations: [],
    allowedFloatingDependencies: [],
    disallowedCommands: [],
    declared: new Set(),
    invalidDeclared: new Set(),
    lineByField: new Map(),
    evidenceByField: new Map(),
  };
}

function isParsedDocument(
  input: Artifact | ParsedDocument,
): input is ParsedDocument {
  return "artifact" in input;
}

function canonicalStringArray(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
    return undefined;
  return parsed.map((item) => item.trim()).filter(Boolean);
}

function canonicalFloatingDependencyAllowances(
  value: unknown,
): FloatingDependencyAllowance[] | undefined {
  if (typeof value !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
    return undefined;
  const allowances = parsed.map((item) =>
    parseFloatingDependencyAllowance(item.trim()),
  );
  return allowances.some((allowance) => allowance === undefined)
    ? undefined
    : (allowances as FloatingDependencyAllowance[]);
}

function recordCanonicalSecurityIssue(
  document: ParsedDocument,
  policy: SecurityPolicy,
  issues: CanonicalSecurityMetadataIssue[],
  definition: SecurityMetadataFieldDefinition,
  field: YamlFrontmatterField,
  expectation: string,
): void {
  const evidence = canonicalFieldEvidence(document, field);
  const issue: CanonicalSecurityMetadataIssue = {
    key: definition.skillKey,
    operationalField: definition.operationalField,
    reason: `${expectation}; rejected ${describeRejectedValue(field.value)}`,
    ...evidence,
  };
  issues.push(issue);
  recordInvalidCanonicalPolicyField(policy, definition.operationalField, issue);
}

function recordInvalidCanonicalPolicyField(
  policy: SecurityPolicy,
  operationalField: CanonicalSecurityOperationalField,
  evidence: SecurityPolicyFieldEvidence,
): void {
  policy.invalidDeclared.add(operationalField);
  policy.lineByField.set(operationalField, evidence.startLine);
  policy.evidenceByField.set(operationalField, evidence);
}

function describeRejectedValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

function canonicalFieldEvidence(
  document: ParsedDocument,
  field: Pick<YamlFrontmatterField, "startLine" | "endLine">,
): SecurityPolicyFieldEvidence {
  return {
    startLine: field.startLine,
    endLine: field.endLine,
    snippet: document.lines
      .slice(field.startLine - 1, field.endLine)
      .join("\n"),
  };
}

function recordCanonicalPolicyField(
  document: ParsedDocument,
  policy: SecurityPolicy,
  operationalField: string,
  field: {
    startLine: number;
    endLine: number;
  },
): void {
  policy.declared.add(operationalField);
  policy.lineByField.set(operationalField, field.startLine);
  policy.evidenceByField.set(
    operationalField,
    canonicalFieldEvidence(document, field),
  );
}

function resolvePermissionBoolean(
  local: boolean | undefined,
  inherited: boolean | undefined,
  invalid: boolean,
): boolean | undefined {
  if (local !== undefined) return local;
  if (invalid) return inherited === false ? false : undefined;
  return inherited;
}

function setResolvedBoolean(
  policy: SecurityPolicy,
  field:
    | "networkAllowed"
    | "externalUploadAllowed"
    | "secretsAllowed"
    | "humanApprovalRequired",
  value: boolean | undefined,
): void {
  if (value === undefined) {
    delete policy[field];
  } else {
    policy[field] = value;
  }
}

function resolveRequiredBoolean(
  local: boolean | undefined,
  inherited: boolean | undefined,
  invalid: boolean,
): boolean | undefined {
  if (local !== undefined) return local;
  if (invalid) return inherited === true ? true : undefined;
  return inherited;
}

function inheritedProfileBoolean(
  chain: SecurityProfileChain,
  field:
    | "networkAllowed"
    | "externalUploadAllowed"
    | "secretsAllowed"
    | "humanApprovalRequired",
): boolean | undefined {
  let inherited: boolean | undefined;
  for (const item of chain.profiles) {
    if (item.profile[field] !== undefined) inherited = item.profile[field];
  }
  return inherited;
}

function mayInheritAllowedData(policy: SecurityPolicy): boolean {
  return (
    !policy.declared.has("allowedData") &&
    !policy.invalidDeclared.has("allowedData")
  );
}

function mayInheritForbiddenInputs(policy: SecurityPolicy): boolean {
  return !policy.declared.has("forbiddenInputs");
}

function mayAccumulate(
  policy: SecurityPolicy,
  field: "approvedNetworkDestinations" | "approvedUploadDestinations",
): boolean {
  return !policy.invalidDeclared.has(field);
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
  const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*):/)?.[1];
  return (
    key !== undefined &&
    (CANONICAL_SECURITY_FIELDS.has(key) ||
      BOOLEAN_POLICY_FIELDS.has(key) ||
      DESTINATION_POLICY_FIELDS.has(key) ||
      UPLOAD_DESTINATION_POLICY_FIELDS.has(key) ||
      ALLOWED_DATA_POLICY_FIELDS.has(key) ||
      FORBIDDEN_INPUT_POLICY_FIELDS.has(key) ||
      ALLOWED_FLOATING_DEPENDENCY_POLICY_FIELDS.has(key) ||
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

function parseRawBlockList(
  lines: string[],
  startIndex: number,
  scanEnd: number,
): ParsedBlockList {
  const values: string[] = [];
  let index = startIndex + 1;
  for (; index < scanEnd; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) break;
    const match = line.match(/^\s*-\s*(.*?)\s*$/u);
    if (!match) break;
    const value = stripMatchingQuotes((match[1] ?? "").trim());
    if (value.length > 0) values.push(value);
  }
  return { values, nextIndex: index };
}

function parseRawList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return [stripMatchingQuotes(trimmed)];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function stripMatchingQuotes(value: string): string {
  const first = value[0];
  return first !== undefined &&
    (first === '"' || first === "'") &&
    value.at(-1) === first
    ? value.slice(1, -1)
    : value;
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
  const normalized = value.toLowerCase();
  if (["true", "yes", "allowed", "allow", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "denied", "deny", "0"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseList(value: string): string[] {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item.length > 0);
}
