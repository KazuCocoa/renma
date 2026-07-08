import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "../markdown.js";
import { parseAssetMetadata } from "../metadata.js";
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

export interface MetadataSuggestion {
  path: string;
  kind: ArtifactKind;
  suggestedMode: "metadata-retrofit";
  ownerProvided: boolean;
  instructions: string[];
  candidateMetadata: Record<string, string>;
  blockedMetadata: BlockedMetadata[];
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

  return {
    path: outputPath,
    kind,
    suggestedMode: "metadata-retrofit",
    ownerProvided: Boolean(explicitOwner),
    instructions: buildInstructions({ existingOwner, explicitOwner }),
    candidateMetadata,
    blockedMetadata,
  };
}

export function renderMetadataPrompt(suggestion: MetadataSuggestion): string {
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
    "",
    "Verification:",
    "- Run `renma scan .`.",
    "- Run `renma ownership .`.",
    "",
    "Return a small reviewed patch. Do not rewrite the asset body.",
  ].join("\n")}\n`;
}

function buildInstructions(input: {
  existingOwner?: string | undefined;
  explicitOwner?: string | undefined;
}): string[] {
  return [
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
    "Run renma scan . and renma ownership . after editing.",
  ];
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
