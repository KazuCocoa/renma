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
  "--cwd",
  "--dir",
  "--filter",
  "--prefix",
  "--registry",
  "--tag",
  "--workspace",
]);
const VARIABLE_RE =
  /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?:(:)([-?])([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/gu;

export function classifyDependencyInstalls(
  tokens: readonly ShellToken[],
  input: string,
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

    let skipNextOptionValue = false;
    for (
      let argumentIndex = command.argumentsStart;
      argumentIndex < tokens.length;
      argumentIndex += 1
    ) {
      const token = tokens[argumentIndex];
      if (token === undefined) break;
      if (token.kind === "operator") break;
      if (skipNextOptionValue) {
        skipNextOptionValue = false;
        continue;
      }
      if (token.value.startsWith("-")) {
        skipNextOptionValue = OPTION_WITH_VALUE.has(
          token.value.split("=")[0] ?? token.value,
        );
        continue;
      }
      if (token.value.includes("=")) continue;
      const classified = classifyPackageReference(
        manager,
        token,
        input,
        associatedGuards,
      );
      if (classified === undefined) continue;
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
  input: string,
  associatedGuards: ReadonlySet<string>,
): Omit<DependencyInstallAnalysis, "sourceSpan"> | undefined {
  const reference = token.value;
  if (
    reference.length === 0 ||
    isPlaceholder(reference) ||
    reference.startsWith(".") ||
    reference.startsWith("/") ||
    reference.startsWith("$")
  ) {
    return undefined;
  }

  const parsed = npmPackageNameAndVersion(reference);
  if (parsed === undefined) return undefined;
  const variableNames: string[] = [];
  let allVariablesFailClosed = true;
  let hasVariable = false;
  for (const match of parsed.version.matchAll(VARIABLE_RE)) {
    hasVariable = true;
    const name = match[1] ?? match[5];
    if (name === undefined) continue;
    variableNames.push(name);
    const directFailClosed =
      match[2] === ":" && match[3] === "?" && (match[4] ?? "").length > 0;
    const prefixGuards = failClosedVariableGuardNamesBefore(input, token.start);
    if (
      !directFailClosed &&
      !associatedGuards.has(name) &&
      !prefixGuards.has(name)
    ) {
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

function failClosedVariableGuardNamesBefore(
  input: string,
  offset: number,
): Set<string> {
  const prefix = input.slice(0, offset);
  const names = new Set<string>();
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*):\?([^}\r\n]+)\}/gu;
  for (const match of prefix.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

function isPlaceholder(value: string): boolean {
  return /^<.*>$|^\[.*\]$|^(example|placeholder|package)$/i.test(value);
}
