import { lstat, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { renmaCommand } from "../command-invocation.js";
import { CONFIG_FILENAMES } from "../config.js";

export const INITIAL_CONFIG_CONTENT = `{
  "fail_on": "high",
  "format": "text"
}
`;

export type InitState =
  | "created"
  | "primary-existing"
  | "legacy-existing"
  | "conflicting";

export interface InitResult {
  state: InitState;
  primaryPath: string;
  legacyPath: string;
}

/** Initialize repository-level Renma configuration without touching assets. */
export async function initializeRepository(root: string): Promise<InitResult> {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Initialization root ${root} is not a directory.`);
  }

  const [primaryName, legacyName] = CONFIG_FILENAMES;
  const primaryPath = path.join(root, primaryName);
  const legacyPath = path.join(root, legacyName);
  const existing = await existingState(primaryPath, legacyPath);
  if (existing) return { state: existing, primaryPath, legacyPath };

  try {
    await writeFile(primaryPath, INITIAL_CONFIG_CONTENT, {
      encoding: "utf8",
      flag: "wx",
    });
    return { state: "created", primaryPath, legacyPath };
  } catch (error) {
    if (nodeErrorCode(error) !== "EEXIST") throw error;

    const racedState = await existingState(primaryPath, legacyPath);
    return {
      state: racedState ?? "primary-existing",
      primaryPath,
      legacyPath,
    };
  }
}

/** Run the repository initialization command and render its human output. */
export async function runInitCommand(root: string): Promise<number> {
  let result: InitResult;
  try {
    result = await initializeRepository(root);
  } catch (error) {
    console.error(
      `Could not initialize Renma at ${root}: ${errorMessage(error)}`,
    );
    return 2;
  }

  const primary = displayPath(result.primaryPath);
  const legacy = displayPath(result.legacyPath);
  if (result.state === "created") {
    const scan = root.startsWith("-")
      ? renmaCommand(["scan", "--", root]).display
      : renmaCommand(["scan", root]).display;
    const catalog = root.startsWith("-")
      ? renmaCommand(["catalog", "--format", "markdown", "--", root]).display
      : renmaCommand(["catalog", root, "--format", "markdown"]).display;
    process.stdout.write(
      `Created ${primary}\n\n` +
        "Renma is initialized for this repository.\n\n" +
        "For an existing repository:\n" +
        `  ${scan}\n` +
        `  ${catalog}\n\n` +
        "To create a new Skill:\n" +
        "  renma guide skill\n",
    );
    return 0;
  }

  if (result.state === "conflicting") {
    process.stdout.write(
      `Warning: both ${primary} and ${legacy} exist.\n` +
        `${primary} takes precedence.\n` +
        "No files were changed.\n",
    );
    return 0;
  }

  const existing = result.state === "primary-existing" ? primary : legacy;
  process.stdout.write(
    `Renma is already initialized with ${existing}.\n` +
      "No files were changed.\n",
  );
  return 0;
}

async function existingState(
  primaryPath: string,
  legacyPath: string,
): Promise<Exclude<InitState, "created"> | undefined> {
  const [primaryExists, legacyExists] = await Promise.all([
    pathExists(primaryPath),
    pathExists(legacyPath),
  ]);
  if (primaryExists && legacyExists) return "conflicting";
  if (primaryExists) return "primary-existing";
  if (legacyExists) return "legacy-existing";
  return undefined;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function displayPath(value: string): string {
  return value.split(path.sep).join("/");
}

function nodeErrorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
