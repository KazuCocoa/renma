import path from "node:path";

import { stringify } from "yaml";

import {
  AGENT_SKILLS_TOP_LEVEL_FIELDS,
  legacyRenmaMetadataKey,
  LEGACY_RENMA_SKILL_FIELDS,
  validateAgentSkill,
  validateAgentSkillName,
  type AgentSkillFormat,
} from "./agent-skills.js";
import type { ParsedDocument } from "./types.js";
import { parseAgentSkillFrontmatter } from "./yaml-frontmatter.js";

const STANDARD_FIELDS = new Set<string>(AGENT_SKILLS_TOP_LEVEL_FIELDS);
const LEGACY_FIELDS = new Set<string>(LEGACY_RENMA_SKILL_FIELDS);
const LIST_LEGACY_FIELDS = new Set([
  "tags",
  "when_to_use",
  "when_not_to_use",
  "requires_context",
  "optional_context",
  "requires_lens",
  "optional_lens",
  "conflicts",
  "superseded_by",
  "allowed_data",
  "forbidden_inputs",
  "approved_network_destinations",
  "approved_upload_destinations",
]);
const SCALAR_LEGACY_FIELDS = new Set([
  "id",
  "title",
  "version",
  "owner",
  "status",
  "purpose",
  "last_reviewed_at",
  "review_cycle",
  "expires_at",
  "network_allowed",
  "external_upload_allowed",
  "secrets_allowed",
  "requires_human_approval",
  "security_profile",
]);

export interface SkillMigrationBlock {
  field: string;
  reason: string;
}

export interface AgentSkillMigrationSuggestion {
  sourceFormat: AgentSkillFormat;
  direction: "legacy-to-agent-skills" | "none";
  bodyPreserved: true;
  candidateAgentSkillsFields: Record<string, string>;
  candidateRenmaMetadata: Record<string, string>;
  preservedMetadata: Record<string, string>;
  canonicalFrontmatter?: string;
  blocked: SkillMigrationBlock[];
  reviewPrompt: string;
}

/** Build a one-way, non-editing migration proposal for a Skill target. */
export function buildAgentSkillMigrationSuggestion(
  document: ParsedDocument,
  explicitOwner?: string,
): AgentSkillMigrationSuggestion {
  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  const validation = validateAgentSkill(document);
  const direction =
    validation.format === "renma-legacy" || validation.format === "hybrid"
      ? "legacy-to-agent-skills"
      : "none";
  const blocked: SkillMigrationBlock[] = [];
  const candidateAgentSkillsFields: Record<string, string> = {};
  const candidateRenmaMetadata: Record<string, string> = {};
  const preservedMetadata: Record<string, string> = {};
  collectStructuralBlocks(document, frontmatter, blocked);

  if (direction === "none") {
    return {
      sourceFormat: validation.format,
      direction,
      bodyPreserved: true,
      candidateAgentSkillsFields,
      candidateRenmaMetadata,
      preservedMetadata,
      blocked: deduplicateBlocks(blocked),
      reviewPrompt:
        validation.format === "agent-skills"
          ? "This Skill already uses Agent Skills identity. No reverse migration is proposed."
          : "No recognized historical Renma Skill metadata was found. No migration is proposed.",
    };
  }

  const parentDirectory = path.posix.basename(
    path.posix.dirname(document.artifact.path.replaceAll("\\", "/")),
  );
  const parentName = validateAgentSkillName(parentDirectory);
  if (parentName.problems.length > 0 || parentName.normalized === undefined) {
    blocked.push({
      field: "name",
      reason: `Skill directory "${parentDirectory}" is not a valid Agent Skills name: ${parentName.problems.join("; ")}. Rename the directory before migration.`,
    });
  } else {
    const existingName = frontmatter.values.name;
    if (existingName !== undefined) {
      const existingNameValidation = validateAgentSkillName(existingName);
      if (
        existingNameValidation.problems.length > 0 ||
        existingNameValidation.normalized !== parentName.normalized
      ) {
        blocked.push({
          field: "name",
          reason: `Existing Agent Skills name conflicts with parent directory "${parentDirectory}". Human review is required before migration.`,
        });
      } else {
        candidateAgentSkillsFields.name = (existingName as string).trim();
      }
    } else {
      candidateAgentSkillsFields.name = parentName.normalized;
    }
  }

  const description = migrationDescription(
    document,
    frontmatter.values.description,
  );
  if (description === undefined) {
    blocked.push({
      field: "description",
      reason:
        "No unambiguous, usable Agent Skills description is supported by the existing description or body. Human review is required before migration.",
    });
  } else {
    candidateAgentSkillsFields.description = description;
  }

  const existingMetadata = frontmatter.values.metadata;
  if (isStringRecord(existingMetadata)) {
    Object.assign(preservedMetadata, existingMetadata);
    for (const [key, value] of Object.entries(existingMetadata)) {
      if (key.startsWith("renma.")) candidateRenmaMetadata[key] = value;
    }
  }

  for (const legacyField of LEGACY_RENMA_SKILL_FIELDS) {
    if (!(legacyField in frontmatter.values)) continue;
    const canonicalKey = legacyRenmaMetadataKey(legacyField);
    if (!canonicalKey) continue;
    const serialized = serializeLegacyValue(
      legacyField,
      frontmatter.values[legacyField],
    );
    if (serialized.blockedReason) {
      blocked.push({ field: legacyField, reason: serialized.blockedReason });
      continue;
    }
    const value = serialized.value;
    if (value === undefined) continue;
    const canonicalValue = preservedMetadata[canonicalKey];
    if (
      canonicalValue !== undefined &&
      !metadataValuesEquivalent(legacyField, canonicalValue, value)
    ) {
      blocked.push({
        field: legacyField,
        reason: `Canonical ${canonicalKey} conflicts with historical ${legacyField}. Human review is required before migration.`,
      });
      delete candidateRenmaMetadata[canonicalKey];
      continue;
    }
    const retainedValue = canonicalValue ?? value;
    preservedMetadata[canonicalKey] = retainedValue;
    candidateRenmaMetadata[canonicalKey] = retainedValue;
  }

  const requestedOwner = explicitOwner?.trim();
  if (requestedOwner) {
    const existingOwner = preservedMetadata["renma.owner"];
    if (existingOwner !== undefined && existingOwner !== requestedOwner) {
      blocked.push({
        field: "owner",
        reason: `Existing owner "${existingOwner}" differs from explicitly provided owner "${requestedOwner}". Human review is required before migration.`,
      });
    } else {
      preservedMetadata["renma.owner"] = requestedOwner;
      candidateRenmaMetadata["renma.owner"] = requestedOwner;
    }
  }

  const canonicalFrontmatter =
    blocked.length === 0
      ? renderCanonicalFrontmatter(
          frontmatter.values,
          candidateAgentSkillsFields,
          preservedMetadata,
        )
      : undefined;

  return {
    sourceFormat: validation.format,
    direction,
    bodyPreserved: true,
    candidateAgentSkillsFields,
    candidateRenmaMetadata,
    preservedMetadata,
    ...(canonicalFrontmatter ? { canonicalFrontmatter } : {}),
    blocked: deduplicateBlocks(blocked),
    reviewPrompt:
      blocked.length === 0
        ? "Review the canonical frontmatter proposal, preserve the Markdown body byte-for-byte, apply only after human approval, and rerun renma scan."
        : "Resolve every blocked item with human review. Do not generate or apply canonical frontmatter while input is ambiguous.",
  };
}

function collectStructuralBlocks(
  document: ParsedDocument,
  frontmatter: ReturnType<typeof parseAgentSkillFrontmatter>,
  blocked: SkillMigrationBlock[],
): void {
  if (!frontmatter.present) {
    blocked.push({
      field: "frontmatter",
      reason: "Migration is unsafe because YAML frontmatter is missing.",
    });
  } else if (!frontmatter.closed) {
    blocked.push({
      field: "frontmatter",
      reason: "Migration is unsafe because YAML frontmatter is not closed.",
    });
  }
  if (frontmatter.errors.length > 0) {
    blocked.push({
      field: "frontmatter",
      reason: `Migration is unsafe because YAML is invalid: ${frontmatter.errors[0]?.message ?? "parse error"}`,
    });
  }
  if (
    frontmatter.present &&
    frontmatter.closed &&
    frontmatter.errors.length === 0 &&
    !frontmatter.mapping
  ) {
    blocked.push({
      field: "frontmatter",
      reason: "Migration is unsafe because frontmatter is not a mapping.",
    });
  }
  for (const duplicate of frontmatter.duplicateFields) {
    blocked.push({
      field: duplicate.key,
      reason: `Migration is unsafe because top-level field "${duplicate.key}" is duplicated. No value was selected.`,
    });
  }
  for (const duplicate of frontmatter.duplicateMetadataKeys) {
    blocked.push({
      field: `metadata.${duplicate.key}`,
      reason: `Migration is unsafe because metadata key "${duplicate.key}" is duplicated. No value was selected.`,
    });
  }
  if (
    frontmatter.values.metadata !== undefined &&
    !isStringRecord(frontmatter.values.metadata)
  ) {
    blocked.push({
      field: "metadata",
      reason:
        "Migration is unsafe because metadata is not a string-to-string mapping.",
    });
  }
  for (const field of ["license", "allowed-tools"] as const) {
    const value = frontmatter.values[field];
    if (value !== undefined && typeof value !== "string") {
      blocked.push({
        field,
        reason: `Migration is unsafe because Agent Skills ${field} is not a string.`,
      });
    }
  }
  const compatibility = frontmatter.values.compatibility;
  if (
    compatibility !== undefined &&
    (typeof compatibility !== "string" ||
      !compatibility.trim() ||
      Array.from(compatibility).length > 500)
  ) {
    blocked.push({
      field: "compatibility",
      reason:
        "Migration is unsafe because Agent Skills compatibility is not a non-empty string of at most 500 characters.",
    });
  }

  const unknownFields = frontmatter.fields.filter(
    (field) => !STANDARD_FIELDS.has(field.key) && !LEGACY_FIELDS.has(field.key),
  );
  for (const field of unknownFields) {
    blocked.push({
      field: field.key,
      reason: `Unknown top-level field "${field.key}" cannot be discarded or assigned a vendor namespace automatically. Human review is required before migration.`,
    });
  }

  if (
    path.posix.basename(document.artifact.path.replaceAll("\\", "/")) !==
    "SKILL.md"
  ) {
    blocked.push({
      field: "filename",
      reason:
        "Migration is unsafe until the entrypoint filename is exactly SKILL.md.",
    });
  }
}

function migrationDescription(
  document: ParsedDocument,
  existing: unknown,
): string | undefined {
  if (existing !== undefined) {
    if (typeof existing !== "string") return undefined;
    const trimmed = existing.trim();
    return trimmed && Array.from(trimmed).length <= 1024 ? trimmed : undefined;
  }

  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  const lines = document.lines.slice(frontmatter.bodyStartLine - 1);
  const paragraphs: string[] = [];
  let active: string[] = [];
  const flush = () => {
    if (active.length > 0) paragraphs.push(active.join(" "));
    active = [];
  };
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || line.startsWith("#") || /^[-*+]\s/.test(line)) {
      flush();
      continue;
    }
    active.push(line);
  }
  flush();

  for (const paragraph of paragraphs) {
    if (!/\buse (?:this skill )?(?:when|for|to)\b/i.test(paragraph)) continue;
    const sentences = paragraph.match(/[^.!?]+[.!?]?/g) ?? [paragraph];
    const safe = sentences.filter((sentence) => {
      if (!/\b(?:do not|never|must not|may not)\b/i.test(sentence)) return true;
      return /\bdo not use (?:this skill|the skill|it)\b/i.test(sentence);
    });
    const candidate = safe.join(" ").replace(/\s+/g, " ").trim();
    if (candidate && Array.from(candidate).length <= 1024) return candidate;
  }
  return undefined;
}

function serializeLegacyValue(
  field: string,
  value: unknown,
): { value?: string; blockedReason?: string } {
  if (SCALAR_LEGACY_FIELDS.has(field)) {
    if (Array.isArray(value) || isRecord(value)) {
      return {
        blockedReason: `Historical ${field} must be a scalar value. Human review is required before migration.`,
      };
    }
    if (typeof value === "string") {
      if (!value.trim()) {
        return {
          blockedReason: `Historical ${field} is empty. Human review is required before migration.`,
        };
      }
      return { value };
    }
    if (typeof value === "boolean" || typeof value === "number") {
      return { value: String(value) };
    }
    return {
      blockedReason: `Historical ${field} must be a scalar value. Human review is required before migration.`,
    };
  }

  if (LIST_LEGACY_FIELDS.has(field)) {
    let normalized: string[] | undefined;
    if (typeof value === "string") {
      if (!value.trim()) {
        return {
          blockedReason: `Historical ${field} is empty. Human review is required before migration.`,
        };
      }
      normalized = parseLegacyStringList(value);
    } else if (typeof value === "boolean" || typeof value === "number") {
      normalized = [String(value)];
    } else if (Array.isArray(value)) {
      if (
        !value.every(
          (item) =>
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean",
        )
      ) {
        return {
          blockedReason: `Historical ${field} contains a non-scalar list value. Human review is required before migration.`,
        };
      }
      normalized = value.map(String);
    }

    if (normalized === undefined) {
      return {
        blockedReason: `Historical ${field} cannot be interpreted as a string list. Human review is required before migration.`,
      };
    }
    if (new Set(normalized).size !== normalized.length) {
      return {
        blockedReason: `Historical ${field} contains ambiguous duplicate semantic values. Human review is required before migration.`,
      };
    }
    return { value: JSON.stringify(normalized) };
  }

  return {
    blockedReason: `Historical ${field} is not part of the supported migration profile. Human review is required before migration.`,
  };
}

function parseLegacyStringList(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) &&
        parsed.every(
          (item) =>
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean",
        )
        ? parsed.map(String)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function metadataValuesEquivalent(
  legacyField: string,
  canonicalValue: string,
  migratedValue: string,
): boolean {
  if (canonicalValue === migratedValue) return true;
  if (!LIST_LEGACY_FIELDS.has(legacyField)) return false;
  const canonicalList = parseJsonScalarList(canonicalValue);
  const migratedList = parseJsonScalarList(migratedValue);
  return (
    canonicalList !== undefined &&
    migratedList !== undefined &&
    JSON.stringify(canonicalList) === JSON.stringify(migratedList)
  );
}

function parseJsonScalarList(value: string): string[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      )
      ? parsed.map(String)
      : undefined;
  } catch {
    return undefined;
  }
}

function renderCanonicalFrontmatter(
  existing: Record<string, unknown>,
  identity: Record<string, string>,
  metadata: Record<string, string>,
): string {
  const candidate: Record<string, unknown> = {
    name: identity.name,
    description: identity.description,
  };
  for (const field of ["license", "compatibility", "allowed-tools"] as const) {
    if (existing[field] !== undefined) candidate[field] = existing[field];
  }
  if (Object.keys(metadata).length > 0) candidate.metadata = metadata;
  return `---\n${stringify(candidate, { lineWidth: 0 }).trimEnd()}\n---`;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deduplicateBlocks(
  blocked: SkillMigrationBlock[],
): SkillMigrationBlock[] {
  const seen = new Set<string>();
  return blocked.filter((item) => {
    const key = `${item.field}\u0000${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
