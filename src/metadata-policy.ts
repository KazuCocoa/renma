import { inspectAgentSkill } from "./agent-skills.js";
import { isIsoDate, parseDayDuration } from "./freshness.js";
import { DIAGNOSTIC_IDS, withDiagnosticId } from "./diagnostic-ids.js";
import type { AssetMetadata, CatalogEntry } from "./model.js";
import {
  RENMA_REQUIRED_METADATA_DEFINITIONS,
  type RequiredMetadataPolicyDefinition,
  type RequiredMetadataPolicyField,
} from "./metadata-definitions.js";
import type { MetadataConfig } from "./types/configuration.js";
import type { Diagnostic, Evidence } from "./types/diagnostics.js";
import type { ParsedDocument } from "./types/metadata.js";
import {
  parseAgentSkillFrontmatter,
  type ParsedYamlFrontmatter,
  type YamlFrontmatterField,
} from "./yaml-frontmatter.js";

export type RequiredMetadataPresenceState =
  "absent" | "empty" | "invalid" | "ambiguous";

export interface RequiredMetadataPolicyOptions {
  policy: MetadataConfig;
  configPath?: string;
}

interface RequiredMetadataPresence {
  state: "valid" | RequiredMetadataPresenceState;
  evidence?: Evidence;
}

/** Enforce repository-required metadata only on cataloged Markdown assets. */
export function requiredMetadataPolicyDiagnostics(
  document: ParsedDocument,
  metadata: AssetMetadata,
  kind: CatalogEntry["kind"],
  options: RequiredMetadataPolicyOptions,
): Diagnostic[] {
  if (
    options.policy.required.length === 0 ||
    document.artifact.markdownParserEligible !== true ||
    document.artifact.contentClassification !== "text"
  ) {
    return [];
  }

  const required = new Set<RequiredMetadataPolicyField>(
    options.policy.required,
  );
  return RENMA_REQUIRED_METADATA_DEFINITIONS.flatMap((definition) => {
    if (!required.has(definition.policyKey)) return [];
    const presence = requiredMetadataPresence(document, metadata, definition);
    if (presence.state === "valid") return [];
    const skill = kind === "skill";
    const serializedKey = skill
      ? `metadata.${definition.skillKey}`
      : definition.nonSkillKey;
    const valueGuidance =
      definition.policyValueKind === "list"
        ? skill
          ? "a non-empty JSON-array string"
          : "a non-empty YAML list or comma-separated list"
        : "a valid non-empty value";
    return [
      withDiagnosticId(DIAGNOSTIC_IDS.META_POLICY_REQUIRED_FIELD_MISSING, {
        severity: "error",
        path: document.artifact.path,
        message: `Repository metadata policy requires ${definition.policyKey}, but ${serializedKey} is ${presence.state}. Add ${serializedKey} as ${valueGuidance}.`,
        evidence: presence.evidence ?? firstLineEvidence(document),
        repairConstraints: [
          {
            kind: "must_not_change",
            text: "Do not invent a value, infer it from Git, filesystem ownership, CODEOWNERS, nearby files, or inherited metadata, or rewrite the asset automatically.",
          },
          {
            kind: "requires_human_decision",
            text: `Obtain a reviewed value for repository-required field ${definition.policyKey}.`,
          },
        ],
        verificationSteps: [
          {
            text: `Declare valid ${serializedKey} metadata and rerun the repository scan.`,
            command: "renma scan . --format json",
            expected: `No ${DIAGNOSTIC_IDS.META_POLICY_REQUIRED_FIELD_MISSING} finding remains for ${definition.policyKey} on this asset.`,
          },
        ],
        llmHint: `Add only a human-reviewed ${serializedKey} declaration. Repository policy requires an explicit declared value; effective or inherited values do not satisfy it.`,
        details: {
          requiredField: definition.policyKey,
          assetPath: document.artifact.path,
          assetKind: kind,
          expectedSerializedKey: serializedKey,
          presenceState: presence.state,
          policySource: "repository_configuration",
          configurationKey: "metadata.required",
          configurationPath: options.configPath ?? null,
          declarationRequirement: "explicit",
        },
      }),
    ];
  });
}

function requiredMetadataPresence(
  document: ParsedDocument,
  metadata: AssetMetadata,
  definition: RequiredMetadataPolicyDefinition,
): RequiredMetadataPresence {
  return document.artifact.kind === "skill"
    ? canonicalSkillPresence(document, metadata, definition)
    : nonSkillPresence(document, metadata, definition);
}

function canonicalSkillPresence(
  document: ParsedDocument,
  metadata: AssetMetadata,
  definition: RequiredMetadataPolicyDefinition,
): RequiredMetadataPresence {
  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  const fields = frontmatter.metadataFields.filter(
    (field) => field.key === definition.skillKey,
  );
  const first = fields[0];
  const evidence = first ? yamlFieldEvidence(document, first) : undefined;
  if (
    frontmatter.duplicateFields.some((field) => field.key === "metadata") ||
    fields.length > 1
  ) {
    return { state: "ambiguous", ...(evidence ? { evidence } : {}) };
  }
  if (fields.length === 0) {
    return malformedEnvelope(frontmatter)
      ? { state: "invalid", evidence: firstLineEvidence(document) }
      : { state: "absent" };
  }
  if (
    malformedEnvelope(frontmatter) ||
    !inspectAgentSkill(document).validation.valid
  ) {
    return { state: "invalid", ...(evidence ? { evidence } : {}) };
  }
  return normalizedPresence(metadata, definition, first!.value, evidence);
}

function nonSkillPresence(
  document: ParsedDocument,
  metadata: AssetMetadata,
  definition: RequiredMetadataPolicyDefinition,
): RequiredMetadataPresence {
  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  const fields = frontmatter.fields.filter(
    (field) => field.key === definition.nonSkillKey,
  );
  const first = fields[0];
  const evidence = first ? yamlFieldEvidence(document, first) : undefined;
  if (fields.length > 1) {
    return { state: "ambiguous", ...(evidence ? { evidence } : {}) };
  }
  if (fields.length === 0) {
    return malformedEnvelope(frontmatter)
      ? { state: "invalid", evidence: firstLineEvidence(document) }
      : { state: "absent" };
  }
  if (malformedEnvelope(frontmatter)) {
    return { state: "invalid", ...(evidence ? { evidence } : {}) };
  }
  return normalizedPresence(metadata, definition, first!.value, evidence);
}

function normalizedPresence(
  metadata: AssetMetadata,
  definition: RequiredMetadataPolicyDefinition,
  rawValue: unknown,
  evidence: Evidence | undefined,
): RequiredMetadataPresence {
  const normalized =
    metadata[definition.operationalField as keyof AssetMetadata];
  if (definition.policyValueKind === "list") {
    const empty =
      rawValue === null ||
      rawValue === undefined ||
      (Array.isArray(rawValue) && rawValue.length === 0) ||
      (typeof rawValue === "string" &&
        (rawValue.trim().length === 0 || rawJsonArrayIsEmpty(rawValue)));
    if (empty) {
      return { state: "empty", ...(evidence ? { evidence } : {}) };
    }
    if (
      (Array.isArray(rawValue) &&
        rawValue.some(
          (item) => typeof item !== "string" || item.trim().length === 0,
        )) ||
      (typeof rawValue === "object" &&
        rawValue !== null &&
        !Array.isArray(rawValue))
    ) {
      return { state: "invalid", ...(evidence ? { evidence } : {}) };
    }
    if (Array.isArray(normalized) && normalized.length > 0) {
      return { state: "valid", ...(evidence ? { evidence } : {}) };
    }
    return {
      state: "invalid",
      ...(evidence ? { evidence } : {}),
    };
  }

  if (
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue === "string" && rawValue.trim().length === 0)
  ) {
    return { state: "empty", ...(evidence ? { evidence } : {}) };
  }
  if (typeof rawValue === "object" && rawValue !== null) {
    return { state: "invalid", ...(evidence ? { evidence } : {}) };
  }
  if (
    typeof normalized === "string" &&
    normalized.trim().length > 0 &&
    validTextSemantics(definition.policyKey, normalized)
  ) {
    return { state: "valid", ...(evidence ? { evidence } : {}) };
  }
  return {
    state:
      rawValue === null ||
      rawValue === undefined ||
      (typeof rawValue === "string" && rawValue.trim().length === 0)
        ? "empty"
        : "invalid",
    ...(evidence ? { evidence } : {}),
  };
}

function validTextSemantics(
  field: RequiredMetadataPolicyField,
  value: string,
): boolean {
  switch (field) {
    case "status":
      return [
        "experimental",
        "stable",
        "suspended",
        "deprecated",
        "archived",
      ].includes(value);
    case "status_changed_at":
    case "last_reviewed_at":
    case "expires_at":
      return isIsoDate(value);
    case "review_cycle":
      return parseDayDuration(value) !== undefined;
    default:
      return true;
  }
}

function malformedEnvelope(frontmatter: ParsedYamlFrontmatter): boolean {
  return (
    frontmatter.present &&
    (!frontmatter.closed ||
      !frontmatter.mapping ||
      frontmatter.errors.length > 0)
  );
}

function rawJsonArrayIsEmpty(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}

function yamlFieldEvidence(
  document: ParsedDocument,
  field: YamlFrontmatterField,
): Evidence {
  return {
    path: document.artifact.path,
    startLine: field.startLine,
    endLine: field.endLine,
    snippet: document.lines
      .slice(field.startLine - 1, field.endLine)
      .join("\n"),
  };
}

function firstLineEvidence(document: ParsedDocument): Evidence {
  return {
    path: document.artifact.path,
    startLine: 1,
    endLine: 1,
    snippet: document.lines[0] ?? "",
  };
}
