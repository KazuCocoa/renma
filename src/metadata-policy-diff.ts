import {
  REQUIRED_METADATA_POLICY_FIELDS,
  type RequiredMetadataPolicyField,
} from "./metadata-definitions.js";
import type { MetadataConfig } from "./types/configuration.js";

export type MetadataPolicyChangeDirection = "weakening" | "tightening";

export type MetadataPolicyProvenance =
  | { source: "renma_default" }
  | {
      source: "repository_configuration";
      configKey: "metadata.required";
      configPath: string | null;
    };

export interface MetadataPolicyRequirementEndpoint {
  required: boolean;
  provenance: MetadataPolicyProvenance;
}

export interface MetadataPolicyRequiredFieldChange {
  field: RequiredMetadataPolicyField;
  configKey: "metadata.required";
  direction: MetadataPolicyChangeDirection;
  from: MetadataPolicyRequirementEndpoint;
  to: MetadataPolicyRequirementEndpoint;
}

export interface MetadataPolicyDiff {
  schemaVersion: "renma.metadata-policy-diff.v1";
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
        configKey: "metadata.required" as const,
        direction: toRequired
          ? ("tightening" as const)
          : ("weakening" as const),
        from: requirementEndpoint(fromRequired, from, fromConfigPath),
        to: requirementEndpoint(toRequired, to, toConfigPath),
      },
    ];
  });
  return {
    schemaVersion: "renma.metadata-policy-diff.v1",
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
            configKey: "metadata.required",
            configPath: configPath ?? null,
          }
        : { source: "renma_default" },
  };
}
