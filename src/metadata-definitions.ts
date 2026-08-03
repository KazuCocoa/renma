import type { ArtifactKind } from "./types/artifact.js";

/** Canonical Agent Skills governance keys understood by the installed Renma version. */
export const CANONICAL_SKILL_METADATA_KEYS = {
  id: "renma.id",
  title: "renma.title",
  version: "renma.version",
  owner: "renma.owner",
  status: "renma.status",
  status_reason: "renma.status-reason",
  status_changed_at: "renma.status-changed-at",
  purpose: "renma.purpose",
  last_reviewed_at: "renma.last-reviewed-at",
  review_cycle: "renma.review-cycle",
  expires_at: "renma.expires-at",
  tags: "renma.tags",
  when_to_use: "renma.when-to-use",
  when_not_to_use: "renma.when-not-to-use",
  requires_context: "renma.requires-context",
  optional_context: "renma.optional-context",
  requires_lens: "renma.requires-lens",
  optional_lens: "renma.optional-lens",
  conflicts: "renma.conflicts",
  superseded_by: "renma.superseded-by",
  continues_with: "renma.continues-with",
} as const;

/** Canonical one-state Skill publication marker, kept out of catalog metadata. */
export const CANONICAL_SKILL_PUBLICATION_METADATA_KEY =
  "renma.published-entrypoint" as const;

/** Top-level fields normalized by parseAssetMetadata for non-Skill assets. */
export const NON_SKILL_CATALOG_METADATA_KEYS = {
  id: "id",
  type: "type",
  version: "version",
  owner: "owner",
  status: "status",
  status_reason: "status_reason",
  status_changed_at: "status_changed_at",
  purpose: "purpose",
  last_reviewed_at: "last_reviewed_at",
  review_cycle: "review_cycle",
  expires_at: "expires_at",
  tags: "tags",
  when_to_use: "when_to_use",
  when_not_to_use: "when_not_to_use",
  requires_context: "requires_context",
  optional_context: "optional_context",
  requires_lens: "requires_lens",
  optional_lens: "optional_lens",
  conflicts: "conflicts",
  superseded_by: "superseded_by",
  applies_to: "applies_to",
  focus: "focus",
  expected_outputs: "expected_outputs",
  token_budget_override: "token_budget_override",
  token_budget_rationale: "token_budget_rationale",
  token_budget_reviewed_at: "token_budget_reviewed_at",
} as const;

export interface CatalogMetadataDefinition {
  operationalField: string;
  skillKey?: string;
  nonSkillKey?: string;
}

/** Skill/non-Skill serialization mappings for normalized catalog metadata. */
export const RENMA_CATALOG_METADATA_DEFINITIONS = [
  {
    operationalField: "id",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.id,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.id,
  },
  {
    operationalField: "title",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.title,
  },
  {
    operationalField: "type",
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.type,
  },
  {
    operationalField: "version",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.version,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.version,
  },
  {
    operationalField: "owner",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.owner,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.owner,
  },
  {
    operationalField: "status",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.status,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.status,
  },
  {
    operationalField: "statusReason",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.status_reason,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.status_reason,
  },
  {
    operationalField: "statusChangedAt",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.status_changed_at,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.status_changed_at,
  },
  {
    operationalField: "purpose",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.purpose,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.purpose,
  },
  {
    operationalField: "lastReviewedAt",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.last_reviewed_at,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.last_reviewed_at,
  },
  {
    operationalField: "reviewCycle",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.review_cycle,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.review_cycle,
  },
  {
    operationalField: "expiresAt",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.expires_at,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.expires_at,
  },
  {
    operationalField: "tags",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.tags,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.tags,
  },
  {
    operationalField: "whenToUse",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.when_to_use,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.when_to_use,
  },
  {
    operationalField: "whenNotToUse",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.when_not_to_use,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.when_not_to_use,
  },
  {
    operationalField: "requiresContext",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.requires_context,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.requires_context,
  },
  {
    operationalField: "optionalContext",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.optional_context,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.optional_context,
  },
  {
    operationalField: "requiresLens",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.requires_lens,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.requires_lens,
  },
  {
    operationalField: "optionalLens",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.optional_lens,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.optional_lens,
  },
  {
    operationalField: "conflicts",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.conflicts,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.conflicts,
  },
  {
    operationalField: "supersededBy",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.superseded_by,
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.superseded_by,
  },
  {
    operationalField: "continuesWith",
    skillKey: CANONICAL_SKILL_METADATA_KEYS.continues_with,
  },
  {
    operationalField: "appliesTo",
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.applies_to,
  },
  {
    operationalField: "focus",
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.focus,
  },
  {
    operationalField: "expectedOutputs",
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.expected_outputs,
  },
  {
    operationalField: "tokenBudgetOverride",
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.token_budget_override,
  },
  {
    operationalField: "tokenBudgetRationale",
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.token_budget_rationale,
  },
  {
    operationalField: "tokenBudgetReviewedAt",
    nonSkillKey: NON_SKILL_CATALOG_METADATA_KEYS.token_budget_reviewed_at,
  },
] as const satisfies readonly CatalogMetadataDefinition[];

/** Ordinary top-level list fields understood by the general non-Skill parser. */
export const NON_SKILL_LIST_METADATA_KEYS = [
  NON_SKILL_CATALOG_METADATA_KEYS.tags,
  NON_SKILL_CATALOG_METADATA_KEYS.when_to_use,
  NON_SKILL_CATALOG_METADATA_KEYS.when_not_to_use,
  NON_SKILL_CATALOG_METADATA_KEYS.requires_context,
  NON_SKILL_CATALOG_METADATA_KEYS.optional_context,
  NON_SKILL_CATALOG_METADATA_KEYS.requires_lens,
  NON_SKILL_CATALOG_METADATA_KEYS.optional_lens,
  NON_SKILL_CATALOG_METADATA_KEYS.applies_to,
  NON_SKILL_CATALOG_METADATA_KEYS.focus,
  NON_SKILL_CATALOG_METADATA_KEYS.expected_outputs,
  NON_SKILL_CATALOG_METADATA_KEYS.conflicts,
  NON_SKILL_CATALOG_METADATA_KEYS.superseded_by,
] as const;

export const SUPPORT_ASSET_TOKEN_BUDGET_METADATA_KEYS = [
  NON_SKILL_CATALOG_METADATA_KEYS.token_budget_override,
  NON_SKILL_CATALOG_METADATA_KEYS.token_budget_rationale,
  NON_SKILL_CATALOG_METADATA_KEYS.token_budget_reviewed_at,
] as const;

/** Artifact classifications eligible for top-level token-budget decisions. */
export const SUPPORT_ASSET_TOKEN_BUDGET_KINDS = [
  "context",
  "reference",
  "profile",
  "example",
] as const satisfies readonly ArtifactKind[];

export type CanonicalSecurityOperationalField =
  | "networkAllowed"
  | "externalUploadAllowed"
  | "secretsAllowed"
  | "humanApprovalRequired"
  | "allowedData"
  | "forbiddenInputs"
  | "approvedNetworkDestinations"
  | "approvedUploadDestinations"
  | "allowedFloatingDependencies"
  | "securityProfile";

export type SecurityMetadataFieldDefinition =
  | {
      skillKey: string;
      nonSkillKey: string;
      operationalField:
        | "networkAllowed"
        | "externalUploadAllowed"
        | "secretsAllowed"
        | "humanApprovalRequired";
      encoding: "boolean";
    }
  | {
      skillKey: string;
      nonSkillKey: string;
      operationalField:
        | "allowedData"
        | "forbiddenInputs"
        | "approvedNetworkDestinations"
        | "approvedUploadDestinations"
        | "allowedFloatingDependencies";
      encoding: "list";
    }
  | {
      skillKey: string;
      nonSkillKey: string;
      operationalField: "securityProfile";
      encoding: "profile";
    };

/** Canonical and non-Skill security field mappings consumed by both parsers. */
export const SECURITY_METADATA_FIELD_DEFINITIONS = [
  {
    skillKey: "renma.network-allowed",
    nonSkillKey: "network_allowed",
    operationalField: "networkAllowed",
    encoding: "boolean",
  },
  {
    skillKey: "renma.external-upload-allowed",
    nonSkillKey: "external_upload_allowed",
    operationalField: "externalUploadAllowed",
    encoding: "boolean",
  },
  {
    skillKey: "renma.secrets-allowed",
    nonSkillKey: "secrets_allowed",
    operationalField: "secretsAllowed",
    encoding: "boolean",
  },
  {
    skillKey: "renma.requires-human-approval",
    nonSkillKey: "requires_human_approval",
    operationalField: "humanApprovalRequired",
    encoding: "boolean",
  },
  {
    skillKey: "renma.allowed-data",
    nonSkillKey: "allowed_data",
    operationalField: "allowedData",
    encoding: "list",
  },
  {
    skillKey: "renma.forbidden-inputs",
    nonSkillKey: "forbidden_inputs",
    operationalField: "forbiddenInputs",
    encoding: "list",
  },
  {
    skillKey: "renma.approved-network-destinations",
    nonSkillKey: "approved_network_destinations",
    operationalField: "approvedNetworkDestinations",
    encoding: "list",
  },
  {
    skillKey: "renma.approved-upload-destinations",
    nonSkillKey: "approved_upload_destinations",
    operationalField: "approvedUploadDestinations",
    encoding: "list",
  },
  {
    skillKey: "renma.allowed-floating-dependencies",
    nonSkillKey: "allowed_floating_dependencies",
    operationalField: "allowedFloatingDependencies",
    encoding: "list",
  },
  {
    skillKey: "renma.security-profile",
    nonSkillKey: "security_profile",
    operationalField: "securityProfile",
    encoding: "profile",
  },
] as const satisfies readonly SecurityMetadataFieldDefinition[];

export interface NonSkillAuxiliaryMetadataDefinition {
  nonSkillKey: string;
  consumer: "context-lens" | "reference-compatibility";
  authoringStatus: "current" | "deprecated" | "recognized-compatibility";
  replacement?: string;
}

export const NON_SKILL_AUXILIARY_METADATA_KEYS = {
  scope: "scope",
  target: "target",
  targets: "targets",
  output: "output",
  outputs: "outputs",
  canonical_context: "canonical_context",
} as const;

/** Operational top-level fields read outside normalized catalog/security metadata. */
export const NON_SKILL_AUXILIARY_METADATA_DEFINITIONS = [
  {
    nonSkillKey: NON_SKILL_AUXILIARY_METADATA_KEYS.scope,
    consumer: "context-lens",
    authoringStatus: "current",
  },
  {
    nonSkillKey: NON_SKILL_AUXILIARY_METADATA_KEYS.target,
    consumer: "context-lens",
    authoringStatus: "deprecated",
    replacement: NON_SKILL_CATALOG_METADATA_KEYS.applies_to,
  },
  {
    nonSkillKey: NON_SKILL_AUXILIARY_METADATA_KEYS.targets,
    consumer: "context-lens",
    authoringStatus: "deprecated",
    replacement: NON_SKILL_CATALOG_METADATA_KEYS.applies_to,
  },
  {
    nonSkillKey: NON_SKILL_AUXILIARY_METADATA_KEYS.output,
    consumer: "context-lens",
    authoringStatus: "deprecated",
    replacement: NON_SKILL_CATALOG_METADATA_KEYS.expected_outputs,
  },
  {
    nonSkillKey: NON_SKILL_AUXILIARY_METADATA_KEYS.outputs,
    consumer: "context-lens",
    authoringStatus: "deprecated",
    replacement: NON_SKILL_CATALOG_METADATA_KEYS.expected_outputs,
  },
  {
    nonSkillKey: NON_SKILL_AUXILIARY_METADATA_KEYS.canonical_context,
    consumer: "reference-compatibility",
    authoringStatus: "recognized-compatibility",
  },
] as const satisfies readonly NonSkillAuxiliaryMetadataDefinition[];

export const CONTEXT_LENS_SUPPORTED_SCOPES = ["context"] as const;
export const CONTEXT_LENS_SUPPORTED_VERSIONS = ["1"] as const;
