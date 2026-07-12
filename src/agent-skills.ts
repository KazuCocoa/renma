import path from "node:path";

import {
  AGENT_SKILL_DIAGNOSTIC_IDS as IDS,
  type AgentSkillDiagnosticId,
} from "./diagnostic-ids.js";
import { classifyRepositorySkillEntrypointPath } from "./discovery.js";
import type { ParsedDocument } from "./types.js";
import {
  parseAgentSkillFrontmatter,
  type ParsedYamlFrontmatter,
  type YamlFrontmatterField,
} from "./yaml-frontmatter.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";

export const AGENT_SKILLS_SPECIFICATION =
  "https://agentskills.io/specification";
export const AGENT_SKILLS_VALIDATION_PROFILE =
  "agentskills.io/specification@2026-07-12";

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
  "purpose",
  "last_reviewed_at",
  "review_cycle",
  "expires_at",
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
const AGENT_SKILLS_LIMITS = DEFAULT_QUALITY_PROFILE.agentSkills;
const MAX_NAME_LENGTH = AGENT_SKILLS_LIMITS.nameMaxChars;
const MAX_DESCRIPTION_LENGTH = AGENT_SKILLS_LIMITS.descriptionMaxChars;
const MAX_COMPATIBILITY_LENGTH = AGENT_SKILLS_LIMITS.compatibilityMaxChars;

export type AgentSkillFormat =
  | "agent-skills"
  | "renma-legacy"
  | "hybrid"
  | "unknown";

export interface AgentSkillValidationIssue {
  code: AgentSkillDiagnosticId;
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
  migrationCommand?: AgentSkillMigrationCommand;
  legacyFields: string[];
  canonicalRenmaFields: string[];
  errorCount: number;
  warningCount: number;
  issues: AgentSkillValidationIssue[];
}

export interface AgentSkillInspection {
  frontmatter: ParsedYamlFrontmatter;
  validation: AgentSkillValidationResult;
}

export interface AgentSkillMigrationCommand {
  command: "renma";
  args: ["suggest-metadata", string];
  display: string;
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

export interface AgentSkillNameValidation {
  normalized: string | undefined;
  problems: string[];
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
  return validateAgentSkillFrontmatter(document, frontmatter);
}

/** Parse and validate a Skill once for canonical operational consumers. */
export function inspectAgentSkill(
  document: ParsedDocument,
): AgentSkillInspection {
  const frontmatter = parseAgentSkillFrontmatter(document.artifact.content);
  return {
    frontmatter,
    validation: validateAgentSkillFrontmatter(document, frontmatter),
  };
}

/** Resolve the YAML description value used by Skill quality rules. */
export function resolvedAgentSkillDescription(
  document: ParsedDocument,
): string | undefined {
  if (document.artifact.kind !== "skill") return undefined;
  return nonEmptyString(
    parseAgentSkillFrontmatter(document.artifact.content).values.description,
  );
}

function validateAgentSkillFrontmatter(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
): AgentSkillValidationResult {
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
        IDS.AS_NONCANONICAL_FILENAME,
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
        IDS.AS_MISSING_FRONTMATTER,
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
        IDS.AS_UNCLOSED_FRONTMATTER,
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
        IDS.AS_INVALID_YAML,
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
        IDS.AS_FRONTMATTER_NOT_MAPPING,
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
        IDS.AS_DUPLICATE_FIELD,
        `Agent Skills frontmatter field "${duplicate.key}" is declared more than once.`,
      ),
    );
  }
  for (const duplicate of frontmatter.duplicateMetadataKeys) {
    issues.push(
      fieldIssue(
        document,
        duplicate,
        IDS.AS_DUPLICATE_METADATA_KEY,
        `Agent Skills metadata key "${duplicate.key}" is declared more than once.`,
        `metadata.${duplicate.key}`,
      ),
    );
  }
  for (const unexpected of frontmatter.fields.filter(
    (field) => !ALLOWED_TOP_LEVEL_FIELDS.has(field.key),
  )) {
    const legacyField = LEGACY_FIELDS.has(unexpected.key);
    issues.push(
      fieldIssue(
        document,
        unexpected,
        IDS.AS_UNEXPECTED_TOP_LEVEL_FIELD,
        legacyField
          ? `Pre-0.16 top-level Skill field "${unexpected.key}" is not operationally supported in Renma 0.16.0. Migrate the Skill to Agent Skills metadata.renma.* before catalog, ownership, graph, or security consumers trust this metadata.`
          : `Unexpected top-level Agent Skills field "${unexpected.key}". Renma extensions belong under metadata using renma.* string keys.`,
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
  const entrypointPath = classifyRepositorySkillEntrypointPath(
    document.artifact.path,
  );
  const migrationRecommended =
    legacyFields.length > 0 ||
    (entrypointPath !== undefined && entrypointPath.kind !== "canonical");

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
          migrationCommand: migrationCommand(document.artifact.path),
        }
      : {}),
    legacyFields,
    canonicalRenmaFields,
    errorCount,
    warningCount,
    issues,
  };
}

function migrationCommand(skillPath: string): AgentSkillMigrationCommand {
  return {
    command: "renma",
    args: ["suggest-metadata", skillPath],
    display: `renma suggest-metadata ${posixShellArgument(skillPath)}`,
  };
}

function posixShellArgument(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Normalize and validate an Agent Skills YAML name field. */
export function normalizeAgentSkillNameField(
  value: unknown,
): AgentSkillNameValidation {
  return normalizeAndValidateAgentSkillName(value, true);
}

/** Normalize and validate a Skill directory name without changing filesystem identity. */
export function normalizeAgentSkillDirectoryName(
  value: unknown,
): AgentSkillNameValidation {
  return normalizeAndValidateAgentSkillName(value, false);
}

/** Backward-compatible name for validating an Agent Skills YAML name field. */
export function validateAgentSkillName(
  value: unknown,
): AgentSkillNameValidation {
  return normalizeAgentSkillNameField(value);
}

function normalizeAndValidateAgentSkillName(
  value: unknown,
  trim: boolean,
): AgentSkillNameValidation {
  if (typeof value !== "string") {
    return {
      normalized: undefined,
      problems: ["must be a non-empty string"],
    };
  }

  const normalized = (trim ? value.trim() : value).normalize("NFKC");
  const problems: string[] = [];
  const length = characterLength(normalized);
  if (length < 1 || length > MAX_NAME_LENGTH)
    problems.push(`must contain 1-${MAX_NAME_LENGTH} Unicode code points`);
  if (normalized !== normalized.toLowerCase())
    problems.push("must equal its lowercase form after NFKC normalization");
  if (!/^[\p{L}\p{N}-]+$/u.test(normalized))
    problems.push(
      "must contain only Unicode letters, Unicode digits, and hyphens",
    );
  if (normalized.startsWith("-") || normalized.endsWith("-"))
    problems.push("must not start or end with a hyphen");
  if (normalized.includes("--"))
    problems.push("must not contain consecutive hyphens");
  return { normalized, problems };
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
        IDS.AS_MISSING_NAME,
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
        IDS.AS_INVALID_NAME,
        "error",
        "specification",
        "Agent Skills name must be a non-empty string.",
        field?.startLine ?? 1,
        "name",
      ),
    );
    return;
  }

  const nameValidation = normalizeAgentSkillNameField(rawName);
  if (nameValidation.problems.length > 0) {
    issues.push(
      createIssue(
        document,
        IDS.AS_INVALID_NAME,
        "error",
        "specification",
        `Invalid Agent Skills name "${rawName}": ${nameValidation.problems.join("; ")}.`,
        field?.startLine ?? 1,
        "name",
      ),
    );
  }

  const parent = path.posix.basename(
    path.posix.dirname(document.artifact.path),
  );
  const parentValidation = normalizeAgentSkillDirectoryName(parent);
  if (
    nameValidation.normalized !== undefined &&
    parentValidation.normalized !== nameValidation.normalized
  ) {
    issues.push({
      ...createIssue(
        document,
        IDS.AS_NAME_DIRECTORY_MISMATCH,
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
        IDS.AS_MISSING_DESCRIPTION,
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
        IDS.AS_INVALID_DESCRIPTION,
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
        IDS.AS_DESCRIPTION_TOO_LONG,
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
        IDS.AS_INVALID_COMPATIBILITY,
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
        IDS.AS_COMPATIBILITY_TOO_LONG,
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
  const code =
    fieldName === "license"
      ? IDS.AS_INVALID_LICENSE
      : IDS.AS_INVALID_ALLOWED_TOOLS;
  issues.push(
    createIssue(
      document,
      code,
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
        IDS.AS_INVALID_METADATA,
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

  if (!descriptionCapabilityPattern().test(description)) {
    issues.push(
      createIssue(
        document,
        IDS.RN_DESCRIPTION_MISSING_CAPABILITY,
        "warning",
        "renma-authoring",
        "Description should state what the skill does, not only that it should be used.",
        descriptionLine,
        "description",
      ),
    );
  }

  if (!usageBoundaryPattern().test(description)) {
    issues.push(
      createIssue(
        document,
        IDS.RN_DESCRIPTION_MISSING_USAGE_BOUNDARY,
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
        IDS.RN_DESCRIPTION_OMITS_SELECTION_BOUNDARY,
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
        IDS.RN_EXECUTION_CONSTRAINT_NOT_PROMINENT,
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
        IDS.RN_EXECUTION_CONSTRAINT_SCATTERED,
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
        IDS.RN_EXECUTION_CONSTRAINT_MISSING_ALTERNATIVE,
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
  const fenceLines = agentSkillFenceLines(
    document.lines,
    frontmatter.bodyStartLine,
  );
  const headings = document.headings
    .filter(
      (heading) =>
        heading.line >= frontmatter.bodyStartLine &&
        !fenceLines.has(heading.line),
    )
    .sort((left, right) => left.line - right.line);
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

/** Return all Markdown line numbers occupied by backtick or tilde fences. */
export function agentSkillFenceLines(
  lines: string[],
  bodyStartLine: number,
): Set<number> {
  const result = new Set<number>();
  let active: { character: "`" | "~"; length: number } | undefined;

  for (
    let index = Math.max(bodyStartLine - 1, 0);
    index < lines.length;
    index += 1
  ) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";
    if (!active) {
      const opening = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
      if (!opening?.[1]) continue;
      const marker = opening[1];
      active = {
        character: marker[0] as "`" | "~",
        length: marker.length,
      };
      result.add(lineNumber);
      continue;
    }

    result.add(lineNumber);
    const escapedCharacter = active.character === "`" ? "`" : "~";
    const closing = new RegExp(
      `^(?: {0,3})${escapedCharacter}{${active.length},}\\s*$`,
    );
    if (closing.test(line)) active = undefined;
  }

  return result;
}

function hasNearbyAlternative(
  constraint: BodyLine,
  lines: BodyLine[],
): boolean {
  const sameLineAlternative = textAfterProhibition(constraint.text);
  if (
    sameLineAlternative !== undefined &&
    alternativeClausePattern().test(sameLineAlternative)
  ) {
    return true;
  }

  const index = lines.findIndex((line) => line.line === constraint.line);
  return lines.slice(index + 1, index + 3).some((line) => {
    if (line.ancestry.join(" > ") !== constraint.ancestry.join(" > ")) {
      return false;
    }
    if (executionConstraintPattern().test(line.text)) return false;
    return alternativeClausePattern().test(line.text);
  });
}

function textAfterProhibition(text: string): string | undefined {
  const prohibition = executionConstraintPattern().exec(text);
  if (!prohibition) return undefined;
  const remainder = text.slice(prohibition.index + prohibition[0].length);
  const delimiterIndex = remainder.search(/[.;\n]/);
  return delimiterIndex < 0
    ? undefined
    : remainder.slice(delimiterIndex + 1).trim();
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

function firstField(
  frontmatter: ParsedYamlFrontmatter,
  key: string,
): YamlFrontmatterField | undefined {
  return frontmatter.fields.find((field) => field.key === key);
}

function fieldIssue(
  document: ParsedDocument,
  field: YamlFrontmatterField,
  code: AgentSkillDiagnosticId,
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
  code: AgentSkillDiagnosticId,
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

/**
 * Conservative English capability evidence for the Agent Skills "what" clause.
 * Non-ASCII descriptions are accepted because Renma cannot reliably infer
 * capability semantics across languages with a deterministic word list.
 */
function descriptionCapabilityPattern(): RegExp {
  return /[^\p{ASCII}]|\b(?:address(?:es|ing)?|analy[sz](?:e|es|ing)|analysis|automat(?:e|es|ing|ion)|build(?:s|ing)?|calculat(?:e|es|ing|ion)|compar(?:e|es|ing|ison)|configur(?:e|es|ing|ation)|convert(?:s|ing)?|creat(?:e|es|ing|ion)|debug(?:s|ging)?|deploy(?:s|ing|ment)?|design(?:s|ing)?|diagnos(?:e|es|ing|is)|document(?:s|ing|ation)?|edit(?:s|ing)?|evaluat(?:e|es|ing|ion)|extract(?:s|ing|ion)?|find(?:s|ing)?|fix(?:es|ing)?|generat(?:e|es|ing|ion)|guid(?:e|es|ing|ance)|implement(?:s|ing|ation)?|inspect(?:s|ing|ion)?|install(?:s|ing|ation)?|manage(?:s|ment|ing)?|migrat(?:e|es|ing|ion)|monitor(?:s|ing)?|organiz(?:e|es|ing|ation)|plan(?:s|ning)?|prepar(?:e|es|ing|ation)|produc(?:e|es|ing|tion)|publish(?:es|ing)?|read(?:s|ing)?|releas(?:e|es|ing)|render(?:s|ing)?|review(?:s|ing)?|rout(?:e|es|ing)|scaffold(?:s|ing)?|search(?:es|ing)?|summari[sz](?:e|es|ing|ation)|test(?:s|ing)?|transform(?:s|ing|ation)?|triag(?:e|es|ing)|updat(?:e|es|ing)|validat(?:e|es|ing|ion)|verif(?:y|ies|ying|ication)|writ(?:e|es|ing))\b/iu;
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

function alternativeClausePattern(): RegExp {
  return /(?:\binstead\b|\bthen\b|(?:^|[-*+]\s+)stop\b|(?:^|[-*+]\s+)ask\b|\brequest human (?:review|approval)\b|\bescalate\b|\bleave\b.+\bunchanged\b|(?:^|[-*+]\s+)skip\b|\buse\b.+\binstead\b)/i;
}
