import {
  classifyNpmSelector,
  classifyPythonSelector,
  type DependencySelectorAnalysis,
  type FloatingDependencyAllowance,
} from "../dependency-selectors.js";
import type { SecurityGuardEvidence } from "../markdown-security-view.js";
import type { ShellProjection } from "../security-destination/index.js";
import { projectionSpanToSourceSpan } from "../security-destination/logical-shell.js";
import { associatedFailClosedVariableGuardNames } from "./guards.js";
import type { ShellToken } from "./shell.js";
import type {
  DependencyInstallAnalysis,
  DependencyPinningKind,
} from "./types.js";

type DependencyClassification = {
  installs: DependencyInstallAnalysis[];
  dependencyInstallCommand: boolean;
  npmStyleInstallCommand: boolean;
  supported: boolean;
};

type NpmPackageManager = "npm" | "pnpm" | "yarn";

type DependencyCommand = {
  ecosystem: DependencyInstallAnalysis["ecosystem"];
  packageManager: DependencyInstallAnalysis["packageManager"];
  argumentsStart?: number;
  supported: boolean;
};

const NPM_OPTION_WITH_VALUE = new Set([
  "-F",
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
const NPM_OPTION_WITHOUT_VALUE = new Set([
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
const NPM_MANAGER_OPTION_WITH_VALUE: Readonly<
  Record<NpmPackageManager, ReadonlySet<string>>
> = {
  npm: new Set(),
  pnpm: new Set(["--filter", "-F"]),
  yarn: new Set(["--cwd"]),
};
const PYTHON_OPTION_WITH_VALUE = new Set([
  "-f",
  "-i",
  "--abi",
  "--cache-dir",
  "--config-settings",
  "--extra-index-url",
  "--find-links",
  "--implementation",
  "--index-url",
  "--no-binary",
  "--only-binary",
  "--platform",
  "--prefix",
  "--progress-bar",
  "--proxy",
  "--python",
  "--python-version",
  "--root",
  "--src",
  "--target",
  "--timeout",
  "--trusted-host",
  "--upgrade-strategy",
]);
const PYTHON_OPTION_WITHOUT_VALUE = new Set([
  "--break-system-packages",
  "--check-build-dependencies",
  "--compile",
  "--disable-pip-version-check",
  "--dry-run",
  "--force-reinstall",
  "--ignore-installed",
  "--ignore-requires-python",
  "--no-build-isolation",
  "--no-cache-dir",
  "--no-compile",
  "--no-deps",
  "--no-index",
  "--no-input",
  "--pre",
  "--prefer-binary",
  "--quiet",
  "--require-hashes",
  "--upgrade",
  "--user",
  "--verbose",
  "-q",
  "-U",
  "-v",
]);
const PYTHON_GLOBAL_OPTION_WITH_VALUE = new Set([
  "--cache-dir",
  "--cert",
  "--client-cert",
  "--proxy",
  "--python",
  "--retries",
  "--timeout",
  "--trusted-host",
]);
const PYTHON_GLOBAL_OPTION_WITHOUT_VALUE = new Set([
  "--disable-pip-version-check",
  "--isolated",
  "--no-input",
  "--quiet",
  "--verbose",
  "-q",
  "-v",
]);
const MAX_PYTHON_GLOBAL_ARGUMENTS = 32;
const VARIABLE_RE =
  /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?:(:)([-?])([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/gu;
const PYTHON_EXECUTABLE_RE = /^python\d*(?:\.\d+)*$/iu;
const PYTHON_EXACT_VARIABLE_SELECTOR_RE =
  /^(?:===|==)\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?::\?[^}]+)?\}|[A-Za-z_][A-Za-z0-9_]*)$/u;

export function classifyDependencyInstalls(
  tokens: readonly ShellToken[],
  shellProjection: ShellProjection,
  sourceLength: number,
  guards: readonly SecurityGuardEvidence[],
  allowedFloatingDependencies: readonly FloatingDependencyAllowance[] = [],
): DependencyClassification {
  const installs: DependencyInstallAnalysis[] = [];
  const associatedGuards = associatedFailClosedVariableGuardNames(guards);
  const allowances = new Map(
    allowedFloatingDependencies.map((allowance) => [
      allowance.normalized,
      allowance,
    ]),
  );
  let dependencyInstallCommand = false;
  let npmStyleInstallCommand = false;
  let supported = true;

  for (let index = 0; index < tokens.length; index += 1) {
    const command =
      npmDependencyCommand(tokens, index) ??
      pythonDependencyCommand(tokens, index);
    if (command === undefined) continue;
    dependencyInstallCommand = true;
    if (command.ecosystem === "npm") npmStyleInstallCommand = true;
    if (!command.supported) supported = false;
    if (command.argumentsStart === undefined) continue;

    const result = classifyCommandArguments(
      tokens,
      command,
      associatedGuards,
      allowances,
      shellProjection,
      sourceLength,
    );
    installs.push(...result.installs);
    if (!result.supported) supported = false;
  }

  return {
    installs,
    dependencyInstallCommand,
    npmStyleInstallCommand,
    supported,
  };
}

function classifyCommandArguments(
  tokens: readonly ShellToken[],
  command: DependencyCommand,
  associatedGuards: ReadonlySet<string>,
  allowances: ReadonlyMap<string, FloatingDependencyAllowance>,
  shellProjection: ShellProjection,
  sourceLength: number,
): { installs: DependencyInstallAnalysis[]; supported: boolean } {
  const installs: DependencyInstallAnalysis[] = [];
  let supported = true;
  let optionsEnded = false;

  for (
    let argumentIndex = command.argumentsStart ?? tokens.length;
    argumentIndex < tokens.length;
    argumentIndex += 1
  ) {
    const token = tokens[argumentIndex];
    if (token === undefined || token.kind === "operator") break;
    if (!optionsEnded && token.value === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && token.value.startsWith("-")) {
      const option = consumeInstallOption(
        tokens,
        argumentIndex,
        command.ecosystem,
      );
      if (option === undefined) {
        supported = false;
        continue;
      }
      if (!option.supported) supported = false;
      if (option.evidence !== undefined) {
        installs.push(
          dependencyFromSelector(
            option.evidence.kind === "indirect-file"
              ? {
                  ecosystem: command.ecosystem,
                  reference: option.evidence.token.value,
                  selector: option.evidence.token.value,
                  normalizedSelector: option.evidence.token.value,
                  selectorKind: "indirect-file",
                  normalizedReference: option.evidence.token.value,
                }
              : command.ecosystem === "npm"
                ? classifyNpmSelector(option.evidence.token.value)
                : classifyPythonSelector(option.evidence.token.value),
            command.packageManager,
            option.evidence.token,
            associatedGuards,
            allowances,
            shellProjection,
            sourceLength,
          ),
        );
      }
      argumentIndex = option.nextIndex - 1;
      continue;
    }

    if (isPlaceholder(token.value)) {
      supported = false;
      continue;
    }
    const selector =
      command.ecosystem === "npm"
        ? classifyNpmSelector(token.value)
        : classifyPythonSelector(token.value);
    if (selector.selectorKind === "unknown") supported = false;
    installs.push(
      dependencyFromSelector(
        selector,
        command.packageManager,
        token,
        associatedGuards,
        allowances,
        shellProjection,
        sourceLength,
      ),
    );
  }
  return { installs, supported };
}

function consumeInstallOption(
  tokens: readonly ShellToken[],
  optionIndex: number,
  ecosystem: DependencyInstallAnalysis["ecosystem"],
):
  | {
      nextIndex: number;
      supported: boolean;
      evidence?: {
        kind: "direct-reference" | "indirect-file";
        token: ShellToken;
      };
    }
  | undefined {
  const token = tokens[optionIndex];
  if (token?.kind !== "word") return undefined;
  if (ecosystem === "npm") {
    return consumeOrdinaryOption(
      tokens,
      optionIndex,
      NPM_OPTION_WITH_VALUE,
      NPM_OPTION_WITHOUT_VALUE,
    );
  }

  const indirect = pythonIndirectOption(tokens, optionIndex);
  if (indirect !== undefined) return indirect;
  return consumeOrdinaryOption(
    tokens,
    optionIndex,
    PYTHON_OPTION_WITH_VALUE,
    PYTHON_OPTION_WITHOUT_VALUE,
  );
}

function pythonIndirectOption(
  tokens: readonly ShellToken[],
  optionIndex: number,
): ReturnType<typeof consumeInstallOption> {
  const option = tokens[optionIndex];
  if (option?.kind !== "word") return undefined;
  const value = option.value;
  const exactOption = /^(?:-r|-c|--requirement|--constraint|-e|--editable)$/u;
  const attached =
    /^(?:(-r|-c)(.+)|(--requirement|--constraint|--editable)=(.*))$/u.exec(
      value,
    );
  if (!exactOption.test(value) && attached === null) return undefined;

  const kind =
    value === "-e" || value === "--editable" || attached?.[3] === "--editable"
      ? "direct-reference"
      : "indirect-file";
  if (attached !== null) {
    const attachedValue = attached[2] ?? attached[4] ?? "";
    return {
      nextIndex: optionIndex + 1,
      supported: attachedValue.length > 0,
      ...(attachedValue.length === 0
        ? {}
        : {
            evidence: {
              kind,
              token: { ...option, value: attachedValue },
            },
          }),
    };
  }

  const optionValue = tokens[optionIndex + 1];
  if (
    optionValue?.kind !== "word" ||
    optionValue.value.length === 0 ||
    optionValue.value.startsWith("-")
  ) {
    return { nextIndex: optionIndex + 1, supported: false };
  }
  return {
    nextIndex: optionIndex + 2,
    supported: true,
    evidence: { kind, token: optionValue },
  };
}

function consumeOrdinaryOption(
  tokens: readonly ShellToken[],
  optionIndex: number,
  optionsWithValue: ReadonlySet<string>,
  optionsWithoutValue: ReadonlySet<string>,
): { nextIndex: number; supported: boolean; evidence?: never } | undefined {
  const option = tokens[optionIndex];
  if (option?.kind !== "word") return undefined;
  const attachedShortOption = [...optionsWithValue].find(
    (optionName) =>
      /^-[^-]$/u.test(optionName) &&
      option.value.startsWith(optionName) &&
      option.value.length > optionName.length,
  );
  if (attachedShortOption !== undefined) {
    return { nextIndex: optionIndex + 1, supported: true };
  }
  const equalsAt = option.value.indexOf("=");
  const optionName =
    equalsAt < 0 ? option.value : option.value.slice(0, equalsAt);
  if (equalsAt >= 0) {
    return optionsWithValue.has(optionName)
      ? {
          nextIndex: optionIndex + 1,
          supported: equalsAt < option.value.length - 1,
        }
      : optionsWithoutValue.has(optionName)
        ? { nextIndex: optionIndex + 1, supported: false }
        : undefined;
  }
  if (optionsWithoutValue.has(optionName)) {
    return { nextIndex: optionIndex + 1, supported: true };
  }
  if (!optionsWithValue.has(optionName)) return undefined;
  const value = tokens[optionIndex + 1];
  if (
    value?.kind !== "word" ||
    value.value.length === 0 ||
    value.value.startsWith("-")
  ) {
    return { nextIndex: optionIndex + 1, supported: false };
  }
  return { nextIndex: optionIndex + 2, supported: true };
}

function npmDependencyCommand(
  tokens: readonly ShellToken[],
  managerIndex: number,
): DependencyCommand | undefined {
  const managerToken = tokens[managerIndex];
  if (managerToken?.kind !== "word") return undefined;
  const manager = normalizedNpmManager(managerToken.value);
  if (manager === undefined) return undefined;
  let cursor = managerIndex + 1;
  let sawManagerOption = false;

  while (tokens[cursor]?.kind === "word") {
    const option = tokens[cursor];
    if (option === undefined || !option.value.startsWith("-")) break;
    sawManagerOption = true;
    const projection = consumeManagerOption(tokens, cursor, manager);
    if (projection === undefined) {
      const command = option.value.includes("=")
        ? supportedNpmDependencyCommand(tokens, cursor + 1, manager)
        : undefined;
      return {
        ecosystem: "npm",
        packageManager: manager,
        ...(command === undefined ? {} : command),
        supported: false,
      };
    }
    if (!projection.supported) {
      const command =
        projection.nextIndex === cursor + 1
          ? supportedNpmDependencyCommand(tokens, projection.nextIndex, manager)
          : undefined;
      return {
        ecosystem: "npm",
        packageManager: manager,
        ...(command === undefined ? {} : command),
        supported: false,
      };
    }
    cursor = projection.nextIndex;
  }

  const command = supportedNpmDependencyCommand(tokens, cursor, manager);
  if (command !== undefined) {
    return {
      ecosystem: "npm",
      packageManager: manager,
      ...command,
      supported: true,
    };
  }
  return sawManagerOption
    ? { ecosystem: "npm", packageManager: manager, supported: false }
    : undefined;
}

function pythonDependencyCommand(
  tokens: readonly ShellToken[],
  index: number,
): DependencyCommand | undefined {
  const first = tokens[index];
  if (first?.kind !== "word") return undefined;
  const value = first.value.toLowerCase();
  if (/^pip3?$/u.test(value)) {
    const previous = tokens[index - 1];
    if (
      previous?.kind === "word" &&
      (previous.value === "-m" || previous.value.toLowerCase() === "uv")
    ) {
      return undefined;
    }
    return pythonInstallCommand(tokens, index + 1, "pip");
  }
  if (PYTHON_EXECUTABLE_RE.test(value) || value === "py") {
    const moduleFlag = tokens[index + 1];
    const pip = tokens[index + 2];
    if (
      moduleFlag?.kind !== "word" ||
      moduleFlag.value !== "-m" ||
      pip?.kind !== "word" ||
      pip.value.toLowerCase() !== "pip"
    ) {
      return undefined;
    }
    return pythonInstallCommand(tokens, index + 3, "pip");
  }
  if (value === "uv") {
    const pip = tokens[index + 1];
    if (pip?.kind !== "word" || pip.value.toLowerCase() !== "pip") {
      return undefined;
    }
    return pythonInstallCommand(tokens, index + 2, "uv");
  }
  return undefined;
}

function pythonInstallCommand(
  tokens: readonly ShellToken[],
  commandIndex: number,
  packageManager: "pip" | "uv",
): DependencyCommand | undefined {
  const directInstall = tokens[commandIndex];
  if (
    directInstall?.kind === "word" &&
    directInstall.value.toLowerCase() === "install"
  ) {
    return {
      ecosystem: "pypi",
      packageManager,
      argumentsStart: commandIndex + 1,
      supported: true,
    };
  }
  if (packageManager !== "pip") {
    return undefined;
  }

  let cursor = commandIndex;
  while (cursor - commandIndex < MAX_PYTHON_GLOBAL_ARGUMENTS) {
    const token = tokens[cursor];
    if (token?.kind !== "word") {
      return undefined;
    }
    if (token.value.toLowerCase() === "install") {
      return {
        ecosystem: "pypi",
        packageManager,
        argumentsStart: cursor + 1,
        supported: true,
      };
    }
    if (!token.value.startsWith("-")) {
      return recoverPythonInstallCommand(tokens, cursor + 1, packageManager);
    }

    const optionName = token.value.split("=", 1)[0] ?? token.value;
    if (
      PYTHON_GLOBAL_OPTION_WITH_VALUE.has(optionName) &&
      !token.value.includes("=") &&
      tokens[cursor + 1]?.kind === "word" &&
      tokens[cursor + 1]?.value.toLowerCase() === "install"
    ) {
      return {
        ecosystem: "pypi",
        packageManager,
        argumentsStart: cursor + 2,
        supported: false,
      };
    }

    const option = consumeOrdinaryOption(
      tokens,
      cursor,
      PYTHON_GLOBAL_OPTION_WITH_VALUE,
      PYTHON_GLOBAL_OPTION_WITHOUT_VALUE,
    );
    if (option === undefined || !option.supported) {
      return recoverPythonInstallCommand(tokens, cursor + 1, packageManager);
    }
    cursor = option.nextIndex;
  }

  return recoverPythonInstallCommand(tokens, cursor, packageManager);
}

function recoverPythonInstallCommand(
  tokens: readonly ShellToken[],
  searchStart: number,
  packageManager: "pip" | "uv",
): DependencyCommand | undefined {
  const searchEnd = Math.min(
    tokens.length,
    searchStart + MAX_PYTHON_GLOBAL_ARGUMENTS,
  );
  for (let cursor = searchStart; cursor < searchEnd; cursor += 1) {
    const token = tokens[cursor];
    if (token?.kind === "operator") {
      break;
    }
    if (token?.kind === "word" && token.value.toLowerCase() === "install") {
      return {
        ecosystem: "pypi",
        packageManager,
        argumentsStart: cursor + 1,
        supported: false,
      };
    }
  }
  return undefined;
}

function supportedNpmDependencyCommand(
  tokens: readonly ShellToken[],
  commandIndex: number,
  manager: NpmPackageManager,
): Pick<DependencyCommand, "argumentsStart"> | undefined {
  const first = tokens[commandIndex];
  if (first?.kind !== "word") return undefined;
  if (manager === "yarn" && first.value.toLowerCase() === "global") {
    const add = tokens[commandIndex + 1];
    return add?.kind === "word" && add.value.toLowerCase() === "add"
      ? { argumentsStart: commandIndex + 2 }
      : undefined;
  }
  const command = first.value.toLowerCase();
  const accepted =
    manager === "npm"
      ? command === "install" || command === "i" || command === "add"
      : manager === "pnpm"
        ? command === "install" || command === "add"
        : command === "add";
  return accepted ? { argumentsStart: commandIndex + 1 } : undefined;
}

function consumeManagerOption(
  tokens: readonly ShellToken[],
  optionIndex: number,
  manager: NpmPackageManager,
): { nextIndex: number; supported: boolean } | undefined {
  const option = tokens[optionIndex];
  if (option?.kind !== "word") return undefined;
  const equalsAt = option.value.indexOf("=");
  const optionName =
    equalsAt < 0 ? option.value : option.value.slice(0, equalsAt);
  if (!NPM_MANAGER_OPTION_WITH_VALUE[manager].has(optionName)) {
    return undefined;
  }
  if (equalsAt >= 0) {
    return {
      nextIndex: optionIndex + 1,
      supported: equalsAt < option.value.length - 1,
    };
  }
  const value = tokens[optionIndex + 1];
  if (
    value?.kind !== "word" ||
    value.value.length === 0 ||
    value.value.startsWith("-")
  ) {
    return { nextIndex: optionIndex + 1, supported: false };
  }
  return { nextIndex: optionIndex + 2, supported: true };
}

function dependencyFromSelector(
  selector: DependencySelectorAnalysis,
  packageManager: DependencyInstallAnalysis["packageManager"],
  token: ShellToken,
  associatedGuards: ReadonlySet<string>,
  allowances: ReadonlyMap<string, FloatingDependencyAllowance>,
  shellProjection: ShellProjection,
  sourceLength: number,
): DependencyInstallAnalysis {
  const variables = variableEvidence(
    selector.normalizedSelector,
    token,
    associatedGuards,
  );
  const pinning = pinningForSelector(selector, variables);
  const allowanceKey = `${selector.ecosystem}:${selector.normalizedReference}`;
  const allowance =
    pinning === "floating-literal" ? allowances.get(allowanceKey) : undefined;
  return {
    ecosystem: selector.ecosystem,
    packageManager,
    ...(selector.packageName === undefined
      ? {}
      : { packageName: selector.packageName }),
    ...(selector.normalizedPackageName === undefined
      ? {}
      : { normalizedPackageName: selector.normalizedPackageName }),
    reference: selector.reference,
    selector: selector.selector,
    selectorKind: selector.selectorKind,
    pinning,
    variableNames: variables.variableNames,
    floatingAllowed: allowance !== undefined,
    ...(allowance === undefined ? {} : { allowance }),
    sourceSpan: projectionSpanToSourceSpan(
      { start: token.start, end: token.end },
      shellProjection,
      sourceLength,
    ),
  };
}

function pinningForSelector(
  selector: DependencySelectorAnalysis,
  variables: ReturnType<typeof variableEvidence>,
): DependencyPinningKind {
  if (selector.selectorKind === "exact") return "pinned-literal";
  if (selector.selectorKind === "variable") {
    const guardShapeAccepted =
      selector.ecosystem === "npm" ||
      PYTHON_EXACT_VARIABLE_SELECTOR_RE.test(selector.normalizedSelector);
    return guardShapeAccepted && variables.allVariablesFailClosed
      ? "pinned-variable-guarded"
      : "variable-unverified";
  }
  if (
    selector.selectorKind === "bare" ||
    selector.selectorKind === "dist-tag" ||
    selector.selectorKind === "range" ||
    selector.selectorKind === "wildcard"
  ) {
    return "floating-literal";
  }
  return "unpinned";
}

function variableEvidence(
  selector: string,
  token: ShellToken,
  associatedGuards: ReadonlySet<string>,
): { variableNames: string[]; allVariablesFailClosed: boolean } {
  const variableNames: string[] = [];
  let allVariablesFailClosed = true;
  let hasVariable = false;
  for (const match of selector.matchAll(VARIABLE_RE)) {
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
  if (selector.includes("$") && !hasVariable) {
    allVariablesFailClosed = false;
  }
  return {
    variableNames: [...new Set(variableNames)],
    allVariablesFailClosed: hasVariable && allVariablesFailClosed,
  };
}

function normalizedNpmManager(value: string): NpmPackageManager | undefined {
  const normalized = value.toLowerCase();
  return normalized === "npm" || normalized === "pnpm" || normalized === "yarn"
    ? normalized
    : undefined;
}

function isPlaceholder(value: string): boolean {
  return /^<.*>$|^\[.*\]$|^(example|placeholder|package)$/iu.test(value);
}
