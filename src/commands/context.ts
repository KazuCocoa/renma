import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "../markdown.js";
import type { Artifact } from "../types.js";

const DEFAULT_SECTION_PREVIEW_LINES = 3;

export type ContextFormat = "json" | "text";

export interface ContextOptions {
  format?: ContextFormat;
  lines?: string;
}

export interface ContextOutline {
  path: string;
  bytes: number;
  lineCount: number;
  frontmatterRange: null | string;
  headings: Array<{
    depth: number;
    line: number;
    range: string;
    text: string;
    preview: string[];
  }>;
  codeFences: Array<{
    endLine: number;
    language: string;
    range: string;
    startLine: number;
  }>;
  links: Array<{
    line: number;
    target: string;
  }>;
}

export interface ContextSlice {
  path: string;
  range: string;
  text: string;
}

export async function runContextCommand(
  target: string,
  options: ContextOptions = {},
): Promise<number> {
  if (options.lines) {
    const slice = await buildContextSlice(target, options.lines);
    process.stdout.write(
      options.format === "text"
        ? `${slice.text}\n`
        : `${JSON.stringify(slice, null, 2)}\n`,
    );
    return 0;
  }

  const outline = await buildContextOutline(target);
  process.stdout.write(
    options.format === "text"
      ? renderTextOutline(outline)
      : `${JSON.stringify(outline, null, 2)}\n`,
  );
  return 0;
}

export async function buildContextOutline(
  target: string,
): Promise<ContextOutline> {
  const absolutePath = path.resolve(target);
  const content = await readFile(absolutePath, "utf8");
  const artifact: Artifact = {
    absolutePath,
    content,
    kind: "reference",
    path: absolutePath,
    sizeBytes: Buffer.byteLength(content),
  };
  const document = parseDocument(artifact);
  const lineCount = document.lines.length;

  return {
    bytes: artifact.sizeBytes,
    codeFences: document.codeFences.map((fence) => ({
      endLine: fence.endLine,
      language: fence.language,
      range: formatRange(fence.startLine, fence.endLine),
      startLine: fence.startLine,
    })),
    frontmatterRange: frontmatterRange(document.lines),
    headings: document.headings.map((heading, index) => {
      const nextHeading = document.headings
        .slice(index + 1)
        .find((candidate) => candidate.depth <= heading.depth);
      const endLine = nextHeading ? nextHeading.line - 1 : lineCount;
      return {
        depth: heading.depth,
        line: heading.line,
        preview: sectionPreview(document.lines, heading.line + 1, endLine),
        range: formatRange(heading.line, endLine),
        text: heading.text,
      };
    }),
    lineCount,
    links: document.links.map((link) => ({
      line: link.line,
      target: link.target,
    })),
    path: absolutePath,
  };
}

async function buildContextSlice(
  target: string,
  requestedRange: string,
): Promise<ContextSlice> {
  const absolutePath = path.resolve(target);
  const content = await readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  const { end, start } = parseLineRange(requestedRange, lines.length);
  const selected = lines
    .slice(start - 1, end)
    .map((line, index) => `L${String(start + index).padStart(4, "0")}: ${line}`)
    .join("\n");

  return {
    path: absolutePath,
    range: formatRange(start, end),
    text: selected,
  };
}

function frontmatterRange(lines: string[]): null | string {
  if (lines[0] !== "---") {
    return null;
  }

  const endIndex = lines.slice(1).findIndex((line) => line === "---");
  return endIndex === -1 ? null : formatRange(1, endIndex + 2);
}

function sectionPreview(lines: string[], start: number, end: number): string[] {
  const preview: string[] = [];
  let inFence = false;

  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    const line = lines[lineNumber - 1] ?? "";
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.trim() === "") {
      continue;
    }
    preview.push(`L${String(lineNumber).padStart(4, "0")}: ${line.trim()}`);
    if (preview.length >= DEFAULT_SECTION_PREVIEW_LINES) {
      break;
    }
  }

  return preview;
}

function parseLineRange(
  value: string,
  lineCount: number,
): { end: number; start: number } {
  const match = /^L?(\d+)(?:-L?(\d+))?$/i.exec(value.trim());
  if (!match) {
    throw new Error("--lines must look like L10-L42 or 10-42.");
  }

  const start = Number.parseInt(match[1] ?? "", 10);
  const end = Number.parseInt(match[2] ?? match[1] ?? "", 10);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > lineCount
  ) {
    throw new Error(
      `--lines ${value} is outside the file's 1-${lineCount} range.`,
    );
  }

  return { end, start };
}

function renderTextOutline(outline: ContextOutline): string {
  const lines = [
    `Path: ${outline.path}`,
    `Lines: ${outline.lineCount}`,
    `Bytes: ${outline.bytes}`,
    `Frontmatter: ${outline.frontmatterRange ?? "none"}`,
    "",
    "Headings:",
    ...outline.headings.flatMap((heading) => [
      `- ${"#".repeat(heading.depth)} ${heading.text} ${heading.range}`,
      ...heading.preview.map((line) => `  ${line}`),
    ]),
    "",
    "Code fences:",
    ...outline.codeFences.map(
      (fence) => `- ${fence.range} ${fence.language || "(no language)"}`,
    ),
    "",
    "Links:",
    ...outline.links.map((link) => `- L${link.line}: ${link.target}`),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function formatRange(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-L${end}`;
}
