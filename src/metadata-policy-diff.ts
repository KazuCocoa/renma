import {
  REQUIRED_METADATA_CONFIGURATION_KEY,
  REQUIRED_METADATA_POLICY_FIELDS,
  type RequiredMetadataPolicyField,
} from "./metadata-definitions.js";
import type { MetadataConfig } from "./types/configuration.js";

export const METADATA_POLICY_DIFF_SCHEMA_VERSION =
  "renma.metadata-policy-diff.v1" as const;

export type MetadataPolicyChangeDirection = "weakening" | "tightening";

export type MetadataPolicyProvenance =
  | { source: "renma_default" }
  | {
      source: "repository_configuration";
      configKey: typeof REQUIRED_METADATA_CONFIGURATION_KEY;
      configPath: string | null;
    };

export interface MetadataPolicyRequirementEndpoint {
  required: boolean;
  provenance: MetadataPolicyProvenance;
}

export interface MetadataPolicyRequiredFieldChange {
  field: RequiredMetadataPolicyField;
  configKey: typeof REQUIRED_METADATA_CONFIGURATION_KEY;
  direction: MetadataPolicyChangeDirection;
  from: MetadataPolicyRequirementEndpoint;
  to: MetadataPolicyRequirementEndpoint;
}

export interface MetadataPolicyDiff {
  schemaVersion: typeof METADATA_POLICY_DIFF_SCHEMA_VERSION;
  changes: MetadataPolicyRequiredFieldChange[];
  addedRequiredFields: RequiredMetadataPolicyField[];
  removedRequiredFields: RequiredMetadataPolicyField[];
}

/** Compare required declarations in stable registry order. */
export function buildMetadataPolicyDiff(
  from: MetadataConfig,
  to: MetadataConfig,
  fromConfigPath?: string,
  toConfigPath?: string,
): MetadataPolicyDiff {
  const fromFields = new Set(from.required);
  const toFields = new Set(to.required);
  const changes = REQUIRED_METADATA_POLICY_FIELDS.flatMap((field) => {
    const fromRequired = fromFields.has(field);
    const toRequired = toFields.has(field);
    if (fromRequired === toRequired) return [];
    return [
      {
        field,
        configKey: REQUIRED_METADATA_CONFIGURATION_KEY,
        direction: toRequired
          ? ("tightening" as const)
          : ("weakening" as const),
        from: requirementEndpoint(fromRequired, from, fromConfigPath),
        to: requirementEndpoint(toRequired, to, toConfigPath),
      },
    ];
  });
  return {
    schemaVersion: METADATA_POLICY_DIFF_SCHEMA_VERSION,
    changes,
    addedRequiredFields: changes
      .filter((change) => change.direction === "tightening")
      .map((change) => change.field),
    removedRequiredFields: changes
      .filter((change) => change.direction === "weakening")
      .map((change) => change.field),
  };
}

function requirementEndpoint(
  required: boolean,
  policy: MetadataConfig,
  configPath: string | undefined,
): MetadataPolicyRequirementEndpoint {
  return {
    required,
    provenance:
      policy.requiredSource === "repository_configuration"
        ? {
            source: "repository_configuration",
            configKey: REQUIRED_METADATA_CONFIGURATION_KEY,
            configPath: configPath ?? null,
          }
        : { source: "renma_default" },
  };
}
