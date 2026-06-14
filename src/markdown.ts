import type {
  Artifact,
  CodeFence,
  Heading,
  Link,
  ParsedDocument,
} from "./types.js";

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

function parseFrontmatter(lines: string[]): Record<string, string> {
  if (lines[0] !== "---") return {};
  const metadata: Record<string, string> = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") break;
    const match = line?.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) metadata[match[1] as string] = match[2]?.trim() ?? "";
  }
  return metadata;
}
