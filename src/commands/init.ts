import { lstat, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CLI_EXIT, CliUserError } from "../cli-errors.js";
import { renmaCommand } from "../command-invocation.js";
import { CONFIG_FILENAMES, LEGACY_CONFIG_FILENAME } from "../config.js";

export const INITIAL_CONFIG_CONTENT = `{
  // Record the rationale beside any temporary exception or disabled policy.
  "fail_on": "high",
  "format": "text"
}
`;

type InitState =
  | "created"
  | "primary-existing"
  | "json-existing"
  | "legacy-existing"
  | "conflicting";

interface InitResult {
  state: InitState;
  primaryPath: string;
  existingPaths: string[];
}

/** Initialize repository-level Renma configuration without touching assets. */
export async function initializeRepository(root: string): Promise<InitResult> {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new CliUserError(`Initialization root ${root} is not a directory.`);
  }

  const [primaryName] = CONFIG_FILENAMES;
  const primaryPath = path.join(root, primaryName);
  const conventionalPaths = CONFIG_FILENAMES.map((name) =>
    path.join(root, name),
  );
  const existing = await existingState(conventionalPaths);
  if (existing?.state === "conflicting") return { ...existing, primaryPath };
  const legacyPath = path.join(root, LEGACY_CONFIG_FILENAME);
  if (await pathExists(legacyPath)) {
    return {
      state: "legacy-existing",
      primaryPath,
      existingPaths: [legacyPath],
    };
  }
  if (existing) return { ...existing, primaryPath };

  try {
    await writeFile(primaryPath, INITIAL_CONFIG_CONTENT, {
      encoding: "utf8",
      flag: "wx",
    });
    return { state: "created", primaryPath, existingPaths: [] };
  } catch (error) {
    if (nodeErrorCode(error) !== "EEXIST") throw error;

    const racedState = await existingState(conventionalPaths);
    return {
      state: racedState?.state ?? "primary-existing",
      primaryPath,
      existingPaths: racedState?.existingPaths ?? [primaryPath],
    };
  }
}

/** Run the repository initialization command and render its human output. */
export async function runInitCommand(root: string): Promise<number> {
  let result: InitResult;
  try {
    result = await initializeRepository(root);
  } catch (error) {
    if (error instanceof CliUserError || isUserTargetError(error)) {
      throw new CliUserError(
        `Could not initialize Renma at ${root}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    throw error;
  }

  const primary = displayPath(result.primaryPath);
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
    return CLI_EXIT.success;
  }

  if (result.state === "conflicting") {
    console.error(
      `Multiple Renma configuration files exist: ${result.existingPaths
        .map(displayPath)
        .join(
          ", ",
        )}. Renma requires one unambiguous repository configuration. Keep ${primary} when comments are desired and remove the other supported configuration files. No files were changed.`,
    );
    return CLI_EXIT.userError;
  }

  if (result.state === "legacy-existing") {
    const legacy = displayPath(result.existingPaths[0]!);
    console.error(
      `Legacy Renma configuration ${legacy} is not supported in v1. Rename it to renma.config.json for JSON or ${primary} when comments are needed. No files were changed.`,
    );
    return CLI_EXIT.userError;
  }

  const existing = displayPath(result.existingPaths[0] ?? primary);
  process.stdout.write(
    `Renma is already initialized with ${existing}.\n` +
      "No files were changed.\n",
  );
  return CLI_EXIT.success;
}

async function existingState(conventionalPaths: readonly string[]): Promise<
  | {
      state: Exclude<InitState, "created">;
      existingPaths: string[];
    }
  | undefined
> {
  const existingPaths = (
    await Promise.all(
      conventionalPaths.map(async (candidate) =>
        (await pathExists(candidate)) ? candidate : undefined,
      ),
    )
  ).filter((candidate) => candidate !== undefined);
  if (existingPaths.length > 1) {
    return { state: "conflicting", existingPaths };
  }
  const existingPath = existingPaths[0];
  if (!existingPath) return undefined;
  const index = conventionalPaths.indexOf(existingPath);
  if (index === 0) return { state: "primary-existing", existingPaths };
  if (index === 1) return { state: "json-existing", existingPaths };
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

function isUserTargetError(error: unknown): boolean {
  const code = nodeErrorCode(error);
  return (
    code === "EACCES" ||
    code === "EISDIR" ||
    code === "ENOENT" ||
    code === "ENOTDIR" ||
    code === "EPERM"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
