#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_FORMAT = "prompt";
const DEFAULT_MAX_SOURCE_BYTES = 120 * 1024;
const DEFAULT_MAX_CONTEXT_BYTES = 32 * 1024;
const CONTEXT_DIRS = new Set(["references", "profiles", "examples", "r"]);

const options = parseArgs(process.argv.slice(2));
const contextPackage = await buildContextPackage(options);

if (options.format === "json") {
  process.stdout.write(`${JSON.stringify(contextPackage, null, 2)}\n`);
} else {
  process.stdout.write(renderCodexPrompt(contextPackage));
}

async function buildContextPackage(options) {
  const sourcePath = path.resolve(options.inputPath);
  const source = await readLimitedText(sourcePath, options.maxSourceBytes);
  const skillDir = await findSkillDir(path.dirname(sourcePath));
  const skillPath = skillDir ? path.join(skillDir, "SKILL.md") : null;
  const skill = skillPath
    ? await readLimitedText(skillPath, options.maxContextBytes)
    : null;
  const siblingContext = skillDir
    ? await collectSiblingContext(skillDir, sourcePath, options.maxContextBytes)
    : [];

  return {
    mode: "codex-semantic-split-prompt",
    mutatesFiles: false,
    source: {
      path: sourcePath,
      bytesRead: source.bytesRead,
      truncated: source.truncated,
      numberedText: numberLines(source.text),
    },
    context: {
      skillDir,
      skill: skill
        ? {
            path: skillPath,
            bytesRead: skill.bytesRead,
            truncated: skill.truncated,
            text: skill.text,
          }
        : null,
      siblingFiles: siblingContext,
    },
  };
}

function renderCodexPrompt(contextPackage) {
  const source = contextPackage.source;
  const context = contextPackage.context;
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
    "# Codex Task: Suggest Semantic Reference Split",
    "",
    "You are improving an AI-agent skill repository.",
    "",
    "Read the provided source file and nearby context. Suggest a semantic split plan for the source file based on meaning, not byte size and not predefined categories.",
    "",
    "Infer the best split direction as a human maintainer would. For example, choose platform-specific files only if the content itself separates macOS/Linux, Windows, etc. If the better boundary is setup phase, troubleshooting area, tool, workflow, runtime, audience, prerequisite, verification, or something else, choose that instead.",
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
      "routingHint": "when SKILL.md should route here"
    }
  ],
  "sharedContent": [
    {
      "sourceRanges": ["L1-L9"],
      "recommendation": "keep in common file, duplicate intentionally, or route from SKILL.md"
    }
  ],
  "routingUpdate": "brief SKILL.md routing guidance",
  "risks": ["coverage or validation concerns"],
  "confidence": 0.0
}`),
    "",
    "Rules:",
    "- Use source line ranges from the numbered source file.",
    "- Do not split inside fenced code blocks.",
    "- Do not drop warnings, prerequisites, rollback, or verification steps.",
    "- Name files by meaning, not by part number.",
    "- If the source should remain one file, set shouldSplit to false and suggestedFiles to [].",
    "- Return JSON only. Do not include Markdown outside the JSON.",
    "",
    "## Source",
    "",
    `Path: ${source.path}`,
    `Bytes read: ${source.bytesRead}${source.truncated ? " (truncated)" : ""}`,
    "",
    fence(source.numberedText),
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

async function findSkillDir(startDir) {
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

async function collectSiblingContext(skillDir, sourcePath, maxBytes) {
  const files = await walk(skillDir);
  const contextFiles = [];

  for (const filePath of files.sort()) {
    if (filePath === sourcePath || path.basename(filePath) === "SKILL.md") {
      continue;
    }

    const relative = path.relative(skillDir, filePath);
    const [topLevel] = relative.split(path.sep);
    if (!CONTEXT_DIRS.has(topLevel) || !filePath.endsWith(".md")) {
      continue;
    }

    const text = await readLimitedText(filePath, Math.min(maxBytes, 4 * 1024));
    contextFiles.push({
      path: filePath,
      bytesRead: text.bytesRead,
      truncated: text.truncated,
      preview: previewMarkdown(text.text),
    });

    if (contextFiles.length >= 80) {
      break;
    }
  }

  return contextFiles;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

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

async function readLimitedText(filePath, maxBytes) {
  const buffer = await readFile(filePath);
  const slice = buffer.subarray(0, maxBytes);
  return {
    text: slice.toString("utf8"),
    bytesRead: slice.byteLength,
    truncated: buffer.byteLength > maxBytes,
  };
}

function previewMarkdown(text) {
  const lines = text.split(/\n/);
  const preview = [];

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

function numberLines(text) {
  return text
    .split(/\n/)
    .map((line, index) => `L${String(index + 1).padStart(4, "0")}: ${line}`)
    .join("\n");
}

function fence(text) {
  return `\`\`\`text\n${text}\n\`\`\``;
}

function parseArgs(args) {
  const options = {
    format: DEFAULT_FORMAT,
    maxContextBytes: DEFAULT_MAX_CONTEXT_BYTES,
    maxSourceBytes: DEFAULT_MAX_SOURCE_BYTES,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--format") {
      options.format = requiredValue(args, ++index, "--format");
    } else if (arg === "--max-source-bytes") {
      options.maxSourceBytes = parsePositiveInt(
        requiredValue(args, ++index, "--max-source-bytes"),
        "--max-source-bytes",
      );
    } else if (arg === "--max-context-bytes") {
      options.maxContextBytes = parsePositiveInt(
        requiredValue(args, ++index, "--max-context-bytes"),
        "--max-context-bytes",
      );
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.inputPath) {
      options.inputPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.inputPath) {
    printUsage();
    process.exit(1);
  }

  if (!["json", "prompt"].includes(options.format)) {
    throw new Error("--format must be json or prompt.");
  }

  return options;
}

function requiredValue(args, index, name) {
  const value = args[index];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function printUsage() {
  process.stdout
    .write(`Usage: node scripts/suggest-semantic-split.mjs <file> [options]

Build a Codex-ready prompt for a semantic split proposal. This command does not
call a model and does not mutate files. Pipe the output to Codex CLI so Codex can
read the context and propose the split.

Examples:
  node scripts/suggest-semantic-split.mjs skills/setup/references/android.md | codex exec
  npm run --silent suggest-semantic-split -- skills/setup/references/android.md | codex exec

Options:
  --format <prompt|json>        Output format. Defaults to prompt.
  --max-source-bytes <bytes>    Source file budget. Defaults to ${DEFAULT_MAX_SOURCE_BYTES}.
  --max-context-bytes <bytes>   Nearby context budget. Defaults to ${DEFAULT_MAX_CONTEXT_BYTES}.
  -h, --help                    Show help.
`);
}
