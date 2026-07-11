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
  const bodyLines = authoringBodyLines(document);
  const selectionBoundaryLines = bodyLines.filter((line) =>
    hasExplicitSkillSelectionBoundary(line.text),
  );
  const hasSelectionBoundaryHeading = document.headings.some((heading) =>
    selectionBoundaryHeadingPattern().test(heading.text),
  );
  const descriptionHasSelectionBoundary = description
    ? hasExplicitSkillSelectionBoundary(description)
    : false;
  const executionConstraints = bodyLines.filter(
    (line) =>
      hasExplicitExecutionConstraint(line.text) &&
      !hasExplicitSkillSelectionBoundary(line.text),
  );
  const hasConstraintHeading = document.headings.some((heading) =>
    executionConstraintHeadingPattern().test(heading.text),
  );

  if (
    (selectionBoundaryLines.length > 0 || hasSelectionBoundaryHeading) &&
    !descriptionHasSelectionBoundary
  ) {
    issues.push(
      issue(
        document,
        "RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY",
        "warning",
        "renma-authoring",
        "The body explicitly excludes a class of tasks from this skill, but description does not expose that selection boundary. Add only the supported skill-selection exclusion; do not copy execution constraints into description.",
        fieldLine(document, "description"),
        "description",
      ),
    );
  }

  if (executionConstraints.length > 0 && !hasConstraintHeading) {
    issues.push(
      issue(
        document,
        "RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT",
        "warning",
        "renma-authoring",
        "Execution prohibitions are present but no prominent Hard Constraints, Prohibited Actions, Safety Constraints, or equivalent constraint section exists. Group the existing constraints without changing their meaning.",
        executionConstraints[0]?.line ?? 1,
      ),
    );
  }

  const executionSections = new Set(
    executionConstraints.map((constraint) => constraint.section),
  );
  if (
    executionConstraints.length > 1 &&
    executionSections.size > 1 &&
    !hasConstraintHeading
  ) {
    issues.push(
      issue(
        document,
        "RN-SKILL-EXECUTION-CONSTRAINT-SCATTERED",
        "warning",
        "renma-authoring",
        "Execution prohibitions appear in multiple sections without a central constraint section. Group the existing prohibitions for review without inventing or broadening them.",
        executionConstraints[0]?.line ?? 1,
      ),
    );
  }

  const constraintLines = new Set(
    executionConstraints.map((constraint) => constraint.line),
  );
  const missingAlternatives = executionConstraints.filter(
    (constraint) =>
      !hasAlternativeOrStopBehavior(
        nearbyConstraintText(document, constraint.line, constraintLines),
      ),
  );
  if (missingAlternatives.length > 0) {
    issues.push({
      ...issue(
        document,
        "RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE",
        "warning",
        "renma-authoring",
        "An execution prohibition has no nearby reviewed alternative or stop behavior. Add the existing required action when supported; otherwise request human clarification. Do not invent replacement behavior.",
        missingAlternatives[0]?.line ?? 1,
      ),
      details: { lines: missingAlternatives.map((item) => item.line) },
    });
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

function usageLanguagePattern(): RegExp {
  return /\b(?:use|used|when|whenever|for requests?|for tasks?|applies?)\b|(?:使用|利用|とき|場合|向け)/iu;
}

export function hasExplicitSkillSelectionBoundary(value: string): boolean {
  return selectionBoundaryPattern().test(value);
}

export function hasExplicitExecutionConstraint(value: string): boolean {
  return executionConstraintPattern().test(value);
}

function selectionBoundaryPattern(): RegExp {
  return /\b(?:do not use(?: this skill| it)? for|do not use this skill|when not to use|not for (?:this|the|these) tasks?|use (?:another|a different|an alternative|the [\w-]+) skill (?:instead )?when|out of scope for this skill)\b|(?:このスキルを使用しない|このスキルを利用しない|このスキルの対象外)/iu;
}

function selectionBoundaryHeadingPattern(): RegExp {
  return /^(?:do not use(?: this skill)?(?: when| for)?|when not to use|not for(?: this skill)?|out of scope(?: for this skill)?)$/iu;
}

function executionConstraintPattern(): RegExp {
  return /\b(?:do not|don't|never|must not|should not)\b|(?:してはいけない|禁止)/iu;
}

function executionConstraintHeadingPattern(): RegExp {
  return /^(?:(?:hard|safety|execution|operational) constraints?|constraints?|prohibited actions?)$/iu;
}

interface AuthoringBodyLine {
  line: number;
  text: string;
  section: string;
}

function authoringBodyLines(document: ParsedDocument): AuthoringBodyLine[] {
  const bodyStart = bodyStartLine(document);
  const fencedLines = new Set<number>();
  for (const fence of document.codeFences) {
    for (let line = fence.startLine; line <= fence.endLine; line += 1) {
      fencedLines.add(line);
    }
  }

  let section = "<body>";
  const result: AuthoringBodyLine[] = [];
  for (let index = bodyStart - 1; index < document.lines.length; index += 1) {
    const line = index + 1;
    if (fencedLines.has(line)) continue;
    const text = document.lines[index] ?? "";
    const heading = text.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      section = heading[2]?.trim() ?? "<body>";
      continue;
    }
    if (text.trim().length > 0) result.push({ line, text, section });
  }
  return result;
}

function bodyStartLine(document: ParsedDocument): number {
  if (document.lines[0]?.trim() !== "---") return 1;
  const end = document.lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return end >= 0 ? end + 2 : 1;
}

function nearbyConstraintText(
  document: ParsedDocument,
  line: number,
  constraintLines: Set<number>,
): string {
  const nearby = [document.lines[line - 1] ?? ""];
  for (const candidateLine of [line - 1, line + 1]) {
    if (candidateLine < 1 || constraintLines.has(candidateLine)) continue;
    const candidate = document.lines[candidateLine - 1]?.trim() ?? "";
    if (candidate.length === 0 || /^#{1,6}\s+/.test(candidate)) continue;
    nearby.push(candidate);
  }
  return nearby.join("\n");
}

function hasAlternativeOrStopBehavior(value: string): boolean {
  return /(?:^|[.;:]\s+|\n\s*(?:[-*+]\s+|\d+[.)]\s+)?|\bthen\s+|\band\s+)(?:(?!(?:do not|don't|never|must not|should not)\b)[^.\n]{0,80}\binstead\b|stop\b|report\b|ask\b|record\b|return\b|leave\b[^.\n]{0,40}\bunchanged\b|produce\b[^.\n]{0,40}\b(?:proposal|patch)\b|require\b[^.\n]{0,40}\bhuman review\b)/iu.test(
    value,
  );
}

function characterLength(value: string): number {
  return [...value].length;
}
