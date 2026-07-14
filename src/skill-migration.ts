import { stringify } from "yaml";

import {
  AGENT_SKILLS_TOP_LEVEL_FIELDS,
  agentSkillFenceLines,
  legacyRenmaMetadataKey,
  LEGACY_RENMA_SKILL_FIELDS,
  normalizeAgentSkillDirectoryName,
  normalizeAgentSkillNameField,
  validateAgentSkill,
  type AgentSkillFormat,
  type AgentSkillValidationResult,
} from "./agent-skills.js";
import type { SkillEntrypointPath } from "./discovery.js";
import { parseDocument } from "./markdown.js";
import { validateCanonicalSecurityMetadata } from "./security-policy.js";
import type { Artifact, ParsedDocument } from "./types.js";
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
const TEXT_SCALAR_LEGACY_FIELDS = new Set([
  "id",
  "title",
  "version",
  "owner",
  "status",
  "purpose",
  "last_reviewed_at",
  "review_cycle",
  "expires_at",
  "security_profile",
]);
const BOOLEAN_SCALAR_LEGACY_FIELDS = new Set([
  "network_allowed",
  "external_upload_allowed",
  "secrets_allowed",
  "requires_human_approval",
]);

export interface SkillMigrationBlock {
  field: string;
  reason: string;
}

export interface AgentSkillMigrationSuggestion {
  sourceFormat: AgentSkillFormat;
  direction: "legacy-to-agent-skills" | "none";
  proposalKind: "historical-migration" | "canonical-metadata-retrofit" | "none";
  sourcePath: string;
  targetPath: string;
  entrypointMigration: "none" | "rename" | "move-and-rename";
  bodyPreserved: true;
  candidateAgentSkillsFields: Record<string, string>;
  candidateRenmaMetadata: Record<string, string>;
  preservedMetadata: Record<string, string>;
  canonicalFrontmatter?: string;
  blocked: SkillMigrationBlock[];
  reviewPrompt: string;
}

export interface AgentSkillMigrationOptions {
  explicitOwner?: string;
  entrypoint?: SkillEntrypointPath;
  additionalBlocks?: SkillMigrationBlock[];
}

/** Build a one-way, non-editing migration proposal for a Skill target. */
export function buildAgentSkillMigrationSuggestion(
  document: ParsedDocument,
  options: AgentSkillMigrationOptions = {},
): AgentSkillMigrationSuggestion {
  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  const validation = validateAgentSkill(document);
  const entrypoint = options.entrypoint;
  const historicalEntrypoint =
    entrypoint !== undefined && entrypoint.kind !== "canonical";
  const direction =
    validation.format === "renma-legacy" ||
    validation.format === "hybrid" ||
    historicalEntrypoint
      ? "legacy-to-agent-skills"
      : "none";
  const sourcePath =
    entrypoint?.currentPath ?? document.artifact.path.replaceAll("\\", "/");
  const targetPath = entrypoint?.targetPath ?? sourcePath;
  const entrypointMigration =
    entrypoint?.kind === "lowercase-entrypoint"
      ? "rename"
      : entrypoint?.kind === "flat-legacy-entrypoint"
        ? "move-and-rename"
        : "none";
  const blocked: SkillMigrationBlock[] = [...(options.additionalBlocks ?? [])];
  const candidateAgentSkillsFields: Record<string, string> = {};
  const candidateRenmaMetadata: Record<string, string> = {};
  const preservedMetadata: Record<string, string> = {};
  collectStructuralBlocks(document, frontmatter, blocked);
  const duplicateTopLevelMetadata = frontmatter.duplicateFields.some(
    (field) => field.key === "metadata",
  );
  const duplicateMetadataKeys = new Set(
    frontmatter.duplicateMetadataKeys.map((field) => field.key),
  );
  const existingMetadata = frontmatter.values.metadata;
  if (!duplicateTopLevelMetadata && isStringRecord(existingMetadata)) {
    for (const [key, value] of Object.entries(existingMetadata)) {
      if (duplicateMetadataKeys.has(key)) continue;
      preservedMetadata[key] = value;
      if (key.startsWith("renma.")) candidateRenmaMetadata[key] = value;
    }
  }

  const requestedOwner = options.explicitOwner?.trim();
  const proposalKind =
    direction === "legacy-to-agent-skills"
      ? "historical-migration"
      : validation.format === "agent-skills" && requestedOwner
        ? "canonical-metadata-retrofit"
        : "none";

  if (proposalKind === "none") {
    for (const key of Object.keys(candidateRenmaMetadata)) {
      delete candidateRenmaMetadata[key];
    }
    return {
      sourceFormat: validation.format,
      direction,
      proposalKind,
      sourcePath,
      targetPath,
      entrypointMigration,
      bodyPreserved: true,
      candidateAgentSkillsFields,
      candidateRenmaMetadata,
      preservedMetadata,
      blocked: deduplicateBlocks(blocked),
      reviewPrompt:
        validation.format === "agent-skills"
          ? "This Skill already uses Agent Skills identity. No metadata retrofit or reverse migration is proposed."
          : "No recognized pre-0.16 Renma Skill metadata was found. No migration is proposed.",
    };
  }

  if (proposalKind === "canonical-metadata-retrofit") {
    for (const key of Object.keys(candidateRenmaMetadata)) {
      delete candidateRenmaMetadata[key];
    }
    if (entrypoint?.kind !== "canonical" || !validation.valid) {
      collectSpecificationBlocks(validation, blocked, "Existing Agent Skill");
      if (entrypoint?.kind !== "canonical") {
        blocked.push({
          field: "entrypoint",
          reason:
            "Canonical Agent Skills metadata retrofit requires the exact SKILL.md entrypoint.",
        });
      }
    } else if (
      requestedOwner &&
      !duplicateTopLevelMetadata &&
      !duplicateMetadataKeys.has("renma.owner")
    ) {
      const existingOwner = preservedMetadata["renma.owner"];
      if (existingOwner !== undefined && existingOwner !== requestedOwner) {
        blocked.push({
          field: "owner",
          reason: `Existing owner "${existingOwner}" differs from explicitly provided owner "${requestedOwner}". Human review is required before changing canonical Agent Skills metadata.`,
        });
      } else if (existingOwner === undefined) {
        preservedMetadata["renma.owner"] = requestedOwner;
        candidateRenmaMetadata["renma.owner"] = requestedOwner;
      }
    }

    let canonicalFrontmatter =
      candidateRenmaMetadata["renma.owner"] !== undefined &&
      blocked.length === 0
        ? renderCanonicalFrontmatter(
            frontmatter.values,
            {
              name: String(frontmatter.values.name),
              description: String(frontmatter.values.description),
            },
            preservedMetadata,
          )
        : undefined;
    if (canonicalFrontmatter) {
      const candidateBlocks = validateMigrationCandidate(
        document,
        frontmatter.bodyStartLine,
        targetPath,
        canonicalFrontmatter,
      );
      if (candidateBlocks.length > 0) {
        blocked.push(...candidateBlocks);
        canonicalFrontmatter = undefined;
      }
    }
    const actualProposalKind =
      canonicalFrontmatter === undefined &&
      blocked.length === 0 &&
      Object.keys(candidateRenmaMetadata).length === 0
        ? "none"
        : proposalKind;

    return {
      sourceFormat: validation.format,
      direction,
      proposalKind: actualProposalKind,
      sourcePath,
      targetPath,
      entrypointMigration,
      bodyPreserved: true,
      candidateAgentSkillsFields,
      candidateRenmaMetadata,
      preservedMetadata,
      ...(canonicalFrontmatter ? { canonicalFrontmatter } : {}),
      blocked: deduplicateBlocks(blocked),
      reviewPrompt: canonicalFrontmatter
        ? "Review the canonical Renma metadata retrofit, preserve the Markdown body byte-for-byte, apply only after human approval, and rerun renma scan. No reverse migration is proposed."
        : blocked.length > 0
          ? "Resolve every blocked item with human review. Do not change canonical Agent Skills metadata while specification or ownership evidence is invalid. No reverse migration is proposed."
          : "The canonical Agent Skill already has the explicitly provided owner. Preserve it; no rewrite or reverse migration is proposed.",
    };
  }

  if (!entrypoint) {
    blocked.push({
      field: "entrypoint",
      reason:
        "Skill migration requires an entrypoint under skills/** or .agents/skills/** using SKILL.md, skill.md, or *.skill.md.",
    });
  }
  const candidateDirectory = entrypoint?.candidateName ?? "";
  const parentName = normalizeAgentSkillDirectoryName(candidateDirectory);
  if (parentName.problems.length > 0 || parentName.normalized === undefined) {
    blocked.push({
      field: "name",
      reason: `Target Skill directory "${candidateDirectory}" is not a valid Agent Skills name: ${parentName.problems.join("; ")}. Rename the directory before migration.`,
    });
  } else {
    const existingName = frontmatter.values.name;
    if (existingName !== undefined) {
      const existingNameValidation = normalizeAgentSkillNameField(existingName);
      if (
        existingNameValidation.problems.length > 0 ||
        existingNameValidation.normalized !== parentName.normalized
      ) {
        candidateAgentSkillsFields.name = parentName.normalized;
        blocked.push({
          field: "name",
          reason: `Existing Agent Skills name conflicts with target directory "${candidateDirectory}". Human review is required before migration.`,
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

  for (const legacyField of LEGACY_RENMA_SKILL_FIELDS) {
    if (duplicateTopLevelMetadata) continue;
    if (!(legacyField in frontmatter.values)) continue;
    const canonicalKey = legacyRenmaMetadataKey(legacyField);
    if (!canonicalKey) continue;
    if (duplicateMetadataKeys.has(canonicalKey)) continue;
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
        reason: `Canonical ${canonicalKey} conflicts with pre-0.16 Renma Skill field ${legacyField}. Human review is required before migration.`,
      });
      delete candidateRenmaMetadata[canonicalKey];
      continue;
    }
    const retainedValue = canonicalValue ?? value;
    preservedMetadata[canonicalKey] = retainedValue;
    candidateRenmaMetadata[canonicalKey] = retainedValue;
  }

  if (
    requestedOwner &&
    !duplicateTopLevelMetadata &&
    !duplicateMetadataKeys.has("renma.owner")
  ) {
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

  let canonicalFrontmatter =
    blocked.length === 0
      ? renderCanonicalFrontmatter(
          frontmatter.values,
          candidateAgentSkillsFields,
          preservedMetadata,
        )
      : undefined;
  if (canonicalFrontmatter) {
    const candidateBlocks = validateMigrationCandidate(
      document,
      frontmatter.bodyStartLine,
      targetPath,
      canonicalFrontmatter,
    );
    if (candidateBlocks.length > 0) {
      blocked.push(...candidateBlocks);
      canonicalFrontmatter = undefined;
    }
  }

  return {
    sourceFormat: validation.format,
    direction,
    proposalKind,
    sourcePath,
    targetPath,
    entrypointMigration,
    bodyPreserved: true,
    candidateAgentSkillsFields,
    candidateRenmaMetadata,
    preservedMetadata,
    ...(canonicalFrontmatter ? { canonicalFrontmatter } : {}),
    blocked: deduplicateBlocks(blocked),
    reviewPrompt:
      blocked.length === 0
        ? entrypointMigration === "none"
          ? "Review the canonical frontmatter proposal, preserve the Markdown body byte-for-byte, apply only after human approval, and rerun renma scan."
          : `Review the canonical frontmatter and ${entrypointMigration} entrypoint proposal together, preserve the Markdown body byte-for-byte, apply both path and content changes only after human approval, and rerun renma scan.`
        : "Resolve every blocked item with human review. Do not generate or apply canonical frontmatter while input is ambiguous.",
  };
}

function collectSpecificationBlocks(
  validation: AgentSkillValidationResult,
  blocked: SkillMigrationBlock[],
  subject: string,
): void {
  for (const issue of validation.issues.filter(
    (candidate) =>
      candidate.category === "specification" && candidate.severity === "error",
  )) {
    blocked.push({
      field: issue.field ?? "agent-skills",
      reason: `${subject} is invalid: ${issue.message}`,
    });
  }
}

function validateMigrationCandidate(
  source: ParsedDocument,
  bodyStartLine: number,
  targetPath: string,
  canonicalFrontmatter: string,
): SkillMigrationBlock[] {
  const body = source.lines.slice(bodyStartLine - 1).join("\n");
  const content = `${canonicalFrontmatter}\n${body}`;
  const candidate = parseDocument({
    path: targetPath,
    absolutePath: targetPath,
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  } satisfies Artifact);
  const validation = validateAgentSkill(candidate);
  const blocked: SkillMigrationBlock[] = [];
  collectSpecificationBlocks(
    validation,
    blocked,
    "Resulting Agent Skills candidate",
  );
  if (validation.valid) {
    const security = validateCanonicalSecurityMetadata(candidate);
    for (const issue of security.issues) {
      blocked.push({
        field: `metadata.${issue.key}`,
        reason: `Resulting Agent Skills candidate has invalid canonical security metadata: ${issue.reason}.`,
      });
    }
  }
  return blocked;
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
  const fenceLines = agentSkillFenceLines(
    document.lines,
    frontmatter.bodyStartLine,
  );
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const lineNumber = frontmatter.bodyStartLine + index;
    const line = rawLine.trim();
    if (
      fenceLines.has(lineNumber) ||
      !line ||
      line.startsWith("#") ||
      /^[-*+]\s/.test(line)
    ) {
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
  if (TEXT_SCALAR_LEGACY_FIELDS.has(field)) {
    if (typeof value === "string") {
      if (!value.trim()) {
        return {
          blockedReason: `Pre-0.16 Renma Skill field ${field} is empty. Human review is required before migration.`,
        };
      }
      return { value };
    }
    return {
      blockedReason: `Pre-0.16 Renma Skill field ${field} must be a YAML string to preserve its exact value.`,
    };
  }

  if (BOOLEAN_SCALAR_LEGACY_FIELDS.has(field)) {
    if (typeof value === "boolean") return { value: String(value) };
    if (value === "true" || value === "false") return { value };
    return {
      blockedReason: `Pre-0.16 Renma Skill field ${field} must be a boolean or the string "true" or "false".`,
    };
  }

  if (LIST_LEGACY_FIELDS.has(field)) {
    let normalized: string[] | undefined;
    if (typeof value === "string") {
      if (!value.trim()) {
        return {
          blockedReason: `Pre-0.16 Renma Skill field ${field} is empty. Human review is required before migration.`,
        };
      }
      normalized = parseLegacyStringList(value);
    } else if (Array.isArray(value)) {
      if (!value.every((item) => typeof item === "string")) {
        return {
          blockedReason: `Pre-0.16 Renma Skill field ${field} must contain string values only.`,
        };
      }
      normalized = value;
    }

    if (normalized === undefined) {
      return {
        blockedReason: `Pre-0.16 Renma Skill field ${field} cannot be interpreted as a string list. Human review is required before migration.`,
      };
    }
    if (new Set(normalized).size !== normalized.length) {
      return {
        blockedReason: `Pre-0.16 Renma Skill field ${field} contains ambiguous duplicate semantic values. Human review is required before migration.`,
      };
    }
    return { value: JSON.stringify(normalized) };
  }

  return {
    blockedReason: `Pre-0.16 Renma Skill field ${field} is not part of the supported migration profile. Human review is required before migration.`,
  };
}

function parseLegacyStringList(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) &&
        parsed.every((item) => typeof item === "string")
        ? parsed
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
      parsed.every((item) => typeof item === "string")
      ? parsed
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
