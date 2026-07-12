import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "<placeholder>";
const VALUE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const TOOL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = path.resolve(TOOL_DIRECTORY, "..");
const TEMPLATE_PATH = anchoredPath("assets", "template.txt");
const WORKSPACE_PATH = anchoredPath("workspace");
const OUTPUT_PATH = anchoredPath("workspace", "output.txt");

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "prepare") {
    requireArgumentCount(command, args, 0);
    await prepare();
  } else if (command === "apply") {
    requireArgumentCount(command, args, 1);
    await apply(args[0]);
  } else if (command === "inspect") {
    requireArgumentCount(command, args, 0);
    await inspect();
  } else {
    fail(
      "Usage: node tools/placeholder-demo.mjs <prepare|apply VALUE|inspect>",
    );
  }
} catch (error) {
  if (error instanceof Error) fail(error.message);
  fail("Unexpected local filesystem error.");
}

function anchoredPath(...segments) {
  const candidate = path.resolve(EXAMPLE_ROOT, ...segments);
  const relative = path.relative(EXAMPLE_ROOT, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing a path outside the example directory.");
  }
  return candidate;
}

function requireArgumentCount(selectedCommand, values, expected) {
  if (values.length !== expected) {
    throw new Error(`Invalid arguments for ${selectedCommand}.`);
  }
}

async function prepare() {
  const template = await readFile(TEMPLATE_PATH, "utf8");
  if (!template.includes(PLACEHOLDER)) {
    throw new Error("Immutable template does not contain <placeholder>.");
  }
  await mkdir(WORKSPACE_PATH, { recursive: true });
  await writeFile(OUTPUT_PATH, template, "utf8");
  process.stdout.write(
    "Prepared workspace/output.txt: replacement value is missing (<placeholder>).\n",
  );
}

async function apply(value) {
  if (!VALUE_PATTERN.test(value ?? "")) {
    throw new Error("Invalid value: expected [A-Za-z0-9_-]{1,32}.");
  }
  const output = await readOutput();
  if (!output.includes(PLACEHOLDER)) {
    throw new Error("Cannot apply: workspace/output.txt has no <placeholder>.");
  }
  await writeFile(OUTPUT_PATH, output.replaceAll(PLACEHOLDER, value), "utf8");
  process.stdout.write(`Applied value ${value} to workspace/output.txt.\n`);
}

async function inspect() {
  const output = await readOutput();
  if (output.includes(PLACEHOLDER)) {
    process.stdout.write(
      "State: waiting for a replacement value (<placeholder> remains).\n",
    );
    return;
  }
  process.stdout.write(`State: complete. ${output.trim()}\n`);
}

async function readOutput() {
  try {
    return await readFile(OUTPUT_PATH, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("workspace/output.txt is missing; run prepare first.");
    }
    throw error;
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
