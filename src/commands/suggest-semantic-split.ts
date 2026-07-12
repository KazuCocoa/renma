import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildInspectOutline, type InspectOutline } from "./inspect.js";

const DEFAULT_MAX_CONTEXT_BYTES = 32 * 1024;
const CONTEXT_DIRS = new Set(["references", "profiles", "examples", "r"]);

export type SuggestSemanticSplitFormat = "prompt" | "json";

export interface SuggestSemanticSplitOptions {
  format?: SuggestSemanticSplitFormat;
  maxContextBytes?: number;
  maxSourceBytes?: number;
}

interface LimitedText {
  bytesRead: number;
  text: string;
  truncated: boolean;
}

interface ContextFile {
  bytesRead: number;
  path: string;
  preview: string;
  truncated: boolean;
}

interface SemanticSplitReviewBundle {
  context: {
    siblingFiles: ContextFile[];
    skill: null | {
      bytesRead: number;
      path: string;
      text: string;
      truncated: boolean;
    };
    skillDir: null | string;
  };
  helperCommands: {
    outline: string;
    sliceExample: string;
  };
  mode: "codex-semantic-split-prompt";
  mutatesFiles: false;
  source: {
    outline: InspectOutline;
    path: string;
  };
}

export async function runSuggestSemanticSplitCommand(
  target: string,
  options: SuggestSemanticSplitOptions = {},
): Promise<number> {
  const semanticSplitReviewBundle = await buildSemanticSplitReviewBundle(
    target,
    options,
  );
  const format = options.format ?? "prompt";
  process.stdout.write(
    format === "json"
      ? `${JSON.stringify(semanticSplitReviewBundle, null, 2)}\n`
      : renderReviewPrompt(semanticSplitReviewBundle),
  );
  return 0;
}

async function buildSemanticSplitReviewBundle(
  target: string,
  options: SuggestSemanticSplitOptions,
): Promise<SemanticSplitReviewBundle> {
  const sourcePath = path.resolve(target);
  const sourceOutline = await buildInspectOutline(sourcePath);
  const skillDir = await findSkillDir(path.dirname(sourcePath));
  const skillPath = skillDir ? path.join(skillDir, "SKILL.md") : null;
  const skill = skillPath
    ? await readLimitedText(
        skillPath,
        options.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES,
      )
    : null;
  const skillContext =
    skill && skillPath
      ? {
          bytesRead: skill.bytesRead,
          path: skillPath,
          text: skill.text,
          truncated: skill.truncated,
        }
      : null;
  const siblingContext = skillDir
    ? await collectSiblingContext(
        skillDir,
        sourcePath,
        options.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES,
      )
    : [];

  return {
    context: {
      siblingFiles: siblingContext,
      skill: skillContext,
      skillDir,
    },
    helperCommands: {
      outline: `renma inspect ${shellQuote(sourcePath)} --format json`,
      sliceExample: `renma inspect ${shellQuote(sourcePath)} --lines L10-L42 --format text`,
    },
    mode: "codex-semantic-split-prompt",
    mutatesFiles: false,
    source: {
      outline: sourceOutline,
      path: sourcePath,
    },
  };
}

function renderReviewPrompt(
  semanticSplitReviewBundle: SemanticSplitReviewBundle,
): string {
  const { source } = semanticSplitReviewBundle;
  const { context } = semanticSplitReviewBundle;
  const siblingSummary =
    context.siblingFiles.length > 0
      ? context.siblingFiles
          .map(
            (file) =>
              `### ${file.path}\nBytes read: ${file.bytesRead}${file.truncated ? " (truncated)" : ""}\n${fence(
                file.preview,
              )}`,
          )
          .join("\n\n")
      : "(none found)";

  return `${[
    "# Renma Task: Suggest Semantic Reference Split",
    "",
    "You are improving an AI-agent skill repository.",
    "",
    "Read the compact source outline and nearby context. Suggest a semantic split plan for the source file based on meaning, not byte size and not predefined categories.",
    "",
    "Infer the best split direction as a human maintainer would. For example, choose platform-specific files only if the content itself separates macOS/Linux, Windows, etc. If the better boundary is setup phase, troubleshooting area, tool, workflow mode, audience, prerequisite, verification, or something else, choose that instead.",
    "",
    "Use deterministic inspection helpers when the outline is not enough. Prefer these helpers over ad hoc cat/sed calls so token usage stays low:",
    `- Outline: \`${semanticSplitReviewBundle.helperCommands.outline}\``,
    `- Exact slice: \`${semanticSplitReviewBundle.helperCommands.sliceExample}\``,
    "",
    "Do not rewrite files. Return only a proposal.",
    "",
    "Return strict JSON with this shape:",
    "",
    fence(`{
  "source": "${source.path}",
  "shouldSplit": true,
  "splitDirection": "one sentence describing the semantic boundary",
  "suggestedFiles": [
      {
        "path": "suggested repo-relative or source-neighbor path",
        "category": "human-readable category",
        "why": "why this category belongs together",
        "sourceRanges": ["L10-L42", "L80-L120"],
        "usageHint": "when SKILL.md should reference this file"
      }
    ],
    "sharedContent": [
      {
        "sourceRanges": ["L1-L9"],
        "recommendation": "keep in a common file, duplicate intentionally, or reference from SKILL.md"
      }
    ],
    "skillGuidanceUpdate": "brief SKILL.md usage and reference guidance",
    "risks": ["coverage or validation concerns"],
    "confidence": 0.0
  }`),
    "",
    "Rules:",
    "- Use source line ranges from the outline and exact line slices.",
    "- Do not split inside fenced code blocks.",
    "- Do not drop warnings, prerequisites, rollback, or verification steps.",
    "- Name files by meaning, not by part number.",
    "- If the source should remain one file, set shouldSplit to false and suggestedFiles to [].",
    "- Return JSON only. Do not include Markdown outside the JSON.",
    "",
    "## Source Outline",
    "",
    fence(JSON.stringify(source.outline, null, 2)),
    "",
    "## Nearby SKILL.md",
    "",
    context.skill
      ? `Path: ${context.skill.path}\nBytes read: ${context.skill.bytesRead}${context.skill.truncated ? " (truncated)" : ""}\n\n${fence(
          context.skill.text,
        )}`
      : "(not found)",
    "",
    "## Sibling Context Files",
    "",
    siblingSummary,
    "",
  ].join("\n")}\n`;
}

async function findSkillDir(startDir: string): Promise<null | string> {
  let current = startDir;
  while (true) {
    try {
      const skill = path.join(current, "SKILL.md");
      if ((await stat(skill)).isFile()) {
        return current;
      }
    } catch {
      // Keep walking upward.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function collectSiblingContext(
  skillDir: string,
  sourcePath: string,
  maxBytes: number,
): Promise<ContextFile[]> {
  const files = await walk(skillDir);
  const contextFiles: ContextFile[] = [];

  for (const filePath of files.sort()) {
    if (filePath === sourcePath || path.basename(filePath) === "SKILL.md") {
      continue;
    }

    const relative = path.relative(skillDir, filePath);
    const [topLevel] = relative.split(path.sep);
    if (!topLevel || !CONTEXT_DIRS.has(topLevel) || !filePath.endsWith(".md")) {
      continue;
    }

    const text = await readLimitedText(filePath, Math.min(maxBytes, 4 * 1024));
    contextFiles.push({
      bytesRead: text.bytesRead,
      path: filePath,
      preview: previewMarkdown(text.text),
      truncated: text.truncated,
    });

    if (contextFiles.length >= 80) {
      break;
    }
  }

  return contextFiles;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function readLimitedText(
  filePath: string,
  maxBytes: number,
): Promise<LimitedText> {
  const buffer = await readFile(filePath);
  const slice = buffer.subarray(0, maxBytes);
  return {
    bytesRead: slice.byteLength,
    text: slice.toString("utf8"),
    truncated: buffer.byteLength > maxBytes,
  };
}

function previewMarkdown(text: string): string {
  const lines = text.split(/\n/);
  const preview: string[] = [];

  for (const line of lines) {
    if (
      /^#{1,6}\s+/.test(line) ||
      /^description:\s*/i.test(line) ||
      /^name:\s*/i.test(line)
    ) {
      preview.push(line);
    }
    if (preview.length >= 8) {
      break;
    }
  }

  return preview.length > 0 ? preview.join("\n") : lines.slice(0, 8).join("\n");
}

function fence(text: string): string {
  return `\`\`\`text\n${text}\n\`\`\``;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
