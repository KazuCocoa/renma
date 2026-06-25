import type {
  Artifact,
  CodeFence,
  Heading,
  Link,
  MetadataValue,
  ParsedDocument,
} from "./types.js";

/** Parse a markdown artifact into headings, links, code fences, and frontmatter metadata. */
export function parseDocument(artifact: Artifact): ParsedDocument {
  const lines = artifact.content.split(/\r?\n/);
  const headings: Heading[] = [];
  const links: Link[] = [];
  const codeFences: CodeFence[] = [];
  const metadata = parseFrontmatter(lines);
  let fenceStart: number | undefined;
  let fenceLanguage = "";
  let fenceLines: string[] = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      if (fenceStart === undefined) {
        fenceStart = lineNumber;
        fenceLanguage = fence[1] ?? "";
        fenceLines = [];
      } else {
        codeFences.push({
          language: fenceLanguage,
          content: fenceLines.join("\n"),
          startLine: fenceStart,
          endLine: lineNumber,
        });
        fenceStart = undefined;
        fenceLanguage = "";
        fenceLines = [];
      }
      return;
    }

    if (fenceStart !== undefined) {
      fenceLines.push(line);
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      headings.push({
        depth: heading[1]?.length ?? 1,
        text: heading[2]?.trim() ?? "",
        line: lineNumber,
      });
    }

    for (const match of line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      links.push({
        text: match[1] ?? "",
        target: match[2] ?? "",
        line: lineNumber,
      });
    }
  });

  if (fenceStart !== undefined) {
    codeFences.push({
      language: fenceLanguage,
      content: fenceLines.join("\n"),
      startLine: fenceStart,
      endLine: lines.length,
    });
  }

  return { artifact, lines, headings, codeFences, links, metadata };
}

const LIST_METADATA_KEYS = new Set([
  "tags",
  "when_to_use",
  "when_not_to_use",
  "requires_context",
  "optional_context",
  "conflicts",
  "superseded_by",
]);

function parseFrontmatter(lines: string[]): Record<string, MetadataValue> {
  if (lines[0] !== "---") return {};
  const metadata: Record<string, MetadataValue> = {};
  let activeListKey: string | undefined;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") break;
    const listItem = line?.match(/^\s+-\s+(.+)$/);
    if (activeListKey && listItem) {
      const current = metadata[activeListKey];
      if (Array.isArray(current)) current.push(listItem[1]?.trim() ?? "");
      continue;
    }

    activeListKey = undefined;
    const match = line?.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1] as string;
    const value = match[2]?.trim() ?? "";
    if (LIST_METADATA_KEYS.has(key) && value.length === 0) {
      metadata[key] = [];
      activeListKey = key;
      continue;
    }

    metadata[key] = value;
  }
  return metadata;
}
