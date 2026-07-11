import path from "node:path";

import {
  canonicalRenmaMetadataFields,
  inspectLegacyRenmaSkillMetadata,
} from "./renma-metadata.js";
import type { ParsedDocument } from "./types.js";
import {
  parseYamlFrontmatter,
  type ParsedYamlFrontmatter,
} from "./yaml-frontmatter.js";

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
  migrationDirection?: "legacy-to-agent-skills";
  migrationCommand?: string;
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
  const frontmatter = parseYamlFrontmatter(document.artifact.content);
  const issues: AgentSkillValidationIssue[] = [];
  const legacyFields = inspectLegacyRenmaSkillMetadata(frontmatter).fields;
  const canonicalFields = canonicalRenmaMetadataFields(frontmatter);
  const name = metadataText(frontmatter.values.name);
  const description = metadataText(frontmatter.values.description);
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

  if (!frontmatter.present) {
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
  } else if (!frontmatter.closed) {
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

  for (const yamlError of frontmatter.errors) {
    issues.push({
      ...issue(
        document,
        "AS-SKILL-INVALID-YAML",
        "error",
        "specification",
        `Invalid Agent Skills YAML frontmatter: ${yamlError.message}`,
        yamlError.line,
      ),
      details: { yamlCode: yamlError.code },
    });
  }

  if (
    frontmatter.present &&
    frontmatter.closed &&
    frontmatter.errors.length === 0 &&
    !frontmatter.mapping
  ) {
    issues.push(
      issue(
        document,
        "AS-SKILL-FRONTMATTER-NOT-MAPPING",
        "error",
        "specification",
        "Agent Skills frontmatter must parse to a YAML mapping.",
        2,
      ),
    );
  }

  const unexpectedFields = [
    ...new Set(
      frontmatter.fields
        .map((field) => field.key)
        .filter((field) => !ALLOWED_TOP_LEVEL_FIELDS.has(field)),
    ),
  ];
  if (unexpectedFields.length > 0) {
    const first = frontmatter.fields.find((field) =>
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

  for (const duplicate of frontmatter.duplicateFields) {
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

  for (const duplicate of frontmatter.duplicateMetadataKeys) {
    issues.push(
      issue(
        document,
        "AS-SKILL-DUPLICATE-METADATA-KEY",
        "error",
        "specification",
        `Agent Skills metadata key "${duplicate.key}" is declared more than once.`,
        duplicate.startLine,
        `metadata.${duplicate.key}`,
      ),
    );
  }

  if (!validMetadataMapping(frontmatter.values.metadata)) {
    const metadata = frontmatter.fields.find(
      (field) => field.key === "metadata",
    );
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

  validateName(document, frontmatter.values.name, name, frontmatter, issues);
  validateDescription(
    document,
    frontmatter.values.description,
    description,
    frontmatter,
    issues,
  );
  validateOptionalTextField(
    document,
    "compatibility",
    frontmatter.values.compatibility,
    MAX_COMPATIBILITY_LENGTH,
    frontmatter,
    issues,
  );
  validateStringField(
    document,
    "license",
    frontmatter.values.license,
    frontmatter,
    issues,
  );
  validateStringField(
    document,
    "allowed-tools",
    frontmatter.values["allowed-tools"],
    frontmatter,
    issues,
  );

  issues.push(...authoringIssues(document, description));
  issues.sort((a, b) => {
    const byLine = a.startLine - b.startLine;
    if (byLine !== 0) return byLine;
    return a.code.localeCompare(b.code);
  });

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const migrationRecommended = legacyFields.length > 0;
  return {
    path: document.artifact.path,
    format,
    valid: errorCount === 0,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    migrationRecommended,
    ...(migrationRecommended
      ? {
          migrationDirection: "legacy-to-agent-skills" as const,
          migrationCommand: `renma suggest-metadata ${document.artifact.path}`,
        }
      : {}),
    legacyFields,
    canonicalRenmaFields: canonicalFields,
    errorCount,
    warningCount,
    issues,
  };
}

function validateName(
  document: ParsedDocument,
  rawName: unknown,
  name: string | undefined,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
): void {
  const line = frontmatterFieldLine(frontmatter, "name");
  if (rawName === undefined || (typeof rawName === "string" && !name)) {
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

  if (typeof rawName !== "string") {
    issues.push(
      issue(
        document,
        "AS-SKILL-INVALID-NAME",
        "error",
        "specification",
        "Agent Skills name must be a non-empty string.",
        line,
        "name",
      ),
    );
    return;
  }

  const normalized = rawName.normalize("NFKC");
  const reasons = agentSkillNameValidationReasons(rawName);
  if (reasons.length > 0) {
    issues.push(
      issue(
        document,
        "AS-SKILL-INVALID-NAME",
        "error",
        "specification",
        `Invalid Agent Skills name "${rawName}": ${reasons.join("; ")}.`,
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
  rawDescription: unknown,
  description: string | undefined,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
): void {
  const line = frontmatterFieldLine(frontmatter, "description");
  if (
    rawDescription === undefined ||
    (typeof rawDescription === "string" && !description)
  ) {
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

  if (typeof rawDescription !== "string") {
    issues.push(
      issue(
        document,
        "AS-SKILL-INVALID-DESCRIPTION",
        "error",
        "specification",
        "Agent Skills description must be a non-empty string.",
        line,
        "description",
      ),
    );
    return;
  }

  if (characterLength(rawDescription) > MAX_DESCRIPTION_LENGTH) {
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

  if (!usageLanguagePattern().test(rawDescription)) {
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
  value: unknown,
  maxLength: number,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(
      issue(
        document,
        `AS-SKILL-INVALID-${field.toUpperCase()}`,
        "error",
        "specification",
        `Agent Skills ${field} must be a non-empty string when provided.`,
        frontmatterFieldLine(frontmatter, field),
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
        frontmatterFieldLine(frontmatter, field),
        field,
      ),
    );
  }
}

function validateStringField(
  document: ParsedDocument,
  field: string,
  value: unknown,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
): void {
  if (value === undefined || typeof value === "string") return;
  issues.push(
    issue(
      document,
      `AS-SKILL-INVALID-${field.toUpperCase()}`,
      "error",
      "specification",
      `Agent Skills ${field} must be a string when provided.`,
      frontmatterFieldLine(frontmatter, field),
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
  const nonProminentConstraints = executionConstraints.filter(
    (constraint) => prominentConstraintSection(constraint) === undefined,
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

  if (nonProminentConstraints.length > 0) {
    issues.push(
      issue(
        document,
        "RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT",
        "warning",
        "renma-authoring",
        "Execution prohibitions are present but no prominent Hard Constraints, Prohibited Actions, Safety Constraints, or equivalent constraint section exists. Group the existing constraints without changing their meaning.",
        nonProminentConstraints[0]?.line ?? 1,
      ),
    );
  }

  const executionSections = new Set(
    executionConstraints.map(
      (constraint) =>
        prominentConstraintSection(constraint) ?? constraint.section,
    ),
  );
  if (executionConstraints.length > 1 && executionSections.size > 1) {
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

function metadataText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validMetadataMapping(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
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

function frontmatterFieldLine(
  frontmatter: ParsedYamlFrontmatter,
  field: string,
): number {
  return (
    frontmatter.fields.find((candidate) => candidate.key === field)
      ?.startLine ?? 1
  );
}

export function agentSkillNameValidationReasons(value: string): string[] {
  const normalized = value.normalize("NFKC");
  const reasons: string[] = [];
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
    normalized.length === 0 ||
    ![...normalized].every(
      (character) => character === "-" || /[\p{L}\p{N}]/u.test(character),
    )
  ) {
    reasons.push("may contain only lowercase letters, numbers, and hyphens");
  }
  return reasons;
}

export interface AgentSkillDirectoryName {
  parentDirectory: string;
  name: string;
  reasons: string[];
}

export function agentSkillDirectoryName(
  filePath: string,
): AgentSkillDirectoryName {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const parentDirectory = path.posix.basename(
    path.posix.dirname(normalizedPath),
  );
  const name = parentDirectory.normalize("NFKC");
  return {
    parentDirectory,
    name,
    reasons: agentSkillNameValidationReasons(name),
  };
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
  ancestors: string[];
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
  const headingStack: Array<{ depth: number; text: string }> = [];
  const result: AuthoringBodyLine[] = [];
  for (let index = bodyStart - 1; index < document.lines.length; index += 1) {
    const line = index + 1;
    if (fencedLines.has(line)) continue;
    const text = document.lines[index] ?? "";
    const heading = text.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const depth = heading[1]?.length ?? 1;
      section = heading[2]?.trim() ?? "<body>";
      while ((headingStack.at(-1)?.depth ?? 0) >= depth) headingStack.pop();
      headingStack.push({ depth, text: section });
      continue;
    }
    if (text.trim().length > 0) {
      result.push({
        line,
        text,
        section,
        ancestors: headingStack.slice(0, -1).map((heading) => heading.text),
      });
    }
  }
  return result;
}

function prominentConstraintSection(
  line: AuthoringBodyLine,
): string | undefined {
  return [line.section, ...line.ancestors]
    .reverse()
    .find((heading) => executionConstraintHeadingPattern().test(heading));
}

function bodyStartLine(document: ParsedDocument): number {
  if (document.lines[0]?.trim() !== "---") return 1;
  const end = document.lines.findIndex(
    (line, index) => index > 0 && /^---\s*$/.test(line),
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
