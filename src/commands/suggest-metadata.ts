import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_SKILLS_SPECIFICATION,
  validateAgentSkill,
  type AgentSkillFormat,
  type AgentSkillValidationResult,
} from "../agent-skills.js";
import { parseDocument } from "../markdown.js";
import { parseAssetMetadata } from "../metadata.js";
import {
  canonicalRenmaMetadataKey,
  encodeRenmaMetadataList,
  isCanonicalRenmaMetadataKey,
  legacyRenmaMetadataFields,
  metadataValueAsList,
  metadataValueAsText,
  readRenmaMetadataValue,
  RENMA_LIST_METADATA_KEYS,
  RENMA_METADATA_KEYS,
  yamlString,
  type LegacyRenmaMetadataKey,
} from "../renma-metadata.js";
import type { Artifact, ArtifactKind, MetadataValue } from "../types.js";

export type SuggestMetadataFormat = "prompt" | "json";

export interface SuggestMetadataOptions {
  format?: SuggestMetadataFormat;
  owner?: string;
}

export interface BlockedMetadata {
  field: string;
  reason: string;
}

export interface AgentSkillsMigrationSuggestion {
  specification: string;
  direction: "legacy-to-agent-skills" | "none";
  sourceFormat: AgentSkillFormat;
  targetFormat: "agent-skills";
  validation: AgentSkillValidationResult;
  candidateAgentSkillsMetadata: Record<string, string>;
  candidateRenmaMetadata: Record<string, string>;
  canonicalFrontmatter?: string;
  descriptionDraftRequired: boolean;
  authoringRecommendations: string[];
}

export interface MetadataSuggestion {
  path: string;
  kind: ArtifactKind;
  suggestedMode: "metadata-retrofit";
  ownerProvided: boolean;
  instructions: string[];
  candidateMetadata: Record<string, string>;
  blockedMetadata: BlockedMetadata[];
  agentSkills?: AgentSkillsMigrationSuggestion;
}

export class SuggestMetadataTargetError extends Error {
  constructor(target: string, cause: unknown) {
    super(
      `Could not read metadata target ${target}: ${readErrorReason(cause)}`,
    );
    this.name = "SuggestMetadataTargetError";
  }
}

export async function runSuggestMetadataCommand(
  target: string,
  options: SuggestMetadataOptions = {},
): Promise<number> {
  const suggestion = await buildMetadataSuggestion(target, options);
  const format = options.format ?? "prompt";
  process.stdout.write(
    format === "json"
      ? `${JSON.stringify(suggestion, null, 2)}\n`
      : renderMetadataPrompt(suggestion),
  );
  return 0;
}

export async function buildMetadataSuggestion(
  target: string,
  options: SuggestMetadataOptions = {},
): Promise<MetadataSuggestion> {
  const absolutePath = path.resolve(target);
  let content: string;
  try {
    content = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new SuggestMetadataTargetError(target, error);
  }
  const outputPath = toPosix(target);
  const initialKind = classifyPath(outputPath);
  const document = parseDocument({
    path: outputPath,
    absolutePath,
    kind: initialKind,
    sizeBytes: Buffer.byteLength(content),
    content,
  } satisfies Artifact);
  const { metadata } = parseAssetMetadata(document);
  const kind =
    initialKind === "context" && metadata.type === "context_lens"
      ? "context_lens"
      : initialKind;
  const existingId = optionalText(metadataValueText(document.metadata.id));
  const existingTitle = optionalText(
    metadataValueText(document.metadata.title),
  );
  const existingOwner = optionalText(metadata.owner);
  const explicitOwner = optionalText(options.owner);
  const candidateMetadata: Record<string, string> = {};
  const candidateId = inferCandidateId(kind, outputPath);
  const candidateTitle = mainHeadingTitle(document.headings);

  if (!existingId && candidateId) {
    candidateMetadata.id = candidateId;
  }
  if (!existingTitle && candidateTitle) {
    candidateMetadata.title = candidateTitle;
  }
  if (!existingOwner && explicitOwner) {
    candidateMetadata.owner = explicitOwner;
  }

  const blockedMetadata: BlockedMetadata[] = [];
  if (!existingOwner && !explicitOwner) {
    blockedMetadata.push({
      field: "owner",
      reason: "No owner was explicitly provided. Missing owner is allowed.",
    });
  }
  if (existingOwner && explicitOwner && existingOwner !== explicitOwner) {
    blockedMetadata.push({
      field: "owner",
      reason: `Existing owner "${existingOwner}" differs from explicitly provided owner "${explicitOwner}". Do not change ownership without human review.`,
    });
  }

  const agentSkills =
    kind === "skill"
      ? buildAgentSkillsMigrationSuggestion({
          document,
          outputPath,
          ...(candidateId ? { candidateId } : {}),
          ...(candidateTitle ? { candidateTitle } : {}),
          ...(existingOwner ? { existingOwner } : {}),
          ...(explicitOwner ? { explicitOwner } : {}),
          blockedMetadata,
        })
      : undefined;

  return {
    path: outputPath,
    kind,
    suggestedMode: "metadata-retrofit",
    ownerProvided: Boolean(explicitOwner),
    instructions: buildInstructions({
      kind,
      existingOwner,
      explicitOwner,
      agentSkills,
    }),
    candidateMetadata,
    blockedMetadata,
    ...(agentSkills ? { agentSkills } : {}),
  };
}

export function renderMetadataPrompt(suggestion: MetadataSuggestion): string {
  const agentSkills = suggestion.agentSkills;
  const migrationSection = agentSkills
    ? [
        "",
        "Agent Skills Compatibility:",
        `- Specification: ${agentSkills.specification}`,
        `- Source format: ${agentSkills.sourceFormat}`,
        `- Migration direction: ${agentSkills.direction}`,
        `- Specification errors: ${agentSkills.validation.errorCount}`,
        `- Renma authoring warnings: ${agentSkills.validation.warningCount}`,
        "",
        "Candidate Agent Skills Metadata:",
        ...metadataLines(agentSkills.candidateAgentSkillsMetadata),
        "",
        "Candidate Renma Extension Metadata:",
        ...metadataLines(agentSkills.candidateRenmaMetadata),
        "",
        "Canonical Frontmatter:",
        ...(agentSkills.canonicalFrontmatter
          ? ["```yaml", agentSkills.canonicalFrontmatter, "```"]
          : [
              "- (blocked until a reviewed description can be drafted from existing evidence)",
            ]),
        "",
        "Authoring Review:",
        ...agentSkills.authoringRecommendations.map((item) => `- ${item}`),
      ]
    : [];

  return `${[
    "# Codex Task: Safely Retrofit Renma Metadata",
    "",
    "Update this existing Renma asset metadata safely.",
    "",
    "Asset:",
    `- Path: \`${suggestion.path}\``,
    `- Kind: \`${suggestion.kind}\``,
    `- Mode: \`${suggestion.suggestedMode}\``,
    "",
    "Rules:",
    ...suggestion.instructions.map((instruction) => `- ${instruction}`),
    "",
    "Candidate Metadata:",
    ...metadataLines(suggestion.candidateMetadata),
    "",
    "Blocked Metadata:",
    ...blockedMetadataLines(suggestion.blockedMetadata),
    ...migrationSection,
    "",
    "Verification:",
    "- Run `renma scan .`.",
    "- Confirm the Agent Skills validation summary reports this SKILL.md as valid.",
    "- Run `renma ownership .`.",
    "",
    "Return a small reviewed patch. Do not broadly rewrite the asset body.",
  ].join("\n")}\n`;
}

function buildAgentSkillsMigrationSuggestion(input: {
  document: ReturnType<typeof parseDocument>;
  outputPath: string;
  candidateId?: string;
  candidateTitle?: string;
  existingOwner?: string;
  explicitOwner?: string;
  blockedMetadata: BlockedMetadata[];
}): AgentSkillsMigrationSuggestion {
  const validation = validateAgentSkill(input.document);
  const existingName = optionalText(
    metadataValueText(input.document.metadata.name),
  );
  const existingDescription = optionalText(
    metadataValueText(input.document.metadata.description),
  );
  const name = validSkillName(existingName, input.outputPath)
    ? existingName
    : inferSkillName(input.outputPath);
  const extractedDescription =
    existingDescription ?? extractDescriptionCandidate(input.document);
  const candidateAgentSkillsMetadata: Record<string, string> = {};
  if (!existingName || existingName !== name) {
    candidateAgentSkillsMetadata.name = name;
  }
  if (!existingDescription && extractedDescription) {
    candidateAgentSkillsMetadata.description = extractedDescription;
  }

  for (const field of ["license", "compatibility", "allowed-tools"]) {
    const value = optionalText(
      metadataValueText(input.document.metadata[field]),
    );
    if (value) candidateAgentSkillsMetadata[field] = value;
  }

  const candidateRenmaMetadata = collectRenmaMigrationMetadata({
    document: input.document,
    ...(input.candidateId ? { candidateId: input.candidateId } : {}),
    ...(input.candidateTitle ? { candidateTitle: input.candidateTitle } : {}),
    ...(input.existingOwner ? { existingOwner: input.existingOwner } : {}),
    ...(input.explicitOwner ? { explicitOwner: input.explicitOwner } : {}),
  });
  const clientMetadata = collectClientMetadata(input.document);
  const canonicalFrontmatter = extractedDescription
    ? renderCanonicalSkillFrontmatter({
        name,
        description: extractedDescription,
        agentSkillsMetadata: candidateAgentSkillsMetadata,
        clientMetadata,
        renmaMetadata: candidateRenmaMetadata,
      })
    : undefined;

  if (!extractedDescription) {
    input.blockedMetadata.push({
      field: "description",
      reason:
        "No reviewed Agent Skills description can be extracted from the existing body. Draft what the skill does, when to use it, and any selection-critical exclusion from repository evidence; require human review.",
    });
  }

  return {
    specification: AGENT_SKILLS_SPECIFICATION,
    direction:
      validation.format === "agent-skills" && !validation.migrationRecommended
        ? "none"
        : "legacy-to-agent-skills",
    sourceFormat: validation.format,
    targetFormat: "agent-skills",
    validation,
    candidateAgentSkillsMetadata,
    candidateRenmaMetadata,
    ...(canonicalFrontmatter ? { canonicalFrontmatter } : {}),
    descriptionDraftRequired: !extractedDescription,
    authoringRecommendations: authoringRecommendations(validation),
  };
}

function collectRenmaMigrationMetadata(input: {
  document: ReturnType<typeof parseDocument>;
  candidateId?: string;
  candidateTitle?: string;
  existingOwner?: string;
  explicitOwner?: string;
}): Record<string, string> {
  const result: Record<string, string> = {};

  for (const legacyKey of Object.keys(
    RENMA_METADATA_KEYS,
  ) as LegacyRenmaMetadataKey[]) {
    const value = readRenmaMetadataValue(input.document, legacyKey);
    if (value === undefined) continue;
    const canonicalKey = canonicalRenmaMetadataKey(legacyKey).replace(
      /^metadata\./,
      "",
    );
    if (RENMA_LIST_METADATA_KEYS.has(legacyKey)) {
      result[canonicalKey] = encodeRenmaMetadataList(
        metadataValueAsList(value),
      );
    } else {
      const text = metadataValueAsText(value);
      if (text !== undefined) result[canonicalKey] = text;
    }
  }

  if (!result["renma.id"] && input.candidateId) {
    result["renma.id"] = input.candidateId;
  }
  if (!result["renma.title"] && input.candidateTitle) {
    result["renma.title"] = input.candidateTitle;
  }
  if (!result["renma.owner"] && !input.existingOwner && input.explicitOwner) {
    result["renma.owner"] = input.explicitOwner;
  }

  return sortRecord(result);
}

function collectClientMetadata(
  document: ReturnType<typeof parseDocument>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(document.metadata)) {
    if (!key.startsWith("metadata.")) continue;
    if (isCanonicalRenmaMetadataKey(key)) continue;
    const childKey = key.slice("metadata.".length);
    const text = metadataValueAsText(value);
    if (childKey && text !== undefined) result[childKey] = text;
  }
  return sortRecord(result);
}

function renderCanonicalSkillFrontmatter(input: {
  name: string;
  description: string;
  agentSkillsMetadata: Record<string, string>;
  clientMetadata: Record<string, string>;
  renmaMetadata: Record<string, string>;
}): string {
  const lines = [
    "---",
    `name: ${yamlString(input.name)}`,
    `description: ${yamlString(input.description)}`,
  ];
  for (const field of ["license", "compatibility", "allowed-tools"]) {
    const value = input.agentSkillsMetadata[field];
    if (value) lines.push(`${field}: ${yamlString(value)}`);
  }
  const metadata = {
    ...input.clientMetadata,
    ...input.renmaMetadata,
  };
  if (Object.keys(metadata).length > 0) {
    lines.push("metadata:");
    for (const [key, value] of Object.entries(sortRecord(metadata))) {
      lines.push(`  ${key}: ${yamlString(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function authoringRecommendations(
  validation: AgentSkillValidationResult,
): string[] {
  const recommendations = validation.issues
    .filter((issue) => issue.category === "renma-authoring")
    .map((issue) => issue.message);
  if (recommendations.length === 0) {
    return [
      "Preserve the existing usage boundaries and hard constraints while moving only the metadata representation.",
    ];
  }
  return recommendations;
}

function buildInstructions(input: {
  kind: ArtifactKind;
  existingOwner?: string | undefined;
  explicitOwner?: string | undefined;
  agentSkills?: AgentSkillsMigrationSuggestion | undefined;
}): string[] {
  const base = [
    "Inspect the existing asset before editing.",
    "Preserve the existing markdown body content.",
    "Preserve existing frontmatter fields and values unless they are clearly invalid.",
    "Add missing metadata only when it is clearly supported by file content, established Renma path conventions, or user-provided options.",
    "Do not infer or invent owner.",
    "Do not infer owner from Git history, file path, prose, or author.",
    "Missing owner is allowed.",
    "Avoid placeholder metadata.",
    "Keep metadata compact.",
    ownerInstruction(input),
  ];

  if (input.kind === "skill" && input.agentSkills) {
    base.push(
      "Apply migration only from legacy top-level Renma skill metadata to the Agent Skills-compatible form; never migrate a valid Agent Skill back to the legacy form.",
      "Keep only name, description, license, compatibility, metadata, and allowed-tools at the top level of SKILL.md frontmatter.",
      "Move Renma extension values under metadata using renma.* string keys and remove the migrated legacy top-level duplicates after review.",
      "Preserve unrelated client-specific metadata entries.",
      "Treat description as the discovery surface: state what the skill does, when to use it, and any selection-critical exclusion already supported by the body.",
      "A narrowly scoped body organization change is allowed only to group existing negative directives under a prominent Do Not Use or Hard Constraints section; preserve their meaning and state an existing alternative or stop behavior when available.",
      "Do not invent new prohibitions, policies, domain facts, owners, dependencies, or routing promises.",
    );
  }

  base.push("Run renma scan . and renma ownership . after editing.");
  return base;
}

function ownerInstruction(input: {
  existingOwner?: string | undefined;
  explicitOwner?: string | undefined;
}): string {
  if (input.existingOwner) {
    if (input.explicitOwner && input.existingOwner !== input.explicitOwner) {
      return `Existing owner is ${input.existingOwner}. The explicitly provided owner ${input.explicitOwner} differs, so do not change ownership without human review.`;
    }
    return `Preserve existing owner: ${input.existingOwner}.`;
  }
  if (input.explicitOwner) {
    return `Use owner: ${input.explicitOwner} because the user explicitly provided it.`;
  }
  return "Do not add owner unless the existing asset already declares one or a maintainer provides one.";
}

function metadataLines(candidateMetadata: Record<string, string>): string[] {
  const entries = Object.entries(candidateMetadata);
  if (entries.length === 0) {
    return ["- (none)"];
  }
  return entries.map(([field, value]) => `- ${field}: \`${value}\``);
}

function blockedMetadataLines(blockedMetadata: BlockedMetadata[]): string[] {
  if (blockedMetadata.length === 0) {
    return ["- (none)"];
  }
  return blockedMetadata.map((item) => `- ${item.field}: ${item.reason}`);
}

function classifyPath(filePath: string): ArtifactKind {
  const parts = pathParts(filePath);
  const basename = parts.at(-1) ?? "";

  if (basename === "SKILL.md") return "skill";
  if (parts.includes("lenses")) return "context_lens";
  if (parts.includes("contexts") || parts.includes("context")) return "context";
  if (parts.includes("profiles")) return "profile";
  if (parts.includes("references")) return "reference";
  if (parts.includes("examples")) return "example";
  if (basename === "AGENTS.md" || parts.includes(".agents")) return "agent";
  if (basename === "renma.config.json" || basename === ".renma.json") {
    return "config";
  }
  return "unknown";
}

function inferCandidateId(
  kind: ArtifactKind,
  filePath: string,
): string | undefined {
  if (kind === "skill") {
    return inferRootedId("skill", filePath, "skills", (parts) =>
      parts.filter((part) => part !== "SKILL"),
    );
  }
  if (kind === "context") {
    return inferRootedId("context", filePath, "contexts");
  }
  if (kind === "context_lens") {
    return inferRootedId("lens", filePath, "lenses");
  }
  return undefined;
}

function inferRootedId(
  prefix: string,
  filePath: string,
  rootSegment: string,
  transform: (parts: string[]) => string[] = (parts) => parts,
): string | undefined {
  const parts = pathParts(stripExtension(filePath));
  let rootIndex = lastIndexOf(parts, rootSegment);
  if (rootIndex < 0 && rootSegment === "contexts") {
    rootIndex = lastIndexOf(parts, "context");
  }
  if (rootIndex < 0) return undefined;

  const idParts = transform(parts.slice(rootIndex + 1))
    .map(slugify)
    .filter(Boolean);
  if (idParts.length === 0) return undefined;
  if (idParts[0] === prefix) return idParts.join(".");
  return [prefix, ...idParts].join(".");
}

function inferSkillName(filePath: string): string {
  const parts = pathParts(filePath);
  return slugify(parts.at(-2) ?? "skill");
}

function validSkillName(
  value: string | undefined,
  filePath: string,
): value is string {
  if (!value) return false;
  return value === inferSkillName(filePath);
}

function extractDescriptionCandidate(
  document: ReturnType<typeof parseDocument>,
): string | undefined {
  const bodyStart =
    document.lines[0]?.trim() === "---"
      ? document.lines.findIndex(
          (line, index) => index > 0 && line.trim() === "---",
        ) + 1
      : 0;
  const candidates: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) candidates.push(paragraph.join(" ").trim());
    paragraph = [];
  };

  for (const line of document.lines.slice(Math.max(0, bodyStart))) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed) || /^[-*+]\s+/.test(trimmed)) {
      flush();
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();

  const candidate = candidates.find(
    (value) =>
      /\b(?:use this skill|use when|use for|when the request|when reviewing)\b|(?:このスキル|使用|利用|場合|とき)/iu.test(
        value,
      ) && value.length <= 1024,
  );
  return candidate;
}

function mainHeadingTitle(headings: Array<{ depth: number; text: string }>) {
  return headings.find((heading) => heading.depth === 1)?.text.trim();
}

function metadataValueText(
  value: MetadataValue | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stripExtension(value: string): string {
  return value.replace(/\.[^/.]+$/, "");
}

function pathParts(value: string): string[] {
  return toPosix(value).split("/").filter(Boolean);
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function lastIndexOf(values: string[], target: string): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] === target) return index;
  }
  return -1;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function readErrorReason(error: unknown): string {
  const code = errorCode(error);
  if (code === "ENOENT") return "file does not exist";
  if (code === "EISDIR") return "target is a directory";
  if (code === "EACCES" || code === "EPERM") return "permission denied";
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
