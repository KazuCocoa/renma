import path from "node:path";

import {
  canonicalRenmaMetadataFields,
  legacyRenmaMetadataFields,
} from "./renma-metadata.js";
import type { MetadataValue, ParsedDocument } from "./types.js";

export const AGENT_SKILLS_SPECIFICATION =
  "https://agentskills.io/specification";
export const AGENT_SKILLS_VALIDATION_PROFILE =
  "agentskills.io/specification@2026-07-11";

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;

export type AgentSkillFormat =
  | "agent-skills"
  | "renma-legacy"
  | "hybrid"
  | "unknown";

export interface AgentSkillValidationIssue {
  code: string;
  severity: "error" | "warning";
  category: "specification" | "renma-authoring";
  path: string;
  startLine: number;
  endLine: number;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface AgentSkillValidationResult {
  path: string;
  format: AgentSkillFormat;
  valid: boolean;
  name?: string;
  description?: string;
  migrationRecommended: boolean;
  legacyFields: string[];
  canonicalRenmaFields: string[];
  errorCount: number;
  warningCount: number;
  issues: AgentSkillValidationIssue[];
}

export interface AgentSkillsValidationSummary {
  specification: string;
  profile: string;
  totalSkillCount: number;
  validSkillCount: number;
  invalidSkillCount: number;
  legacySkillCount: number;
  hybridSkillCount: number;
  canonicalSkillCount: number;
  warningCount: number;
  results: AgentSkillValidationResult[];
}

interface RawFrontmatterField {
  key: string;
  value: string;
  startLine: number;
  endLine: number;
}

interface RawFrontmatter {
  present: boolean;
  closed: boolean;
  fields: RawFrontmatterField[];
  metadataFields: RawFrontmatterField[];
  duplicateFields: RawFrontmatterField[];
  metadataShapeValid: boolean;
}

export function validateAgentSkills(
  documents: ParsedDocument[],
): AgentSkillsValidationSummary {
  const results = documents
    .filter((document) => document.artifact.kind === "skill")
    .map(validateAgentSkill)
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    specification: AGENT_SKILLS_SPECIFICATION,
    profile: AGENT_SKILLS_VALIDATION_PROFILE,
    totalSkillCount: results.length,
    validSkillCount: results.filter((result) => result.valid).length,
    invalidSkillCount: results.filter((result) => !result.valid).length,
    legacySkillCount: results.filter(
      (result) => result.format === "renma-legacy",
    ).length,
    hybridSkillCount: results.filter((result) => result.format === "hybrid")
      .length,
    canonicalSkillCount: results.filter(
      (result) => result.format === "agent-skills",
    ).length,
    warningCount: results.reduce(
      (total, result) => total + result.warningCount,
      0,
    ),
    results,
  };
}

export function validateAgentSkill(
  document: ParsedDocument,
): AgentSkillValidationResult {
  const raw = parseRawFrontmatter(document);
  const issues: AgentSkillValidationIssue[] = [];
  const legacyFields = legacyRenmaMetadataFields(document);
  const canonicalFields = canonicalRenmaMetadataFields(document);
  const name = metadataText(document.metadata.name);
  const description = metadataText(document.metadata.description);
  const format = skillFormat({
    hasAgentSkillsIdentity: Boolean(name || description),
    legacyFields,
    canonicalFields,
  });

  if (path.posix.basename(document.artifact.path) !== "SKILL.md") {
    issues.push(
      issue(
        document,
        "AS-SKILL-NONCANONICAL-FILENAME",
        "error",
        "specification",
        "Agent Skills requires the skill entrypoint filename to be SKILL.md.",
        1,
      ),
    );
  }

  if (!raw.present) {
    issues.push(
      issue(
        document,
        "AS-SKILL-MISSING-FRONTMATTER",
        "error",
        "specification",
        "SKILL.md must start with YAML frontmatter delimited by ---.",
        1,
      ),
    );
  } else if (!raw.closed) {
    issues.push(
      issue(
        document,
        "AS-SKILL-UNCLOSED-FRONTMATTER",
        "error",
        "specification",
        "SKILL.md frontmatter must be closed with --- before the Markdown body.",
        1,
      ),
    );
  }

  const unexpectedFields = raw.fields
    .map((field) => field.key)
    .filter((field) => !ALLOWED_TOP_LEVEL_FIELDS.has(field));
  if (unexpectedFields.length > 0) {
    const first = raw.fields.find((field) =>
      unexpectedFields.includes(field.key),
    );
    issues.push({
      ...issue(
        document,
        "AS-SKILL-UNEXPECTED-TOP-LEVEL-FIELD",
        "error",
        "specification",
        `Unexpected top-level Agent Skills fields: ${unexpectedFields.sort().join(", ")}. Move Renma extensions under metadata using renma.* string keys.`,
        first?.startLine ?? 1,
      ),
      details: { fields: unexpectedFields.sort() },
    });
  }

  for (const duplicate of raw.duplicateFields) {
    issues.push(
      issue(
        document,
        "AS-SKILL-DUPLICATE-FIELD",
        "error",
        "specification",
        `Agent Skills frontmatter field "${duplicate.key}" is declared more than once.`,
        duplicate.startLine,
        duplicate.key,
      ),
    );
  }

  if (!raw.metadataShapeValid) {
    const metadata = raw.fields.find((field) => field.key === "metadata");
    issues.push(
      issue(
        document,
        "AS-SKILL-INVALID-METADATA",
        "error",
        "specification",
        "Agent Skills metadata must be a mapping from string keys to string values.",
        metadata?.startLine ?? 1,
        "metadata",
      ),
    );
  }

  validateName(document, name, issues);
  validateDescription(document, description, issues);
  validateOptionalTextField(
    document,
    "compatibility",
    MAX_COMPATIBILITY_LENGTH,
    issues,
  );
  validateStringField(document, "license", issues);
  validateStringField(document, "allowed-tools", issues);

  issues.push(...authoringIssues(document, description));
  issues.sort((a, b) => {
    const byLine = a.startLine - b.startLine;
    if (byLine !== 0) return byLine;
    return a.code.localeCompare(b.code);
  });

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return {
    path: document.artifact.path,
    format,
    valid: errorCount === 0,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    migrationRecommended:
      format === "renma-legacy" ||
      format === "hybrid" ||
      unexpectedFields.length > 0,
    legacyFields,
    canonicalRenmaFields: canonicalFields,
    errorCount,
    warningCount,
    issues,
  };
}

function validateName(
  document: ParsedDocument,
  name: string | undefined,
  issues: AgentSkillValidationIssue[],
): void {
  const line = fieldLine(document, "name");
  if (!name) {
    issues.push(
      issue(
        document,
        "AS-SKILL-MISSING-NAME",
        "error",
        "specification",
        "Agent Skills requires a non-empty name field.",
        line,
        "name",
      ),
    );
    return;
  }

  const reasons: string[] = [];
  const normalized = name.normalize("NFKC");
  if (characterLength(normalized) > MAX_NAME_LENGTH) {
    reasons.push(`must not exceed ${MAX_NAME_LENGTH} characters`);
  }
  if (normalized !== normalized.toLowerCase()) {
    reasons.push("must be lowercase");
  }
  if (normalized.startsWith("-") || normalized.endsWith("-")) {
    reasons.push("must not start or end with a hyphen");
  }
  if (normalized.includes("--")) {
    reasons.push("must not contain consecutive hyphens");
  }
  if (
    ![...normalized].every(
      (character) => character === "-" || /[\p{L}\p{N}]/u.test(character),
    )
  ) {
    reasons.push("may contain only lowercase letters, numbers, and hyphens");
  }
  if (reasons.length > 0) {
    issues.push(
      issue(
        document,
        "AS-SKILL-INVALID-NAME",
        "error",
        "specification",
        `Invalid Agent Skills name "${name}": ${reasons.join("; ")}.`,
        line,
        "name",
      ),
    );
  }

  const parentDirectory = path.posix.basename(
    path.posix.dirname(document.artifact.path),
  );
  if (parentDirectory.normalize("NFKC") !== normalized) {
    issues.push({
      ...issue(
        document,
        "AS-SKILL-NAME-DIRECTORY-MISMATCH",
        "error",
        "specification",
        `Agent Skills name "${name}" must match parent directory "${parentDirectory}".`,
        line,
        "name",
      ),
      details: { name, parentDirectory },
    });
  }
}

function validateDescription(
  document: ParsedDocument,
  description: string | undefined,
  issues: AgentSkillValidationIssue[],
): void {
  const line = fieldLine(document, "description");
  if (!description) {
    issues.push(
      issue(
        document,
        "AS-SKILL-MISSING-DESCRIPTION",
        "error",
        "specification",
        "Agent Skills requires a non-empty description field describing what the skill does and when to use it.",
        line,
        "description",
      ),
    );
    return;
  }

  if (characterLength(description) > MAX_DESCRIPTION_LENGTH) {
    issues.push(
      issue(
        document,
        "AS-SKILL-DESCRIPTION-TOO-LONG",
        "error",
        "specification",
        `Agent Skills description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`,
        line,
        "description",
      ),
    );
  }

  if (!usageLanguagePattern().test(description)) {
    issues.push(
      issue(
        document,
        "RN-SKILL-DESCRIPTION-MISSING-USAGE-BOUNDARY",
        "warning",
        "renma-authoring",
        "Description should state when the agent should use this skill, because name and description are the first discovery surface.",
        line,
        "description",
      ),
    );
  }
}

function validateOptionalTextField(
  document: ParsedDocument,
  field: string,
  maxLength: number,
  issues: AgentSkillValidationIssue[],
): void {
  const value = document.metadata[field];
  if (value === undefined) return;
  if (Array.isArray(value) || value.trim().length === 0) {
    issues.push(
      issue(
        document,
        `AS-SKILL-INVALID-${field.toUpperCase()}`,
        "error",
        "specification",
        `Agent Skills ${field} must be a non-empty string when provided.`,
        fieldLine(document, field),
        field,
      ),
    );
    return;
  }
  if (characterLength(value) > maxLength) {
    issues.push(
      issue(
        document,
        `AS-SKILL-${field.toUpperCase()}-TOO-LONG`,
        "error",
        "specification",
        `Agent Skills ${field} exceeds ${maxLength} characters.`,
        fieldLine(document, field),
        field,
      ),
    );
  }
}

function validateStringField(
  document: ParsedDocument,
  field: string,
  issues: AgentSkillValidationIssue[],
): void {
  const value = document.metadata[field];
  if (value === undefined || typeof value === "string") return;
  issues.push(
    issue(
      document,
      `AS-SKILL-INVALID-${field.toUpperCase()}`,
      "error",
      "specification",
      `Agent Skills ${field} must be a string when provided.`,
      fieldLine(document, field),
      field,
    ),
  );
}

function authoringIssues(
  document: ParsedDocument,
  description: string | undefined,
): AgentSkillValidationIssue[] {
  const issues: AgentSkillValidationIssue[] = [];
  const body = markdownBody(document);
  const hasNegativeDirective = negativeDirectivePattern().test(body);
  const hasNegativeHeading = document.headings.some((heading) =>
    negativeHeadingPattern().test(heading.text),
  );
  const descriptionHasNegative = description
    ? negativeDirectivePattern().test(description)
    : false;

  if ((hasNegativeDirective || hasNegativeHeading) && !descriptionHasNegative) {
    issues.push(
      issue(
        document,
        "RN-SKILL-DESCRIPTION-OMITS-NEGATIVE-BOUNDARY",
        "warning",
        "renma-authoring",
        "The body declares negative usage guidance, but description does not expose a selection-critical exclusion. Reflect the important 'do not use' boundary in description without copying full procedures.",
        fieldLine(document, "description"),
        "description",
      ),
    );
  }

  if (!hasNegativeDirective && !hasNegativeHeading && !descriptionHasNegative) {
    issues.push(
      issue(
        document,
        "RN-SKILL-MISSING-NEGATIVE-USAGE-BOUNDARY",
        "warning",
        "renma-authoring",
        "Skill does not state when it must not be used. Add a reviewed negative usage boundary rather than leaving nearby cases to model inference.",
        document.headings[0]?.line ?? 1,
      ),
    );
  }

  if (hasNegativeDirective && !hasNegativeHeading) {
    const line = firstMatchingLine(document, negativeDirectivePattern());
    issues.push(
      issue(
        document,
        "RN-SKILL-NEGATIVE-DIRECTIVES-NOT-PROMINENT",
        "warning",
        "renma-authoring",
        "Negative directives are present but not grouped under a prominent 'Do Not Use' or 'Hard Constraints' section. Make critical constraints easy to find after activation without changing their meaning.",
        line,
      ),
    );
  }

  return issues;
}

function parseRawFrontmatter(document: ParsedDocument): RawFrontmatter {
  const lines = document.lines;
  if (lines[0]?.trim() !== "---") {
    return {
      present: false,
      closed: false,
      fields: [],
      metadataFields: [],
      duplicateFields: [],
      metadataShapeValid: true,
    };
  }

  const fields: RawFrontmatterField[] = [];
  const metadataFields: RawFrontmatterField[] = [];
  const duplicateFields: RawFrontmatterField[] = [];
  const seen = new Set<string>();
  let closed = false;
  let metadataShapeValid = true;
  let inMetadata = false;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") {
      closed = true;
      break;
    }

    const topLevel = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (topLevel) {
      const key = topLevel[1] ?? "";
      const value = topLevel[2] ?? "";
      const field = {
        key,
        value,
        startLine: index + 1,
        endLine: index + 1,
      };
      fields.push(field);
      if (seen.has(key)) duplicateFields.push(field);
      seen.add(key);
      inMetadata = key === "metadata";
      if (inMetadata && value.trim().length > 0) metadataShapeValid = false;
      continue;
    }

    if (inMetadata) {
      const child = line.match(/^\s{2,}([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (child) {
        const value = child[2] ?? "";
        if (value.trim().length === 0 || /^[|>][-+]?\s*$/.test(value.trim())) {
          metadataShapeValid = false;
        }
        metadataFields.push({
          key: child[1] ?? "",
          value,
          startLine: index + 1,
          endLine: index + 1,
        });
        continue;
      }
      if (/^\s+-\s+/.test(line) || line.trim().length > 0) {
        metadataShapeValid = false;
      }
    }
  }

  return {
    present: true,
    closed,
    fields,
    metadataFields,
    duplicateFields,
    metadataShapeValid,
  };
}

function skillFormat(input: {
  hasAgentSkillsIdentity: boolean;
  legacyFields: string[];
  canonicalFields: string[];
}): AgentSkillFormat {
  if (input.hasAgentSkillsIdentity && input.legacyFields.length > 0) {
    return "hybrid";
  }
  if (input.hasAgentSkillsIdentity) return "agent-skills";
  if (input.legacyFields.length > 0) return "renma-legacy";
  if (input.canonicalFields.length > 0) return "agent-skills";
  return "unknown";
}

function metadataText(value: MetadataValue | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function issue(
  document: ParsedDocument,
  code: string,
  severity: "error" | "warning",
  category: "specification" | "renma-authoring",
  message: string,
  line: number,
  field?: string,
): AgentSkillValidationIssue {
  return {
    code,
    severity,
    category,
    path: document.artifact.path,
    startLine: line,
    endLine: line,
    message,
    ...(field ? { field } : {}),
  };
}

function fieldLine(document: ParsedDocument, field: string): number {
  return document.metadataFields[field]?.startLine ?? 1;
}

function markdownBody(document: ParsedDocument): string {
  if (document.lines[0]?.trim() !== "---") return document.artifact.content;
  const end = document.lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return (end >= 0 ? document.lines.slice(end + 1) : document.lines).join("\n");
}

function firstMatchingLine(document: ParsedDocument, pattern: RegExp): number {
  const flags = pattern.flags.replace("g", "");
  const safePattern = new RegExp(pattern.source, flags);
  const index = document.lines.findIndex((line) => safePattern.test(line));
  return index >= 0 ? index + 1 : 1;
}

function usageLanguagePattern(): RegExp {
  return /\b(?:use|used|when|whenever|for requests?|for tasks?|applies?)\b|(?:使用|利用|とき|場合|向け)/iu;
}

function negativeDirectivePattern(): RegExp {
  return /\b(?:do not|don't|never|must not|should not|avoid|not for|not when)\b|(?:使用しない|利用しない|してはいけない|禁止|避ける|対象外)/iu;
}

function negativeHeadingPattern(): RegExp {
  return /\b(?:do not use|when not to use|not for|hard constraints?|constraints?|prohibited|out of scope)\b|(?:使用しない|利用しない|禁止|制約|対象外)/iu;
}

function characterLength(value: string): number {
  return [...value].length;
}
