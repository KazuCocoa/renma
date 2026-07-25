import { projectionSpanToSourceSpan } from "../security-destination/logical-shell.js";
import type { ShellProjection } from "../security-destination/index.js";
import { associatedFailClosedVariableGuardNames } from "./guards.js";
import type { SecurityGuardEvidence } from "../markdown-security-view.js";
import type {
  DependencyInstallAnalysis,
  DependencyPinningKind,
} from "./types.js";
import type { ShellToken } from "./shell.js";

type DependencyClassification = {
  installs: DependencyInstallAnalysis[];
  npmStyleInstallCommand: boolean;
  supported: boolean;
};

const OPTION_WITH_VALUE = new Set([
  "--cache",
  "--cache-folder",
  "--cwd",
  "--dir",
  "--filter",
  "--global-dir",
  "--modules-folder",
  "--mutex",
  "--prefix",
  "--registry",
  "--store-dir",
  "--tag",
  "--workspace",
]);
const OPTION_WITHOUT_VALUE = new Set([
  "-D",
  "-E",
  "-O",
  "-P",
  "-g",
  "--dev",
  "--exact",
  "--global",
  "--ignore-scripts",
  "--no-save",
  "--offline",
  "--optional",
  "--peer",
  "--prod",
  "--save",
  "--save-dev",
  "--save-exact",
  "--save-optional",
  "--save-peer",
  "--workspace-root",
]);
const VARIABLE_RE =
  /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?:(:)([-?])([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/gu;

export function classifyDependencyInstalls(
  tokens: readonly ShellToken[],
  shellProjection: ShellProjection,
  sourceLength: number,
  guards: readonly SecurityGuardEvidence[],
): DependencyClassification {
  const installs: DependencyInstallAnalysis[] = [];
  const associatedGuards = associatedFailClosedVariableGuardNames(guards);
  let npmStyleInstallCommand = false;
  let supported = true;

  for (let index = 0; index < tokens.length; index += 1) {
    const managerToken = tokens[index];
    if (managerToken?.kind !== "word") continue;
    const manager = normalizedManager(managerToken.value);
    if (manager === undefined) continue;
    const command = dependencyCommand(tokens, index, manager);
    if (command === undefined) continue;
    npmStyleInstallCommand = true;
    if (!command.supported) {
      supported = false;
      continue;
    }

    let optionsEnded = false;
    for (
      let argumentIndex = command.argumentsStart;
      argumentIndex < tokens.length;
      argumentIndex += 1
    ) {
      const token = tokens[argumentIndex];
      if (token === undefined) break;
      if (token.kind === "operator") break;
      if (!optionsEnded && token.value === "--") {
        optionsEnded = true;
        continue;
      }
      if (!optionsEnded && token.value.startsWith("-")) {
        const equalsAt = token.value.indexOf("=");
        const optionName =
          equalsAt < 0 ? token.value : token.value.slice(0, equalsAt);
        if (equalsAt >= 0) {
          if (equalsAt === token.value.length - 1) supported = false;
          continue;
        }
        if (OPTION_WITH_VALUE.has(optionName)) {
          const value = tokens[argumentIndex + 1];
          if (
            value?.kind !== "word" ||
            value.value.length === 0 ||
            value.value.startsWith("-")
          ) {
            supported = false;
            continue;
          }
          argumentIndex += 1;
          continue;
        }
        if (!OPTION_WITHOUT_VALUE.has(optionName)) {
          supported = false;
        }
        continue;
      }
      const classified = classifyPackageReference(
        manager,
        token,
        associatedGuards,
      );
      if (classified === undefined) {
        supported = false;
        continue;
      }
      installs.push({
        ...classified,
        sourceSpan: projectionSpanToSourceSpan(
          { start: token.start, end: token.end },
          shellProjection,
          sourceLength,
        ),
      });
    }
  }

  return { installs, npmStyleInstallCommand, supported };
}

function normalizedManager(
  value: string,
): DependencyInstallAnalysis["packageManager"] | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "npm" || normalized === "pnpm" || normalized === "yarn") {
    return normalized;
  }
  return undefined;
}

function dependencyCommand(
  tokens: readonly ShellToken[],
  managerIndex: number,
  manager: DependencyInstallAnalysis["packageManager"],
): { argumentsStart: number; supported: boolean } | undefined {
  const first = tokens[managerIndex + 1];
  if (first?.kind !== "word") return undefined;
  if (manager === "yarn" && first.value.toLowerCase() === "global") {
    const add = tokens[managerIndex + 2];
    if (add?.kind !== "word" || add.value.toLowerCase() !== "add") {
      return undefined;
    }
    return { argumentsStart: managerIndex + 3, supported: true };
  }
  const command = first.value.toLowerCase();
  const accepted =
    manager === "npm"
      ? command === "install" || command === "i" || command === "add"
      : manager === "pnpm"
        ? command === "install" || command === "add"
        : command === "add";
  if (accepted) {
    return { argumentsStart: managerIndex + 2, supported: true };
  }
  if (command.startsWith("-")) {
    return { argumentsStart: managerIndex + 2, supported: false };
  }
  return undefined;
}

function classifyPackageReference(
  packageManager: DependencyInstallAnalysis["packageManager"],
  token: ShellToken,
  associatedGuards: ReadonlySet<string>,
): Omit<DependencyInstallAnalysis, "sourceSpan"> | undefined {
  const reference = token.value;
  if (
    reference.length === 0 ||
    isPlaceholder(reference) ||
    reference.startsWith(".") ||
    reference.startsWith("/") ||
    reference.startsWith("$") ||
    reference.includes("=")
  ) {
    return undefined;
  }

  const parsed = npmPackageNameAndVersion(reference);
  if (
    parsed === undefined ||
    !/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/u.test(parsed.packageName)
  ) {
    return undefined;
  }
  const variableNames: string[] = [];
  let allVariablesFailClosed = true;
  let hasVariable = false;
  for (const match of parsed.version.matchAll(VARIABLE_RE)) {
    hasVariable = true;
    const name = match[1] ?? match[5];
    if (name === undefined) continue;
    variableNames.push(name);
    const directFailClosed =
      match[2] === ":" &&
      match[3] === "?" &&
      (match[4] ?? "").length > 0 &&
      !token.raw.includes("'");
    if (!directFailClosed && !associatedGuards.has(name)) {
      allVariablesFailClosed = false;
    }
  }
  if (parsed.version.includes("$") && !hasVariable) {
    hasVariable = true;
    allVariablesFailClosed = false;
  }

  let pinning: DependencyPinningKind;
  if (parsed.version.length === 0) {
    pinning = "unpinned";
  } else if (hasVariable) {
    pinning = allVariablesFailClosed
      ? "pinned-variable-guarded"
      : "variable-unverified";
  } else {
    pinning = "pinned-literal";
  }
  return {
    packageManager,
    packageName: parsed.packageName,
    reference,
    pinning,
    variableNames: [...new Set(variableNames)],
  };
}

function npmPackageNameAndVersion(
  reference: string,
): { packageName: string; version: string } | undefined {
  if (reference.startsWith("@")) {
    const slash = reference.indexOf("/");
    if (slash <= 1) return undefined;
    const versionAt = reference.indexOf("@", slash + 1);
    return versionAt < 0
      ? { packageName: reference, version: "" }
      : {
          packageName: reference.slice(0, versionAt),
          version: reference.slice(versionAt + 1),
        };
  }
  const versionAt = reference.lastIndexOf("@");
  if (versionAt < 0) return { packageName: reference, version: "" };
  if (versionAt === 0) return undefined;
  return {
    packageName: reference.slice(0, versionAt),
    version: reference.slice(versionAt + 1),
  };
}

function isPlaceholder(value: string): boolean {
  return /^<.*>$|^\[.*\]$|^(example|placeholder|package)$/i.test(value);
}
