import path from "node:path";

import {
  RENMA_LIST_METADATA_KEYS,
  RENMA_METADATA_KEYS,
  yamlString,
  type LegacyRenmaMetadataKey,
} from "../src/renma-metadata.js";

/** Convert simple historical test fixtures into canonical operational Skills. */
export function canonicalSkillFixture(
  filePath: string,
  content: string,
): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return content;
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (end < 0) return content;
  const topLevelKeys = lines
    .slice(1, end)
    .flatMap((line) => line.match(/^([A-Za-z0-9_-]+):/)?.[1] ?? []);
  const alreadyCanonical =
    topLevelKeys.includes("name") &&
    topLevelKeys.includes("description") &&
    topLevelKeys.includes("metadata") &&
    !topLevelKeys.some((key) => Object.hasOwn(RENMA_METADATA_KEYS, key));
  if (alreadyCanonical) return content;

  const standard = new Map<string, string>();
  const extensions = new Map<string, string>();
  for (let index = 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1] ?? "";
    const rawValue = match[2]?.trim() ?? "";

    if (key === "metadata") {
      for (index += 1; index < end; index += 1) {
        const child = lines[index]?.match(/^\s{2,}([^:]+):\s*(.*)$/);
        if (!child) {
          index -= 1;
          break;
        }
        extensions.set(child[1]?.trim() ?? "", scalarText(child[2] ?? ""));
      }
      continue;
    }

    if (
      key === "name" ||
      key === "description" ||
      key === "license" ||
      key === "compatibility" ||
      key === "allowed-tools"
    ) {
      standard.set(key, scalarText(rawValue));
      continue;
    }

    if (!Object.hasOwn(RENMA_METADATA_KEYS, key)) continue;
    const legacyKey = key as LegacyRenmaMetadataKey;
    if (RENMA_LIST_METADATA_KEYS.has(legacyKey) && rawValue.length === 0) {
      const values: string[] = [];
      while (index + 1 < end) {
        const item = lines[index + 1]?.match(/^\s+-\s+(.+)$/);
        if (!item) break;
        values.push(scalarText(item[1] ?? ""));
        index += 1;
      }
      const canonicalKey = `renma.${RENMA_METADATA_KEYS[legacyKey]}`;
      if (!extensions.has(canonicalKey)) {
        extensions.set(canonicalKey, JSON.stringify(values));
      }
    } else {
      const canonicalKey = `renma.${RENMA_METADATA_KEYS[legacyKey]}`;
      if (!extensions.has(canonicalKey)) {
        extensions.set(canonicalKey, scalarText(rawValue));
      }
    }
  }

  const normalizedPath = filePath.replaceAll("\\", "/");
  const name = path.posix.basename(path.posix.dirname(normalizedPath));
  if (!standard.has("name")) standard.set("name", name);
  if (!standard.has("description")) {
    standard.set(
      "description",
      `Use this ${name} skill for deterministic repository fixture checks.`,
    );
  }

  const frontmatter = [
    "---",
    ...[
      "name",
      "description",
      "license",
      "compatibility",
      "allowed-tools",
    ].flatMap((key) => {
      const value = standard.get(key);
      return value === undefined ? [] : [`${key}: ${yamlString(value)}`];
    }),
    ...(extensions.size > 0
      ? [
          "metadata:",
          ...[...extensions.entries()].map(
            ([key, value]) => `  ${key}: ${yamlString(value)}`,
          ),
        ]
      : []),
    "---",
  ];
  return [...frontmatter, ...lines.slice(end + 1)].join("\n");
}

function scalarText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}
