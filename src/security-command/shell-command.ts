import { tokenizeBoundedShell, type ShellToken } from "./shell.js";

export type ShellExecutableResolution = {
  directIndex: number;
  effectiveIndex: number;
  directExecutable?: string;
  effectiveExecutable?: string;
  wrappers: readonly string[];
  sudo: boolean;
  executionCwdMayChange: boolean;
};

const SHELL_PRESENTATION_MARKER_RE = /^(?:[-*+$%]|\d+[.)])$/u;
const SHELL_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const SHELL_REDIRECTION_OPERATOR_RE = /^(?:>|>>|<|<<|&>)$/u;
const SHELL_WRAPPER_RE = /^(?:command|env)$/iu;
const SHELL_WRAPPER_OPTION_WITH_VALUE_RE = /^(?:-u|--unset|-C|--chdir)$/u;
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
    };
  }

  index = direct.index + 1;
  let sudoCwdMayChange = false;
  while ((words[index] ?? "").startsWith("-")) {
    const option = words[index] ?? "";
    index += 1;
    if (
      option === "-D" ||
      option === "--chdir" ||
      option.startsWith("--chdir=")
    ) {
      sudoCwdMayChange = true;
    }
    if (SUDO_OPTION_WITH_VALUE_RE.test(option)) index += 1;
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
): { index: number; wrappers: string[]; cwdMayChange: boolean } {
  let index = startIndex;
  const wrappers: string[] = [];
  let cwdMayChange = false;
  while (SHELL_ASSIGNMENT_RE.test(words[index] ?? "")) index += 1;
  while (SHELL_WRAPPER_RE.test(normalizeShellExecutable(words[index]) ?? "")) {
    const wrapper = normalizeShellExecutable(words[index]) ?? "";
    wrappers.push(wrapper);
    index += 1;
    while ((words[index] ?? "").startsWith("-")) {
      const option = words[index] ?? "";
      index += 1;
      if (option === "--") break;
      if (
        wrapper === "env" &&
        (option === "-C" ||
          option === "--chdir" ||
          option.startsWith("--chdir="))
      ) {
        cwdMayChange = true;
      }
      if (shellWrapperOptionConsumesValue(option)) index += 1;
    }
    while (SHELL_ASSIGNMENT_RE.test(words[index] ?? "")) index += 1;
  }
  return { index, wrappers, cwdMayChange };
}

function shellWrapperOptionConsumesValue(option: string): boolean {
  if (option.includes("=")) return false;
  return SHELL_WRAPPER_OPTION_WITH_VALUE_RE.test(option);
}
