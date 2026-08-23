import { tokenizeBoundedShell, type ShellToken } from "./shell.js";

export type ShellExecutableResolution = {
  directIndex: number;
  effectiveIndex: number;
  directExecutable?: string;
  effectiveExecutable?: string;
  wrappers: readonly string[];
  sudo: boolean;
  executionCwdMayChange: boolean;
  executionRootMayChange: boolean;
  executionDisposition: ShellExecutionDisposition;
};

export type ShellExecutionDisposition = "proven" | "not-executed" | "unknown";

const SHELL_PRESENTATION_MARKER_RE = /^(?:[-*+$%]|\d+[.)])$/u;
const SHELL_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const SHELL_REDIRECTION_OPERATOR_RE = /^(?:>|>>|<|<<|&>)$/u;
const SHELL_WRAPPER_RE = /^(?:command|env)$/iu;
const SHELL_WRAPPER_OPTION_WITH_VALUE_RE =
  /^(?:-u|--unset|-C|--chdir|-a|--argv0|-S|--split-string)$/u;
const SUDO_OPTION_WITH_VALUE_RE =
  /^(?:-[ughpCTRD]|--(?:user|group|host|prompt|chdir|command-timeout|chroot))$/u;

export function directShellExecutable(command: string): string | undefined {
  const words = shellCommandWords(command);
  if (words === undefined) return undefined;
  return normalizeShellExecutable(words[directShellExecutableIndex(words)]);
}

export function effectiveShellExecutable(command: string): string | undefined {
  const words = shellCommandWords(command);
  if (words === undefined) return undefined;
  return normalizeShellExecutable(words[effectiveShellExecutableIndex(words)]);
}

export function resolveShellExecutableWords(
  words: readonly string[],
): ShellExecutableResolution {
  let index = 0;
  while (SHELL_PRESENTATION_MARKER_RE.test(words[index] ?? "")) index += 1;
  const direct = wrappedShellExecutableResolution(words, index);
  const directExecutable = normalizeShellExecutable(words[direct.index]);
  if (directExecutable !== "sudo") {
    return {
      directIndex: direct.index,
      effectiveIndex: direct.index,
      ...(directExecutable === undefined ? {} : { directExecutable }),
      ...(directExecutable === undefined
        ? {}
        : { effectiveExecutable: directExecutable }),
      wrappers: Object.freeze([...direct.wrappers]),
      sudo: false,
      executionCwdMayChange: direct.cwdMayChange,
      executionRootMayChange: false,
      executionDisposition: direct.executionDisposition,
    };
  }

  index = direct.index + 1;
  let sudoCwdMayChange = false;
  let sudoRootMayChange = false;
  let sudoExecutionDisposition: ShellExecutionDisposition = "proven";
  while ((words[index] ?? "").startsWith("-")) {
    const option = words[index] ?? "";
    index += 1;
    sudoExecutionDisposition = combineExecutionDispositions(
      sudoExecutionDisposition,
      sudoOptionExecutionDisposition(option),
    );
    if (
      option === "-D" ||
      option === "--chdir" ||
      option.startsWith("--chdir=") ||
      (option.startsWith("-D") && option.length > 2) ||
      option === "--login" ||
      option === "-i" ||
      (/^-[^-]*i/u.test(option) && option.length > 2)
    ) {
      sudoCwdMayChange = true;
    }
    if (
      option === "-R" ||
      option === "--chroot" ||
      option.startsWith("--chroot=") ||
      (option.startsWith("-R") && option.length > 2)
    ) {
      sudoRootMayChange = true;
    }
    if (SUDO_OPTION_WITH_VALUE_RE.test(option)) {
      if ((words[index] ?? "").length === 0) {
        sudoExecutionDisposition = combineExecutionDispositions(
          sudoExecutionDisposition,
          "not-executed",
        );
      }
      index += 1;
    }
  }
  const effective = wrappedShellExecutableResolution(words, index);
  const effectiveExecutable = normalizeShellExecutable(words[effective.index]);
  return {
    directIndex: direct.index,
    effectiveIndex: effective.index,
    directExecutable,
    ...(effectiveExecutable === undefined ? {} : { effectiveExecutable }),
    wrappers: Object.freeze([...direct.wrappers, ...effective.wrappers]),
    sudo: true,
    executionCwdMayChange:
      direct.cwdMayChange || sudoCwdMayChange || effective.cwdMayChange,
    executionRootMayChange: sudoRootMayChange,
    executionDisposition: combineExecutionDispositions(
      direct.executionDisposition,
      sudoExecutionDisposition,
      effective.executionDisposition,
    ),
  };
}

export function effectiveShellExecutableIndex(
  words: readonly string[],
): number {
  return resolveShellExecutableWords(words).effectiveIndex;
}

export function directShellExecutableIndex(words: readonly string[]): number {
  return resolveShellExecutableWords(words).directIndex;
}

export function normalizeShellExecutable(
  word: string | undefined,
): string | undefined {
  if (word === undefined) return undefined;
  return word.slice(word.lastIndexOf("/") + 1).toLowerCase();
}

export function shellCommandWords(command: string): string[] | undefined {
  return shellCommandWordTokens(command)?.map(({ value }) => value);
}

export function shellCommandWordTokens(
  command: string,
): ShellToken[] | undefined {
  const tokenization = tokenizeBoundedShell(command);
  if (!tokenization.supported) return undefined;

  const words: ShellToken[] = [];
  let skipRedirectionTarget = false;
  for (const [index, token] of tokenization.tokens.entries()) {
    if (token.kind === "operator") {
      skipRedirectionTarget = SHELL_REDIRECTION_OPERATOR_RE.test(token.value);
      continue;
    }
    const next = tokenization.tokens[index + 1];
    if (
      /^\d+$/u.test(token.value) &&
      next?.kind === "operator" &&
      SHELL_REDIRECTION_OPERATOR_RE.test(next.value) &&
      token.end === next.start
    ) {
      continue;
    }
    if (skipRedirectionTarget) {
      skipRedirectionTarget = false;
      continue;
    }
    words.push(token);
  }
  return words;
}

function wrappedShellExecutableResolution(
  words: readonly string[],
  startIndex: number,
): {
  index: number;
  wrappers: string[];
  cwdMayChange: boolean;
  executionDisposition: ShellExecutionDisposition;
} {
  let index = startIndex;
  const wrappers: string[] = [];
  let cwdMayChange = false;
  let executionDisposition: ShellExecutionDisposition = "proven";
  while (SHELL_ASSIGNMENT_RE.test(words[index] ?? "")) index += 1;
  while (SHELL_WRAPPER_RE.test(normalizeShellExecutable(words[index]) ?? "")) {
    const wrapper = normalizeShellExecutable(words[index]) ?? "";
    wrappers.push(wrapper);
    index += 1;
    while ((words[index] ?? "").startsWith("-")) {
      const option = words[index] ?? "";
      index += 1;
      if (option === "--") break;
      executionDisposition = combineExecutionDispositions(
        executionDisposition,
        wrapperOptionExecutionDisposition(wrapper, option),
      );
      if (
        wrapper === "env" &&
        (option === "-C" ||
          option === "--chdir" ||
          option.startsWith("--chdir=") ||
          (option.startsWith("-C") && option.length > 2))
      ) {
        cwdMayChange = true;
      }
      if (shellWrapperOptionConsumesValue(option)) {
        if ((words[index] ?? "").length === 0) {
          executionDisposition = combineExecutionDispositions(
            executionDisposition,
            "not-executed",
          );
        }
        index += 1;
      }
    }
    while (SHELL_ASSIGNMENT_RE.test(words[index] ?? "")) index += 1;
  }
  return { index, wrappers, cwdMayChange, executionDisposition };
}

function shellWrapperOptionConsumesValue(option: string): boolean {
  if (option.includes("=")) return false;
  return SHELL_WRAPPER_OPTION_WITH_VALUE_RE.test(option);
}

function wrapperOptionExecutionDisposition(
  wrapper: string,
  option: string,
): ShellExecutionDisposition {
  if (wrapper === "command") {
    if (/^-p+$/u.test(option)) return "proven";
    if (option === "--help" || /^-[p]*[vV][pvV]*$/u.test(option)) {
      return "not-executed";
    }
    return "unknown";
  }
  if (wrapper !== "env") return "unknown";
  if (option === "--help" || option === "--version") {
    return "not-executed";
  }
  return option === "-v" ||
    option === "--debug" ||
    option === "-i" ||
    option === "--ignore-environment" ||
    option === "-u" ||
    option === "--unset" ||
    (option.startsWith("--unset=") && option.length > "--unset=".length) ||
    /^-u.+/u.test(option) ||
    option === "-C" ||
    option === "--chdir" ||
    (option.startsWith("--chdir=") && option.length > "--chdir=".length) ||
    /^-C.+/u.test(option) ||
    option === "-S" ||
    option === "--split-string" ||
    (option.startsWith("--split-string=") &&
      option.length > "--split-string=".length) ||
    option === "-a" ||
    option === "--argv0" ||
    (option.startsWith("--argv0=") && option.length > "--argv0=".length)
    ? "proven"
    : "unknown";
}

function sudoOptionExecutionDisposition(
  option: string,
): ShellExecutionDisposition {
  if (option === "--") return "proven";
  if (option.startsWith("--")) {
    const equals = option.indexOf("=");
    const name = option.slice(0, equals < 0 ? undefined : equals);
    const attachedValue = equals < 0 ? undefined : option.slice(equals + 1);
    if (
      new Set([
        "--help",
        "--version",
        "--list",
        "--validate",
        "--reset-timestamp",
        "--remove-timestamp",
      ]).has(name)
    ) {
      return "not-executed";
    }
    const valueTaking = new Set([
      "--user",
      "--group",
      "--host",
      "--prompt",
      "--chdir",
      "--command-timeout",
      "--chroot",
    ]);
    if (valueTaking.has(name)) {
      return attachedValue === undefined || attachedValue.length > 0
        ? "proven"
        : "not-executed";
    }
    if (name === "--preserve-env") {
      return attachedValue === undefined || attachedValue.length > 0
        ? "proven"
        : "not-executed";
    }
    const flagOnly = new Set([
      "--set-home",
      "--login",
      "--non-interactive",
      "--stdin",
      "--shell",
    ]);
    if (flagOnly.has(name) && attachedValue === undefined) return "proven";
    return "unknown";
  }
  if (!option.startsWith("-") || option === "-") return "unknown";
  const flags = option.slice(1);
  if (/[hVlvkK]/u.test(flags)) return "not-executed";
  if (/^[AbBEHinPSs]+$/u.test(flags)) return "proven";
  if (
    /^-[ughpCTRD].+/u.test(option) ||
    SUDO_OPTION_WITH_VALUE_RE.test(option)
  ) {
    return "proven";
  }
  return "unknown";
}

function combineExecutionDispositions(
  ...dispositions: readonly ShellExecutionDisposition[]
): ShellExecutionDisposition {
  if (dispositions.includes("not-executed")) return "not-executed";
  if (dispositions.includes("unknown")) return "unknown";
  return "proven";
}
