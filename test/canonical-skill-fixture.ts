import path from "node:path";

import { parse, stringify } from "yaml";

import {
  LEGACY_RENMA_SKILL_FIELDS,
  legacyRenmaMetadataKey,
} from "../src/agent-skills.js";

const LIST_FIELDS = new Set([
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

const BOOLEAN_FIELDS = new Set([
  "network_allowed",
  "external_upload_allowed",
  "secrets_allowed",
  "requires_human_approval",
]);

/** Convert a legacy test fixture into the released canonical Skill shape. */
export function canonicalSkillFixture(
  skillPath: string,
  content: string,
): string {
  const lines = content.split(/\r?\n/);
  const closing =
    lines[0] === "---"
      ? lines.findIndex((line, index) => index > 0 && line === "---")
      : -1;
  if (closing < 0) return content;

  const parsed = parse(lines.slice(1, closing).join("\n")) as unknown;
  const source = isRecord(parsed) ? parsed : {};
  const existingMetadata = isRecord(source.metadata) ? source.metadata : {};
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(existingMetadata)) {
    if (typeof value === "string") metadata[key] = value;
  }

  for (const field of LEGACY_RENMA_SKILL_FIELDS) {
    if (!(field in source)) continue;
    const key = legacyRenmaMetadataKey(field);
    if (!key) continue;
    const value = canonicalValue(field, source[field]);
    if (value !== undefined) metadata[key] = value;
  }

  const normalizedPath = skillPath.replaceAll("\\", "/");
  const name = path.posix.basename(path.posix.dirname(normalizedPath));
  const frontmatter: Record<string, unknown> = {
    name,
    description:
      typeof source.description === "string" && source.description.trim()
        ? source.description
        : `Use this skill for deterministic ${name} fixture checks. Use when repository behavior needs review.`,
  };
  for (const field of ["license", "compatibility", "allowed-tools"] as const) {
    if (typeof source[field] === "string") frontmatter[field] = source[field];
  }
  if (Object.keys(metadata).length > 0) frontmatter.metadata = metadata;

  const body = lines.slice(closing + 1).join("\n");
  return `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}

function canonicalValue(field: string, value: unknown): string | undefined {
  if (BOOLEAN_FIELDS.has(field)) {
    if (typeof value === "boolean") return String(value);
    return value === "true" || value === "false" ? value : undefined;
  }
  if (LIST_FIELDS.has(field)) {
    const values = legacyList(value);
    return values === undefined ? undefined : JSON.stringify(values);
  }
  return typeof value === "string" && value.trim() ? value : undefined;
}

function legacyList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string") ? value : undefined;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
