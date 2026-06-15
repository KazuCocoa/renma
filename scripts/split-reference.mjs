#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

const DEFAULT_MAX_BYTES = 8 * 1024;

try {
  const options = parseArgs(process.argv.slice(2));
  const input = await readFile(options.inputPath);
  const content = input.toString("utf8");
  const parts = splitByLineBoundary(content, options.maxBytes);
  const outputDir = options.outputDir ?? path.dirname(options.inputPath);
  const prefix =
    options.prefix ??
    path.basename(options.inputPath, path.extname(options.inputPath));
  const extension = path.extname(options.inputPath) || ".md";

  await mkdir(outputDir, { recursive: true });
  await ensureNoExistingParts(outputDir, prefix, extension, options.force);

  const writtenPaths = [];
  for (const [index, part] of parts.entries()) {
    const partPath = path.join(
      outputDir,
      `${prefix}-${String(index + 1).padStart(2, "0")}${extension}`,
    );
    await writeFile(partPath, part, "utf8");
    writtenPaths.push(partPath);
  }

  const reconstructed = Buffer.concat(
    await Promise.all(writtenPaths.map((partPath) => readFile(partPath))),
  );
  if (!reconstructed.equals(input)) {
    throw new Error(
      "Reconstruction verification failed. Refusing to accept lossy split.",
    );
  }

  process.stdout.write(
    [
      `Wrote ${writtenPaths.length} ordered part file(s).`,
      "Verified reconstruction byte-for-byte against the original.",
      ...writtenPaths.map((partPath) => `- ${partPath}`),
      "",
    ].join("\n"),
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    maxBytes: DEFAULT_MAX_BYTES,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--out-dir") {
      options.outputDir = requiredValue(args, ++index, "--out-dir");
      continue;
    }
    if (arg === "--part-size-bytes") {
      options.maxBytes = positiveInteger(
        requiredValue(args, ++index, "--part-size-bytes"),
        "--part-size-bytes",
      );
      continue;
    }
    if (arg === "--prefix") {
      options.prefix = requiredValue(args, ++index, "--prefix");
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.inputPath) {
      throw new Error(`Unexpected extra input path: ${arg}`);
    }
    options.inputPath = arg;
  }

  if (!options.inputPath) {
    throw new Error("Missing input file. Run with --help for usage.");
  }

  return options;
}

function splitByLineBoundary(content, maxBytes) {
  if (Buffer.byteLength(content) <= maxBytes) return [content];

  const lines = content.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line !== "");
  if (!lines?.length) return [content];

  const parts = [];
  let current = "";
  for (const line of lines) {
    const next = `${current}${line}`;
    if (current && Buffer.byteLength(next) > maxBytes) {
      parts.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

async function ensureNoExistingParts(outputDir, prefix, extension, force) {
  if (force) return;
  const existing = await readdir(outputDir).catch((error) => {
    if (error && error.code === "ENOENT") return [];
    throw error;
  });
  const pattern = new RegExp(
    `^${escapeRegExp(prefix)}-\\d{2}${escapeRegExp(extension)}$`,
  );
  const collisions = existing.filter((fileName) => pattern.test(fileName));
  if (collisions.length) {
    throw new Error(
      `Refusing to overwrite existing part files without --force: ${collisions.join(", ")}`,
    );
  }
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function positiveInteger(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/split-reference.mjs <file> [options]

Split a reference file into ordered part files such as android-01.md without losing content.
The script verifies reconstruction byte-for-byte before succeeding.

Options:
  --out-dir <path>           Directory for part files. Defaults to input file directory.
  --part-size-bytes <bytes>  Approximate max bytes per part. Defaults to ${DEFAULT_MAX_BYTES}.
  --prefix <name>            Output file prefix. Defaults to input basename.
  --force                    Overwrite existing matching part files.
  -h, --help                 Show help.
`);
}
