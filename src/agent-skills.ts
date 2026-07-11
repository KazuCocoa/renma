import path from "node:path";

import type { ParsedDocument } from "./types.js";
import {
  parseAgentSkillFrontmatter,
  type ParsedYamlFrontmatter,
  type YamlFrontmatterField,
} from "./yaml-frontmatter.js";

export const AGENT_SKILLS_SPECIFICATION =
  "https://agentskills.io/specification";
export const AGENT_SKILLS_VALIDATION_PROFILE =
  "agentskills.io/specification@2026-07-11";

export const AGENT_SKILLS_TOP_LEVEL_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
] as const;

export const LEGACY_RENMA_SKILL_FIELDS = [
  "id",
  "title",
  "version",
  "owner",
  "status",
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
  "network_allowed",
  "external_upload_allowed",
  "secrets_allowed",
  "requires_human_approval",
  "forbidden_inputs",
  "approved_network_destinations",
  "approved_upload_destinations",
  "security_profile",
] as const;

const ALLOWED_TOP_LEVEL_FIELDS = new Set<string>(AGENT_SKILLS_TOP_LEVEL_FIELDS);
const LEGACY_FIELDS = new Set<string>(LEGACY_RENMA_SKILL_FIELDS);
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
  canonicalSkillCount: number;
  legacySkillCount: number;
  hybridSkillCount: number;
  warningCount: number;
  results: AgentSkillValidationResult[];
}

/** Validate every discovered Skill using one locally versioned Agent Skills profile. */
export function validateAgentSkills(
  documents: ParsedDocument[],
): AgentSkillsValidationSummary {
  const results = documents
    .filter((document) => document.artifact.kind === "skill")
    .map(validateAgentSkill)
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    specification: AGENT_SKILLS_SPECIFICATION,
    profile: AGENT_SKILLS_VALIDATION_PROFILE,
    totalSkillCount: results.length,
    validSkillCount: results.filter((result) => result.valid).length,
    invalidSkillCount: results.filter((result) => !result.valid).length,
    canonicalSkillCount: results.filter(
      (result) => result.format === "agent-skills",
    ).length,
    legacySkillCount: results.filter(
      (result) => result.format === "renma-legacy",
    ).length,
    hybridSkillCount: results.filter((result) => result.format === "hybrid")
      .length,
    warningCount: results.reduce(
      (count, result) => count + result.warningCount,
      0,
    ),
    results,
  };
}

/** Validate one discovered Skill without changing any operational metadata reader. */
export function validateAgentSkill(
  document: ParsedDocument,
): AgentSkillValidationResult {
  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  const issues: AgentSkillValidationIssue[] = [];
  const name = nonEmptyString(frontmatter.values.name);
  const description = nonEmptyString(frontmatter.values.description);
  const legacyFields = uniqueSorted(
    frontmatter.fields
      .map((field) => field.key)
      .filter((field) => LEGACY_FIELDS.has(field)),
  );
  const canonicalRenmaFields = uniqueSorted(
    frontmatter.metadataFields
      .map((field) => field.key)
      .filter((field) => field.startsWith("renma.")),
  );
  const hasAgentSkillsIdentity = Boolean(name && description);
  const format = classifyAgentSkillFormat(
    hasAgentSkillsIdentity,
    legacyFields.length > 0,
  );

  if (path.posix.basename(document.artifact.path) !== "SKILL.md") {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-NONCANONICAL-FILENAME",
        "error",
        "specification",
        "Agent Skills requires the skill entrypoint filename to be exactly SKILL.md.",
        1,
      ),
    );
  }

  if (!frontmatter.present) {
    issues.push(
      createIssue(
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
      createIssue(
        document,
        "AS-SKILL-UNCLOSED-FRONTMATTER",
        "error",
        "specification",
        "SKILL.md frontmatter must be closed with --- before the Markdown body.",
        1,
      ),
    );
  }

  for (const error of frontmatter.errors) {
    issues.push({
      ...createIssue(
        document,
        "AS-SKILL-INVALID-YAML",
        "error",
        "specification",
        `Invalid Agent Skills YAML frontmatter: ${error.message}`,
        error.line,
      ),
      details: { yamlCode: error.code },
    });
  }

  if (
    frontmatter.present &&
    frontmatter.closed &&
    frontmatter.errors.length === 0 &&
    !frontmatter.mapping
  ) {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-FRONTMATTER-NOT-MAPPING",
        "error",
        "specification",
        "Agent Skills frontmatter must parse to a YAML mapping.",
        2,
      ),
    );
  }

  for (const duplicate of frontmatter.duplicateFields) {
    issues.push(
      fieldIssue(
        document,
        duplicate,
        "AS-SKILL-DUPLICATE-FIELD",
        `Agent Skills frontmatter field "${duplicate.key}" is declared more than once.`,
      ),
    );
  }
  for (const duplicate of frontmatter.duplicateMetadataKeys) {
    issues.push(
      fieldIssue(
        document,
        duplicate,
        "AS-SKILL-DUPLICATE-METADATA-KEY",
        `Agent Skills metadata key "${duplicate.key}" is declared more than once.`,
        `metadata.${duplicate.key}`,
      ),
    );
  }
  for (const unexpected of frontmatter.fields.filter(
    (field) => !ALLOWED_TOP_LEVEL_FIELDS.has(field.key),
  )) {
    issues.push(
      fieldIssue(
        document,
        unexpected,
        "AS-SKILL-UNEXPECTED-TOP-LEVEL-FIELD",
        `Unexpected top-level Agent Skills field "${unexpected.key}". Renma extensions belong under metadata using renma.* string keys.`,
      ),
    );
  }

  validateName(document, frontmatter, issues);
  validateDescription(document, frontmatter, issues);
  validateOptionalFields(document, frontmatter, issues);
  validateMetadata(document, frontmatter, issues);
  issues.push(...authoringIssues(document, frontmatter, description));

  issues.sort((left, right) => {
    const lineOrder = left.startLine - right.startLine;
    return lineOrder || left.code.localeCompare(right.code);
  });
  const errorCount = issues.filter(
    (issue) => issue.severity === "error",
  ).length;
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
    canonicalRenmaFields,
    errorCount,
    warningCount,
    issues,
  };
}

export function isValidAgentSkillName(value: string): boolean {
  return agentSkillNameProblems(value).length === 0;
}

export function legacyRenmaMetadataKey(field: string): string | undefined {
  return LEGACY_FIELDS.has(field)
    ? `renma.${field.replaceAll("_", "-")}`
    : undefined;
}

function validateName(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
): void {
  const rawName = frontmatter.values.name;
  const field = firstField(frontmatter, "name");
  if (
    rawName === undefined ||
    (typeof rawName === "string" && !rawName.trim())
  ) {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-MISSING-NAME",
        "error",
        "specification",
        "Agent Skills requires a non-empty string name.",
        field?.startLine ?? 1,
        "name",
      ),
    );
    return;
  }
  if (typeof rawName !== "string") {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-INVALID-NAME",
        "error",
        "specification",
        "Agent Skills name must be a non-empty string.",
        field?.startLine ?? 1,
        "name",
      ),
    );
    return;
  }

  const problems = agentSkillNameProblems(rawName);
  if (problems.length > 0) {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-INVALID-NAME",
        "error",
        "specification",
        `Invalid Agent Skills name "${rawName}": ${problems.join("; ")}.`,
        field?.startLine ?? 1,
        "name",
      ),
    );
  }

  const parent = path.posix.basename(
    path.posix.dirname(document.artifact.path),
  );
  if (rawName !== parent) {
    issues.push({
      ...createIssue(
        document,
        "AS-SKILL-NAME-DIRECTORY-MISMATCH",
        "error",
        "specification",
        `Agent Skills name "${rawName}" must match parent directory "${parent}".`,
        field?.startLine ?? 1,
        "name",
      ),
      details: { name: rawName, parentDirectory: parent },
    });
  }
}

function validateDescription(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
): void {
  const raw = frontmatter.values.description;
  const field = firstField(frontmatter, "description");
  if (raw === undefined || (typeof raw === "string" && !raw.trim())) {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-MISSING-DESCRIPTION",
        "error",
        "specification",
        "Agent Skills requires a non-empty description describing what the skill does and when to use it.",
        field?.startLine ?? 1,
        "description",
      ),
    );
    return;
  }
  if (typeof raw !== "string") {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-INVALID-DESCRIPTION",
        "error",
        "specification",
        "Agent Skills description must be a non-empty string.",
        field?.startLine ?? 1,
        "description",
      ),
    );
    return;
  }
  if (characterLength(raw) > MAX_DESCRIPTION_LENGTH) {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-DESCRIPTION-TOO-LONG",
        "error",
        "specification",
        `Agent Skills description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`,
        field?.startLine ?? 1,
        "description",
      ),
    );
  }
}

function validateOptionalFields(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
): void {
  validateOptionalString(document, frontmatter, issues, "license");
  validateOptionalString(document, frontmatter, issues, "allowed-tools");

  const compatibility = frontmatter.values.compatibility;
  if (compatibility === undefined) return;
  const field = firstField(frontmatter, "compatibility");
  if (typeof compatibility !== "string" || !compatibility.trim()) {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-INVALID-COMPATIBILITY",
        "error",
        "specification",
        "Agent Skills compatibility must be a non-empty string when provided.",
        field?.startLine ?? 1,
        "compatibility",
      ),
    );
  } else if (characterLength(compatibility) > MAX_COMPATIBILITY_LENGTH) {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-COMPATIBILITY-TOO-LONG",
        "error",
        "specification",
        `Agent Skills compatibility exceeds ${MAX_COMPATIBILITY_LENGTH} characters.`,
        field?.startLine ?? 1,
        "compatibility",
      ),
    );
  }
}

function validateOptionalString(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
  fieldName: "license" | "allowed-tools",
): void {
  const value = frontmatter.values[fieldName];
  if (value === undefined || typeof value === "string") return;
  const codeField = fieldName.toUpperCase();
  issues.push(
    createIssue(
      document,
      `AS-SKILL-INVALID-${codeField}`,
      "error",
      "specification",
      `Agent Skills ${fieldName} must be a string when provided.`,
      firstField(frontmatter, fieldName)?.startLine ?? 1,
      fieldName,
    ),
  );
}

function validateMetadata(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
  issues: AgentSkillValidationIssue[],
): void {
  const metadata = frontmatter.values.metadata;
  if (metadata === undefined) return;
  if (
    !isRecord(metadata) ||
    Object.entries(metadata).some(
      ([key, value]) => typeof key !== "string" || typeof value !== "string",
    )
  ) {
    issues.push(
      createIssue(
        document,
        "AS-SKILL-INVALID-METADATA",
        "error",
        "specification",
        "Agent Skills metadata must be a mapping from string keys to string values.",
        firstField(frontmatter, "metadata")?.startLine ?? 1,
        "metadata",
      ),
    );
  }
}

interface BodyLine {
  line: number;
  text: string;
  ancestry: string[];
}

function authoringIssues(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
  description: string | undefined,
): AgentSkillValidationIssue[] {
  if (!description) return [];
  const issues: AgentSkillValidationIssue[] = [];
  const bodyLines = collectBodyLines(document, frontmatter);
  const descriptionLine =
    firstField(frontmatter, "description")?.startLine ?? 1;

  if (!usageBoundaryPattern().test(description)) {
    issues.push(
      createIssue(
        document,
        "RN-SKILL-DESCRIPTION-MISSING-USAGE-BOUNDARY",
        "warning",
        "renma-authoring",
        "Description should state when the agent should use this skill.",
        descriptionLine,
        "description",
      ),
    );
  }

  const bodySelectionBoundary = bodyLines.find(
    (line) =>
      explicitSelectionBoundaryPattern().test(line.text) ||
      line.ancestry.some((heading) => selectionHeadingPattern().test(heading)),
  );
  if (
    bodySelectionBoundary &&
    !descriptionSelectionBoundaryPattern().test(description)
  ) {
    issues.push(
      createIssue(
        document,
        "RN-SKILL-DESCRIPTION-OMITS-SELECTION-BOUNDARY",
        "warning",
        "renma-authoring",
        "The body declares a skill-selection exclusion that is absent from the Agent Skills description.",
        bodySelectionBoundary.line,
        "description",
      ),
    );
  }

  const constraints = bodyLines.filter(
    (line) =>
      executionConstraintPattern().test(line.text) &&
      !explicitSelectionBoundaryPattern().test(line.text) &&
      !line.ancestry.some((heading) => selectionHeadingPattern().test(heading)),
  );
  const buried = constraints.filter(
    (line) =>
      !line.ancestry.some((heading) =>
        prominentConstraintHeading().test(heading),
      ),
  );
  for (const constraint of buried) {
    issues.push(
      createIssue(
        document,
        "RN-SKILL-EXECUTION-CONSTRAINT-NOT-PROMINENT",
        "warning",
        "renma-authoring",
        "Execution constraints should appear under a prominent Hard Constraints, Prohibited Actions, Safety Constraints, or equivalent heading.",
        constraint.line,
      ),
    );
  }

  const sections = new Set(
    constraints.map((line) => line.ancestry.join(" > ")),
  );
  if (constraints.length > 1 && sections.size > 1 && buried.length > 0) {
    issues.push(
      createIssue(
        document,
        "RN-SKILL-EXECUTION-CONSTRAINT-SCATTERED",
        "warning",
        "renma-authoring",
        "Execution constraints are scattered across sections; centralize them without changing their meaning.",
        constraints[0]?.line ?? 1,
      ),
    );
  }

  for (const constraint of constraints) {
    if (hasNearbyAlternative(constraint, bodyLines)) continue;
    issues.push(
      createIssue(
        document,
        "RN-SKILL-EXECUTION-CONSTRAINT-MISSING-ALTERNATIVE",
        "warning",
        "renma-authoring",
        "Execution constraint has no nearby supported alternative or stop behavior. Request human clarification; do not invent one.",
        constraint.line,
      ),
    );
  }

  return issues;
}

function collectBodyLines(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
): BodyLine[] {
  const headings = document.headings
    .filter((heading) => heading.line >= frontmatter.bodyStartLine)
    .sort((left, right) => left.line - right.line);
  const fenceLines = new Set<number>();
  for (const fence of document.codeFences) {
    for (let line = fence.startLine; line <= fence.endLine; line += 1) {
      fenceLines.add(line);
    }
  }
  const ancestry: Array<{ depth: number; text: string }> = [];
  const result: BodyLine[] = [];
  let headingIndex = 0;

  for (
    let lineNumber = frontmatter.bodyStartLine;
    lineNumber <= document.lines.length;
    lineNumber += 1
  ) {
    while (headings[headingIndex]?.line === lineNumber) {
      const heading = headings[headingIndex];
      if (!heading) break;
      while (ancestry.at(-1) && ancestry.at(-1)!.depth >= heading.depth) {
        ancestry.pop();
      }
      ancestry.push({ depth: heading.depth, text: heading.text });
      headingIndex += 1;
    }
    const text = document.lines[lineNumber - 1]?.trim() ?? "";
    if (!text || text.startsWith("#") || fenceLines.has(lineNumber)) continue;
    result.push({
      line: lineNumber,
      text,
      ancestry: ancestry.map((heading) => heading.text),
    });
  }
  return result;
}

function hasNearbyAlternative(
  constraint: BodyLine,
  lines: BodyLine[],
): boolean {
  const index = lines.findIndex((line) => line.line === constraint.line);
  const nearby = lines
    .slice(Math.max(0, index - 1), index + 3)
    .filter(
      (line) =>
        line.line === constraint.line ||
        line.ancestry.join(" > ") === constraint.ancestry.join(" > "),
    )
    .map((line) => line.text)
    .join(" ");
  return alternativePattern().test(nearby);
}

function classifyAgentSkillFormat(
  hasAgentSkillsIdentity: boolean,
  hasLegacyFields: boolean,
): AgentSkillFormat {
  if (hasAgentSkillsIdentity && hasLegacyFields) return "hybrid";
  if (hasAgentSkillsIdentity) return "agent-skills";
  if (hasLegacyFields) return "renma-legacy";
  return "unknown";
}

function agentSkillNameProblems(value: string): string[] {
  const problems: string[] = [];
  const length = characterLength(value);
  if (length < 1 || length > MAX_NAME_LENGTH)
    problems.push(`must contain 1-${MAX_NAME_LENGTH} characters`);
  if (!/^[a-z0-9-]+$/.test(value))
    problems.push(
      "must contain only lowercase ASCII letters, numbers, and hyphens",
    );
  if (value.startsWith("-") || value.endsWith("-"))
    problems.push("must not start or end with a hyphen");
  if (value.includes("--"))
    problems.push("must not contain consecutive hyphens");
  return problems;
}

function firstField(
  frontmatter: ParsedYamlFrontmatter,
  key: string,
): YamlFrontmatterField | undefined {
  return frontmatter.fields.find((field) => field.key === key);
}

function fieldIssue(
  document: ParsedDocument,
  field: YamlFrontmatterField,
  code: string,
  message: string,
  fieldName = field.key,
): AgentSkillValidationIssue {
  return createIssue(
    document,
    code,
    "error",
    "specification",
    message,
    field.startLine,
    fieldName,
    field.endLine,
  );
}

function createIssue(
  document: ParsedDocument,
  code: string,
  severity: "error" | "warning",
  category: "specification" | "renma-authoring",
  message: string,
  startLine: number,
  field?: string,
  endLine = startLine,
): AgentSkillValidationIssue {
  return {
    code,
    severity,
    category,
    path: document.artifact.path,
    startLine,
    endLine,
    message,
    ...(field ? { field } : {}),
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function usageBoundaryPattern(): RegExp {
  return /\b(?:use(?: this skill)? (?:when|for|to)|when (?:a|an|the|you|reviewing|working|handling))\b/i;
}

function explicitSelectionBoundaryPattern(): RegExp {
  return /\b(?:do not use (?:this|the) skill|do not select (?:this|the) skill|use another skill|when not to use (?:this|the) skill)\b/i;
}

function descriptionSelectionBoundaryPattern(): RegExp {
  return /\b(?:do not use|not for|when not to use|use another skill)\b/i;
}

function selectionHeadingPattern(): RegExp {
  return /^(?:do not use(?: this skill)?(?: for| when)?|when not to use(?: this skill)?|selection boundaries?)$/i;
}

function executionConstraintPattern(): RegExp {
  return /\b(?:do not|never|must not|may not|prohibited)\b/i;
}

function prominentConstraintHeading(): RegExp {
  return /^(?:hard |safety |execution )?constraints?$|^prohibited actions?$/i;
}

function alternativePattern(): RegExp {
  return /\b(?:instead|stop|report|ask|request human|use .+ instead|produce|return|keep|leave unchanged|skip|require human|escalate)\b/i;
}
